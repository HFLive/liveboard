import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import type { ActivityItem } from "@liveboard/shared";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class ActivityService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string | null) {
    const user = await this.requireUser(userId);
    return this.listForUser(user);
  }

  private async listForUser(user: {
    id: string;
    username: string;
    activityReadAt: Date | null;
  }) {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const [exercises, submissions, forumThreads, dismissals] =
      await Promise.all([
        this.prisma.exerciseSet.findMany({
          where: {
            updatedAt: { gte: since },
            classroom: { members: { some: { userId: user.id } } },
          },
          orderBy: { updatedAt: "desc" },
          take: 10,
        }),
        this.prisma.submission.findMany({
          where: { userId: user.id, gradedAt: { not: null, gte: since } },
          include: { exerciseSet: { select: { title: true } } },
          orderBy: { gradedAt: "desc" },
          take: 10,
        }),
        this.prisma.forumThread.findMany({
          where: {
            lastActivityAt: { gte: since },
            authorId: user.id,
          },
          include: { category: { select: { name: true } } },
          orderBy: { lastActivityAt: "desc" },
          take: 10,
        }),
        this.prisma.activityDismissal.findMany({
          where: { userId: user.id, dismissedAt: { gte: since } },
          select: { activityId: true },
        }),
      ]);

    const readAt = user.activityReadAt;
    const isUnread = (date: Date) => !readAt || date > readAt;
    const dismissedIds = new Set(
      dismissals.map((dismissal) => dismissal.activityId),
    );
    const items: ActivityItem[] = [
      ...exercises.map((exercise) => ({
        id: `exercise-${exercise.id}-${exercise.updatedAt.toISOString()}`,
        kind: "exercise" as const,
        title: exercise.title,
        detail:
          exercise.createdById === user.id
            ? "练习内容已更新"
            : "可作答的练习已发布或更新",
        href: `/app/exercises/${encodeURIComponent(exercise.id)}`,
        occurredAt: exercise.updatedAt.toISOString(),
        unread: isUnread(exercise.updatedAt),
      })),
      ...submissions.map((submission) => ({
        id: `grading-${submission.id}-${submission.gradedAt?.toISOString()}`,
        kind: "grading" as const,
        title: submission.exerciseSet.title,
        detail: `批改已完成${submission.score === null ? "" : ` · ${submission.score}/${submission.maxScore} 分`}`,
        href: `/app/exercises/${encodeURIComponent(submission.exerciseSetId)}`,
        occurredAt: submission.gradedAt!.toISOString(),
        unread: isUnread(submission.gradedAt!),
      })),
      ...forumThreads.map((thread) => ({
        id: `forum-${thread.id}-${thread.lastActivityAt.toISOString()}`,
        kind: "forum" as const,
        title: thread.title,
        detail: `${thread.category.name} · 帖子有新回复`,
        href: `/app/forum/${encodeURIComponent(thread.id)}`,
        occurredAt: thread.lastActivityAt.toISOString(),
        unread: isUnread(thread.lastActivityAt),
      })),
    ]
      .filter((item) => !dismissedIds.has(item.id))
      .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))
      .slice(0, 24);

    return { items, unreadCount: items.filter((item) => item.unread).length };
  }

  async markRead(userId: string | null) {
    const user = await this.requireUser(userId);
    const activityReadAt = new Date();
    await this.prisma.user.update({
      where: { id: user.id },
      data: { activityReadAt },
    });
    return { activityReadAt: activityReadAt.toISOString() };
  }

  async dismiss(userId: string | null, activityId: string) {
    const user = await this.requireUser(userId);

    if (!activityId || activityId.length > 300) {
      throw new BadRequestException("Invalid activity id");
    }

    const existing = await this.prisma.activityDismissal.findUnique({
      where: { userId_activityId: { userId: user.id, activityId } },
    });
    if (existing) return { dismissed: true };

    const current = await this.listForUser(user);
    if (!current.items.some((item) => item.id === activityId)) {
      throw new NotFoundException("Activity not found");
    }

    await this.prisma.activityDismissal.create({
      data: { userId: user.id, activityId },
    });
    return { dismissed: true };
  }

  private async requireUser(userId: string | null) {
    if (!userId) throw new UnauthorizedException("Missing session");
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.status !== "active")
      throw new UnauthorizedException("User not found");
    return user;
  }
}
