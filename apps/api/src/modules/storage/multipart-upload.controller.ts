import {
  BadRequestException,
  Body,
  Controller,
  NotFoundException,
  Param,
  Post,
  Put,
  Req,
} from "@nestjs/common";
import { IsInt, Min } from "class-validator";
import type { PendingUpload } from "@prisma/client";
import type { Request } from "express";
import { CurrentUserId } from "../../common/current-user-id.decorator";
import { PrismaService } from "../prisma/prisma.service";
import { MULTIPART_UPLOAD_PART_SIZE_BYTES } from "./storage-backend";
import { StorageService } from "./storage.service";

class SignMultipartPartDto {
  @IsInt()
  @Min(1)
  sizeBytes!: number;
}

/**
 * 统一的 multipart 分片入口。
 *
 * - direct：只通过这里为每片签发短期 PUT 地址，文件字节仍直达 OSS/R2；
 * - relay：浏览器把一个原始二进制分片 PUT 到这里，接口返回前已写入对象存储。
 * 业务域仍负责自己的 upload-confirm、文件头校验和数据库事务。
 */
@Controller("uploads")
export class MultipartUploadController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  @Post(":uploadId/parts/:partNumber/url")
  async signPartUrl(
    @CurrentUserId() userId: string | null,
    @Param("uploadId") uploadId: string,
    @Param("partNumber") partNumber: string,
    @Body() body: SignMultipartPartDto,
  ) {
    const pending = await this.requirePending(userId, uploadId);
    return this.storage.presignMultipartPartForPending(
      pending,
      Number(partNumber),
      body.sizeBytes,
    );
  }

  @Put(":uploadId/parts/:partNumber")
  async uploadPart(
    @CurrentUserId() userId: string | null,
    @Param("uploadId") uploadId: string,
    @Param("partNumber") partNumber: string,
    @Req() request: Request,
  ) {
    const pending = await this.requirePending(userId, uploadId);
    const declaredSize = Number(request.headers["content-length"]);
    if (
      Number.isInteger(declaredSize) &&
      declaredSize > MULTIPART_UPLOAD_PART_SIZE_BYTES
    ) {
      throw new BadRequestException("上传分片过大");
    }
    const data = await readRawRequestBody(
      request,
      MULTIPART_UPLOAD_PART_SIZE_BYTES,
    );
    await this.storage.uploadMultipartPartForPending(
      pending,
      Number(partNumber),
      data,
    );
    return { ok: true as const, partNumber: Number(partNumber) };
  }

  private async requirePending(userId: string | null, uploadId: string) {
    if (!userId) throw new NotFoundException("上传任务不存在或已完成");
    const pending = await this.prisma.pendingUpload.findUnique({
      where: { id: uploadId },
    });
    if (!pending || pending.uploadedBy !== userId) {
      throw new NotFoundException("上传任务不存在或已完成");
    }
    if (pending.expiresAt.getTime() <= Date.now()) {
      await this.storage.discardPendingUpload(pending);
      throw new NotFoundException("上传任务已过期,请重新上传");
    }
    return pending;
  }
}

async function readRawRequestBody(request: Request, maxBytes: number) {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request as unknown as AsyncIterable<
    Buffer | Uint8Array | string
  >) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > maxBytes) {
      throw new BadRequestException("上传分片过大");
    }
    chunks.push(buffer);
  }
  if (total === 0) throw new BadRequestException("上传分片不能为空");
  return Buffer.concat(chunks, total);
}
