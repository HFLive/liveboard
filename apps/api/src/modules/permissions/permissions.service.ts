import {
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
  comparePermissions,
  computeEffectivePermission,
  isSystemAdmin,
} from "@liveboard/shared";
import type { PermissionLevel, PermissionTargetType } from "@liveboard/shared";
import { PrismaService } from "../prisma/prisma.service";

export interface UpsertPermissionInput {
  targetType: PermissionTargetType;
  targetId: string;
  groupId: string;
  level: PermissionLevel;
}

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

  async listGrants(
    actorUserId: string | null,
    targetType: PermissionTargetType,
    targetId: string,
  ) {
    if (!actorUserId) {
      throw new UnauthorizedException("Missing session");
    }

    await this.assertCanViewGrantTarget(actorUserId, targetType, targetId);

    const grants = await this.prisma.permissionGrant.findMany({
      where: { targetType, targetId },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            displayName: true,
            systemRole: true,
            status: true,
          },
        },
        group: {
          select: {
            id: true,
            name: true,
            description: true,
            members: {
              select: { id: true },
              take: 1,
            },
            _count: {
              select: { members: true },
            },
          },
        },
      },
      orderBy: [{ createdAt: "asc" }],
    });

    return grants.map((grant) => ({
      ...grant,
      group: grant.group
        ? {
            id: grant.group.id,
            name: grant.group.name,
            description: grant.group.description,
            memberCount: grant.group._count.members,
          }
        : null,
    }));
  }

  async upsertGrant(actorUserId: string | null, input: UpsertPermissionInput) {
    if (!actorUserId) {
      throw new UnauthorizedException("Missing session");
    }

    const workspaceId = await this.resolveWorkspaceId(
      input.targetType,
      input.targetId,
    );
    await this.assertCanManageGrant(
      actorUserId,
      input.targetType,
      input.targetId,
    );

    return this.upsertGrantUnchecked(actorUserId, workspaceId, input);
  }

  async deleteGrant(actorUserId: string | null, grantId: string) {
    if (!actorUserId) {
      throw new UnauthorizedException("Missing session");
    }

    const grant = await this.prisma.permissionGrant.findUnique({
      where: { id: grantId },
    });

    if (!grant) {
      throw new NotFoundException("Grant not found");
    }

    await this.assertCanManageGrant(
      actorUserId,
      grant.targetType,
      grant.targetId,
    );

    await this.prisma.permissionGrant.delete({
      where: { id: grantId },
    });

    return { ok: true };
  }

  async assertCanManageGrantTarget(
    actorUserId: string,
    targetType: PermissionTargetType,
    targetId: string,
  ) {
    await this.assertCanManageGrant(actorUserId, targetType, targetId);
  }

  async upsertGrantUnchecked(
    actorUserId: string,
    workspaceId: string,
    input: UpsertPermissionInput,
  ) {
    const group = await this.prisma.permissionGroup.findUnique({
      where: { id: input.groupId },
    });

    if (!group || group.workspaceId !== workspaceId) {
      throw new NotFoundException("Permission group not found");
    }

    return this.prisma.permissionGrant.upsert({
      where: {
        targetType_targetId_groupId: {
          targetType: input.targetType,
          targetId: input.targetId,
          groupId: input.groupId,
        },
      },
      update: {
        level: input.level,
        userId: null,
      },
      create: {
        workspaceId,
        createdById: actorUserId,
        targetType: input.targetType,
        targetId: input.targetId,
        groupId: input.groupId,
        level: input.level,
      },
    });
  }

  async getEffectiveLevelForFolder(
    userId: string,
    folderId: string,
  ): Promise<PermissionLevel | null> {
    const user = await this.requireActiveUser(userId);

    if (isSystemAdmin(user.systemRole)) {
      return "owner";
    }

    const folder = await this.prisma.folder.findUnique({
      where: { id: folderId },
    });

    if (!folder) {
      throw new NotFoundException("Folder not found");
    }

    const workspaceGrant = await this.findGrant(
      userId,
      "workspace",
      folder.workspaceId,
    );
    let level = workspaceGrant?.level ?? null;

    const path = await this.getFolderPath(folderId);
    for (const item of path) {
      const grant = await this.findGrant(userId, "folder", item.id);
      level = computeEffectivePermission(level, grant?.level ?? null);
    }

    return level;
  }

  async getEffectiveLevelForFile(
    userId: string,
    fileId: string,
  ): Promise<PermissionLevel | null> {
    const user = await this.requireActiveUser(userId);

    if (isSystemAdmin(user.systemRole)) {
      return "owner";
    }

    const file = await this.prisma.file.findUnique({
      where: { id: fileId },
    });

    if (!file) {
      throw new NotFoundException("File not found");
    }

    const inherited = await this.getEffectiveLevelForFolder(
      userId,
      file.folderId,
    );
    const explicit = await this.findGrant(userId, "file", file.id);

    return computeEffectivePermission(inherited, explicit?.level ?? null);
  }

  async getEffectiveLevelsForFolders(userId: string, folderIds: string[]) {
    const uniqueIds = [...new Set(folderIds)];
    const result = new Map<string, PermissionLevel | null>();
    if (uniqueIds.length === 0) return result;

    const user = await this.requireActiveUser(userId);
    if (isSystemAdmin(user.systemRole)) {
      for (const id of uniqueIds) result.set(id, "owner");
      return result;
    }

    const folders = await this.prisma.folder.findMany({
      select: { id: true, parentId: true, workspaceId: true },
    });
    const folderById = new Map(folders.map((folder) => [folder.id, folder]));
    for (const id of uniqueIds) {
      if (!folderById.has(id)) throw new NotFoundException("Folder not found");
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
    const memo = new Map<string, PermissionLevel | null>();
    const visiting = new Set<string>();
    const compute = (folderId: string): PermissionLevel | null => {
      if (memo.has(folderId)) return memo.get(folderId) ?? null;
      if (visiting.has(folderId)) {
        throw new ConflictException("Folder hierarchy contains a cycle");
      }
      visiting.add(folderId);
      const folder = folderById.get(folderId);
      if (!folder) throw new NotFoundException("Folder not found");
      const inherited = folder.parentId
        ? compute(folder.parentId)
        : (grantLevels.get(`workspace:${folder.workspaceId}`) ?? null);
      const level = computeEffectivePermission(
        inherited,
        grantLevels.get(`folder:${folder.id}`) ?? null,
      );
      visiting.delete(folderId);
      memo.set(folderId, level);
      return level;
    };

    for (const id of uniqueIds) result.set(id, compute(id));
    return result;
  }

  async getEffectiveLevelsForFiles(userId: string, fileIds: string[]) {
    const uniqueIds = [...new Set(fileIds)];
    const result = new Map<string, PermissionLevel | null>();
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
          folderLevels.get(file.folderId) ?? null,
          grantLevels.get(`file:${file.id}`) ?? null,
        ),
      );
    }
    return result;
  }

  private async resolveWorkspaceId(
    targetType: PermissionTargetType,
    targetId: string,
  ): Promise<string> {
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

  private async assertCanManageGrant(
    actorUserId: string,
    targetType: PermissionTargetType,
    targetId: string,
  ) {
    const actor = await this.requireActiveUser(actorUserId);

    if (isSystemAdmin(actor.systemRole)) {
      return;
    }

    if (targetType === "workspace") {
      const grant = await this.findGrant(actorUserId, "workspace", targetId);
      if (grant?.level === "owner") {
        return;
      }
      throw new ForbiddenException("No permission to manage workspace grants");
    }

    const level =
      targetType === "folder"
        ? await this.getEffectiveLevelForFolder(actorUserId, targetId)
        : await this.getEffectiveLevelForFile(actorUserId, targetId);

    if (level !== "owner") {
      throw new ForbiddenException("No permission to manage grants");
    }
  }

  private async assertCanViewGrantTarget(
    actorUserId: string,
    targetType: PermissionTargetType,
    targetId: string,
  ) {
    const actor = await this.requireActiveUser(actorUserId);

    if (isSystemAdmin(actor.systemRole)) {
      return;
    }

    if (targetType === "workspace") {
      const grant = await this.findGrant(actorUserId, "workspace", targetId);
      if (canView(grant?.level ?? null)) {
        return;
      }
      throw new ForbiddenException("No permission to view workspace grants");
    }

    const level =
      targetType === "folder"
        ? await this.getEffectiveLevelForFolder(actorUserId, targetId)
        : await this.getEffectiveLevelForFile(actorUserId, targetId);

    if (!canView(level)) {
      throw new ForbiddenException("No permission to view grants");
    }
  }

  private async findGrant(
    userId: string,
    targetType: PermissionTargetType,
    targetId: string,
  ) {
    const memberships = await this.prisma.permissionGroupMember.findMany({
      where: { userId },
      select: { groupId: true },
    });
    const groupIds = memberships.map((membership) => membership.groupId);
    const grantFilters =
      groupIds.length > 0
        ? [{ userId }, { groupId: { in: groupIds } }]
        : [{ userId }];

    const grants = await this.prisma.permissionGrant.findMany({
      where: {
        targetType,
        targetId,
        OR: grantFilters,
      },
    });
    const level = grants.reduce<PermissionLevel | null>(
      (current, grant) => comparePermissions(current, grant.level),
      null,
    );

    return level ? { level } : null;
  }

  private async loadGrantLevels(
    userId: string,
    targets: Array<{ targetType: PermissionTargetType; id: string }>,
  ) {
    const levels = new Map<string, PermissionLevel>();
    if (targets.length === 0) return levels;
    const memberships = await this.prisma.permissionGroupMember.findMany({
      where: { userId },
      select: { groupId: true },
    });
    const groupIds = memberships.map((membership) => membership.groupId);
    const grants = await this.prisma.permissionGrant.findMany({
      where: {
        OR: [
          { userId },
          ...(groupIds.length > 0 ? [{ groupId: { in: groupIds } }] : []),
        ],
        AND: [
          {
            OR: targets.map((target) => ({
              targetType: target.targetType,
              targetId: target.id,
            })),
          },
        ],
      },
      select: { targetType: true, targetId: true, level: true },
    });
    for (const grant of grants) {
      const key = `${grant.targetType}:${grant.targetId}`;
      const level = comparePermissions(levels.get(key) ?? null, grant.level);
      if (level) levels.set(key, level);
    }
    return levels;
  }

  private async requireActiveUser(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
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

      if (!folder) {
        break;
      }

      path.unshift(folder);
      currentId = folder.parentId;
    }

    return path;
  }
}
