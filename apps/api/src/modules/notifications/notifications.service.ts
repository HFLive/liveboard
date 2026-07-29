import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import type {
  NotificationCategory,
  NotificationListResult,
  NotificationPriority,
} from "@liveboard/shared";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

const NOTIFICATION_CATEGORIES = new Set<NotificationCategory>([
  "task",
  "classroom",
  "feedback",
  "interaction",
  "permission",
  "system",
]);

type NotificationTransaction = Prisma.TransactionClient;

export interface CreateNotificationInput {
  type: string;
  category: NotificationCategory;
  priority?: NotificationPriority;
  actorId?: string | null;
  classroomId?: string | null;
  targetType: string;
  targetId: string;
  title: string;
  detail: string;
  href: string;
  recipientIds: string[];
  groupKey?: string;
  groupWindowMs?: number;
  aggregatedDetail?: string;
  occurredAt?: Date;
  expiresAt?: Date | null;
}

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    userId: string | null,
    input: {
      status?: string;
      category?: string;
      cursor?: string;
      limit?: string;
    },
  ): Promise<NotificationListResult> {
    const user = await this.requireUser(userId);
    const status = input.status ?? "all";
    if (status !== "all" && status !== "unread") {
      throw new BadRequestException("消息状态筛选无效");
    }
    const category = input.category || undefined;
    if (
      category &&
      !NOTIFICATION_CATEGORIES.has(category as NotificationCategory)
    ) {
      throw new BadRequestException("消息分类筛选无效");
    }
    const parsedLimit = Number(input.limit ?? 25);
    const limit =
      Number.isInteger(parsedLimit) && parsedLimit > 0
        ? Math.min(parsedLimit, 50)
        : 25;
    const now = new Date();
    const visibility = {
      OR: [
        { classroomId: null },
        { category: "permission" },
        { classroom: { members: { some: { userId: user.id } } } },
      ],
      AND: [{ OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }],
    };
    const recipientWhere: Prisma.NotificationRecipientWhereInput = {
      userId: user.id,
      archivedAt: null,
      ...(status === "unread" ? { readAt: null } : {}),
      notification: {
        ...(category ? { category } : {}),
        ...visibility,
      },
    };

    const [rows, unreadCount] = await Promise.all([
      this.prisma.notificationRecipient.findMany({
        where: recipientWhere,
        include: {
          notification: {
            include: {
              actor: {
                select: {
                  id: true,
                  displayName: true,
                  avatarUpdatedAt: true,
                },
              },
              classroom: { select: { name: true } },
            },
          },
        },
        orderBy: [
          { notification: { occurredAt: "desc" } },
          { notificationId: "desc" },
        ],
        ...(input.cursor
          ? {
              cursor: {
                notificationId_userId: {
                  notificationId: input.cursor,
                  userId: user.id,
                },
              },
              skip: 1,
            }
          : {}),
        take: limit + 1,
      }),
      this.prisma.notificationRecipient.count({
        where: {
          userId: user.id,
          archivedAt: null,
          readAt: null,
          notification: visibility,
        },
      }),
    ]);

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    return {
      items: page.map(({ notification, readAt }) => ({
        id: notification.id,
        type: notification.type,
        category: notification.category as NotificationCategory,
        priority: notification.priority as NotificationPriority,
        title: notification.title,
        detail: notification.detail,
        href: notification.href,
        classroomId: notification.classroomId,
        classroomName: notification.classroom?.name ?? null,
        actor: notification.actor
          ? {
              id: notification.actor.id,
              displayName: notification.actor.displayName,
              avatarUrl: notification.actor.avatarUpdatedAt
                ? `/auth/avatar/${notification.actor.id}?v=${notification.actor.avatarUpdatedAt.getTime()}`
                : null,
            }
          : null,
        aggregateCount: notification.aggregateCount,
        occurredAt: notification.occurredAt.toISOString(),
        unread: readAt === null,
      })),
      unreadCount,
      nextCursor: hasMore ? (page.at(-1)?.notificationId ?? null) : null,
    };
  }

  async create(
    input: CreateNotificationInput,
    transaction?: NotificationTransaction,
  ) {
    const db = transaction ?? this.prisma;
    const recipientIds = [
      ...new Set(
        input.recipientIds.filter(
          (recipientId) => recipientId && recipientId !== input.actorId,
        ),
      ),
    ];
    if (recipientIds.length === 0) return null;

    const activeRecipients = await db.user.findMany({
      where: { id: { in: recipientIds }, status: "active" },
      select: { id: true },
    });
    const activeRecipientIds = activeRecipients.map(({ id }) => id);
    if (activeRecipientIds.length === 0) return null;

    const occurredAt = input.occurredAt ?? new Date();
    if (input.groupKey && input.groupWindowMs) {
      const existing = await db.notification.findFirst({
        where: {
          groupKey: input.groupKey,
          occurredAt: {
            gte: new Date(occurredAt.getTime() - input.groupWindowMs),
          },
          recipients: {
            some: {
              userId: { in: activeRecipientIds },
              archivedAt: null,
            },
          },
        },
        orderBy: { occurredAt: "desc" },
      });
      if (existing) {
        const aggregateCount = existing.aggregateCount + 1;
        await db.notificationRecipient.createMany({
          data: activeRecipientIds.map((recipientId) => ({
            notificationId: existing.id,
            userId: recipientId,
          })),
          skipDuplicates: true,
        });
        return db.notification.update({
          where: { id: existing.id },
          data: {
            actorId: input.actorId ?? null,
            aggregateCount,
            detail:
              input.aggregatedDetail?.replace(
                "{count}",
                String(aggregateCount),
              ) ?? input.detail,
            occurredAt,
          },
        });
      }
    }

    return db.notification.create({
      data: {
        type: input.type,
        category: input.category,
        priority: input.priority ?? "normal",
        actorId: input.actorId ?? null,
        classroomId: input.classroomId ?? null,
        targetType: input.targetType,
        targetId: input.targetId,
        title: input.title,
        detail: input.detail,
        href: input.href,
        groupKey: input.groupKey,
        occurredAt,
        expiresAt: input.expiresAt,
        recipients: {
          create: activeRecipientIds.map((recipientId) => ({
            userId: recipientId,
          })),
        },
      },
    });
  }

  async markAllRead(userId: string | null) {
    const user = await this.requireUser(userId);
    const result = await this.prisma.notificationRecipient.updateMany({
      where: { userId: user.id, archivedAt: null, readAt: null },
      data: { readAt: new Date() },
    });
    return { updatedCount: result.count };
  }

  async setRead(userId: string | null, notificationId: string, read: boolean) {
    const user = await this.requireUser(userId);
    await this.requireRecipient(user.id, notificationId);
    await this.prisma.notificationRecipient.update({
      where: {
        notificationId_userId: { notificationId, userId: user.id },
      },
      data: { readAt: read ? new Date() : null },
    });
    return { read };
  }

  async archive(userId: string | null, notificationId: string) {
    const user = await this.requireUser(userId);
    await this.requireRecipient(user.id, notificationId);
    await this.prisma.notificationRecipient.update({
      where: {
        notificationId_userId: { notificationId, userId: user.id },
      },
      data: { archivedAt: new Date() },
    });
    return { archived: true };
  }

  private async requireRecipient(userId: string, notificationId: string) {
    const recipient = await this.prisma.notificationRecipient.findUnique({
      where: { notificationId_userId: { notificationId, userId } },
      select: { notificationId: true },
    });
    if (!recipient) throw new NotFoundException("消息不存在");
  }

  private async requireUser(userId: string | null) {
    if (!userId) throw new UnauthorizedException("Missing session");
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, status: true },
    });
    if (!user || user.status !== "active") {
      throw new UnauthorizedException("User not found");
    }
    return user;
  }
}
