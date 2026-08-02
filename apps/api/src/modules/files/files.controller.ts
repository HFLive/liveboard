import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { Type } from "class-transformer";
import type { Request, Response } from "express";
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from "class-validator";
import type { FileType } from "@liveboard/shared";
import type { ContentBlockType } from "@liveboard/shared";
import { CurrentUserId } from "../../common/current-user-id.decorator";
import {
  PRIVATE_IMMUTABLE_CACHE_CONTROL,
  PRIVATE_NO_STORE_CACHE_CONTROL,
} from "../../common/cache-control";
import {
  AssetsService,
  MAX_ASSET_SIZE_BYTES,
  type UploadedAssetFile,
} from "./assets.service";
import { isSafeInlineImageMime } from "../storage/storage-backend";
import { FilesService } from "./files.service";
import { MAX_MARKDOWN_SIZE_BYTES } from "./markdown";
import { createRequestAbortSignal } from "../../common/request-abort";

class CreateFolderDto {
  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  parentId?: string;
}

class CreateFileDto {
  @IsString()
  folderId!: string;

  @IsString()
  title!: string;

  @IsOptional()
  @IsIn(["book", "lesson", "course", "exercise_set", "doc", "asset"])
  type?: FileType;
}

class UpdateFolderDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  parentId?: string | null;
}

class DeleteFolderDto {
  @IsBoolean()
  recursive!: boolean;

  @IsString()
  confirmationName!: string;
}

class UpdateFileDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  folderId?: string;
}

class CreateBlockDto {
  @IsIn([
    "heading_1",
    "heading_2",
    "heading_3",
    "heading_4",
    "heading_5",
    "heading_6",
    "paragraph",
    "bulleted_list",
    "numbered_list",
    "todo",
    "code",
    "quote",
    "image",
    "attachment",
    "bilibili",
    "divider",
    "question",
    "table",
    "math",
  ])
  type!: ContentBlockType;

  @IsObject()
  dataJson!: Record<string, unknown>;

  // 指定后把新块插入到该块之后；缺省追加到文末。
  @IsOptional()
  @IsString()
  afterBlockId?: string;
}

class UpdateBlockDto {
  @IsOptional()
  @IsIn([
    "heading_1",
    "heading_2",
    "heading_3",
    "heading_4",
    "heading_5",
    "heading_6",
    "paragraph",
    "bulleted_list",
    "numbered_list",
    "todo",
    "code",
    "quote",
    "image",
    "attachment",
    "bilibili",
    "divider",
    "question",
    "table",
    "math",
  ])
  type?: ContentBlockType;

  @IsObject()
  dataJson!: Record<string, unknown>;
}

class ReorderBlocksDto {
  @IsArray()
  @IsString({ each: true })
  blockIds!: string[];
}

class ContentPinTargetDto {
  @IsIn(["folder", "file"])
  targetType!: "folder" | "file";

  @IsString()
  targetId!: string;
}

class UpdateContentPinsDto {
  @IsString()
  folderId!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ContentPinTargetDto)
  items!: ContentPinTargetDto[];
}

class UploadAssetDto {
  @IsOptional()
  @IsString()
  folderId?: string;

  @IsOptional()
  @IsString()
  fileId?: string;
}

class SignAssetUploadDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  filename!: string;

  @IsInt()
  @Min(1)
  sizeBytes!: number;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  mimeType?: string;

  @IsOptional()
  @IsString()
  folderId?: string;

  @IsOptional()
  @IsString()
  fileId?: string;
}

class ConfirmAssetUploadDto {
  @IsString()
  @IsNotEmpty()
  uploadId!: string;
}

class RenameAssetDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  filename!: string;
}

class ImportMarkdownDto {
  @IsString()
  folderId!: string;
}

interface UploadedMarkdownFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

function decodeMultipartFilename(filename: string) {
  const decoded = Buffer.from(filename, "latin1").toString("utf8");

  return decoded.includes("\uFFFD") ? filename : decoded;
}

@Controller()
export class FilesController {
  constructor(
    private readonly assetsService: AssetsService,
    private readonly filesService: FilesService,
  ) {}

  @Get("folders/tree")
  async folderTree(@CurrentUserId() userId: string | null) {
    return this.filesService.getFolderTree(userId);
  }

  @Patch("content-pins")
  async updateContentPins(
    @CurrentUserId() userId: string | null,
    @Body() body: UpdateContentPinsDto,
  ) {
    return this.filesService.updateContentPins(userId, body);
  }

  @Post("folders")
  async createFolder(
    @CurrentUserId() userId: string | null,
    @Body() body: CreateFolderDto,
  ) {
    return { folder: await this.filesService.createFolder(userId, body) };
  }

  @Patch("folders/:id")
  async updateFolder(
    @CurrentUserId() userId: string | null,
    @Param("id") folderId: string,
    @Body() body: UpdateFolderDto,
  ) {
    return {
      folder: await this.filesService.updateFolder(userId, folderId, body),
    };
  }

  @Delete("folders/:id")
  async deleteFolder(
    @CurrentUserId() userId: string | null,
    @Param("id") folderId: string,
    @Body() body: DeleteFolderDto,
  ) {
    return this.filesService.deleteFolder(userId, folderId, body);
  }

  @Get("files")
  async listFiles(
    @CurrentUserId() userId: string | null,
    @Query("folderId") folderId?: string,
  ) {
    return this.filesService.listFiles(userId, {
      folderId,
    });
  }

  @Get("files/:id")
  async getFile(
    @CurrentUserId() userId: string | null,
    @Param("id") fileId: string,
  ) {
    return { file: await this.filesService.getFile(userId, fileId) };
  }

  @Post("files")
  async createFile(
    @CurrentUserId() userId: string | null,
    @Body() body: CreateFileDto,
  ) {
    return { file: await this.filesService.createFile(userId, body) };
  }

  @Post("files/import/markdown")
  @UseInterceptors(
    FileInterceptor("file", {
      defParamCharset: "utf8",
      limits: { fileSize: MAX_MARKDOWN_SIZE_BYTES, files: 1 },
    }),
  )
  async importMarkdown(
    @CurrentUserId() userId: string | null,
    @Body() body: ImportMarkdownDto,
    @UploadedFile() file?: UploadedMarkdownFile,
  ) {
    if (!file) {
      return this.filesService.importMarkdown(userId, {
        folderId: body.folderId,
        originalname: "",
        size: 0,
        buffer: Buffer.alloc(0),
      });
    }

    return this.filesService.importMarkdown(userId, {
      folderId: body.folderId,
      originalname: decodeMultipartFilename(file.originalname),
      size: file.size,
      buffer: file.buffer,
    });
  }

  @Get("files/:id/export/markdown")
  async exportMarkdown(
    @CurrentUserId() userId: string | null,
    @Param("id") fileId: string,
    @Res() response: Response,
  ) {
    const result = await this.filesService.exportMarkdown(userId, fileId);
    const encodedFilename = encodeURIComponent(result.filename);
    response.setHeader("Content-Type", "text/markdown; charset=utf-8");
    response.setHeader("Cache-Control", PRIVATE_NO_STORE_CACHE_CONTROL);
    response.setHeader(
      "Content-Disposition",
      `attachment; filename="content.md"; filename*=UTF-8''${encodedFilename}`,
    );
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.send(result.content);
  }

  @Patch("files/:id")
  async updateFile(
    @CurrentUserId() userId: string | null,
    @Param("id") fileId: string,
    @Body() body: UpdateFileDto,
  ) {
    return { file: await this.filesService.updateFile(userId, fileId, body) };
  }

  @Post("files/:id/publish")
  async publishFile(
    @CurrentUserId() userId: string | null,
    @Param("id") fileId: string,
  ) {
    return { file: await this.filesService.publishFile(userId, fileId) };
  }

  @Delete("files/:id")
  async deleteFile(
    @CurrentUserId() userId: string | null,
    @Param("id") fileId: string,
  ) {
    return this.filesService.deleteFile(userId, fileId);
  }

  @Delete("files/:id/import-warnings")
  async dismissImportWarnings(
    @CurrentUserId() userId: string | null,
    @Param("id") fileId: string,
  ) {
    return this.filesService.dismissImportWarnings(userId, fileId);
  }

  @Get("files/:id/blocks")
  async listBlocks(
    @CurrentUserId() userId: string | null,
    @Param("id") fileId: string,
  ) {
    return { blocks: await this.filesService.listBlocks(userId, fileId) };
  }

  @Post("files/:id/blocks")
  async createBlock(
    @CurrentUserId() userId: string | null,
    @Param("id") fileId: string,
    @Body() body: CreateBlockDto,
  ) {
    return { block: await this.filesService.createBlock(userId, fileId, body) };
  }

  @Patch("files/:id/blocks/reorder")
  async reorderBlocks(
    @CurrentUserId() userId: string | null,
    @Param("id") fileId: string,
    @Body() body: ReorderBlocksDto,
  ) {
    return {
      blocks: await this.filesService.reorderBlocks(userId, fileId, body),
    };
  }

  @Post("assets/upload")
  @UseInterceptors(
    FileInterceptor("file", {
      defParamCharset: "utf8",
      limits: { fileSize: MAX_ASSET_SIZE_BYTES, files: 1 },
    }),
  )
  async uploadAsset(
    @CurrentUserId() userId: string | null,
    @Body() body: UploadAssetDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @UploadedFile() file?: UploadedAssetFile,
  ) {
    const requestAbort = createRequestAbortSignal(request, response);
    try {
      return {
        asset: await this.assetsService.uploadAsset(
          userId,
          body,
          file,
          requestAbort.signal,
        ),
      };
    } finally {
      requestAbort.dispose();
    }
  }

  @Post("assets/upload-url")
  async signAssetUpload(
    @CurrentUserId() userId: string | null,
    @Body() body: SignAssetUploadDto,
  ) {
    return this.assetsService.signAssetUpload(userId, body);
  }

  @Post("assets/upload-confirm")
  async confirmAssetUpload(
    @CurrentUserId() userId: string | null,
    @Body() body: ConfirmAssetUploadDto,
  ) {
    return {
      asset: await this.assetsService.confirmAssetUpload(userId, body.uploadId),
    };
  }

  @Post("assets/upload-abort")
  async abortAssetUpload(
    @CurrentUserId() userId: string | null,
    @Body() body: ConfirmAssetUploadDto,
  ) {
    return this.assetsService.abortAssetUpload(userId, body.uploadId);
  }

  @Get("assets/library")
  async listLibraryAssets(@CurrentUserId() userId: string | null) {
    return {
      assets: await this.assetsService.listLibraryAssets(userId),
    };
  }

  @Delete("assets/:id")
  async deleteAsset(
    @CurrentUserId() userId: string | null,
    @Param("id") assetId: string,
  ) {
    return this.assetsService.deleteLibraryAsset(userId, assetId);
  }

  @Patch("assets/:id")
  async renameAsset(
    @CurrentUserId() userId: string | null,
    @Param("id") assetId: string,
    @Body() body: RenameAssetDto,
  ) {
    return {
      asset: await this.assetsService.renameStandaloneAsset(
        userId,
        assetId,
        body.filename,
      ),
    };
  }

  @Get("assets/:id/references")
  async listAssetReferences(
    @CurrentUserId() userId: string | null,
    @Param("id") assetId: string,
  ) {
    return {
      references: await this.assetsService.listAssetReferences(userId, assetId),
    };
  }

  @Get("assets/:id/preview")
  async previewAsset(
    @CurrentUserId() userId: string | null,
    @Param("id") assetId: string,
    @Res() response: Response,
  ) {
    const preview = await this.assetsService.getAssetForPreview(
      userId,
      assetId,
    );
    const contentType =
      preview.kind === "pdf"
        ? "application/pdf"
        : preview.kind === "markdown"
          ? "text/markdown; charset=utf-8"
          : "text/plain; charset=utf-8";
    response.setHeader("Content-Type", contentType);
    response.setHeader("Content-Disposition", "inline");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Cross-Origin-Resource-Policy", "same-site");
    response.setHeader("Content-Security-Policy", "sandbox");
    response.setHeader("Cache-Control", PRIVATE_IMMUTABLE_CACHE_CONTROL);
    if (preview.kind === "pdf") {
      // PDF 可能接近 25MB，超过 Vercel 普通响应体上限，必须流式 pipe。
      response.setHeader("Content-Length", String(preview.asset.sizeBytes));
      preview.stream.pipe(response);
      return;
    }
    response.send(preview.content);
  }

  @Get("assets/:id")
  async getAsset(
    @CurrentUserId() userId: string | null,
    @Param("id") assetId: string,
    @Res() res: Response,
    @Query("download") download?: string,
  ) {
    const forceDownload = download === "1" || download === "true";
    const { asset, stream, redirectUrl } =
      await this.assetsService.getAssetForDownload(
        userId,
        assetId,
        forceDownload,
      );

    if (redirectUrl) {
      res.setHeader("Cache-Control", PRIVATE_NO_STORE_CACHE_CONTROL);
      res.redirect(302, redirectUrl);
      return;
    }

    const inline = !forceDownload && isSafeInlineImageMime(asset.mimeType);
    res.setHeader(
      "Content-Type",
      inline ? asset.mimeType : "application/octet-stream",
    );
    if (inline) {
      // 资产内容不可变（id 固定对应一个对象），让浏览器缓存预览图，
      // 避免每次打开页面都重走一遍带宽受限的中转下载。
      res.setHeader("Cache-Control", PRIVATE_IMMUTABLE_CACHE_CONTROL);
    } else {
      res.setHeader("Cache-Control", PRIVATE_NO_STORE_CACHE_CONTROL);
    }
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader(
      "Cross-Origin-Resource-Policy",
      inline ? "same-site" : "same-origin",
    );
    if (!inline) res.setHeader("Content-Security-Policy", "sandbox");
    res.setHeader(
      "Content-Disposition",
      `${inline ? "inline" : "attachment"}; filename="${encodeURIComponent(asset.filename)}"`,
    );
    res.setHeader("Content-Length", String(asset.sizeBytes));
    stream!.pipe(res);
  }

  @Patch("blocks/:id")
  async updateBlock(
    @CurrentUserId() userId: string | null,
    @Param("id") blockId: string,
    @Body() body: UpdateBlockDto,
  ) {
    return {
      block: await this.filesService.updateBlock(userId, blockId, body),
    };
  }

  @Delete("blocks/:id")
  async deleteBlock(
    @CurrentUserId() userId: string | null,
    @Param("id") blockId: string,
  ) {
    return this.filesService.deleteBlock(userId, blockId);
  }
}
