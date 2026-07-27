import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import {
  isSuperAdmin,
  isSystemAdmin,
  type AdminUserSummary,
  type SystemRole,
  type UserTagSummary,
  type UserSummary,
} from "@liveboard/shared";
import argon2 from "argon2";
import { Prisma } from "@prisma/client";
import { formatDateKey } from "../../common/date-key";
import {
  DEFAULT_CLASSROOM_STORAGE_QUOTA_BYTES,
  DEFAULT_MEMBER_ATTACHMENT_QUOTA_BYTES,
} from "../../common/storage-quota";
import { PrismaService } from "../prisma/prisma.service";

export interface CreateUserInput {
  username: string;
  displayName: string;
  password: string;
  systemRole: SystemRole;
}

export type ImportUserInput = CreateUserInput;

export interface ImportUsersResult {
  created: UserSummary[];
  skipped: Array<{ rowNumber: number; username: string; reason: string }>;
  failed: Array<{ rowNumber: number; username: string; reason: string }>;
}

export interface UpdateUserInput {
  displayName?: string;
  systemRole?: SystemRole;
  status?: UserSummary["status"];
  password?: string;
  storageQuotaBytes?: number | null;
  aiCallLimit?: number | null;
}

export interface UserStorageSummary {
  user: UserSummary;
  storageQuotaBytes: number;
  storageQuotaCustom: boolean;
  storageUsedBytes: number;
  assetCount: number;
}

export interface StorageQuotaDefaults {
  memberAttachmentQuotaBytes: number;
  memberAttachmentQuotaCustom: boolean;
  classroomStorageQuotaBytes: number;
  classroomStorageQuotaCustom: boolean;
}

export interface CreateUserTagInput {
  name: string;
}

export interface UpdateUserTagInput {
  name: string;
}

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async listUsers(actorUserId: string | null): Promise<AdminUserSummary[]> {
    await this.requireAdmin(actorUserId);

    const [users, workspace] = await Promise.all([
      this.prisma.user.findMany({
        orderBy: [{ createdAt: "asc" }],
        include: {
          tagAssignments: { include: { tag: true } },
          badgeAssignments: {
            where: { equippedOrder: { not: null } },
            include: { badge: true },
            orderBy: { equippedOrder: "asc" },
            take: 3,
          },
        },
      }),
      this.prisma.workspace.findFirst({
        orderBy: { createdAt: "asc" },
        select: { timeZone: true },
      }),
    ]);
    const dateKey = formatDateKey(
      new Date(),
      workspace?.timeZone ?? "Asia/Shanghai",
    );

    return users.map((user) => ({
      ...this.toSummary(user),
      aiCallCount: user.aiCallDateKey === dateKey ? user.aiCallCount : 0,
      aiCallLimit: user.aiCallLimit,
    }));
  }

  async listVisibilityUsers(
    actorUserId: string | null,
  ): Promise<UserSummary[]> {
    if (!actorUserId) {
      throw new UnauthorizedException("Missing session");
    }

    const actor = await this.prisma.user.findUnique({
      where: { id: actorUserId },
      select: { status: true },
    });
    if (!actor || actor.status !== "active") {
      throw new UnauthorizedException("User not found");
    }

    const users = await this.prisma.user.findMany({
      where: { status: "active" },
      orderBy: [{ displayName: "asc" }, { username: "asc" }],
      include: {
        tagAssignments: { include: { tag: true } },
        badgeAssignments: {
          where: { equippedOrder: { not: null } },
          include: { badge: true },
          orderBy: { equippedOrder: "asc" },
          take: 3,
        },
      },
    });

    return users.map((user) => this.toSummary(user));
  }

  async listUserStorage(
    actorUserId: string | null,
  ): Promise<UserStorageSummary[]> {
    await this.requireAdmin(actorUserId);

    const [users, groupedAssets, workspace] = await Promise.all([
      this.prisma.user.findMany({
        orderBy: [{ createdAt: "asc" }],
        include: {
          badgeAssignments: {
            where: { equippedOrder: { not: null } },
            include: { badge: true },
            orderBy: { equippedOrder: "asc" },
            take: 3,
          },
        },
      }),
      this.prisma.fileAsset.groupBy({
        by: ["uploadedBy"],
        _sum: { sizeBytes: true },
        _count: { id: true },
      }),
      this.prisma.workspace.findFirst({
        select: { memberAttachmentQuotaBytes: true },
      }),
    ]);
    const defaultQuotaBytes =
      workspace?.memberAttachmentQuotaBytes ??
      DEFAULT_MEMBER_ATTACHMENT_QUOTA_BYTES;
    const usageByUserId = new Map<
      string,
      { storageUsedBytes: number; assetCount: number }
    >();
    for (const item of groupedAssets) {
      usageByUserId.set(item.uploadedBy, {
        storageUsedBytes: item._sum.sizeBytes ?? 0,
        assetCount: item._count.id,
      });
    }

    return users.map((user) => {
      const usage = usageByUserId.get(user.id);

      return {
        user: this.toSummary(user),
        storageQuotaBytes: user.storageQuotaBytes ?? defaultQuotaBytes,
        storageQuotaCustom: user.storageQuotaBytes !== null,
        storageUsedBytes: usage?.storageUsedBytes ?? 0,
        assetCount: usage?.assetCount ?? 0,
      };
    });
  }

  async getStorageQuotaDefaults(
    actorUserId: string | null,
  ): Promise<StorageQuotaDefaults> {
    await this.requireAdmin(actorUserId);
    const workspace = await this.prisma.workspace.findFirst();
    return {
      memberAttachmentQuotaBytes:
        workspace?.memberAttachmentQuotaBytes ??
        DEFAULT_MEMBER_ATTACHMENT_QUOTA_BYTES,
      memberAttachmentQuotaCustom:
        workspace?.memberAttachmentQuotaBytes != null,
      classroomStorageQuotaBytes:
        workspace?.classroomStorageQuotaBytes ??
        DEFAULT_CLASSROOM_STORAGE_QUOTA_BYTES,
      classroomStorageQuotaCustom:
        workspace?.classroomStorageQuotaBytes != null,
    };
  }

  async updateStorageQuotaDefaults(
    actorUserId: string | null,
    input: {
      memberAttachmentQuotaBytes?: number | null;
      classroomStorageQuotaBytes?: number | null;
    },
  ): Promise<StorageQuotaDefaults> {
    await this.requireAdmin(actorUserId);
    for (const [key, value] of Object.entries(input)) {
      if (
        value !== undefined &&
        value !== null &&
        (!Number.isInteger(value) || value < 0)
      ) {
        throw new BadRequestException(`默认容量必须是非负整数：${key}`);
      }
    }
    const workspace = await this.prisma.workspace.findFirst();
    if (!workspace) throw new NotFoundException("Workspace not found");
    await this.prisma.workspace.update({
      where: { id: workspace.id },
      data: {
        ...(input.memberAttachmentQuotaBytes !== undefined
          ? { memberAttachmentQuotaBytes: input.memberAttachmentQuotaBytes }
          : {}),
        ...(input.classroomStorageQuotaBytes !== undefined
          ? { classroomStorageQuotaBytes: input.classroomStorageQuotaBytes }
          : {}),
      },
    });
    return this.getStorageQuotaDefaults(actorUserId);
  }

  async listVisibleUserTags(actorUserId: string | null) {
    await this.requireActiveUser(actorUserId);
    return this.findUserTags();
  }

  async listUserTags(actorUserId: string | null) {
    await this.requireAdmin(actorUserId);
    return this.findUserTags();
  }

  async createUserTag(
    actorUserId: string | null,
    input: CreateUserTagInput,
  ): Promise<UserTagSummary> {
    await this.requireAdmin(actorUserId);
    const workspace = await this.getDefaultWorkspace();
    const name = this.normalizeTagName(input.name);
    const existing = await this.prisma.userTag.findUnique({
      where: { workspaceId_name: { workspaceId: workspace.id, name } },
      select: { id: true },
    });
    if (existing) throw new ConflictException("标签名称已存在");
    const tag = await this.prisma.userTag.create({
      data: {
        workspaceId: workspace.id,
        name,
      },
    });
    return { id: tag.id, name: tag.name, memberCount: 0 };
  }

  async updateUserTag(
    actorUserId: string | null,
    tagId: string,
    input: UpdateUserTagInput,
  ): Promise<UserTagSummary> {
    await this.requireAdmin(actorUserId);
    const current = await this.prisma.userTag.findUnique({
      where: { id: tagId },
      select: { id: true, workspaceId: true },
    });
    if (!current) throw new NotFoundException("Tag not found");
    const name = this.normalizeTagName(input.name);
    const duplicate = await this.prisma.userTag.findUnique({
      where: {
        workspaceId_name: { workspaceId: current.workspaceId, name },
      },
      select: { id: true },
    });
    if (duplicate && duplicate.id !== tagId) {
      throw new ConflictException("标签名称已存在");
    }
    const tag = await this.prisma.userTag.update({
      where: { id: tagId },
      data: { name },
      include: { _count: { select: { assignments: true } } },
    });
    return {
      id: tag.id,
      name: tag.name,
      memberCount: tag._count.assignments,
    };
  }

  async deleteUserTag(actorUserId: string | null, tagId: string) {
    await this.requireAdmin(actorUserId);
    await this.prisma.userTag.delete({ where: { id: tagId } });
    return { ok: true };
  }

  async setUserTags(
    actorUserId: string | null,
    userId: string,
    tagIds: string[],
  ): Promise<UserSummary> {
    await this.requireAdmin(actorUserId);
    const uniqueTagIds = [...new Set(tagIds)];
    const [user, tagCount] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { id: true },
      }),
      this.prisma.userTag.count({ where: { id: { in: uniqueTagIds } } }),
    ]);
    if (!user) throw new NotFoundException("User not found");
    if (tagCount !== uniqueTagIds.length) {
      throw new BadRequestException("包含不存在的成员标签");
    }

    await this.prisma.$transaction([
      this.prisma.userTagAssignment.deleteMany({ where: { userId } }),
      this.prisma.userTagAssignment.createMany({
        data: uniqueTagIds.map((tagId) => ({ tagId, userId })),
      }),
    ]);
    const updated = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: {
        tagAssignments: { include: { tag: true } },
        badgeAssignments: {
          where: { equippedOrder: { not: null } },
          include: { badge: true },
          orderBy: { equippedOrder: "asc" },
          take: 3,
        },
      },
    });
    return this.toSummary(updated);
  }

  /* Legacy permission-group implementation removed in the next migration.
  async listPermissionGroups(
    actorUserId: string | null,
  ): Promise<PermissionGroupSummary[]> {
    await this.requireAdmin(actorUserId);

    const groups = await this.prisma.permissionGroup.findMany({
      orderBy: [{ name: "asc" }],
      include: {
        members: {
          include: {
            user: true,
          },
          orderBy: [{ createdAt: "asc" }],
        },
        _count: { select: { members: true } },
      },
    });

    return groups.map((group) => this.toPermissionGroupSummary(group));
  }

  async listAssignablePermissionGroups(
    actorUserId: string | null,
    targetType: PermissionTargetType,
    targetId: string,
  ): Promise<PermissionGroupSummary[]> {
    if (!actorUserId) {
      throw new UnauthorizedException("Missing session");
    }

    if (!["workspace", "folder", "file"].includes(targetType)) {
      throw new BadRequestException("Invalid permission target type");
    }

    await this.permissions.assertCanManageGrantTarget(
      actorUserId,
      targetType,
      targetId,
    );

    const workspaceId = await this.resolveTargetWorkspaceId(
      targetType,
      targetId,
    );
    const groups = await this.prisma.permissionGroup.findMany({
      where: { workspaceId },
      orderBy: [{ name: "asc" }],
      include: {
        members: {
          include: { user: true },
          take: 6,
          orderBy: [{ createdAt: "asc" }],
        },
        _count: { select: { members: true } },
      },
    });

    return groups.map((group) => this.toPermissionGroupSummary(group));
  }

  async createPermissionGroup(
    actorUserId: string | null,
    input: CreatePermissionGroupInput,
  ): Promise<PermissionGroupSummary> {
    const actor = await this.requireAdmin(actorUserId);
    const workspace = await this.getDefaultWorkspace();
    const name = input.name.trim();

    if (!name) {
      throw new BadRequestException("权限组名称不能为空");
    }

    const group = await this.prisma.permissionGroup.create({
      data: {
        workspaceId: workspace.id,
        name,
        description: input.description?.trim() || null,
        createdById: actor.id,
      },
      include: {
        members: { include: { user: true } },
        _count: { select: { members: true } },
      },
    });

    return this.toPermissionGroupSummary(group);
  }

  async updatePermissionGroup(
    actorUserId: string | null,
    groupId: string,
    input: UpdatePermissionGroupInput,
  ): Promise<PermissionGroupSummary> {
    await this.requireAdmin(actorUserId);
    const data: { name?: string; description?: string | null } = {};

    if (typeof input.name === "string") {
      const name = input.name.trim();
      if (!name) {
        throw new BadRequestException("权限组名称不能为空");
      }
      data.name = name;
    }

    if (input.description !== undefined) {
      data.description = input.description?.trim() || null;
    }

    const group = await this.prisma.permissionGroup.update({
      where: { id: groupId },
      data,
      include: {
        members: { include: { user: true }, orderBy: [{ createdAt: "asc" }] },
        _count: { select: { members: true } },
      },
    });

    return this.toPermissionGroupSummary(group);
  }

  async deletePermissionGroup(actorUserId: string | null, groupId: string) {
    await this.requireAdmin(actorUserId);
    const group = await this.prisma.permissionGroup.findUnique({
      where: { id: groupId },
      include: {
        members: {
          include: { user: true },
        },
      },
    });

    if (!group) {
      throw new NotFoundException("Permission group not found");
    }

    await this.prisma.permissionGrant.deleteMany({ where: { groupId } });
    await this.prisma.permissionGroup.delete({ where: { id: groupId } });
    return { ok: true };
  }

  async addPermissionGroupMember(
    actorUserId: string | null,
    groupId: string,
    userId: string,
  ): Promise<PermissionGroupSummary> {
    await this.requireAdmin(actorUserId);
    const user = await this.prisma.user.findUnique({ where: { id: userId } });

    if (!user) {
      throw new NotFoundException("User not found");
    }

    await this.prisma.permissionGroupMember.upsert({
      where: { groupId_userId: { groupId, userId } },
      update: {},
      create: { groupId, userId },
    });

    return this.getPermissionGroup(groupId);
  }

  async removePermissionGroupMember(
    actorUserId: string | null,
    groupId: string,
    userId: string,
  ): Promise<PermissionGroupSummary> {
    await this.requireAdmin(actorUserId);
    const group = await this.prisma.permissionGroup.findUnique({
      where: { id: groupId },
      select: { name: true },
    });
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { systemRole: true },
    });

    if (!group) {
      throw new NotFoundException("Permission group not found");
    }

    if (!user) {
      throw new NotFoundException("User not found");
    }

    await this.prisma.permissionGroupMember.deleteMany({
      where: { groupId, userId },
    });

    return this.getPermissionGroup(groupId);
  }
  */

  async createUser(
    actorUserId: string | null,
    input: CreateUserInput,
  ): Promise<UserSummary> {
    const actor = await this.requireAdmin(actorUserId);
    const username = input.username.trim();
    const displayName = input.displayName.trim();

    if (!username) {
      throw new BadRequestException("登录账号不能为空");
    }

    if (!displayName) {
      throw new BadRequestException("显示名不能为空");
    }

    const existing = await this.prisma.user.findUnique({
      where: { username },
    });

    if (existing) {
      throw new ConflictException("Username already exists");
    }

    if (!isSuperAdmin(actor.systemRole) && input.systemRole !== "member") {
      throw new ForbiddenException("管理员只能创建普通用户");
    }

    const user = await this.prisma.user.create({
      data: {
        username,
        displayName,
        systemRole: input.systemRole,
        passwordHash: await argon2.hash(input.password),
      },
    });

    return this.toSummary(user);
  }

  async importUsers(
    actorUserId: string | null,
    rows: ImportUserInput[],
  ): Promise<ImportUsersResult> {
    const actor = await this.requireAdmin(actorUserId);

    if (rows.length === 0) {
      throw new BadRequestException("导入列表不能为空");
    }

    const normalized = rows.map((row, index) => ({
      rowNumber: index + 2,
      username: row.username.trim(),
      displayName: row.displayName.trim(),
      password: row.password,
      systemRole: row.systemRole,
    }));

    const usernames = normalized
      .map((row) => row.username)
      .filter((username) => username.length > 0);
    const existingUsers = await this.prisma.user.findMany({
      where: { username: { in: usernames } },
      select: { username: true },
    });
    const existingUsernames = new Set(
      existingUsers.map((user) => user.username),
    );
    const seenUsernames = new Set<string>();
    const result: ImportUsersResult = {
      created: [],
      skipped: [],
      failed: [],
    };

    for (const row of normalized) {
      if (!row.username) {
        result.failed.push({
          rowNumber: row.rowNumber,
          username: row.username,
          reason: "登录账号不能为空",
        });
        continue;
      }

      if (!row.displayName) {
        result.failed.push({
          rowNumber: row.rowNumber,
          username: row.username,
          reason: "显示名不能为空",
        });
        continue;
      }

      if (row.password.length < 8) {
        result.failed.push({
          rowNumber: row.rowNumber,
          username: row.username,
          reason: "密码至少 8 位",
        });
        continue;
      }

      if (!["super_admin", "admin", "member"].includes(row.systemRole)) {
        result.failed.push({
          rowNumber: row.rowNumber,
          username: row.username,
          reason: "系统权限无效",
        });
        continue;
      }

      if (!isSuperAdmin(actor.systemRole) && row.systemRole !== "member") {
        result.failed.push({
          rowNumber: row.rowNumber,
          username: row.username,
          reason: "管理员只能导入普通用户",
        });
        continue;
      }

      if (seenUsernames.has(row.username)) {
        result.skipped.push({
          rowNumber: row.rowNumber,
          username: row.username,
          reason: "导入列表中账号重复",
        });
        continue;
      }

      seenUsernames.add(row.username);

      if (existingUsernames.has(row.username)) {
        result.skipped.push({
          rowNumber: row.rowNumber,
          username: row.username,
          reason: "账号已存在",
        });
        continue;
      }

      const user = await this.prisma.user.create({
        data: {
          username: row.username,
          displayName: row.displayName,
          systemRole: row.systemRole,
          passwordHash: await argon2.hash(row.password),
        },
      });

      result.created.push(this.toSummary(user));
      existingUsernames.add(row.username);
    }

    return result;
  }

  async updateUser(
    actorUserId: string | null,
    userId: string,
    input: UpdateUserInput,
  ): Promise<UserSummary> {
    const actor = await this.requireAdmin(actorUserId);
    const target = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!target) {
      throw new NotFoundException("User not found");
    }

    if (!isSuperAdmin(actor.systemRole) && target.systemRole !== "member") {
      throw new ForbiddenException("管理员不能修改其他管理员");
    }

    const data: {
      displayName?: string;
      systemRole?: SystemRole;
      status?: UserSummary["status"];
      passwordHash?: string;
      storageQuotaBytes?: number | null;
      aiCallLimit?: number | null;
      sessionVersion?: { increment: number };
    } = {};

    if (typeof input.displayName === "string") {
      const displayName = input.displayName.trim();
      if (!displayName) {
        throw new BadRequestException("显示名不能为空");
      }
      data.displayName = displayName;
    }

    if (input.systemRole) {
      if (!isSuperAdmin(actor.systemRole) && input.systemRole !== "member") {
        throw new ForbiddenException("只有最高管理员可以分配管理角色");
      }
      data.systemRole = input.systemRole;
    }

    if (input.status) {
      data.status = input.status;
    }

    const removesActiveSuperAdmin =
      target.systemRole === "super_admin" &&
      target.status === "active" &&
      ((input.systemRole !== undefined && input.systemRole !== "super_admin") ||
        input.status === "disabled");

    if (input.password) {
      data.passwordHash = await argon2.hash(input.password);
    }

    if (
      input.password ||
      (input.status !== undefined && input.status !== target.status) ||
      (input.systemRole !== undefined && input.systemRole !== target.systemRole)
    ) {
      data.sessionVersion = { increment: 1 };
    }

    if (input.storageQuotaBytes !== undefined) {
      if (
        input.storageQuotaBytes !== null &&
        (!Number.isInteger(input.storageQuotaBytes) ||
          input.storageQuotaBytes < 0)
      ) {
        throw new BadRequestException("容量上限必须是非负整数");
      }
      data.storageQuotaBytes = input.storageQuotaBytes;
    }

    if (input.aiCallLimit !== undefined) {
      if (input.aiCallLimit === null) {
        data.aiCallLimit = null;
      } else if (
        !Number.isInteger(input.aiCallLimit) ||
        input.aiCallLimit < 0
      ) {
        throw new BadRequestException("每日 AI 调用限额必须是非负整数");
      } else {
        data.aiCallLimit = input.aiCallLimit;
      }
    }

    let updated: typeof target | null = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        updated = await this.prisma.$transaction(
          async (tx) => {
            if (removesActiveSuperAdmin) {
              const activeSuperAdminCount = await tx.user.count({
                where: { systemRole: "super_admin", status: "active" },
              });
              if (activeSuperAdminCount <= 1) {
                throw new BadRequestException(
                  "必须保留至少一位正常状态的最高管理员",
                );
              }
            }
            return tx.user.update({ where: { id: target.id }, data });
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
        break;
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

    if (!updated) {
      throw new ConflictException("用户状态同时发生了变化，请重试");
    }
    return this.toSummary(updated);
  }

  private async requireAdmin(actorUserId: string | null) {
    if (!actorUserId) {
      throw new UnauthorizedException("Missing session");
    }

    const actor = await this.prisma.user.findUnique({
      where: { id: actorUserId },
    });

    if (
      !actor ||
      !isSystemAdmin(actor.systemRole) ||
      actor.status !== "active"
    ) {
      throw new ForbiddenException("Only admins can manage users");
    }

    return actor;
  }

  private async requireActiveUser(actorUserId: string | null) {
    if (!actorUserId) {
      throw new UnauthorizedException("Missing session");
    }
    const actor = await this.prisma.user.findUnique({
      where: { id: actorUserId },
      select: { id: true, status: true },
    });
    if (!actor || actor.status !== "active") {
      throw new UnauthorizedException("User not found");
    }
    return actor;
  }

  private async findUserTags(): Promise<UserTagSummary[]> {
    const tags = await this.prisma.userTag.findMany({
      orderBy: [{ name: "asc" }],
      include: { _count: { select: { assignments: true } } },
    });
    return tags.map((tag) => ({
      id: tag.id,
      name: tag.name,
      memberCount: tag._count.assignments,
    }));
  }

  private normalizeTagName(value: string) {
    const name = value.trim();
    if (!name) throw new BadRequestException("标签名称不能为空");
    if (name.length > 32) {
      throw new BadRequestException("标签名称不能超过 32 个字符");
    }
    return name;
  }

  private async getDefaultWorkspace() {
    const workspace = await this.prisma.workspace.findFirst({
      orderBy: [{ createdAt: "asc" }],
    });

    if (!workspace) {
      throw new NotFoundException("Workspace not found");
    }

    return workspace;
  }

  /* Legacy permission-group helpers retained only for migration reference.
  private async resolveTargetWorkspaceId(
    targetType: PermissionTargetType,
    targetId: string,
  ) {
    if (targetType === "workspace") {
      const workspace = await this.prisma.workspace.findUnique({
        where: { id: targetId },
      });
      if (!workspace) {
        throw new NotFoundException("Workspace not found");
      }
      return workspace.id;
    }

    if (targetType === "folder") {
      const folder = await this.prisma.folder.findUnique({
        where: { id: targetId },
      });
      if (!folder) {
        throw new NotFoundException("Folder not found");
      }
      return folder.workspaceId;
    }

    const file = await this.prisma.file.findUnique({ where: { id: targetId } });
    if (!file) {
      throw new NotFoundException("File not found");
    }

    return file.workspaceId;
  }

  private async getPermissionGroup(groupId: string) {
    const group = await this.prisma.permissionGroup.findUnique({
      where: { id: groupId },
      include: {
        members: { include: { user: true }, orderBy: [{ createdAt: "asc" }] },
        _count: { select: { members: true } },
      },
    });

    if (!group) {
      throw new NotFoundException("Permission group not found");
    }

    return this.toPermissionGroupSummary(group);
  }

  private toPermissionGroupSummary(group: {
    id: string;
    name: string;
    description: string | null;
    members?: Array<{
      id: string;
      user: {
        id: string;
        username: string;
        displayName: string;
        avatarUpdatedAt?: Date | null;
        systemRole: UserSummary["systemRole"];
        status: UserSummary["status"];
      };
    }>;
    _count?: { members: number };
  }): PermissionGroupSummary {
    return {
      id: group.id,
      name: group.name,
      description: group.description,
      memberCount: group._count?.members ?? group.members?.length ?? 0,
      members: group.members?.map((member) => ({
        id: member.id,
        user: this.toSummary(member.user),
      })),
    };
  }
  */

  private toSummary(user: {
    id: string;
    username: string;
    displayName: string;
    avatarUpdatedAt?: Date | null;
    systemRole: UserSummary["systemRole"];
    status: UserSummary["status"];
    tagAssignments?: Array<{ tag: { id: string; name: string } }>;
    badgeAssignments?: Array<{
      badge: {
        id: string;
        name: string;
        description: string | null;
        color: string;
      };
    }>;
  }): UserSummary {
    return {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      avatarUrl: user.avatarUpdatedAt
        ? `/auth/avatar/${user.id}?v=${user.avatarUpdatedAt.getTime()}`
        : null,
      systemRole: user.systemRole,
      status: user.status,
      tags: user.tagAssignments
        ?.map(({ tag }) => ({ id: tag.id, name: tag.name }))
        .sort((left, right) => left.name.localeCompare(right.name, "zh-CN")),
      badges: user.badgeAssignments?.map(({ badge }) => ({
        id: badge.id,
        name: badge.name,
        description: badge.description,
        color: normalizeBadgeColor(badge.color),
      })),
    };
  }
}

function normalizeBadgeColor(value: string) {
  return ["gold", "blue", "green", "purple", "red", "gray"].includes(value)
    ? (value as NonNullable<UserSummary["badges"]>[number]["color"])
    : ("gray" as const);
}
