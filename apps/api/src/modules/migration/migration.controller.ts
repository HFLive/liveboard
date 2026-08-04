import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { createReadStream, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Request, Response } from "express";
import { CurrentUserId } from "../../common/current-user-id.decorator";
import { MigrationService } from "./migration.service";

class StartExportDto {
  includeObjects?: boolean;
  /** 对象直推目标 R2（server→vercel 方向）：包内不含对象，需源服务器配置 TARGET_R2_*。 */
  pushToR2?: boolean;
}

class StartImportDto {
  source!: string;
  confirm!: string;
}

/**
 * 浏览器上传落盘目录（≤100MB 小包）；与 service 的 MIGRATION_DATA_DIR 一致。
 * 目录创建必须容错：Vercel 只读文件系统、宿主未挂载、CI 直跑（无挂载）时，
 * 应用仍必须能启动。multer 的 DiskStorage 构造器在实例化 FileInterceptor 时
 * 会自行 mkdirSync(dest)——这一步不在 controller 的 try/catch 覆盖范围内，
 * 直接把不可写路径传给它会在 Nest 实例化 controller 时抛 EACCES，击穿整个 API。
 * 因此不可写时回退到系统临时目录；上传接口在请求期由 ensureMigrationDirs 判定
 * 不可用并拒绝（同时清理 multer 已落盘的临时文件）。
 */
let UPLOAD_DEST = path.join(
  process.env.MIGRATION_DATA_DIR?.trim() || "/data/migration",
  "incoming",
);
try {
  mkdirSync(UPLOAD_DEST, { recursive: true, mode: 0o700 });
} catch {
  UPLOAD_DEST = tmpdir();
}

const MAX_UPLOAD_SIZE_BYTES = 100 * 1024 * 1024;

/** 上传文件的字段子集，避免依赖 @types/multer 的全局类型。 */
export interface UploadedPackageFile {
  originalname?: string;
  size?: number;
  path?: string;
}

@Controller()
export class MigrationController {
  constructor(private readonly migration: MigrationService) {}

  @Get("admin/migration/info")
  async info(@CurrentUserId() userId: string | null) {
    return { info: await this.migration.getInfo(userId) };
  }

  @Post("admin/migration/export")
  async startExport(
    @CurrentUserId() userId: string | null,
    @Body() body: StartExportDto,
  ) {
    return {
      job: await this.migration.startExport(userId, {
        includeObjects: body.includeObjects !== false,
        pushToR2: body.pushToR2 === true,
      }),
    };
  }

  @Post("admin/migration/import")
  async startImport(
    @CurrentUserId() userId: string | null,
    @Body() body: StartImportDto,
  ) {
    return {
      job: await this.migration.startImport(userId, {
        source: body.source,
        confirm: body.confirm,
      }),
    };
  }

  @Get("admin/migration/jobs")
  async listJobs(@CurrentUserId() userId: string | null) {
    return { jobs: await this.migration.listJobs(userId) };
  }

  @Get("admin/migration/jobs/:id")
  async getJob(
    @CurrentUserId() userId: string | null,
    @Param("id") id: string,
  ) {
    return { job: await this.migration.getJob(userId, id) };
  }

  @Get("admin/migration/incoming")
  async listIncoming(@CurrentUserId() userId: string | null) {
    return { packages: await this.migration.listIncoming(userId) };
  }

  /** 浏览器上传小包（≤100MB）；大包请走服务器目录（路径式导入）。 */
  @Post("admin/migration/incoming/upload")
  @UseInterceptors(
    FileInterceptor("file", {
      dest: UPLOAD_DEST,
      limits: { fileSize: MAX_UPLOAD_SIZE_BYTES, files: 1 },
    }),
  )
  async uploadPackage(
    @CurrentUserId() userId: string | null,
    @UploadedFile() file?: UploadedPackageFile,
  ) {
    return { package: await this.migration.uploadPackage(userId, file) };
  }

  /** 导出包下载。支持单段 Range（断点续传），Nginx 侧已对齐大文件超时。 */
  @Get("admin/migration/exports/:name")
  async downloadExport(
    @CurrentUserId() userId: string | null,
    @Param("name") name: string,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    const { path: filePath, size } = await this.migration.exportPackagePath(
      userId,
      name,
    );
    response.setHeader("Content-Type", "application/x-tar");
    response.setHeader(
      "Content-Disposition",
      `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
    );
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Accept-Ranges", "bytes");

    // 单段 Range：bytes=start-end / bytes=start- / bytes=-suffix；不支持多段或
    // 越界时按 416 返回（附 Content-Range: bytes */size）。
    let statusCode = 200;
    let start = 0;
    let end = size - 1;
    const range = request.headers.range;
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (match && (match[1] !== "" || match[2] !== "")) {
        const from = match[1] === "" ? undefined : Number(match[1]);
        const to = match[2] === "" ? undefined : Number(match[2]);
        if (from === undefined) {
          start = Math.max(0, size - (to ?? 0));
          end = size - 1;
        } else {
          start = from;
          end = to === undefined ? size - 1 : Math.min(to, size - 1);
        }
        if (start >= size || start > end) {
          response.setHeader("Content-Range", `bytes */${size}`);
          response.status(416).end();
          return;
        }
        statusCode = 206;
        response.setHeader("Content-Range", `bytes ${start}-${end}/${size}`);
        response.setHeader("Content-Length", String(end - start + 1));
      }
      // 非 bytes= 语法或空段：忽略 Range，整包返回。
    }
    response.status(statusCode);
    if (statusCode === 200) {
      response.setHeader("Content-Length", String(size));
    }
    // stat 之后文件可能被清理/删除：不加 error 监听会让响应悬挂。
    const stream = createReadStream(filePath, { start, end });
    stream.on("error", () => {
      if (!response.headersSent) {
        response.status(500).json({ error: "导出包读取失败" });
      } else {
        response.destroy();
      }
    });
    stream.pipe(response);
  }
}
