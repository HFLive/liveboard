import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { canEdit, canView, isSystemAdmin } from "@liveboard/shared";
import type { FileSummary, FolderNode } from "@liveboard/shared";
import type { FileStatus, FileType } from "@liveboard/shared";
import type { ContentBlockType } from "@liveboard/shared";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { PermissionsService } from "../permissions/permissions.service";
import {
  decodeMarkdown,
  exportMarkdown,
  markdownDownloadFilename,
  markdownTitleFromFilename,
  MAX_MARKDOWN_BLOCKS,
  MAX_MARKDOWN_SIZE_BYTES,
  parseMarkdown,
} from "./markdown";

export interface CreateFolderInput {
  name: string;
  parentId?: string | null;
}

export interface CreateFileInput {
  folderId: string;
  title: string;
  type: FileType;
}

export interface UpdateFolderInput {
  name?: string;
  parentId?: string | null;
}

export interface DeleteFolderInput {
  recursive: boolean;
  confirmationName: string;
}

export interface UpdateFileInput {
  title?: string;
  folderId?: string;
}

export interface ListFilesInput {
  folderId?: string;
}

export interface CreateBlockInput {
  type: ContentBlockType;
  dataJson: unknown;
}

export interface UpdateBlockInput {
  type?: ContentBlockType;
  dataJson: unknown;
}

export interface ReferenceBlocksInput {
  sourceBlockIds: string[];
}

export interface ReorderBlocksInput {
  blockIds: string[];
}

export interface ImportMarkdownInput {
  folderId: string;
  originalname: string;
  size: number;
  buffer: Buffer;
}

@Injectable()
export class FilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionsService,
  ) {}

  async getFolderTree(userId: string | null): Promise<FolderNode[]> {
    if (!userId) {
      throw new UnauthorizedException("Missing session");
    }

    const folders = await this.prisma.folder.findMany({
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      include: { _count: { select: { files: true } } },
    });

    const nodes = new Map<string, FolderNode>();
    const permissions = await this.permissions.getEffectiveLevelsForFolders(
      userId,
      folders.map((folder) => folder.id),
    );

    for (const folder of folders) {
      const permission = permissions.get(folder.id) ?? null;

      if (!canView(permission)) {
        continue;
      }

      nodes.set(folder.id, {
        id: folder.id,
        name: folder.name,
        parentId: folder.parentId,
        permission: permission!,
        fileCount: folder._count.files,
        updatedAt: folder.updatedAt.toISOString(),
        children: [],
      });
    }

    const roots: FolderNode[] = [];

    for (const node of nodes.values()) {
      if (node.parentId && nodes.has(node.parentId)) {
        nodes.get(node.parentId)!.children.push(node);
      } else {
        roots.push(node);
      }
    }

    return roots;
  }

  async listFiles(
    userId: string | null,
    input: ListFilesInput = {},
  ): Promise<FileSummary[]> {
    if (!userId) {
      throw new UnauthorizedException("Missing session");
    }

    const files = await this.prisma.file.findMany({
      where: {
        ...(input.folderId ? { folderId: input.folderId } : {}),
        status: { not: "archived" },
      },
      orderBy: [{ updatedAt: "desc" }],
    });

    const visibleFiles: FileSummary[] = [];
    const permissions = await this.permissions.getEffectiveLevelsForFiles(
      userId,
      files.map((file) => file.id),
    );

    for (const file of files) {
      const permission = permissions.get(file.id) ?? null;

      if (!canView(permission)) {
        continue;
      }

      if (file.status === "draft" && permission === "viewer") {
        continue;
      }

      visibleFiles.push(this.toSummary(file));
    }

    return visibleFiles;
  }

  async createFolder(userId: string | null, input: CreateFolderInput) {
    if (!userId) {
      throw new UnauthorizedException("Missing session");
    }

    let workspace = await this.getDefaultWorkspace();
    let parentPermission = null;

    if (input.parentId) {
      parentPermission = await this.permissions.getEffectiveLevelForFolder(
        userId,
        input.parentId,
      );

      if (!canEdit(parentPermission)) {
        throw new ForbiddenException("No permission to create folder here");
      }

      const parent = await this.prisma.folder.findUnique({
        where: { id: input.parentId },
        select: { workspace: true },
      });
      if (!parent) {
        throw new NotFoundException("Folder not found");
      }
      workspace = parent.workspace;
    }
    const ownerGroupId = input.parentId
      ? null
      : await this.resolveOwnerGroupId(userId, workspace.id);

    return this.prisma.$transaction(async (tx) => {
      const folder = await tx.folder.create({
        data: {
          workspaceId: workspace.id,
          parentId: input.parentId ?? null,
          name: input.name,
          createdById: userId,
        },
      });

      if (ownerGroupId) {
        await tx.permissionGrant.create({
          data: {
            workspaceId: workspace.id,
            createdById: userId,
            targetType: "folder",
            targetId: folder.id,
            groupId: ownerGroupId,
            level: "owner",
          },
        });
      }

      return folder;
    });
  }

  async updateFolder(
    userId: string | null,
    folderId: string,
    input: UpdateFolderInput,
  ) {
    if (!userId) {
      throw new UnauthorizedException("Missing session");
    }

    if (!input.name && input.parentId === undefined) {
      throw new BadRequestException("Nothing to update");
    }

    const permission = await this.permissions.getEffectiveLevelForFolder(
      userId,
      folderId,
    );

    if (!canEdit(permission)) {
      throw new ForbiddenException("No permission to rename folder");
    }

    const folder = await this.prisma.folder.findUnique({
      where: { id: folderId },
      select: { workspaceId: true },
    });
    if (!folder) {
      throw new NotFoundException("Folder not found");
    }

    const data: { name?: string; parentId?: string | null } = {};

    if (input.name !== undefined) {
      const name = input.name.trim();
      if (!name) {
        throw new BadRequestException("文件夹名称不能为空");
      }
      data.name = name;
    }

    if (input.parentId !== undefined) {
      const parentId = input.parentId || null;

      if (parentId === folderId) {
        throw new BadRequestException("不能移动到自身内部");
      }

      if (parentId) {
        const targetPermission =
          await this.permissions.getEffectiveLevelForFolder(userId, parentId);

        if (!canEdit(targetPermission)) {
          throw new ForbiddenException("No permission to move folder here");
        }

        const target = await this.prisma.folder.findUnique({
          where: { id: parentId },
          select: { workspaceId: true },
        });
        if (!target || target.workspaceId !== folder.workspaceId) {
          throw new BadRequestException("不能将文件夹移动到其他工作区");
        }

        const targetPath = await this.getFolderPath(parentId);
        if (targetPath.some((folder) => folder.id === folderId)) {
          throw new BadRequestException("不能移动到自己的子文件夹内");
        }
      }

      data.parentId = parentId;
    }

    return this.prisma.folder.update({
      where: { id: folderId },
      data,
    });
  }

  async deleteFolder(
    userId: string | null,
    folderId: string,
    input: DeleteFolderInput,
  ) {
    if (!userId) {
      throw new UnauthorizedException("Missing session");
    }

    const permission = await this.permissions.getEffectiveLevelForFolder(
      userId,
      folderId,
    );

    if (!canEdit(permission)) {
      throw new ForbiddenException("No permission to delete folder");
    }

    const folder = await this.prisma.folder.findUnique({
      where: { id: folderId },
      select: { id: true, name: true, workspaceId: true },
    });

    if (!folder) {
      throw new NotFoundException("Folder not found");
    }

    if (!input.recursive || input.confirmationName !== folder.name) {
      throw new BadRequestException("请确认递归删除并输入正确的文件夹名称");
    }

    await this.prisma.$transaction(async (tx) => {
      const current = await tx.folder.findUnique({
        where: { id: folderId },
        select: { id: true, name: true, workspaceId: true },
      });
      if (!current) throw new NotFoundException("Folder not found");
      if (current.name !== input.confirmationName) {
        throw new BadRequestException("文件夹名称已变化，请重新确认");
      }

      const workspaceFolders = await tx.folder.findMany({
        where: { workspaceId: current.workspaceId },
        select: { id: true, parentId: true },
      });
      const childIdsByParent = new Map<string, string[]>();
      for (const item of workspaceFolders) {
        if (!item.parentId) continue;
        const childIds = childIdsByParent.get(item.parentId) ?? [];
        childIds.push(item.id);
        childIdsByParent.set(item.parentId, childIds);
      }

      const folderIds = new Set([folderId]);
      const stack = [...(childIdsByParent.get(folderId) ?? [])];
      while (stack.length > 0) {
        const id = stack.pop();
        if (!id || folderIds.has(id)) continue;
        folderIds.add(id);
        stack.push(...(childIdsByParent.get(id) ?? []));
      }

      const files = await tx.file.findMany({
        where: { folderId: { in: [...folderIds] } },
        select: { id: true },
      });
      await tx.permissionGrant.deleteMany({
        where: {
          OR: [
            { targetType: "folder", targetId: { in: [...folderIds] } },
            {
              targetType: "file",
              targetId: { in: files.map((file) => file.id) },
            },
          ],
        },
      });
      await tx.folder.delete({ where: { id: folderId } });
    });

    return { ok: true };
  }

  async createFile(userId: string | null, input: CreateFileInput) {
    if (!userId) {
      throw new UnauthorizedException("Missing session");
    }

    const permission = await this.permissions.getEffectiveLevelForFolder(
      userId,
      input.folderId,
    );

    if (!canEdit(permission) && permission !== "lecturer") {
      throw new ForbiddenException("No permission to create file here");
    }

    const folder = await this.prisma.folder.findUnique({
      where: { id: input.folderId },
    });

    if (!folder) {
      throw new NotFoundException("Folder not found");
    }

    return this.prisma.file.create({
      data: {
        workspaceId: folder.workspaceId,
        folderId: folder.id,
        title: input.title,
        type: input.type,
        createdById: userId,
        updatedById: userId,
      },
    });
  }

  async importMarkdown(userId: string | null, input: ImportMarkdownInput) {
    if (!userId) {
      throw new UnauthorizedException("Missing session");
    }
    if (!input.folderId) {
      throw new BadRequestException("请选择导入位置");
    }
    if (!input.originalname) {
      throw new BadRequestException("请选择 Markdown 文件");
    }
    if (!/\.md$/i.test(input.originalname)) {
      throw new BadRequestException("只支持上传 .md 文件");
    }
    if (input.size <= 0 || input.buffer.length === 0) {
      throw new BadRequestException("Markdown 文件不能为空");
    }
    if (
      input.size > MAX_MARKDOWN_SIZE_BYTES ||
      input.buffer.length > MAX_MARKDOWN_SIZE_BYTES
    ) {
      throw new BadRequestException("Markdown 文件不能超过 2 MB");
    }

    const permission = await this.permissions.getEffectiveLevelForFolder(
      userId,
      input.folderId,
    );
    if (!canEdit(permission) && permission !== "lecturer") {
      throw new ForbiddenException("No permission to create file here");
    }

    const folder = await this.prisma.folder.findUnique({
      where: { id: input.folderId },
    });
    if (!folder) {
      throw new NotFoundException("Folder not found");
    }

    let markdown: string;
    try {
      markdown = decodeMarkdown(input.buffer);
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : "无法读取 Markdown 文件",
      );
    }
    const parsed = parseMarkdown(markdown);
    if (parsed.blocks.length > MAX_MARKDOWN_BLOCKS) {
      throw new BadRequestException(
        `Markdown 内容块不能超过 ${MAX_MARKDOWN_BLOCKS} 个`,
      );
    }

    const file = await this.prisma.$transaction(async (tx) => {
      const created = await tx.file.create({
        data: {
          workspaceId: folder.workspaceId,
          folderId: folder.id,
          title: markdownTitleFromFilename(input.originalname),
          type: "doc",
          createdById: userId,
          updatedById: userId,
        },
      });
      if (parsed.blocks.length > 0) {
        await tx.contentBlock.createMany({
          data: parsed.blocks.map((block, index) => ({
            fileId: created.id,
            type: block.type,
            dataJson: block.dataJson as Prisma.InputJsonValue,
            sortOrder: (index + 1) * 10,
            createdById: userId,
            updatedById: userId,
          })),
        });
      }
      return created;
    });

    return {
      file: this.toSummary(file),
      warnings: parsed.warnings,
      blockCount: parsed.blocks.length,
    };
  }

  async exportMarkdown(userId: string | null, fileId: string) {
    const file = await this.getFile(userId, fileId);
    const blocks = await this.prisma.contentBlock.findMany({
      where: { fileId },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      select: { type: true, dataJson: true },
    });

    return {
      filename: markdownDownloadFilename(file.title),
      content: exportMarkdown(blocks),
    };
  }

  async updateFile(
    userId: string | null,
    fileId: string,
    input: UpdateFileInput,
  ) {
    if (!userId) {
      throw new UnauthorizedException("Missing session");
    }

    if (!input.title && !input.folderId) {
      throw new BadRequestException("Nothing to update");
    }

    const permission = await this.permissions.getEffectiveLevelForFile(
      userId,
      fileId,
    );

    if (!canEdit(permission) && permission !== "lecturer") {
      throw new ForbiddenException("No permission to rename file");
    }

    if (input.folderId) {
      const targetPermission =
        await this.permissions.getEffectiveLevelForFolder(
          userId,
          input.folderId,
        );

      if (!canEdit(targetPermission) && targetPermission !== "lecturer") {
        throw new ForbiddenException("No permission to move file here");
      }

      const [file, targetFolder] = await Promise.all([
        this.prisma.file.findUnique({
          where: { id: fileId },
          select: { workspaceId: true },
        }),
        this.prisma.folder.findUnique({
          where: { id: input.folderId },
          select: { workspaceId: true },
        }),
      ]);
      if (!file || !targetFolder) {
        throw new NotFoundException("File or folder not found");
      }
      if (file.workspaceId !== targetFolder.workspaceId) {
        throw new BadRequestException("不能将文件移动到其他工作区");
      }
    }

    return this.prisma.file.update({
      where: { id: fileId },
      data: {
        ...(input.title ? { title: input.title } : {}),
        ...(input.folderId ? { folderId: input.folderId } : {}),
        updatedById: userId,
        version: { increment: 1 },
      },
    });
  }

  async getFile(userId: string | null, fileId: string) {
    if (!userId) {
      throw new UnauthorizedException("Missing session");
    }

    const file = await this.prisma.file.findUnique({
      where: { id: fileId },
    });

    if (!file) {
      throw new NotFoundException("File not found");
    }

    if (file.status === "archived") {
      throw new NotFoundException("File not found");
    }

    const permission = await this.permissions.getEffectiveLevelForFile(
      userId,
      fileId,
    );

    if (!canView(permission)) {
      throw new ForbiddenException("No permission to view file");
    }

    if (file.status === "draft" && permission === "viewer") {
      throw new ForbiddenException("No permission to view draft");
    }

    return {
      ...file,
      permission,
    };
  }

  async listBlocks(userId: string | null, fileId: string) {
    await this.getFile(userId, fileId);

    return this.prisma.contentBlock.findMany({
      where: { fileId },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    });
  }

  async createBlock(
    userId: string | null,
    fileId: string,
    input: CreateBlockInput,
  ) {
    if (!userId) {
      throw new UnauthorizedException("Missing session");
    }

    const permission = await this.permissions.getEffectiveLevelForFile(
      userId,
      fileId,
    );

    if (!canEdit(permission) && permission !== "lecturer") {
      throw new ForbiddenException("No permission to edit file");
    }

    this.assertValidStructuredBlock(input.type, input.dataJson);
    await this.assertCanReferenceAsset(
      userId,
      fileId,
      input.type,
      input.dataJson,
    );

    return this.prisma.$transaction(async (tx) => {
      const maxBlock = await tx.contentBlock.findFirst({
        where: { fileId },
        orderBy: { sortOrder: "desc" },
        select: { sortOrder: true },
      });
      const block = await tx.contentBlock.create({
        data: {
          fileId,
          type: input.type,
          dataJson: input.dataJson as Prisma.InputJsonValue,
          sortOrder: (maxBlock?.sortOrder ?? 0) + 10,
          createdById: userId,
          updatedById: userId,
        },
      });
      await tx.file.update({
        where: { id: fileId },
        data: { version: { increment: 1 }, updatedById: userId },
      });
      return block;
    });
  }

  async referenceBlocks(
    userId: string | null,
    fileId: string,
    input: ReferenceBlocksInput,
  ) {
    if (!userId) {
      throw new UnauthorizedException("Missing session");
    }

    if (input.sourceBlockIds.length === 0) {
      throw new BadRequestException("Please select at least one block");
    }

    const targetPermission = await this.permissions.getEffectiveLevelForFile(
      userId,
      fileId,
    );

    if (!canEdit(targetPermission) && targetPermission !== "lecturer") {
      throw new ForbiddenException("No permission to edit file");
    }

    const sourceBlocks = await this.prisma.contentBlock.findMany({
      where: { id: { in: input.sourceBlockIds } },
      include: { file: true },
    });
    const byId = new Map(sourceBlocks.map((block) => [block.id, block]));
    const orderedBlocks = input.sourceBlockIds
      .map((blockId) => byId.get(blockId))
      .filter((block): block is NonNullable<typeof block> => Boolean(block));

    if (orderedBlocks.length !== input.sourceBlockIds.length) {
      throw new NotFoundException("Source block not found");
    }

    const sourcePermissions = await this.permissions.getEffectiveLevelsForFiles(
      userId,
      orderedBlocks.map((block) => block.fileId),
    );
    for (const block of orderedBlocks) {
      if (!canView(sourcePermissions.get(block.fileId) ?? null)) {
        throw new ForbiddenException("No permission to reference source block");
      }
    }

    return this.prisma.$transaction(async (tx) => {
      const maxBlock = await tx.contentBlock.findFirst({
        where: { fileId },
        orderBy: { sortOrder: "desc" },
        select: { sortOrder: true },
      });
      const startOrder = maxBlock?.sortOrder ?? 0;
      const created = [];
      for (const [index, block] of orderedBlocks.entries()) {
        created.push(
          await tx.contentBlock.create({
            data: {
              fileId,
              type: "reference",
              sortOrder: startOrder + (index + 1) * 10,
              dataJson: {
                text: getBlockText(block.dataJson),
                sourceFileTitle: block.file.title,
                sourceBlockType: block.type,
              },
              sourceFileId: block.fileId,
              sourceBlockId: block.id,
              referenceMode: "snapshot",
              createdById: userId,
              updatedById: userId,
            },
          }),
        );
      }
      await tx.file.update({
        where: { id: fileId },
        data: { version: { increment: 1 }, updatedById: userId },
      });
      return created;
    });
  }

  async reorderBlocks(
    userId: string | null,
    fileId: string,
    input: ReorderBlocksInput,
  ) {
    if (!userId) {
      throw new UnauthorizedException("Missing session");
    }

    const permission = await this.permissions.getEffectiveLevelForFile(
      userId,
      fileId,
    );

    if (!canEdit(permission) && permission !== "lecturer") {
      throw new ForbiddenException("No permission to reorder blocks");
    }

    const existingBlocks = await this.prisma.contentBlock.findMany({
      where: { fileId },
      select: { id: true },
    });
    const existingIds = new Set(existingBlocks.map((block) => block.id));
    const uniqueInputIds = new Set(input.blockIds);

    if (
      input.blockIds.length !== existingBlocks.length ||
      uniqueInputIds.size !== input.blockIds.length ||
      input.blockIds.some((blockId) => !existingIds.has(blockId))
    ) {
      throw new BadRequestException("Invalid block order");
    }

    await this.prisma.$transaction(async (tx) => {
      await Promise.all(
        input.blockIds.map((blockId, index) =>
          tx.contentBlock.update({
            where: { id: blockId },
            data: {
              sortOrder: (index + 1) * 10,
              updatedById: userId,
            },
          }),
        ),
      );
      await tx.file.update({
        where: { id: fileId },
        data: { version: { increment: 1 }, updatedById: userId },
      });
    });

    return this.prisma.contentBlock.findMany({
      where: { fileId },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    });
  }

  async updateBlock(
    userId: string | null,
    blockId: string,
    input: UpdateBlockInput,
  ) {
    if (!userId) {
      throw new UnauthorizedException("Missing session");
    }

    const block = await this.prisma.contentBlock.findUnique({
      where: { id: blockId },
    });

    if (!block) {
      throw new NotFoundException("Block not found");
    }

    const permission = await this.permissions.getEffectiveLevelForFile(
      userId,
      block.fileId,
    );

    if (!canEdit(permission) && permission !== "lecturer") {
      throw new ForbiddenException("No permission to edit block");
    }

    this.assertValidStructuredBlock(
      input.type ?? (block.type as ContentBlockType),
      input.dataJson,
    );
    await this.assertCanReferenceAsset(
      userId,
      block.fileId,
      input.type ?? (block.type as ContentBlockType),
      input.dataJson,
    );

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.contentBlock.update({
        where: { id: blockId },
        data: {
          ...(input.type ? { type: input.type } : {}),
          dataJson: input.dataJson as Prisma.InputJsonValue,
          updatedById: userId,
        },
      });
      await tx.file.update({
        where: { id: block.fileId },
        data: { version: { increment: 1 }, updatedById: userId },
      });
      return updated;
    });
  }

  async deleteBlock(userId: string | null, blockId: string) {
    if (!userId) {
      throw new UnauthorizedException("Missing session");
    }

    const block = await this.prisma.contentBlock.findUnique({
      where: { id: blockId },
    });

    if (!block) {
      throw new NotFoundException("Block not found");
    }

    const permission = await this.permissions.getEffectiveLevelForFile(
      userId,
      block.fileId,
    );

    if (!canEdit(permission) && permission !== "lecturer") {
      throw new ForbiddenException("No permission to delete block");
    }

    await this.prisma.$transaction([
      this.prisma.contentBlock.delete({ where: { id: blockId } }),
      this.prisma.file.update({
        where: { id: block.fileId },
        data: { version: { increment: 1 }, updatedById: userId },
      }),
    ]);

    return { ok: true };
  }

  async publishFile(userId: string | null, fileId: string) {
    if (!userId) {
      throw new UnauthorizedException("Missing session");
    }

    const permission = await this.permissions.getEffectiveLevelForFile(
      userId,
      fileId,
    );

    if (!canEdit(permission) && permission !== "lecturer") {
      throw new ForbiddenException("No permission to publish file");
    }

    return this.prisma.file.update({
      where: { id: fileId },
      data: {
        status: "published",
        publishedAt: new Date(),
        updatedById: userId,
        version: { increment: 1 },
      },
    });
  }

  async deleteFile(userId: string | null, fileId: string) {
    if (!userId) {
      throw new UnauthorizedException("Missing session");
    }

    const permission = await this.permissions.getEffectiveLevelForFile(
      userId,
      fileId,
    );

    if (!canEdit(permission) && permission !== "lecturer") {
      throw new ForbiddenException("No permission to delete file");
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.permissionGrant.deleteMany({
        where: { targetType: "file", targetId: fileId },
      });
      await tx.file.delete({ where: { id: fileId } });
    });

    return { ok: true };
  }

  private async getDefaultWorkspace() {
    const workspace = await this.prisma.workspace.findFirst({
      orderBy: { createdAt: "asc" },
    });

    if (!workspace) {
      throw new NotFoundException(
        "Workspace not found. Run pnpm db:seed first.",
      );
    }

    return workspace;
  }

  private async resolveOwnerGroupId(userId: string, workspaceId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { systemRole: true },
    });

    if (!user) {
      throw new UnauthorizedException("Missing session");
    }

    if (isSystemAdmin(user.systemRole)) {
      return null;
    }

    const membership = await this.prisma.permissionGroupMember.findFirst({
      where: { userId, group: { workspaceId } },
      orderBy: [{ createdAt: "asc" }],
      select: { groupId: true },
    });

    if (!membership) {
      throw new ForbiddenException("请先将成员加入权限组，再创建顶层位置");
    }

    return membership.groupId;
  }

  private toSummary(file: {
    id: string;
    folderId: string;
    title: string;
    type: FileType;
    status: FileStatus;
    updatedAt: Date;
  }): FileSummary {
    return {
      id: file.id,
      folderId: file.folderId,
      title: file.title,
      type: file.type,
      status: file.status,
      updatedAt: file.updatedAt.toISOString(),
    };
  }

  private async bumpFileVersion(fileId: string, userId: string) {
    await this.prisma.file.update({
      where: { id: fileId },
      data: {
        version: { increment: 1 },
        updatedById: userId,
      },
    });
  }

  private async assertCanReferenceAsset(
    userId: string,
    fileId: string,
    type: ContentBlockType,
    dataJson: unknown,
  ) {
    if (type !== "image" && type !== "attachment") return;
    const assetId = getStringField(dataJson, "assetId");
    if (!assetId) return;

    const [file, asset] = await Promise.all([
      this.prisma.file.findUnique({
        where: { id: fileId },
        select: { workspaceId: true },
      }),
      this.prisma.fileAsset.findUnique({ where: { id: assetId } }),
    ]);
    if (!file || !asset || asset.workspaceId !== file.workspaceId) {
      throw new BadRequestException("附件不存在或不属于当前工作区");
    }
    if (asset.uploadedBy === userId) return;

    const sourceLevel = asset.fileId
      ? await this.permissions.getEffectiveLevelForFile(userId, asset.fileId)
      : asset.folderId
        ? await this.permissions.getEffectiveLevelForFolder(
            userId,
            asset.folderId,
          )
        : null;
    if (!canEdit(sourceLevel)) {
      throw new ForbiddenException("No permission to reference asset");
    }
  }

  private assertValidStructuredBlock(
    type: ContentBlockType,
    dataJson: unknown,
  ) {
    if (!dataJson || typeof dataJson !== "object" || Array.isArray(dataJson)) {
      throw new BadRequestException("内容块数据格式无效");
    }

    const data = dataJson as Record<string, unknown>;
    if (type === "math") {
      if (typeof data.text !== "string" || data.text.length > 50_000) {
        throw new BadRequestException("数学公式必须是 50000 字符以内的文本");
      }
      return;
    }

    if (type !== "table") return;
    if (
      !Array.isArray(data.rows) ||
      data.rows.length < 1 ||
      data.rows.length > 50
    ) {
      throw new BadRequestException("表格必须包含 1 至 50 行");
    }
    for (const row of data.rows) {
      if (!Array.isArray(row) || row.length < 1 || row.length > 20) {
        throw new BadRequestException("表格每行必须包含 1 至 20 列");
      }
      if (
        row.some((cell) => typeof cell !== "string" || cell.length > 10_000)
      ) {
        throw new BadRequestException("表格单元格必须是 10000 字符以内的文本");
      }
    }
  }

  private async getFolderPath(folderId: string) {
    const path: Array<{ id: string; parentId: string | null }> = [];
    let currentId: string | null = folderId;

    while (currentId) {
      const folder: { id: string; parentId: string | null } | null =
        await this.prisma.folder.findUnique({
          where: { id: currentId },
          select: { id: true, parentId: true },
        });

      if (!folder) {
        break;
      }

      path.unshift(folder);
      currentId = folder.parentId;
    }

    return path;
  }
}

function getBlockText(value: unknown) {
  if (
    value &&
    typeof value === "object" &&
    "text" in value &&
    typeof value.text === "string"
  ) {
    return value.text;
  }

  return "";
}

function getStringField(value: unknown, field: string) {
  if (!value || typeof value !== "object" || !(field in value)) return null;
  const result = (value as Record<string, unknown>)[field];
  return typeof result === "string" && result ? result : null;
}
