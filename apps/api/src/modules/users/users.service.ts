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
  type SystemRole,
  type UserSummary,
} from "@liveboard/shared";
import type { PermissionGroupSummary } from "@liveboard/shared";
import type { PermissionTargetType } from "@liveboard/shared";
import argon2 from "argon2";
import { Prisma } from "@prisma/client";
import { PermissionsService } from "../permissions/permissions.service";
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
  storageQuotaBytes?: number;
}

export interface UserStorageSummary {
  user: UserSummary;
  storageQuotaBytes: number;
  storageUsedBytes: number;
  assetCount: number;
}

export interface CreatePermissionGroupInput {
  name: string;
  description?: string | null;
}

export interface UpdatePermissionGroupInput {
  name?: string;
  description?: string | null;
}

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionsService,
  ) {}

  async listUsers(actorUserId: string | null): Promise<UserSummary[]> {
    await this.requireAdmin(actorUserId);

    const users = await this.prisma.user.findMany({
      orderBy: [{ createdAt: "asc" }],
    });

    return users.map((user) => this.toSummary(user));
  }

  async listUserStorage(
    actorUserId: string | null,
  ): Promise<UserStorageSummary[]> {
    await this.requireAdmin(actorUserId);

    const [users, groupedAssets] = await Promise.all([
      this.prisma.user.findMany({
        orderBy: [{ createdAt: "asc" }],
      }),
      this.prisma.fileAsset.groupBy({
        by: ["uploadedBy"],
        _sum: { sizeBytes: true },
        _count: { id: true },
      }),
    ]);
    const usageByUserId = new Map(
      groupedAssets.map((item) => [
        item.uploadedBy,
        {
          storageUsedBytes: item._sum.sizeBytes ?? 0,
          assetCount: item._count.id,
        },
      ]),
    );

    return users.map((user) => {
      const usage = usageByUserId.get(user.id);

      return {
        user: this.toSummary(user),
        storageQuotaBytes: user.storageQuotaBytes,
        storageUsedBytes: usage?.storageUsedBytes ?? 0,
        assetCount: usage?.assetCount ?? 0,
      };
    });
  }

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
      storageQuotaBytes?: number;
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
        !Number.isInteger(input.storageQuotaBytes) ||
        input.storageQuotaBytes < 0
      ) {
        throw new BadRequestException("容量上限必须是非负整数");
      }
      data.storageQuotaBytes = input.storageQuotaBytes;
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

  private async getDefaultWorkspace() {
    const workspace = await this.prisma.workspace.findFirst({
      orderBy: [{ createdAt: "asc" }],
    });

    if (!workspace) {
      throw new NotFoundException("Workspace not found");
    }

    return workspace;
  }

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

  private toSummary(user: {
    id: string;
    username: string;
    displayName: string;
    avatarUpdatedAt?: Date | null;
    systemRole: UserSummary["systemRole"];
    status: UserSummary["status"];
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
    };
  }
}
