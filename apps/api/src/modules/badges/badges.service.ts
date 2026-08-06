import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import {
  isSystemAdmin,
  type AdminBadgeSummary,
  type BadgeColor,
  type UserBadgeSummary,
} from "@liveboard/shared";
import { PrismaService } from "../prisma/prisma.service";

const BADGE_COLORS = new Set<BadgeColor>([
  "gold",
  "blue",
  "green",
  "purple",
  "red",
  "gray",
]);

interface BadgeInput {
  name: string;
  description?: string;
  color: BadgeColor;
}

interface BadgeUpdateInput {
  name?: string;
  description?: string;
  color?: BadgeColor;
}

@Injectable()
export class BadgesService {
  constructor(private readonly prisma: PrismaService) {}

  async listMine(userId: string | null): Promise<UserBadgeSummary[]> {
    const user = await this.requireActiveUser(userId);
    const assignments = await this.prisma.userBadge.findMany({
      where: { userId: user.id },
      include: { badge: true },
      orderBy: [
        { equippedOrder: { sort: "asc", nulls: "last" } },
        { awardedAt: "desc" },
      ],
    });
    return assignments.map((assignment) => ({
      ...this.toSummary(assignment.badge),
      equipped: assignment.equippedOrder !== null,
      equippedOrder: assignment.equippedOrder,
      awardedAt: assignment.awardedAt.toISOString(),
    }));
  }

  async setEquipped(
    userId: string | null,
    badgeIds: string[],
  ): Promise<UserBadgeSummary[]> {
    const user = await this.requireActiveUser(userId);
    if (badgeIds.length > 3 || new Set(badgeIds).size !== badgeIds.length) {
      throw new BadRequestException("最多同时佩戴 3 个徽章");
    }

    const ownedCount = await this.prisma.userBadge.count({
      where: { userId: user.id, badgeId: { in: badgeIds } },
    });
    if (ownedCount !== badgeIds.length) {
      throw new BadRequestException("只能佩戴已获得的徽章");
    }

    await this.prisma.$transaction(async (transaction) => {
      await transaction.userBadge.updateMany({
        where: { userId: user.id, equippedOrder: { not: null } },
        data: { equippedOrder: null },
      });
      await Promise.all(
        badgeIds.map((badgeId, index) =>
          transaction.userBadge.update({
            where: { badgeId_userId: { badgeId, userId: user.id } },
            data: { equippedOrder: index },
          }),
        ),
      );
    });

    return this.listMine(user.id);
  }

  async listAdmin(userId: string | null): Promise<AdminBadgeSummary[]> {
    await this.requireAdmin(userId);
    const badges = await this.prisma.badge.findMany({
      include: { assignments: { select: { userId: true } } },
      orderBy: [{ createdAt: "asc" }],
    });
    return badges.map((badge) => ({
      ...this.toSummary(badge),
      recipientIds: badge.assignments.map((assignment) => assignment.userId),
      recipientCount: badge.assignments.length,
      createdAt: badge.createdAt.toISOString(),
      updatedAt: badge.updatedAt.toISOString(),
    }));
  }

  async create(userId: string | null, input: BadgeInput) {
    const actor = await this.requireAdmin(userId);
    const workspace = await this.getDefaultWorkspace();
    const normalized = this.normalizeInput(input);
    try {
      const badge = await this.prisma.badge.create({
        data: {
          workspaceId: workspace.id,
          createdById: actor.id,
          ...normalized,
        },
      });
      return this.toSummary(badge);
    } catch (error) {
      if (this.isUniqueConflict(error)) {
        throw new ConflictException("徽章名称已存在");
      }
      throw error;
    }
  }

  async update(
    userId: string | null,
    badgeId: string,
    input: BadgeUpdateInput,
  ) {
    await this.requireAdmin(userId);
    await this.requireBadge(badgeId);
    const data = this.normalizeUpdateInput(input);
    try {
      const badge = await this.prisma.badge.update({
        where: { id: badgeId },
        data,
      });
      return this.toSummary(badge);
    } catch (error) {
      if (this.isUniqueConflict(error)) {
        throw new ConflictException("徽章名称已存在");
      }
      throw error;
    }
  }

  async remove(userId: string | null, badgeId: string) {
    await this.requireAdmin(userId);
    await this.requireBadge(badgeId);
    await this.prisma.badge.delete({ where: { id: badgeId } });
    return { ok: true };
  }

  async award(userId: string | null, badgeId: string, targetUserId: string) {
    const actor = await this.requireAdmin(userId);
    await Promise.all([
      this.requireBadge(badgeId),
      this.requireActiveUser(targetUserId),
    ]);
    await this.prisma.userBadge.upsert({
      where: { badgeId_userId: { badgeId, userId: targetUserId } },
      create: { badgeId, userId: targetUserId, awardedById: actor.id },
      update: {},
    });
    return { ok: true };
  }

  async revoke(userId: string | null, badgeId: string, targetUserId: string) {
    await this.requireAdmin(userId);
    await this.prisma.userBadge.deleteMany({
      where: { badgeId, userId: targetUserId },
    });
    return { ok: true };
  }

  private normalizeInput(input: BadgeInput) {
    const name = input.name.trim();
    if (!name) throw new BadRequestException("徽章名称不能为空");
    if (!BADGE_COLORS.has(input.color)) {
      throw new BadRequestException("不支持的徽章颜色");
    }
    return {
      name,
      description: input.description?.trim() || null,
      color: input.color,
    };
  }

  private normalizeUpdateInput(input: BadgeUpdateInput) {
    const data: {
      name?: string;
      description?: string | null;
      color?: BadgeColor;
    } = {};
    if (input.name !== undefined) {
      const name = input.name.trim();
      if (!name) throw new BadRequestException("徽章名称不能为空");
      data.name = name;
    }
    if (input.description !== undefined) {
      data.description = input.description.trim() || null;
    }
    if (input.color !== undefined) {
      if (!BADGE_COLORS.has(input.color)) {
        throw new BadRequestException("不支持的徽章颜色");
      }
      data.color = input.color;
    }
    return data;
  }

  private toSummary(badge: {
    id: string;
    name: string;
    description: string | null;
    color: string;
  }) {
    return {
      id: badge.id,
      name: badge.name,
      description: badge.description,
      color: BADGE_COLORS.has(badge.color as BadgeColor)
        ? (badge.color as BadgeColor)
        : "gray",
    };
  }

  private async requireBadge(badgeId: string) {
    const badge = await this.prisma.badge.findUnique({
      where: { id: badgeId },
    });
    if (!badge) throw new NotFoundException("徽章不存在");
    return badge;
  }

  private async requireActiveUser(userId: string | null) {
    if (!userId) throw new UnauthorizedException("Missing session");
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.status !== "active") {
      throw new NotFoundException("User not found");
    }
    return user;
  }

  private async requireAdmin(userId: string | null) {
    const user = await this.requireActiveUser(userId);
    if (!isSystemAdmin(user.systemRole)) {
      throw new ForbiddenException("仅管理员可以管理徽章");
    }
    return user;
  }

  private async getDefaultWorkspace() {
    const workspace = await this.prisma.workspace.findFirst({
      orderBy: { createdAt: "asc" },
    });
    if (!workspace) throw new NotFoundException("Workspace not found");
    return workspace;
  }

  private isUniqueConflict(error: unknown) {
    return (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "P2002"
    );
  }
}
