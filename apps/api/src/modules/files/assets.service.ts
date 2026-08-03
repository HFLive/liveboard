import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  NotImplementedException,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { canEdit, isSuperAdmin, isSystemAdmin } from "@liveboard/shared";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { Prisma, type PendingUpload } from "@prisma/client";
import { PermissionsService } from "../permissions/permissions.service";
import { PrismaService } from "../prisma/prisma.service";
import {
  isSafeInlineImageMime,
  type StorageBackendName,
} from "../storage/storage-backend";
import {
  PDF_PREVIEW_PRESIGN_EXPIRY_SECONDS,
  StorageService,
} from "../storage/storage.service";
import { DEFAULT_MEMBER_ATTACHMENT_QUOTA_BYTES } from "../../common/storage-quota";
import { requireResourceName } from "../../common/resource-name";
import { putObjectWithCompensation } from "../storage/upload-compensation";

export interface UploadedAssetFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

export interface UploadAssetInput {
  folderId?: string;
  fileId?: string;
}

export interface SignAssetUploadInput extends UploadAssetInput {
  filename: string;
  sizeBytes: number;
  mimeType?: string;
}

export const MAX_ASSET_SIZE_BYTES = 50 * 1024 * 1024;
export const MAX_PDF_PREVIEW_SIZE_BYTES = 25 * 1024 * 1024;
export const MAX_TEXT_PREVIEW_SIZE_BYTES = 2 * 1024 * 1024;
/** 签名直入预留的有效期;超时未确认的预留会被定时及惰性清理。 */
const PENDING_UPLOAD_TTL_MS = 60 * 60 * 1000;
export const MAX_FORUM_IMAGES = 9;
export const MAX_FORUM_REPLY_IMAGES = 3;
export const MAX_FORUM_IMAGE_SIZE_BYTES = 10 * 1024 * 1024;
export type AssetPreviewKind = "pdf" | "markdown" | "text";

export function getAssetPreviewKind(
  filename: string,
  mimeType: string,
): AssetPreviewKind | null {
  const lowerName = filename.trim().toLowerCase();
  const normalizedMime = mimeType.trim().toLowerCase();
  if (
    lowerName.endsWith(".pdf") &&
    ["application/pdf", "application/octet-stream"].includes(normalizedMime)
  ) {
    return "pdf";
  }
  if (
    (lowerName.endsWith(".md") || lowerName.endsWith(".markdown")) &&
    ["text/markdown", "text/plain", "application/octet-stream"].includes(
      normalizedMime,
    )
  ) {
    return "markdown";
  }
  if (
    lowerName.endsWith(".txt") &&
    ["text/plain", "application/octet-stream"].includes(normalizedMime)
  ) {
    return "text";
  }
  return null;
}

@Injectable()
export class AssetsService {
  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionsService,
    private readonly storage: StorageService,
  ) {}

  async uploadAsset(
    userId: string | null,
    input: UploadAssetInput,
    file: UploadedAssetFile | undefined,
    signal?: AbortSignal,
  ) {
    if (!userId) {
      throw new UnauthorizedException("Missing session");
    }

    if (!file) {
      throw new BadRequestException("请选择要上传的文件");
    }

    if (file.size > MAX_ASSET_SIZE_BYTES) {
      throw new BadRequestException("文件不能超过 50MB");
    }

    const filename = requireResourceName(file.originalname, "文件名称");
    const mimeType = normalizeAssetMimeType(file);

    const context = await this.resolveUploadContext(userId, input);
    if (context.kind === "standalone") {
      assertStandaloneTypeAllowed(filename, mimeType);
    }
    const backend = await this.storage.activeBackend();

    const storageFilename = sanitizeStorageFilename(filename);
    const storageKey = `${context.workspaceId}/${new Date()
      .toISOString()
      .slice(0, 10)}/${randomUUID()}-${storageFilename}`;

    const asset = await this.reserveAssetWithinQuota(userId, file.size, {
      workspaceId: context.workspaceId,
      folderId: context.folderId,
      fileId: context.fileId,
      storageKey,
      storageBackend: backend.name,
      kind: context.kind,
      filename,
      mimeType,
      sizeBytes: file.size,
      uploadedBy: userId,
    });

    await putObjectWithCompensation({
      backend,
      storageKey,
      data: file.buffer,
      mimeType,
      signal,
      releaseReservation: () =>
        this.prisma.fileAsset.delete({ where: { id: asset.id } }),
    });

    return {
      ...asset,
      url: this.getAssetUrl(asset.id),
    };
  }

  /**
   * 签名直入第一步:校验并预留 PendingUpload,返回浏览器直传对象存储的
   * 上传指令(form_post | put 判别联合)。配额与重名的原子保证在 confirm
   * 时由 reserveAssetWithinQuota 完成,这里只做 UX 预检。
   */
  async signAssetUpload(userId: string | null, input: SignAssetUploadInput) {
    if (!userId) {
      throw new UnauthorizedException("Missing session");
    }

    const filename = requireResourceName(input.filename, "文件名称");
    if (!Number.isInteger(input.sizeBytes) || input.sizeBytes <= 0) {
      throw new BadRequestException("无效的文件大小");
    }
    if (input.sizeBytes > MAX_ASSET_SIZE_BYTES) {
      throw new BadRequestException("文件不能超过 50MB");
    }
    const mimeType = normalizeDirectUploadMime(filename, input.mimeType);

    const context = await this.resolveUploadContext(userId, input);
    if (context.kind === "standalone") {
      assertStandaloneTypeAllowed(filename, mimeType);
    }

    const backend = await this.storage.activeBackend();
    const storageFilename = sanitizeStorageFilename(filename);
    const storageKey = `${context.workspaceId}/${new Date()
      .toISOString()
      .slice(0, 10)}/${randomUUID()}-${storageFilename}`;
    const objectKey = this.storage.objectKeyForPendingUpload(
      backend.name,
      storageKey,
    );
    const instruction = await this.storage.signUpload(backend.name, objectKey, {
      sizeBytes: input.sizeBytes,
      mimeType,
    });
    if (!instruction) {
      throw new NotImplementedException(
        "当前存储配置不支持签名直入,请改用服务器中转上传",
      );
    }

    try {
      await this.reapExpiredPendingUploads(userId);
      await this.assertDirectUploadQuotaAvailable(
        userId,
        context,
        filename,
        input.sizeBytes,
      );

      const pending = await this.prisma.pendingUpload.create({
        data: {
          kind: "asset",
          workspaceId: context.workspaceId,
          folderId: context.folderId,
          fileId: context.fileId,
          storageBackend: backend.name,
          filename,
          mimeType,
          sizeBytes: input.sizeBytes,
          storageKey,
          uploadedBy: userId,
          expiresAt: new Date(Date.now() + PENDING_UPLOAD_TTL_MS),
        },
      });

      return {
        uploadId: pending.id,
        instruction,
        expiresAt: instruction.expiresAt,
      };
    } catch (caught) {
      await Promise.resolve(
        this.storage.discardMultipartUpload(backend.name, objectKey),
      ).catch(() => undefined);
      throw caught;
    }
  }

  /** 签名直入第三步:对象校验通过后原子创建资产记录并释放预留。 */
  async confirmAssetUpload(userId: string | null, uploadId: string) {
    if (!userId) {
      throw new UnauthorizedException("Missing session");
    }
    const pending = await this.requirePendingUpload(userId, uploadId, "asset");

    try {
      await this.storage.verifyAndFinalizePendingObject(pending);
      const asset = await this.reserveAssetWithinQuota(
        userId,
        pending.sizeBytes,
        {
          workspaceId: pending.workspaceId,
          folderId: pending.folderId,
          fileId: pending.fileId,
          storageKey: pending.storageKey,
          storageBackend: pending.storageBackend,
          kind: pending.fileId ? "embedded" : "standalone",
          filename: pending.filename,
          mimeType: pending.mimeType,
          sizeBytes: pending.sizeBytes,
          uploadedBy: userId,
        },
        { pendingUploadId: pending.id },
      );
      return {
        ...asset,
        url: this.getAssetUrl(asset.id),
      };
    } catch (caught) {
      await this.discardPendingUpload(pending);
      throw caught;
    }
  }

  /** 客户端取消或失败时释放预留并清理对象;重复调用安全。 */
  async abortAssetUpload(userId: string | null, uploadId: string) {
    if (!userId) {
      throw new UnauthorizedException("Missing session");
    }
    const pending = await this.prisma.pendingUpload.findUnique({
      where: { id: uploadId },
    });
    if (pending && pending.kind === "asset" && pending.uploadedBy === userId) {
      await this.discardPendingUpload(pending);
    }
    return { ok: true as const };
  }

  private async requirePendingUpload(
    userId: string,
    uploadId: string,
    kind: PendingUpload["kind"],
  ) {
    const pending = await this.prisma.pendingUpload.findUnique({
      where: { id: uploadId },
    });
    if (!pending || pending.kind !== kind || pending.uploadedBy !== userId) {
      throw new NotFoundException("上传任务不存在或已完成");
    }
    if (pending.expiresAt.getTime() <= Date.now()) {
      await this.discardPendingUpload(pending);
      throw new NotFoundException("上传任务已过期,请重新上传");
    }
    return pending;
  }

  /** 删除预留行并按行内 backend 尽力清理对象;R2 同时清理临时与正式 Key。 */
  private async discardPendingUpload(pending: PendingUpload) {
    await this.storage.discardPendingUpload(pending);
  }

  /** 惰性清理:签名新任务时回收该用户已过期的直入预留。 */
  private async reapExpiredPendingUploads(userId: string) {
    const expired = await this.prisma.pendingUpload.findMany({
      where: { uploadedBy: userId, expiresAt: { lte: new Date() } },
      take: 20,
    });
    for (const pending of expired) {
      await this.discardPendingUpload(pending);
    }
  }

  /** 直入签名的 UX 预检:重名与配额(含未确认的直入预留)。 */
  private async assertDirectUploadQuotaAvailable(
    userId: string,
    context: {
      workspaceId: string;
      folderId: string | null;
      fileId: string | null;
      kind: "embedded" | "standalone";
    },
    filename: string,
    incomingBytes: number,
  ) {
    const duplicate =
      context.kind === "standalone" && context.folderId
        ? await this.prisma.fileAsset.findFirst({
            where: {
              folderId: context.folderId,
              kind: "standalone",
              filename,
            },
            select: { id: true },
          })
        : context.kind === "embedded" && context.fileId
          ? await this.prisma.fileAsset.findFirst({
              where: { fileId: context.fileId, kind: "embedded", filename },
              select: { id: true },
            })
          : null;
    if (duplicate) {
      throw new ConflictException(
        context.kind === "standalone"
          ? "当前文件夹中已存在同名文件"
          : "当前文档中已存在同名附件",
      );
    }

    const [user, workspace] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { storageQuotaBytes: true },
      }),
      this.prisma.workspace.findUnique({
        where: { id: context.workspaceId },
        select: { memberAttachmentQuotaBytes: true },
      }),
    ]);
    if (!user) throw new UnauthorizedException("Missing session");

    const quotaBytes =
      user.storageQuotaBytes ??
      workspace?.memberAttachmentQuotaBytes ??
      DEFAULT_MEMBER_ATTACHMENT_QUOTA_BYTES;
    const [assetUsage, pendingUsage] = await Promise.all([
      this.prisma.fileAsset.aggregate({
        where: { uploadedBy: userId },
        _sum: { sizeBytes: true },
      }),
      this.prisma.pendingUpload.aggregate({
        where: {
          uploadedBy: userId,
          kind: "asset",
          expiresAt: { gt: new Date() },
        },
        _sum: { sizeBytes: true },
      }),
    ]);
    const total =
      (assetUsage._sum.sizeBytes ?? 0) +
      (pendingUsage._sum.sizeBytes ?? 0) +
      incomingBytes;
    if (total > quotaBytes) {
      throw new BadRequestException(
        `文档附件容量不足,当前上限为 ${formatStorageSize(quotaBytes)}`,
      );
    }
  }

  async getAssetForDownload(
    userId: string | null,
    assetId: string,
    forceDownload = false,
  ) {
    if (!userId) {
      throw new UnauthorizedException("Missing session");
    }

    const asset = await this.prisma.fileAsset.findUnique({
      where: { id: assetId },
    });

    if (!asset) {
      throw new NotFoundException("Asset not found");
    }

    await this.assertCanViewAsset(userId, asset);

    const inline = !forceDownload && isSafeInlineImageMime(asset.mimeType);
    const redirectUrl = await this.storage.presignDownload(
      asset.storageBackend,
      asset.storageKey,
      { filename: asset.filename, mimeType: asset.mimeType, inline },
    );
    if (redirectUrl) {
      return { asset, redirectUrl, stream: null };
    }

    const backend = await this.storage.backendFor(asset.storageBackend);
    const stream = await backend.getObject(asset.storageKey);

    return {
      asset,
      redirectUrl: null,
      stream: stream as Readable,
    };
  }

  /**
   * PDF 预览的直传签名：鉴权与大小校验通过后，在 direct 下载模式下返回
   * 短期预签名 URL，让浏览器直接拉对象存储做流式加载（首帧即渲染、按需翻页）。
   * 非 PDF、非 direct 模式或后端不支持时返回 null，调用方回退到 /preview 中转。
   */
  async getAssetPreviewUrl(
    userId: string | null,
    assetId: string,
  ): Promise<string | null> {
    if (!userId) {
      throw new UnauthorizedException("Missing session");
    }

    const asset = await this.prisma.fileAsset.findUnique({
      where: { id: assetId },
    });
    if (!asset) {
      throw new NotFoundException("Asset not found");
    }
    await this.assertCanViewAsset(userId, asset);

    const kind = getAssetPreviewKind(asset.filename, asset.mimeType);
    if (kind !== "pdf") return null;
    if (asset.sizeBytes > MAX_PDF_PREVIEW_SIZE_BYTES) {
      throw new BadRequestException("PDF 超过 25MB，请下载后查看");
    }

    return this.storage.presignDownload(
      asset.storageBackend,
      asset.storageKey,
      {
        filename: asset.filename,
        mimeType: asset.mimeType,
        inline: true,
        // 阅读会话内逐页按需拉取，签名必须比附件/图片短签更长。
        expirySeconds: PDF_PREVIEW_PRESIGN_EXPIRY_SECONDS,
      },
    );
  }

  async getAssetForPreview(userId: string | null, assetId: string) {
    if (!userId) {
      throw new UnauthorizedException("Missing session");
    }

    const asset = await this.prisma.fileAsset.findUnique({
      where: { id: assetId },
    });
    if (!asset) {
      throw new NotFoundException("Asset not found");
    }
    await this.assertCanViewAsset(userId, asset);

    const kind = getAssetPreviewKind(asset.filename, asset.mimeType);
    if (!kind) {
      throw new BadRequestException("该文件类型不支持在线预览");
    }
    const maxBytes =
      kind === "pdf" ? MAX_PDF_PREVIEW_SIZE_BYTES : MAX_TEXT_PREVIEW_SIZE_BYTES;
    if (asset.sizeBytes > maxBytes) {
      throw new BadRequestException(
        kind === "pdf"
          ? "PDF 超过 25MB，请下载后查看"
          : "文本文件超过 2MB，请下载后查看",
      );
    }

    const backend = await this.storage.backendFor(asset.storageBackend);
    const stream = await backend.getObject(asset.storageKey);

    if (kind === "pdf") {
      // PDF 上限 25MB，超过 Vercel 普通响应体限制；先读首块校验文件头，
      // 再流式 pipe，禁止整块读入内存后一次性发送。
      return {
        asset,
        kind,
        stream: await pdfStreamWithHeaderCheck(stream),
      };
    }

    const buffer = await readPreviewBuffer(stream, maxBytes);
    if (buffer.length !== asset.sizeBytes) {
      throw new BadRequestException("文件内容不完整，无法预览");
    }
    try {
      const content = new TextDecoder("utf-8", { fatal: true })
        .decode(buffer)
        .replace(/^\uFEFF/, "");
      return { asset, kind, content };
    } catch {
      throw new BadRequestException("文本文件必须使用 UTF-8 编码");
    }
  }

  async uploadForumPostImages(
    userId: string | null,
    postId: string,
    files: UploadedAssetFile[],
  ) {
    if (!userId) {
      throw new UnauthorizedException("Missing session");
    }

    if (files.length === 0) {
      throw new BadRequestException("请选择图片");
    }

    const [user, post, existingCount] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: userId } }),
      this.prisma.forumPost.findUnique({
        where: { id: postId },
        include: { thread: true },
      }),
      this.prisma.fileAsset.count({ where: { forumPostId: postId } }),
    ]);

    if (!user || user.status !== "active") {
      throw new UnauthorizedException("Missing session");
    }

    if (!post) {
      throw new NotFoundException("Forum post not found");
    }

    if (post.authorId !== user.id && !isSystemAdmin(user.systemRole)) {
      throw new ForbiddenException("No permission to attach images");
    }

    const mainPost = await this.prisma.forumPost.findFirst({
      where: { threadId: post.threadId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true },
    });
    const maxImages =
      mainPost?.id === post.id ? MAX_FORUM_IMAGES : MAX_FORUM_REPLY_IMAGES;

    if (existingCount + files.length > maxImages) {
      throw new BadRequestException(`最多附带 ${maxImages} 张图片`);
    }

    const backend = await this.storage.activeBackend();
    const uploaded: Array<{
      id: string;
      storageKey: string;
      width: number;
      height: number;
      sortOrder: number;
    }> = [];

    try {
      for (const [index, file] of files.entries()) {
        if (file.size > MAX_FORUM_IMAGE_SIZE_BYTES) {
          throw new BadRequestException("压缩后的单张图片不能超过 10MB");
        }

        const mimeType = normalizeAssetMimeType(file);
        if (mimeType !== "image/webp") {
          throw new BadRequestException("论坛图片必须压缩为 WebP 格式");
        }

        const dimensions = readWebpDimensions(file.buffer);
        if (!dimensions) {
          throw new BadRequestException("无法读取图片尺寸");
        }

        if (Math.max(dimensions.width, dimensions.height) > 1600) {
          throw new BadRequestException("图片最长边不能超过 1600px");
        }

        const storageKey = `${post.thread.workspaceId}/forum/${post.id}/${randomUUID()}.webp`;
        const asset = await this.reserveAssetWithinQuota(userId, file.size, {
          workspaceId: post.thread.workspaceId,
          folderId: null,
          fileId: null,
          forumPostId: post.id,
          storageKey,
          storageBackend: backend.name,
          filename: `forum-image-${existingCount + index + 1}.webp`,
          mimeType,
          sizeBytes: file.size,
          width: dimensions.width,
          height: dimensions.height,
          sortOrder: existingCount + index,
          uploadedBy: userId,
        });

        try {
          await backend.putObject(storageKey, file.buffer, mimeType);
        } catch (caught) {
          await this.prisma.fileAsset
            .delete({ where: { id: asset.id } })
            .catch(() => undefined);
          throw caught;
        }

        uploaded.push({
          id: asset.id,
          storageKey,
          width: dimensions.width,
          height: dimensions.height,
          sortOrder: existingCount + index,
        });
      }
    } catch (caught) {
      await Promise.all(
        uploaded.map((asset) =>
          backend.removeObject(asset.storageKey).catch(() => undefined),
        ),
      );
      if (uploaded.length > 0) {
        await this.prisma.fileAsset.deleteMany({
          where: { id: { in: uploaded.map((asset) => asset.id) } },
        });
      }
      throw caught;
    }

    return uploaded.map(({ storageKey: _storageKey, ...asset }) => ({
      ...asset,
      url: `/assets/${asset.id}`,
    }));
  }

  /**
   * 论坛图片直传第一步：校验帖子与权限、重新计算当前图片数与预留数，返回
   * 浏览器直传对象存储的上传指令。主帖最多 9 张，评论/嵌套回复最多 3 张。
   */
  async signForumPostImageUpload(
    userId: string | null,
    postId: string,
    input: { filename: string; sizeBytes: number; mimeType?: string },
  ) {
    if (!userId) throw new UnauthorizedException("Missing session");

    const [user, post] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: userId } }),
      this.prisma.forumPost.findUnique({
        where: { id: postId },
        include: { thread: true },
      }),
    ]);
    if (!user || user.status !== "active") {
      throw new UnauthorizedException("Missing session");
    }
    if (!post) throw new NotFoundException("Forum post not found");
    if (post.authorId !== user.id && !isSystemAdmin(user.systemRole)) {
      throw new ForbiddenException("No permission to attach images");
    }

    const mainPost = await this.prisma.forumPost.findFirst({
      where: { threadId: post.threadId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true },
    });
    const maxImages =
      mainPost?.id === post.id ? MAX_FORUM_IMAGES : MAX_FORUM_REPLY_IMAGES;

    const [existingCount, pendingCount] = await Promise.all([
      this.prisma.fileAsset.count({ where: { forumPostId: postId } }),
      this.prisma.pendingUpload.count({
        where: {
          forumPostId: postId,
          kind: "forum_image",
          expiresAt: { gt: new Date() },
        },
      }),
    ]);
    if (existingCount + pendingCount + 1 > maxImages) {
      throw new BadRequestException(`最多附带 ${maxImages} 张图片`);
    }

    if (!Number.isInteger(input.sizeBytes) || input.sizeBytes <= 0) {
      throw new BadRequestException("无效的文件大小");
    }
    if (input.sizeBytes > MAX_FORUM_IMAGE_SIZE_BYTES) {
      throw new BadRequestException("压缩后的单张图片不能超过 10MB");
    }
    const mimeType = normalizeDirectUploadMime(input.filename, input.mimeType);
    if (mimeType !== "image/webp") {
      throw new BadRequestException("论坛图片必须压缩为 WebP 格式");
    }

    const backend = await this.storage.activeBackend();
    const storageKey = `${post.thread.workspaceId}/forum/${post.id}/${randomUUID()}.webp`;
    const objectKey = this.storage.objectKeyForPendingUpload(
      backend.name,
      storageKey,
    );
    const instruction = await this.storage.signUpload(backend.name, objectKey, {
      sizeBytes: input.sizeBytes,
      mimeType,
    });
    if (!instruction) {
      throw new NotImplementedException(
        "当前存储配置不支持签名直入,请改用服务器中转上传",
      );
    }

    try {
      await this.reapExpiredPendingUploads(userId);
      const sortOrder = existingCount + pendingCount;
      const pending = await this.prisma.pendingUpload.create({
        data: {
          kind: "forum_image",
          workspaceId: post.thread.workspaceId,
          forumPostId: post.id,
          storageBackend: backend.name,
          filename: `forum-image-${sortOrder + 1}.webp`,
          mimeType,
          sizeBytes: input.sizeBytes,
          storageKey,
          uploadedBy: userId,
          expiresAt: new Date(Date.now() + PENDING_UPLOAD_TTL_MS),
        },
      });

      return {
        uploadId: pending.id,
        instruction,
        expiresAt: instruction.expiresAt,
      };
    } catch (caught) {
      await Promise.resolve(
        this.storage.discardMultipartUpload(backend.name, objectKey),
      ).catch(() => undefined);
      throw caught;
    }
  }

  /** 论坛图片直传第三步：读取对象并验证真实文件头与尺寸后创建 FileAsset。 */
  async confirmForumPostImageUpload(
    userId: string | null,
    postId: string,
    uploadId: string,
  ) {
    if (!userId) throw new UnauthorizedException("Missing session");
    const pending = await this.requirePendingUpload(
      userId,
      uploadId,
      "forum_image",
    );
    if (pending.forumPostId !== postId) {
      await this.discardPendingUpload(pending);
      throw new NotFoundException("上传任务不存在或已完成");
    }

    try {
      await this.storage.verifyAndFinalizePendingObject(pending);
      const backend = await this.storage.backendFor(
        pending.storageBackend as StorageBackendName,
      );
      const buffer = await readPreviewBuffer(
        await backend.getObject(pending.storageKey),
        MAX_FORUM_IMAGE_SIZE_BYTES,
      );
      const dimensions = readWebpDimensions(buffer);
      if (!dimensions) {
        throw new BadRequestException("无法读取图片尺寸");
      }
      if (Math.max(dimensions.width, dimensions.height) > 1600) {
        throw new BadRequestException("图片最长边不能超过 1600px");
      }

      const post = await this.prisma.forumPost.findUnique({
        where: { id: postId },
        select: { threadId: true },
      });
      if (!post) throw new NotFoundException("Forum post not found");
      const mainPost = await this.prisma.forumPost.findFirst({
        where: { threadId: post.threadId },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: { id: true },
      });
      const maxImages =
        mainPost?.id === postId ? MAX_FORUM_IMAGES : MAX_FORUM_REPLY_IMAGES;
      const asset = await this.reserveAssetWithinQuota(
        userId,
        pending.sizeBytes,
        {
          workspaceId: pending.workspaceId,
          folderId: null,
          fileId: null,
          forumPostId: postId,
          storageKey: pending.storageKey,
          storageBackend: pending.storageBackend,
          filename: pending.filename,
          mimeType: pending.mimeType,
          sizeBytes: pending.sizeBytes,
          width: dimensions.width,
          height: dimensions.height,
          uploadedBy: userId,
        },
        { pendingUploadId: pending.id, maxForumImages: maxImages },
      );
      return {
        id: asset.id,
        url: `/assets/${asset.id}`,
        width: dimensions.width,
        height: dimensions.height,
        sortOrder: asset.sortOrder,
      };
    } catch (caught) {
      await this.discardPendingUpload(pending);
      throw caught;
    }
  }

  /** 论坛图片直传取消或失败时释放预留并清理对象；重复调用安全。 */
  async abortForumPostImageUpload(
    userId: string | null,
    postId: string,
    uploadId: string,
  ) {
    if (!userId) throw new UnauthorizedException("Missing session");
    const pending = await this.prisma.pendingUpload.findUnique({
      where: { id: uploadId },
    });
    if (
      pending &&
      pending.kind === "forum_image" &&
      pending.forumPostId === postId &&
      pending.uploadedBy === userId
    ) {
      await this.discardPendingUpload(pending);
    }
    return { ok: true as const };
  }

  async removeForumPostImages(postIds: string[]) {
    if (postIds.length === 0) return;
    const assets = await this.prisma.fileAsset.findMany({
      where: { forumPostId: { in: postIds } },
      select: { storageKey: true, storageBackend: true },
    });
    await Promise.all(
      assets.map(async (asset) => {
        const backend = await this.storage.backendFor(asset.storageBackend);
        await backend.removeObject(asset.storageKey);
      }),
    );
  }

  async listLibraryAssets(userId: string | null) {
    if (!userId) {
      throw new UnauthorizedException("Missing session");
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.status !== "active") {
      throw new UnauthorizedException("Missing session");
    }

    const assets = await this.prisma.fileAsset.findMany({
      where: {
        uploadedBy: userId,
        forumPostId: null,
      },
      orderBy: { createdAt: "desc" },
      include: { uploader: true },
    });

    const references = await this.getAssetReferences(
      assets.map((asset) => asset.id),
    );
    const referenceCounts = new Map<string, number>();

    for (const reference of references) {
      referenceCounts.set(
        reference.assetId,
        (referenceCounts.get(reference.assetId) ?? 0) + 1,
      );
    }

    const unreferencedAssetIds = assets
      .filter((asset) => !referenceCounts.has(asset.id))
      .map((asset) => asset.id);
    await this.cleanupUnreferencedAssets(unreferencedAssetIds);

    return assets
      .filter((asset) =>
        references.some(
          (reference) =>
            reference.assetId === asset.id && reference.targetType === "file",
        ),
      )
      .map((asset) => ({
        ...asset,
        url: this.getAssetUrl(asset.id),
        referenceCount: referenceCounts.get(asset.id) ?? 0,
        uploader: {
          id: asset.uploader.id,
          username: asset.uploader.username,
          displayName: asset.uploader.displayName,
          avatarUrl: asset.uploader.avatarUpdatedAt
            ? `/auth/avatar/${asset.uploader.id}?v=${asset.uploader.avatarUpdatedAt.getTime()}`
            : null,
          systemRole: asset.uploader.systemRole,
          status: asset.uploader.status,
        },
      }));
  }

  /**
   * 默认只清理文档附件（embedded）；独立文件平时保留在文件库中，
   * 只有在删除文件夹这种“归属目录整体消失”的场景才通过
   * includeStandalone=true 一并清理。仍被文档或课件引用的资产不删除。
   */
  async cleanupUnreferencedAssets(
    assetIds: string[],
    options?: { includeStandalone?: boolean },
  ) {
    const uniqueIds = [...new Set(assetIds.filter(Boolean))];
    if (uniqueIds.length === 0) return;
    const [assets, references] = await Promise.all([
      this.prisma.fileAsset.findMany({
        where: {
          id: { in: uniqueIds },
          forumPostId: null,
          ...(options?.includeStandalone ? {} : { kind: "embedded" as const }),
        },
      }),
      this.getAssetReferences(uniqueIds),
    ]);
    const referencedIds = new Set(
      references.map((reference) => reference.assetId),
    );
    await Promise.allSettled(
      assets
        .filter((asset) => !referencedIds.has(asset.id))
        .map(async (asset) => {
          const backend = await this.storage.backendFor(asset.storageBackend);
          await backend.removeObject(asset.storageKey);
          await this.prisma.fileAsset.delete({ where: { id: asset.id } });
        }),
    );
  }

  async listAssetReferences(userId: string | null, assetId: string) {
    if (!userId) throw new UnauthorizedException("Missing session");
    const [user, asset] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: userId } }),
      this.prisma.fileAsset.findUnique({ where: { id: assetId } }),
    ]);
    if (!user || !asset) throw new NotFoundException("Asset not found");
    if (asset.uploadedBy !== user.id && !isSystemAdmin(user.systemRole)) {
      throw new ForbiddenException("No permission to view asset references");
    }
    const references = await this.getAssetReferences([assetId]);
    return references.map(({ assetId: _assetId, ...reference }) => reference);
  }

  async deleteLibraryAsset(userId: string | null, assetId: string) {
    if (!userId) {
      throw new UnauthorizedException("Missing session");
    }

    const [asset, user] = await Promise.all([
      this.prisma.fileAsset.findUnique({ where: { id: assetId } }),
      this.prisma.user.findUnique({ where: { id: userId } }),
    ]);

    if (!asset) {
      throw new NotFoundException("Asset not found");
    }

    const isUploader = asset.uploadedBy === userId;
    if (!isUploader && (!user || !isSystemAdmin(user.systemRole))) {
      const canManageFolder =
        asset.kind === "standalone" &&
        asset.folderId &&
        user?.status === "active" &&
        canEdit(
          await this.permissions.getEffectiveLevelForFolder(
            userId,
            asset.folderId,
          ),
        );
      if (!canManageFolder) {
        throw new ForbiddenException("No permission to delete asset");
      }
    }

    if (asset.forumPostId) {
      throw new ForbiddenException("Forum images cannot be deleted here");
    }

    const references = await this.getAssetReferences([asset.id]);

    if (references.length > 0) {
      throw new ConflictException({
        message: "文件已被引用，不能删除",
        references: references.map((reference) => ({
          ...reference,
          assetId: undefined,
        })),
      });
    }

    const backend = await this.storage.backendFor(asset.storageBackend);
    await backend.removeObject(asset.storageKey);
    await this.prisma.fileAsset.delete({
      where: { id: asset.id },
    });

    return { ok: true };
  }

  async renameStandaloneAsset(
    userId: string | null,
    assetId: string,
    filename: string,
  ) {
    if (!userId) {
      throw new UnauthorizedException("Missing session");
    }

    const [asset, user] = await Promise.all([
      this.prisma.fileAsset.findUnique({ where: { id: assetId } }),
      this.prisma.user.findUnique({ where: { id: userId } }),
    ]);

    if (!asset || asset.kind !== "standalone") {
      throw new NotFoundException("文件不存在");
    }

    const isUploader = asset.uploadedBy === userId;
    if (!isUploader && (!user || !isSystemAdmin(user.systemRole))) {
      const canManageFolder =
        asset.folderId &&
        user?.status === "active" &&
        canEdit(
          await this.permissions.getEffectiveLevelForFolder(
            userId,
            asset.folderId,
          ),
        );
      if (!canManageFolder) {
        throw new ForbiddenException("No permission to rename asset");
      }
    }

    const name = requireResourceName(filename, "文件名称");
    const duplicate = await this.prisma.fileAsset.findFirst({
      where: {
        folderId: asset.folderId,
        kind: "standalone",
        filename: name,
        id: { not: asset.id },
      },
      select: { id: true },
    });
    if (duplicate) {
      throw new ConflictException("当前文件夹中已存在同名文件");
    }
    const updated = await this.prisma.fileAsset.update({
      where: { id: asset.id },
      data: { filename: name },
    });
    return {
      id: updated.id,
      filename: updated.filename,
      updatedAt: updated.updatedAt.toISOString(),
    };
  }

  private async resolveUploadContext(userId: string, input: UploadAssetInput) {
    if (input.fileId) {
      const file = await this.prisma.file.findUnique({
        where: { id: input.fileId },
      });

      if (!file || file.status === "archived") {
        throw new NotFoundException("File not found");
      }

      const level = await this.permissions.getEffectiveLevelForFile(
        userId,
        file.id,
      );

      if (!canEdit(level) && level !== "lecturer") {
        throw new ForbiddenException("No permission to upload asset");
      }

      return {
        workspaceId: file.workspaceId,
        folderId: file.folderId,
        fileId: file.id,
        kind: "embedded" as const,
      };
    }

    if (!input.folderId) {
      throw new BadRequestException("文档附件只能在编辑文档时上传");
    }

    const folder = await this.prisma.folder.findUnique({
      where: { id: input.folderId },
    });
    if (!folder) {
      throw new NotFoundException("Folder not found");
    }

    const level = await this.permissions.getEffectiveLevelForFolder(
      userId,
      folder.id,
    );
    if (!canEdit(level) && level !== "lecturer") {
      throw new ForbiddenException("没有在此文件夹上传文件的权限");
    }

    return {
      workspaceId: folder.workspaceId,
      folderId: folder.id,
      fileId: null,
      kind: "standalone" as const,
    };
  }

  private async assertCanViewAsset(
    userId: string,
    asset: {
      id: string;
      folderId: string | null;
      fileId: string | null;
      forumPostId: string | null;
      uploadedBy: string;
    },
  ) {
    if (asset.forumPostId) {
      const post = await this.prisma.forumPost.findUnique({
        where: { id: asset.forumPostId },
      });
      if (!post) {
        throw new ForbiddenException("No permission to view asset");
      }
      return;
    }

    const references = await this.getAssetReferences([asset.id]);
    const contentReferences = references.filter(
      (reference) => reference.targetType === "file",
    );

    const referenceLevels = await Promise.all(
      contentReferences.map((reference) =>
        this.permissions.getEffectiveLevelForFile(userId, reference.fileId),
      ),
    );

    if (referenceLevels.some((level) => level && level !== "no_access")) {
      return;
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { systemRole: true, status: true },
    });
    if (user?.status === "active") {
      const teachingReference = await this.prisma.teachingDeckItem.findFirst({
        where: {
          assetId: asset.id,
          ...(isSuperAdmin(user.systemRole)
            ? {}
            : {
                deck: {
                  classroom: { members: { some: { userId } } },
                },
              }),
        },
        select: { id: true },
      });
      if (teachingReference) {
        return;
      }
    }

    if (asset.fileId) {
      const level = await this.permissions.getEffectiveLevelForFile(
        userId,
        asset.fileId,
      );

      if (!level || level === "no_access") {
        throw new ForbiddenException("No permission to view asset");
      }

      return;
    }

    if (!asset.folderId) {
      throw new ForbiddenException("No permission to view asset");
    }

    const level = await this.permissions.getEffectiveLevelForFolder(
      userId,
      asset.folderId,
    );

    if (!level || level === "no_access") {
      throw new ForbiddenException("No permission to view asset");
    }
  }

  private async getAssetReferences(assetIds: string[]) {
    if (assetIds.length === 0) {
      return [];
    }

    const assetIdSet = new Set(assetIds);
    const [blocks, teachingItems] = await Promise.all([
      this.prisma.contentBlock.findMany({
        where: {
          type: { in: ["image", "attachment"] },
          file: { status: { not: "archived" } },
          OR: assetIds.map((assetId) => ({
            dataJson: { path: ["assetId"], equals: assetId },
          })),
        },
        include: {
          file: {
            select: {
              id: true,
              title: true,
            },
          },
        },
      }),
      this.prisma.teachingDeckItem.findMany({
        where: { assetId: { in: assetIds } },
        include: { deck: { select: { id: true, title: true } } },
      }),
    ]);
    const references: Array<
      | {
          assetId: string;
          targetType: "file";
          blockId: string;
          blockType: string;
          fileId: string;
          fileTitle: string;
        }
      | {
          assetId: string;
          targetType: "teaching_deck";
          itemId: string;
          deckId: string;
          deckTitle: string;
        }
    > = [];

    for (const block of blocks) {
      const data = asRecord(block.dataJson);
      const assetId = typeof data.assetId === "string" ? data.assetId : null;

      if (assetId && assetIdSet.has(assetId)) {
        references.push({
          assetId,
          targetType: "file",
          blockId: block.id,
          blockType: block.type,
          fileId: block.file.id,
          fileTitle: block.file.title,
        });
      }
    }

    for (const item of teachingItems) {
      if (item.assetId && assetIdSet.has(item.assetId)) {
        references.push({
          assetId: item.assetId,
          targetType: "teaching_deck",
          itemId: item.id,
          deckId: item.deck.id,
          deckTitle: item.deck.title,
        });
      }
    }

    return references;
  }

  private async reserveAssetWithinQuota(
    userId: string,
    incomingBytes: number,
    data: Prisma.FileAssetUncheckedCreateInput,
    options: {
      pendingUploadId?: string;
      maxForumImages?: number;
    } = {},
  ) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.prisma.$transaction(
          async (tx) => {
            const [user, workspace] = await Promise.all([
              tx.user.findUnique({
                where: { id: userId },
                select: { storageQuotaBytes: true },
              }),
              tx.workspace.findUnique({
                where: { id: data.workspaceId },
                select: { memberAttachmentQuotaBytes: true },
              }),
            ]);
            if (!user) throw new UnauthorizedException("Missing session");

            const duplicate =
              data.kind === "standalone" && data.folderId
                ? await tx.fileAsset.findFirst({
                    where: {
                      folderId: data.folderId,
                      kind: "standalone",
                      filename: data.filename,
                    },
                    select: { id: true },
                  })
                : data.kind === "embedded" && data.fileId
                  ? await tx.fileAsset.findFirst({
                      where: {
                        fileId: data.fileId,
                        kind: "embedded",
                        filename: data.filename,
                      },
                      select: { id: true },
                    })
                  : null;
            if (duplicate) {
              throw new ConflictException(
                data.kind === "standalone"
                  ? "当前文件夹中已存在同名文件"
                  : "当前文档中已存在同名附件",
              );
            }

            let forumImageCount: number | null = null;
            if (data.forumPostId && options.maxForumImages !== undefined) {
              forumImageCount = await tx.fileAsset.count({
                where: { forumPostId: data.forumPostId },
              });
              if (forumImageCount >= options.maxForumImages) {
                throw new BadRequestException(
                  `最多附带 ${options.maxForumImages} 张图片`,
                );
              }
            }

            const quotaBytes =
              user.storageQuotaBytes ??
              workspace?.memberAttachmentQuotaBytes ??
              DEFAULT_MEMBER_ATTACHMENT_QUOTA_BYTES;
            const usage = await tx.fileAsset.aggregate({
              where: { uploadedBy: userId },
              _sum: { sizeBytes: true },
            });
            if ((usage._sum.sizeBytes ?? 0) + incomingBytes > quotaBytes) {
              throw new BadRequestException(
                `文档附件容量不足，当前上限为 ${formatStorageSize(quotaBytes)}`,
              );
            }
            const asset = await tx.fileAsset.create({
              data:
                forumImageCount === null
                  ? data
                  : { ...data, sortOrder: forumImageCount },
            });
            if (options.pendingUploadId) {
              await tx.pendingUpload.delete({
                where: { id: options.pendingUploadId },
              });
            }
            return asset;
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
      } catch (caught) {
        if (
          attempt < 2 &&
          caught instanceof Prisma.PrismaClientKnownRequestError &&
          caught.code === "P2034"
        ) {
          continue;
        }
        throw caught;
      }
    }
    throw new ConflictException("Upload conflicted with another request");
  }

  private getAssetUrl(assetId: string) {
    const baseUrl = this.config.get<string>(
      "API_PUBLIC_URL",
      "http://localhost:4000",
    );
    return `${baseUrl.replace(/\/$/, "")}/assets/${assetId}`;
  }
}

function sanitizeStorageFilename(filename: string) {
  return (filename || "asset")
    .replace(/[^\w.\-\u4e00-\u9fa5]+/g, "_")
    .slice(0, 120);
}

/** 允许直接上传到文件夹的独立文件类型（按扩展名与 MIME 双重判断）。 */
const STANDALONE_EXTENSION_MIMES = new Map<string, string[]>([
  [".pdf", ["application/pdf"]],
  [".doc", ["application/msword", "application/octet-stream"]],
  [
    ".docx",
    [
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/octet-stream",
    ],
  ],
  [".xls", ["application/vnd.ms-excel", "application/octet-stream"]],
  [
    ".xlsx",
    [
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/octet-stream",
    ],
  ],
  [".ppt", ["application/vnd.ms-powerpoint", "application/octet-stream"]],
  [
    ".pptx",
    [
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "application/octet-stream",
    ],
  ],
  [".txt", ["text/plain", "application/octet-stream"]],
  [".md", ["text/markdown", "text/plain", "application/octet-stream"]],
  [".csv", ["text/csv", "text/plain", "application/octet-stream"]],
]);

const STANDALONE_IMAGE_MIMES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);

function assertStandaloneTypeAllowed(filename: string, mimeType: string) {
  if (STANDALONE_IMAGE_MIMES.has(mimeType)) return;
  const lower = filename.toLowerCase();
  for (const [extension, mimes] of STANDALONE_EXTENSION_MIMES) {
    if (lower.endsWith(extension) && mimes.includes(mimeType)) return;
  }
  throw new BadRequestException(
    "该类型不支持直接上传到文件夹，支持 PDF、Office 文档、文本和图片",
  );
}

/**
 * 签名直入拿不到文件内容,只能基于文件名与浏览器声明的 MIME 归一化;
 * 无法做魔数检测,SVG 一律按扩展名/声明拒绝。
 */
function normalizeDirectUploadMime(filename: string, declared?: string) {
  const declaredMime = declared?.trim().toLowerCase() ?? "";
  if (
    filename.toLowerCase().endsWith(".svg") ||
    declaredMime === "image/svg+xml"
  ) {
    throw new BadRequestException("不支持上传 SVG 文件");
  }
  return /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(declaredMime)
    ? declaredMime
    : "application/octet-stream";
}

export function normalizeAssetMimeType(file: UploadedAssetFile) {
  const filename = file.originalname.toLowerCase();
  const declaredMime = file.mimetype.trim().toLowerCase();
  const prefix = file.buffer.subarray(0, 1024).toString("utf8").trimStart();
  if (
    filename.endsWith(".svg") ||
    declaredMime === "image/svg+xml" ||
    /^(?:<\?xml[^>]*>\s*)?<svg[\s>]/i.test(prefix)
  ) {
    throw new BadRequestException("不支持上传 SVG 文件");
  }

  const detectedImage = detectSafeRasterMime(file.buffer);
  if (detectedImage) return detectedImage;
  if (declaredMime.startsWith("image/")) return "application/octet-stream";
  return /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(declaredMime)
    ? declaredMime
    : "application/octet-stream";
}

function detectSafeRasterMime(buffer: Buffer) {
  if (
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  ) {
    return "image/png";
  }
  if (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    return "image/jpeg";
  }
  const signature = buffer.subarray(0, 6).toString("ascii");
  if (signature === "GIF87a" || signature === "GIF89a") return "image/gif";
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

/**
 * PDF 预览的流式文件头校验：读取第一个数据块，确认包含 `%PDF-` 后，把该块
 * 与后续流重新组装成新的 Readable。禁止把整个 PDF 读入内存再发送。
 */
export async function pdfStreamWithHeaderCheck(
  stream: Readable,
): Promise<Readable> {
  const iterator = stream[Symbol.asyncIterator]();
  const first = await iterator.next();
  if (first.done) {
    throw new BadRequestException("文件内容不是有效的 PDF");
  }
  const firstChunk = Buffer.isBuffer(first.value)
    ? first.value
    : Buffer.from(first.value);
  if (!firstChunk.subarray(0, 1024).includes(Buffer.from("%PDF-"))) {
    await iterator.return?.().catch(() => undefined);
    stream.destroy();
    throw new BadRequestException("文件内容不是有效的 PDF");
  }
  return Readable.from(
    (async function* () {
      yield firstChunk;
      for await (const chunk of iterator) yield chunk;
    })(),
  );
}

export async function readPreviewBuffer(stream: Readable, maxBytes: number) {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > maxBytes) {
      stream.destroy();
      throw new BadRequestException("文件过大，无法在线预览");
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks, total);
}

export function readWebpDimensions(buffer: Buffer) {
  if (
    buffer.length < 30 ||
    buffer.subarray(0, 4).toString("ascii") !== "RIFF" ||
    buffer.subarray(8, 12).toString("ascii") !== "WEBP"
  ) {
    return null;
  }

  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const chunkType = buffer.subarray(offset, offset + 4).toString("ascii");
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const dataOffset = offset + 8;

    if (chunkType === "VP8X" && dataOffset + 10 <= buffer.length) {
      return {
        width: 1 + buffer.readUIntLE(dataOffset + 4, 3),
        height: 1 + buffer.readUIntLE(dataOffset + 7, 3),
      };
    }

    if (
      chunkType === "VP8L" &&
      dataOffset + 5 <= buffer.length &&
      buffer[dataOffset] === 0x2f
    ) {
      const bits = buffer.readUInt32LE(dataOffset + 1);
      return {
        width: (bits & 0x3fff) + 1,
        height: ((bits >> 14) & 0x3fff) + 1,
      };
    }

    if (
      chunkType === "VP8 " &&
      dataOffset + 10 <= buffer.length &&
      buffer[dataOffset + 3] === 0x9d &&
      buffer[dataOffset + 4] === 0x01 &&
      buffer[dataOffset + 5] === 0x2a
    ) {
      return {
        width: buffer.readUInt16LE(dataOffset + 6) & 0x3fff,
        height: buffer.readUInt16LE(dataOffset + 8) & 0x3fff,
      };
    }

    offset = dataOffset + chunkSize + (chunkSize % 2);
  }

  return null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function formatStorageSize(size: number) {
  if (size < 1024 * 1024) {
    return `${Math.round(size / 1024)}KB`;
  }

  if (size < 1024 * 1024 * 1024) {
    return `${Math.round(size / 1024 / 1024)}MB`;
  }

  return `${(size / 1024 / 1024 / 1024).toFixed(1)}GB`;
}
