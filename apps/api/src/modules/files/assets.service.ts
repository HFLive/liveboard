import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { canEdit, isSuperAdmin, isSystemAdmin } from "@liveboard/shared";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { Prisma } from "@prisma/client";
import { PermissionsService } from "../permissions/permissions.service";
import { PrismaService } from "../prisma/prisma.service";
import { StorageService } from "../storage/storage.service";
import { DEFAULT_MEMBER_ATTACHMENT_QUOTA_BYTES } from "../../common/storage-quota";
import { requireResourceName } from "../../common/resource-name";

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

export const MAX_ASSET_SIZE_BYTES = 50 * 1024 * 1024;
export const MAX_FORUM_IMAGES = 9;
export const MAX_FORUM_REPLY_IMAGES = 3;
export const MAX_FORUM_IMAGE_SIZE_BYTES = 10 * 1024 * 1024;
const SAFE_INLINE_IMAGE_MIMES = new Set([
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export function isSafeInlineAssetMime(mimeType: string) {
  return SAFE_INLINE_IMAGE_MIMES.has(mimeType);
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

    const mimeType = normalizeAssetMimeType(file);

    const context = await this.resolveUploadContext(userId, input);
    if (context.kind === "standalone") {
      assertStandaloneTypeAllowed(file.originalname, mimeType);
    }
    const backend = await this.storage.activeBackend();

    const safeName = sanitizeFilename(file.originalname);
    const storageKey = `${context.workspaceId}/${new Date()
      .toISOString()
      .slice(0, 10)}/${randomUUID()}-${safeName}`;

    const asset = await this.reserveAssetWithinQuota(userId, file.size, {
      workspaceId: context.workspaceId,
      folderId: context.folderId,
      fileId: context.fileId,
      storageKey,
      storageBackend: backend.name,
      kind: context.kind,
      filename: safeName,
      mimeType,
      sizeBytes: file.size,
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

    return {
      ...asset,
      url: this.getAssetUrl(asset.id),
    };
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

    const inline = !forceDownload && isSafeInlineAssetMime(asset.mimeType);
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

  async cleanupUnreferencedAssets(assetIds: string[]) {
    const uniqueIds = [...new Set(assetIds.filter(Boolean))];
    if (uniqueIds.length === 0) return;
    const [assets, references] = await Promise.all([
      this.prisma.fileAsset.findMany({
        where: { id: { in: uniqueIds }, forumPostId: null, kind: "embedded" },
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
    if (asset.uploadedBy === userId) {
      return;
    }

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
            return tx.fileAsset.create({ data });
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

function sanitizeFilename(filename: string) {
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
