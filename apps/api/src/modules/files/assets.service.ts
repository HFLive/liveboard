import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { canEdit } from "@liveboard/shared";
import { Client } from "minio";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { PermissionsService } from "../permissions/permissions.service";
import { PrismaService } from "../prisma/prisma.service";

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

@Injectable()
export class AssetsService {
  private readonly minio: Client;
  private readonly bucket: string;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionsService,
  ) {
    this.bucket = this.config.get<string>("MINIO_BUCKET", "liveboard-assets");
    const accessKey = this.config.get<string>("MINIO_ROOT_USER", "liveboard");
    const secretKey = this.config.get<string>(
      "MINIO_ROOT_PASSWORD",
      "replace-with-a-strong-password",
    );

    if (
      process.env.NODE_ENV === "production" &&
      (!accessKey ||
        !secretKey ||
        secretKey === "replace-with-a-strong-password")
    ) {
      throw new Error(
        "Secure MinIO credentials must be configured in production",
      );
    }

    this.minio = new Client({
      endPoint: this.config.get<string>("MINIO_ENDPOINT", "localhost"),
      port: this.config.get<number>("MINIO_PORT", 9000),
      useSSL: this.config.get<string>("MINIO_USE_SSL", "false") === "true",
      accessKey,
      secretKey,
    });
  }

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

    if (file.size > 50 * 1024 * 1024) {
      throw new BadRequestException("文件不能超过 50MB");
    }

    const context = await this.resolveUploadContext(userId, input);
    await this.assertStorageQuota(userId, file.size);
    await this.ensureBucket();

    const safeName = sanitizeFilename(file.originalname);
    const storageKey = `${context.workspaceId}/${new Date()
      .toISOString()
      .slice(0, 10)}/${randomUUID()}-${safeName}`;

    await this.minio.putObject(
      this.bucket,
      storageKey,
      file.buffer,
      file.size,
      {
        "Content-Type": file.mimetype || "application/octet-stream",
      },
    );

    const asset = await this.prisma.fileAsset.create({
      data: {
        workspaceId: context.workspaceId,
        folderId: context.folderId,
        fileId: context.fileId,
        storageKey,
        filename: safeName,
        mimeType: file.mimetype || "application/octet-stream",
        sizeBytes: file.size,
        uploadedBy: userId,
      },
    });

    return {
      ...asset,
      url: this.getAssetUrl(asset.id),
    };
  }

  async getAssetForDownload(userId: string | null, assetId: string) {
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

    const stream = await this.minio.getObject(this.bucket, asset.storageKey);

    return {
      asset,
      stream: stream as Readable,
    };
  }

  async listLibraryAssets(userId: string | null) {
    if (!userId) {
      throw new UnauthorizedException("Missing session");
    }

    const assets = await this.prisma.fileAsset.findMany({
      where: { uploadedBy: userId },
      orderBy: { createdAt: "desc" },
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

    return assets.map((asset) => ({
      ...asset,
      url: this.getAssetUrl(asset.id),
      referenceCount: referenceCounts.get(asset.id) ?? 0,
    }));
  }

  async deleteLibraryAsset(userId: string | null, assetId: string) {
    if (!userId) {
      throw new UnauthorizedException("Missing session");
    }

    const asset = await this.prisma.fileAsset.findUnique({
      where: { id: assetId },
    });

    if (!asset) {
      throw new NotFoundException("Asset not found");
    }

    if (asset.uploadedBy !== userId) {
      throw new ForbiddenException("No permission to delete asset");
    }

    const references = await this.getAssetReferences([asset.id]);

    if (references.length > 0) {
      throw new ConflictException({
        message: "文件已被引用，不能删除",
        references: references.map((reference) => ({
          fileId: reference.fileId,
          fileTitle: reference.fileTitle,
          blockId: reference.blockId,
          blockType: reference.blockType,
        })),
      });
    }

    await this.minio
      .removeObject(this.bucket, asset.storageKey)
      .catch(() => undefined);
    await this.prisma.fileAsset.delete({
      where: { id: asset.id },
    });

    return { ok: true };
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
      };
    }

    if (!input.folderId) {
      const workspace = await this.prisma.workspace.findFirst({
        orderBy: { createdAt: "asc" },
      });

      if (!workspace) {
        throw new NotFoundException(
          "Workspace not found. Run pnpm db:seed first.",
        );
      }

      return {
        workspaceId: workspace.id,
        folderId: null,
        fileId: null,
      };
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
      throw new ForbiddenException("No permission to upload asset");
    }

    return {
      workspaceId: folder.workspaceId,
      folderId: folder.id,
      fileId: null,
    };
  }

  private async assertCanViewAsset(
    userId: string,
    asset: {
      id: string;
      folderId: string | null;
      fileId: string | null;
      uploadedBy: string;
    },
  ) {
    if (asset.uploadedBy === userId) {
      return;
    }

    const references = await this.getAssetReferences([asset.id]);

    const referenceLevels = await Promise.all(
      references.map((reference) =>
        this.permissions.getEffectiveLevelForFile(userId, reference.fileId),
      ),
    );

    if (referenceLevels.some((level) => level && level !== "no_access")) {
      return;
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
    const blocks = await this.prisma.contentBlock.findMany({
      where: {
        type: { in: ["image", "attachment"] },
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
    });
    const references: Array<{
      assetId: string;
      blockId: string;
      blockType: string;
      fileId: string;
      fileTitle: string;
    }> = [];

    for (const block of blocks) {
      const data = asRecord(block.dataJson);
      const assetId = typeof data.assetId === "string" ? data.assetId : null;

      if (assetId && assetIdSet.has(assetId)) {
        references.push({
          assetId,
          blockId: block.id,
          blockType: block.type,
          fileId: block.file.id,
          fileTitle: block.file.title,
        });
      }
    }

    return references;
  }

  private async ensureBucket() {
    const exists = await this.minio
      .bucketExists(this.bucket)
      .catch(() => false);

    if (!exists) {
      await this.minio.makeBucket(this.bucket);
    }
  }

  private async assertStorageQuota(userId: string, incomingBytes: number) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { storageQuotaBytes: true },
    });

    if (!user) {
      throw new UnauthorizedException("Missing session");
    }

    const usage = await this.prisma.fileAsset.aggregate({
      where: { uploadedBy: userId },
      _sum: { sizeBytes: true },
    });
    const usedBytes = usage._sum.sizeBytes ?? 0;

    if (usedBytes + incomingBytes > user.storageQuotaBytes) {
      throw new BadRequestException(
        `网盘容量不足，当前上限为 ${formatStorageSize(user.storageQuotaBytes)}`,
      );
    }
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
