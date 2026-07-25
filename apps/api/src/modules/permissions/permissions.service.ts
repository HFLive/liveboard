import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import {
  canEdit,
  canLecture,
  canManagePermissions,
  canView,
  computeEffectivePermission,
  isSystemAdmin,
} from "@liveboard/shared";
import type { PermissionLevel, PermissionTargetType } from "@liveboard/shared";
import { PrismaService } from "../prisma/prisma.service";

export interface UpsertPermissionInput {
  targetType: PermissionTargetType;
  targetId: string;
  userId: string;
  level: PermissionLevel;
}

type GrantSource = {
  targetType: PermissionTargetType;
  targetId: string;
  targetName: string;
};

@Injectable()
export class PermissionsService {
  constructor(private readonly prisma: PrismaService) {}

  getEffectivePermission(
    inherited: PermissionLevel | null,
    explicit: PermissionLevel | null,
  ) {
    const level = computeEffectivePermission(inherited, explicit);
    return {
      level,
      capabilities: {
        view: canView(level),
        edit: canEdit(level),
        lecture: canLecture(level),
        managePermissions: canManagePermissions(level),
      },
    };
  }

  async getDefaultWorkspaceForPermissions(actorUserId: string | null) {
    const actor = await this.requireActiveUser(actorUserId);
    if (!isSystemAdmin(actor.systemRole)) {
      throw new ForbiddenException(
        "Only system administrators can manage workspace permissions",
      );
    }

    const workspace = await this.prisma.workspace.findFirst({
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true },
    });
    if (!workspace) throw new NotFoundException("Workspace not found");
    return workspace;
  }

  async listAssignableUsers(
    actorUserId: string | null,
    targetType: PermissionTargetType,
    targetId: string,
  ) {
    const actor = await this.requireActiveUser(actorUserId);
    await this.assertCanManageGrant(actor.id, targetType, targetId);

    const [users, tags] = await Promise.all([
      this.prisma.user.findMany({
        where: { status: "active", systemRole: "member" },
        orderBy: [{ displayName: "asc" }, { username: "asc" }],
        include: { tagAssignments: { include: { tag: true } } },
      }),
      this.prisma.userTag.findMany({
        orderBy: { name: "asc" },
        include: { _count: { select: { assignments: true } } },
      }),
    ]);

    return {
      users: users.map((user) => this.toUserSummary(user)),
      tags: tags.map((tag) => ({
        id: tag.id,
        name: tag.name,
        memberCount: tag._count.assignments,
      })),
    };
  }

  async listGrants(
    actorUserId: string | null,
    targetType: PermissionTargetType,
    targetId: string,
  ) {
    const actor = await this.requireActiveUser(actorUserId);
    await this.assertCanManageGrant(actor.id, targetType, targetId);

    const grants = await this.prisma.permissionGrant.findMany({
      where: { targetType, targetId },
      include: {
        user: {
          include: { tagAssignments: { include: { tag: true } } },
        },
      },
      orderBy: [
        { user: { displayName: "asc" } },
        { user: { username: "asc" } },
      ],
    });

    return {
      grants: grants.map((grant) => ({
        id: grant.id,
        targetType: grant.targetType,
        targetId: grant.targetId,
        userId: grant.userId,
        level: grant.level,
        user: this.toUserSummary(grant.user),
      })),
      inheritedGrants: await this.listInheritedUserGrants(targetType, targetId),
    };
  }

  async upsertGrant(actorUserId: string | null, input: UpsertPermissionInput) {
    const actor = await this.requireActiveUser(actorUserId);
    const workspaceId = await this.resolveWorkspaceId(
      input.targetType,
      input.targetId,
    );
    await this.assertCanManageGrant(actor.id, input.targetType, input.targetId);

    const targetUser = await this.prisma.user.findUnique({
      where: { id: input.userId },
      select: { id: true, status: true, systemRole: true },
    });
    if (!targetUser || targetUser.status !== "active") {
      throw new NotFoundException("User not found");
    }
    if (isSystemAdmin(targetUser.systemRole)) {
      throw new BadRequestException(
        "Administrator document access is controlled by the system role",
      );
    }

    return this.prisma.permissionGrant.upsert({
      where: {
        targetType_targetId_userId: {
          targetType: input.targetType,
          targetId: input.targetId,
          userId: input.userId,
        },
      },
      update: { level: input.level },
      create: {
        workspaceId,
        targetType: input.targetType,
        targetId: input.targetId,
        userId: input.userId,
        level: input.level,
        createdById: actor.id,
      },
    });
  }

  async deleteGrant(actorUserId: string | null, grantId: string) {
    const actor = await this.requireActiveUser(actorUserId);
    const grant = await this.prisma.permissionGrant.findUnique({
      where: { id: grantId },
    });
    if (!grant) throw new NotFoundException("Grant not found");

    await this.assertCanManageGrant(actor.id, grant.targetType, grant.targetId);
    await this.prisma.permissionGrant.delete({ where: { id: grantId } });
    return { ok: true };
  }

  async getEffectiveLevelForFolder(
    userId: string,
    folderId: string,
  ): Promise<PermissionLevel> {
    const user = await this.requireActiveUser(userId);
    if (isSystemAdmin(user.systemRole)) return "owner";

    const folder = await this.prisma.folder.findUnique({
      where: { id: folderId },
      select: { id: true, workspaceId: true },
    });
    if (!folder) throw new NotFoundException("Folder not found");

    let level: PermissionLevel = this.roleLevel(user.systemRole);
    const workspaceGrant = await this.findGrant(
      userId,
      "workspace",
      folder.workspaceId,
    );
    level =
      computeEffectivePermission(level, workspaceGrant?.level ?? null) ?? level;

    for (const item of await this.getFolderPath(folderId)) {
      const grant = await this.findGrant(userId, "folder", item.id);
      level = computeEffectivePermission(level, grant?.level ?? null) ?? level;
    }
    return level;
  }

  async getEffectiveLevelForFile(
    userId: string,
    fileId: string,
  ): Promise<PermissionLevel> {
    const user = await this.requireActiveUser(userId);
    if (isSystemAdmin(user.systemRole)) return "owner";

    const file = await this.prisma.file.findUnique({
      where: { id: fileId },
      select: { id: true, folderId: true },
    });
    if (!file) throw new NotFoundException("File not found");

    const inherited = await this.getEffectiveLevelForFolder(
      userId,
      file.folderId,
    );
    const explicit = await this.findGrant(userId, "file", file.id);
    return (
      computeEffectivePermission(inherited, explicit?.level ?? null) ??
      inherited
    );
  }

  async getEffectiveLevelsForFolders(userId: string, folderIds: string[]) {
    const uniqueIds = [...new Set(folderIds)];
    const result = new Map<string, PermissionLevel>();
    if (uniqueIds.length === 0) return result;

    const user = await this.requireActiveUser(userId);
    const folders = await this.prisma.folder.findMany({
      select: { id: true, parentId: true, workspaceId: true },
    });
    const folderById = new Map(folders.map((folder) => [folder.id, folder]));
    for (const id of uniqueIds) {
      if (!folderById.has(id)) throw new NotFoundException("Folder not found");
    }
    if (isSystemAdmin(user.systemRole)) {
      for (const id of uniqueIds) result.set(id, "owner");
      return result;
    }

    const workspaceIds = [
      ...new Set(folders.map((folder) => folder.workspaceId)),
    ];
    const grantLevels = await this.loadGrantLevels(userId, [
      ...workspaceIds.map((id) => ({ targetType: "workspace" as const, id })),
      ...folders.map((folder) => ({
        targetType: "folder" as const,
        id: folder.id,
      })),
    ]);
    const memo = new Map<string, PermissionLevel>();
    const visiting = new Set<string>();
    const compute = (folderId: string): PermissionLevel => {
      const cached = memo.get(folderId);
      if (cached) return cached;
      if (visiting.has(folderId)) {
        throw new ConflictException("Folder hierarchy contains a cycle");
      }
      visiting.add(folderId);
      const folder = folderById.get(folderId);
      if (!folder) throw new NotFoundException("Folder not found");
      const inherited = folder.parentId
        ? compute(folder.parentId)
        : (grantLevels.get(`workspace:${folder.workspaceId}`) ??
          this.roleLevel(user.systemRole));
      const level =
        computeEffectivePermission(
          inherited,
          grantLevels.get(`folder:${folder.id}`) ?? null,
        ) ?? inherited;
      visiting.delete(folderId);
      memo.set(folderId, level);
      return level;
    };

    for (const id of uniqueIds) result.set(id, compute(id));
    return result;
  }

  async getEffectiveLevelsForFiles(userId: string, fileIds: string[]) {
    const uniqueIds = [...new Set(fileIds)];
    const result = new Map<string, PermissionLevel>();
    if (uniqueIds.length === 0) return result;

    const user = await this.requireActiveUser(userId);
    const files = await this.prisma.file.findMany({
      where: { id: { in: uniqueIds } },
      select: { id: true, folderId: true },
    });
    if (files.length !== uniqueIds.length) {
      throw new NotFoundException("File not found");
    }
    if (isSystemAdmin(user.systemRole)) {
      for (const id of uniqueIds) result.set(id, "owner");
      return result;
    }

    const folderLevels = await this.getEffectiveLevelsForFolders(
      userId,
      files.map((file) => file.folderId),
    );
    const grantLevels = await this.loadGrantLevels(
      userId,
      files.map((file) => ({ targetType: "file" as const, id: file.id })),
    );
    for (const file of files) {
      result.set(
        file.id,
        computeEffectivePermission(
          folderLevels.get(file.folderId) ?? this.roleLevel(user.systemRole),
          grantLevels.get(`file:${file.id}`) ?? null,
        ) ?? this.roleLevel(user.systemRole),
      );
    }
    return result;
  }

  private roleLevel(systemRole: "super_admin" | "admin" | "member") {
    return isSystemAdmin(systemRole) ? ("owner" as const) : ("viewer" as const);
  }

  private async listInheritedUserGrants(
    targetType: PermissionTargetType,
    targetId: string,
  ) {
    const sources = await this.getInheritedGrantSources(targetType, targetId);
    if (sources.length === 0) return [];

    const sourceByKey = new Map(
      sources.map((source, index) => [
        `${source.targetType}:${source.targetId}`,
        { ...source, index },
      ]),
    );
    const grants = await this.prisma.permissionGrant.findMany({
      where: {
        OR: sources.map((source) => ({
          targetType: source.targetType,
          targetId: source.targetId,
        })),
      },
      include: {
        user: {
          include: { tagAssignments: { include: { tag: true } } },
        },
      },
    });
    grants.sort(
      (left, right) =>
        (sourceByKey.get(`${left.targetType}:${left.targetId}`)?.index ?? 0) -
        (sourceByKey.get(`${right.targetType}:${right.targetId}`)?.index ?? 0),
    );

    const inheritedByUserId = new Map<
      string,
      (typeof grants)[number] & { inheritedFrom: GrantSource }
    >();
    for (const grant of grants) {
      const source = sourceByKey.get(`${grant.targetType}:${grant.targetId}`);
      if (!source) continue;
      const current = inheritedByUserId.get(grant.userId);
      const level = computeEffectivePermission(
        current?.level ?? null,
        grant.level,
      );
      if (!current || level !== current.level) {
        inheritedByUserId.set(grant.userId, {
          ...grant,
          level: level ?? grant.level,
          inheritedFrom: {
            targetType: source.targetType,
            targetId: source.targetId,
            targetName: source.targetName,
          },
        });
      }
    }

    return [...inheritedByUserId.values()].map((grant) => ({
      id: grant.id,
      targetType: grant.targetType,
      targetId: grant.targetId,
      userId: grant.userId,
      level: grant.level,
      user: this.toUserSummary(grant.user),
      inheritedFrom: grant.inheritedFrom,
    }));
  }

  private async getInheritedGrantSources(
    targetType: PermissionTargetType,
    targetId: string,
  ): Promise<GrantSource[]> {
    if (targetType === "workspace") return [];

    const target =
      targetType === "folder"
        ? await this.prisma.folder.findUnique({
            where: { id: targetId },
            select: { workspaceId: true, parentId: true },
          })
        : await this.prisma.file.findUnique({
            where: { id: targetId },
            select: { workspaceId: true, folderId: true },
          });
    if (!target) throw new NotFoundException("Permission target not found");

    const workspace = await this.prisma.workspace.findUnique({
      where: { id: target.workspaceId },
      select: { id: true, name: true },
    });
    if (!workspace) throw new NotFoundException("Workspace not found");

    const parentFolderId =
      "parentId" in target ? target.parentId : target.folderId;
    const folderPath = parentFolderId
      ? await this.getFolderPath(parentFolderId)
      : [];
    const folderNames = await this.prisma.folder.findMany({
      where: { id: { in: folderPath.map((folder) => folder.id) } },
      select: { id: true, name: true },
    });
    const nameById = new Map(
      folderNames.map((folder) => [folder.id, folder.name]),
    );

    return [
      {
        targetType: "workspace",
        targetId: workspace.id,
        targetName: workspace.name,
      },
      ...folderPath.map((folder) => ({
        targetType: "folder" as const,
        targetId: folder.id,
        targetName: nameById.get(folder.id) ?? "上级文件夹",
      })),
    ];
  }

  private async assertCanManageGrant(
    actorUserId: string,
    targetType: PermissionTargetType,
    targetId: string,
  ) {
    const actor = await this.requireActiveUser(actorUserId);
    if (isSystemAdmin(actor.systemRole)) return;
    if (targetType === "workspace") {
      throw new ForbiddenException(
        "Only system administrators can manage workspace permissions",
      );
    }

    const level =
      targetType === "folder"
        ? await this.getEffectiveLevelForFolder(actor.id, targetId)
        : await this.getEffectiveLevelForFile(actor.id, targetId);
    if (level !== "owner") {
      throw new ForbiddenException("No permission to manage grants");
    }
  }

  private async resolveWorkspaceId(
    targetType: PermissionTargetType,
    targetId: string,
  ) {
    if (targetType === "workspace") {
      const workspace = await this.prisma.workspace.findUnique({
        where: { id: targetId },
        select: { id: true },
      });
      if (!workspace) throw new NotFoundException("Workspace not found");
      return workspace.id;
    }
    if (targetType === "folder") {
      const folder = await this.prisma.folder.findUnique({
        where: { id: targetId },
        select: { workspaceId: true },
      });
      if (!folder) throw new NotFoundException("Folder not found");
      return folder.workspaceId;
    }
    const file = await this.prisma.file.findUnique({
      where: { id: targetId },
      select: { workspaceId: true },
    });
    if (!file) throw new NotFoundException("File not found");
    return file.workspaceId;
  }

  private async findGrant(
    userId: string,
    targetType: PermissionTargetType,
    targetId: string,
  ) {
    return this.prisma.permissionGrant.findUnique({
      where: {
        targetType_targetId_userId: { targetType, targetId, userId },
      },
      select: { level: true },
    });
  }

  private async loadGrantLevels(
    userId: string,
    targets: Array<{ targetType: PermissionTargetType; id: string }>,
  ) {
    const levels = new Map<string, PermissionLevel>();
    if (targets.length === 0) return levels;
    const grants = await this.prisma.permissionGrant.findMany({
      where: {
        userId,
        OR: targets.map((target) => ({
          targetType: target.targetType,
          targetId: target.id,
        })),
      },
      select: { targetType: true, targetId: true, level: true },
    });
    for (const grant of grants) {
      levels.set(`${grant.targetType}:${grant.targetId}`, grant.level);
    }
    return levels;
  }

  private async requireActiveUser(userId: string | null) {
    if (!userId) throw new UnauthorizedException("Missing session");
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, systemRole: true, status: true },
    });
    if (!user || user.status !== "active") {
      throw new UnauthorizedException("Missing or inactive session");
    }
    return user;
  }

  private async getFolderPath(folderId: string) {
    const path: Array<{ id: string; parentId: string | null }> = [];
    const visited = new Set<string>();
    let currentId: string | null = folderId;

    while (currentId) {
      if (visited.has(currentId)) {
        throw new ConflictException("Folder hierarchy contains a cycle");
      }
      visited.add(currentId);
      const folder: { id: string; parentId: string | null } | null =
        await this.prisma.folder.findUnique({
          where: { id: currentId },
          select: { id: true, parentId: true },
        });
      if (!folder) break;
      path.unshift(folder);
      currentId = folder.parentId;
    }
    return path;
  }

  private toUserSummary(user: {
    id: string;
    username: string;
    displayName: string;
    systemRole: "super_admin" | "admin" | "member";
    status: "active" | "disabled";
    tagAssignments?: Array<{ tag: { id: string; name: string } }>;
  }) {
    return {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      avatarUrl: null,
      systemRole: user.systemRole,
      status: user.status,
      tags: user.tagAssignments?.map(({ tag }) => ({
        id: tag.id,
        name: tag.name,
      })),
    };
  }
}
