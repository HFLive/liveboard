import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { canView, isSystemAdmin } from "@liveboard/shared";
import type { Prisma } from "@prisma/client";
import { requireResourceName } from "../../common/resource-name";
import { PermissionsService } from "../permissions/permissions.service";
import { PrismaService } from "../prisma/prisma.service";
import { ClassroomsService } from "../classrooms/classrooms.service";
import type {
  CreateTeachingDeckDto,
  TeachingDeckItemDto,
  UpdateTeachingDeckDto,
} from "./teaching.dto";

@Injectable()
export class TeachingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionsService,
    private readonly classrooms: ClassroomsService,
  ) {}

  async list(userId: string | null, classroomId?: string) {
    const user = await this.requireUser(userId);
    const decks = await this.prisma.teachingDeck.findMany({
      where: {
        ...(classroomId ? { classroomId } : {}),
        ...(isSystemAdmin(user.systemRole)
          ? {}
          : { classroom: { members: { some: { userId: user.id } } } }),
      },
      include: {
        createdBy: {
          include: {
            badgeAssignments: {
              where: { equippedOrder: { not: null } },
              include: { badge: true },
              orderBy: { equippedOrder: "asc" },
              take: 3,
            },
          },
        },
        classroom: {
          include: {
            members: { where: { userId: user.id }, select: { role: true } },
          },
        },
        _count: { select: { items: true } },
      },
      orderBy: { updatedAt: "desc" },
    });

    return decks.map((deck) => ({
      id: deck.id,
      classroomId: deck.classroomId,
      classroomName: deck.classroom.name,
      title: deck.title,
      itemCount: deck._count.items,
      createdBy: this.toUserSummary(deck.createdBy),
      canEdit: deck.classroom.members[0]?.role === "teacher",
      createdAt: deck.createdAt.toISOString(),
      updatedAt: deck.updatedAt.toISOString(),
    }));
  }

  async get(userId: string | null, deckId: string) {
    const user = await this.requireUser(userId);
    const deck = await this.prisma.teachingDeck.findUnique({
      where: { id: deckId },
      include: {
        createdBy: {
          include: {
            badgeAssignments: {
              where: { equippedOrder: { not: null } },
              include: { badge: true },
              orderBy: { equippedOrder: "asc" },
              take: 3,
            },
          },
        },
        classroom: {
          include: {
            members: { where: { userId: user.id }, select: { role: true } },
          },
        },
        items: {
          include: {
            sourceFile: { select: { id: true, title: true } },
            exerciseSet: { include: { file: { select: { title: true } } } },
          },
          orderBy: { sortOrder: "asc" },
        },
      },
    });

    if (!deck) {
      throw new NotFoundException("课件不存在");
    }
    if (
      !isSystemAdmin(user.systemRole) &&
      deck.classroom.members.length === 0
    ) {
      throw new ForbiddenException("无权查看这个课件");
    }

    const canEdit = deck.classroom.members[0]?.role === "teacher";

    return {
      id: deck.id,
      classroomId: deck.classroomId,
      classroomName: deck.classroom.name,
      title: deck.title,
      createdBy: this.toUserSummary(deck.createdBy),
      canEdit,
      createdAt: deck.createdAt.toISOString(),
      updatedAt: deck.updatedAt.toISOString(),
      items: deck.items.map((item) => ({
        id: item.id,
        type: item.type,
        sortOrder: item.sortOrder,
        sourceFileId: item.sourceFileId,
        sourceBlockId: item.sourceBlockId,
        sourceFileTitle:
          item.sourceFile?.title ?? this.snapshotTitle(item.snapshotJson),
        block: item.type === "content_block" ? item.snapshotJson : null,
        exerciseSetId: item.exerciseSetId,
        exerciseTitle: item.exerciseSet?.title ?? null,
      })),
    };
  }

  async create(userId: string | null, input: CreateTeachingDeckDto) {
    const user = await this.requireUser(userId);
    await this.classrooms.requireTeacher(user, input.classroomId);
    const title = this.validateTitle(input.title);
    const items = await this.prepareItems(user, input.classroomId, input.items);
    const classroom = await this.prisma.classroom.findUnique({
      where: { id: input.classroomId },
    });

    if (!classroom) {
      throw new BadRequestException("课堂不存在");
    }

    const deck = await this.prisma.teachingDeck.create({
      data: {
        workspaceId: classroom.workspaceId,
        classroomId: classroom.id,
        title,
        createdById: user.id,
        items: { create: items },
      },
    });

    return this.get(user.id, deck.id);
  }

  async update(
    userId: string | null,
    deckId: string,
    input: UpdateTeachingDeckDto,
  ) {
    const user = await this.requireUser(userId);
    const deck = await this.requireEditableDeck(user, deckId);

    if (input.title === undefined && input.items === undefined) {
      throw new BadRequestException("没有需要更新的内容");
    }

    const title =
      input.title === undefined ? undefined : this.validateTitle(input.title);
    const items = input.items
      ? await this.prepareItems(user, deck.classroomId, input.items)
      : undefined;

    await this.prisma.$transaction(async (transaction) => {
      if (items) {
        await transaction.teachingDeckItem.deleteMany({ where: { deckId } });
      }
      await transaction.teachingDeck.update({
        where: { id: deck.id },
        data: {
          ...(title ? { title } : {}),
          ...(items ? { items: { create: items } } : {}),
        },
      });
    });

    return this.get(user.id, deckId);
  }

  async delete(userId: string | null, deckId: string) {
    const user = await this.requireUser(userId);
    await this.requireEditableDeck(user, deckId);
    await this.prisma.teachingDeck.delete({ where: { id: deckId } });
    return { ok: true };
  }

  private async prepareItems(
    user: Awaited<ReturnType<TeachingService["requireUser"]>>,
    classroomId: string,
    items: TeachingDeckItemDto[],
  ) {
    if (!items.length) {
      throw new BadRequestException("课件至少需要一项内容");
    }

    return Promise.all(
      items.map(async (item, sortOrder) => {
        if (item.type === "content_block") {
          if (!item.sourceBlockId) {
            throw new BadRequestException("文档段落无效");
          }
          const block = await this.prisma.contentBlock.findUnique({
            where: { id: item.sourceBlockId },
            include: { file: true },
          });
          if (!block) {
            throw new NotFoundException("选中的文档段落不存在");
          }
          const level = await this.permissions.getEffectiveLevelForFile(
            user.id,
            block.fileId,
          );
          if (!canView(level)) {
            throw new ForbiddenException("无权使用选中的文档段落");
          }
          const snapshotData =
            block.type === "image" && item.imageFit
              ? {
                  ...(block.dataJson as Prisma.JsonObject),
                  teachingImageFit: item.imageFit,
                }
              : block.dataJson;
          const snapshot = {
            id: block.id,
            fileId: block.fileId,
            type: block.type,
            sortOrder,
            dataJson: snapshotData,
            sourceFileTitle: block.file.title,
          } as Prisma.InputJsonValue;
          return {
            type: "content_block",
            sortOrder,
            sourceFileId: block.fileId,
            sourceBlockId: block.id,
            assetId: this.getBlockAssetId(block.type, block.dataJson),
            snapshotJson: snapshot,
          };
        }

        if (!item.exerciseSetId) {
          throw new BadRequestException("练习无效");
        }
        const exercise = await this.prisma.exerciseSet.findUnique({
          where: { id: item.exerciseSetId },
          include: {
            file: { select: { createdById: true } },
          },
        });
        if (!exercise) {
          throw new NotFoundException("选中的练习不存在");
        }
        if (exercise.classroomId !== classroomId) {
          throw new ForbiddenException("课件只能引用同一课堂内的练习");
        }
        return {
          type: "exercise",
          sortOrder,
          exerciseSetId: exercise.id,
        };
      }),
    );
  }

  private validateTitle(value: string) {
    return requireResourceName(value, "课件名称");
  }

  private getBlockAssetId(blockType: string, dataJson: Prisma.JsonValue) {
    if (blockType !== "image" && blockType !== "attachment") {
      return null;
    }
    if (!dataJson || typeof dataJson !== "object" || Array.isArray(dataJson)) {
      return null;
    }
    return typeof dataJson.assetId === "string" ? dataJson.assetId : null;
  }

  private async requireUser(userId: string | null) {
    if (!userId) {
      throw new UnauthorizedException("Missing session");
    }
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.status !== "active") {
      throw new UnauthorizedException("User not found");
    }
    return user;
  }

  private async requireEditableDeck(
    user: Awaited<ReturnType<TeachingService["requireUser"]>>,
    deckId: string,
  ) {
    const deck = await this.prisma.teachingDeck.findUnique({
      where: { id: deckId },
    });
    if (!deck) {
      throw new NotFoundException("课件不存在");
    }
    await this.classrooms.requireTeacher(user, deck.classroomId);
    return deck;
  }

  private toUserSummary(user: {
    id: string;
    username: string;
    displayName: string;
    avatarUpdatedAt?: Date | null;
    systemRole: "super_admin" | "admin" | "member";
    status: "active" | "disabled";
    badgeAssignments?: Array<{
      badge: {
        id: string;
        name: string;
        description: string | null;
        color: string;
      };
    }>;
  }) {
    return {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      avatarUrl: user.avatarUpdatedAt
        ? `/auth/avatar/${user.id}?v=${user.avatarUpdatedAt.getTime()}`
        : null,
      systemRole: user.systemRole,
      status: user.status,
      badges: user.badgeAssignments?.map(({ badge }) => ({
        id: badge.id,
        name: badge.name,
        description: badge.description,
        color: normalizeBadgeColor(badge.color),
      })),
    };
  }

  private snapshotTitle(value: Prisma.JsonValue | null) {
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      typeof value.sourceFileTitle === "string"
    ) {
      return value.sourceFileTitle;
    }
    return "原文件已删除";
  }
}

function normalizeBadgeColor(value: string) {
  return ["gold", "blue", "green", "purple", "red", "gray"].includes(value)
    ? (value as "gold" | "blue" | "green" | "purple" | "red" | "gray")
    : ("gray" as const);
}
