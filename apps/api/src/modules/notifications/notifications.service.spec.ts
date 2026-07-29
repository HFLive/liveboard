import { NotFoundException } from "@nestjs/common";
import type { PrismaService } from "../prisma/prisma.service";
import { NotificationsService } from "./notifications.service";

describe("NotificationsService", () => {
  const occurredAt = new Date("2026-07-29T12:00:00.000Z");
  const prisma = {
    user: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    notification: {
      create: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    notificationRecipient: {
      count: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      createMany: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
  };
  let service: NotificationsService;

  beforeEach(() => {
    jest.resetAllMocks();
    prisma.user.findUnique.mockResolvedValue({
      id: "user-1",
      status: "active",
    });
    prisma.user.findMany.mockImplementation(({ where }) =>
      Promise.resolve(where.id.in.map((id: string) => ({ id }))),
    );
    prisma.notificationRecipient.findMany.mockResolvedValue([]);
    prisma.notificationRecipient.count.mockResolvedValue(0);
    service = new NotificationsService(prisma as unknown as PrismaService);
  });

  it("returns recipient-specific read state and a stable next cursor", async () => {
    prisma.notificationRecipient.count.mockResolvedValue(3);
    prisma.notificationRecipient.findMany.mockResolvedValue([
      {
        notificationId: "notification-1",
        readAt: null,
        notification: {
          id: "notification-1",
          type: "submission_graded",
          category: "feedback",
          priority: "important",
          title: "第一章练习",
          detail: "批改已完成 · 18/20 分",
          href: "/app/exercises/exercise-1",
          classroomId: "classroom-1",
          classroom: { name: "高一物理" },
          actor: {
            id: "teacher-1",
            displayName: "李老师",
            avatarUpdatedAt: occurredAt,
          },
          aggregateCount: 1,
          occurredAt,
        },
      },
    ]);

    await expect(
      service.list("user-1", { status: "unread", limit: "25" }),
    ).resolves.toEqual({
      items: [
        expect.objectContaining({
          id: "notification-1",
          unread: true,
          classroomName: "高一物理",
          actor: {
            id: "teacher-1",
            displayName: "李老师",
            avatarUrl: `/auth/avatar/teacher-1?v=${occurredAt.getTime()}`,
          },
        }),
      ],
      unreadCount: 3,
      nextCursor: null,
    });
    expect(prisma.notificationRecipient.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: "user-1", readAt: null }),
      }),
    );
  });

  it("excludes the actor and inactive users when creating recipients", async () => {
    prisma.user.findMany.mockResolvedValue([{ id: "student-2" }]);
    prisma.notification.create.mockResolvedValue({ id: "notification-1" });

    await service.create({
      type: "exercise_published",
      category: "classroom",
      actorId: "teacher-1",
      classroomId: "classroom-1",
      targetType: "exercise",
      targetId: "exercise-1",
      title: "第一章练习",
      detail: "新练习已发布",
      href: "/app/exercises/exercise-1",
      recipientIds: ["teacher-1", "student-1", "student-2", "student-2"],
    });

    expect(prisma.user.findMany).toHaveBeenCalledWith({
      where: {
        id: { in: ["student-1", "student-2"] },
        status: "active",
      },
      select: { id: true },
    });
    expect(prisma.notification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        recipients: { create: [{ userId: "student-2" }] },
      }),
    });
  });

  it("aggregates repeated submissions within the configured window", async () => {
    prisma.notification.findFirst.mockResolvedValue({
      id: "notification-1",
      aggregateCount: 2,
    });
    prisma.notification.update.mockResolvedValue({ id: "notification-1" });

    await service.create({
      type: "submission_received",
      category: "task",
      actorId: "student-3",
      classroomId: "classroom-1",
      targetType: "exercise",
      targetId: "exercise-1",
      title: "第一章练习",
      detail: "王同学提交了练习",
      href: "/app/exercises/exercise-1/submissions",
      recipientIds: ["teacher-1"],
      groupKey: "submission:exercise-1",
      groupWindowMs: 10 * 60 * 1000,
      aggregatedDetail: "有 {count} 份新提交等待查看",
      occurredAt,
    });

    expect(prisma.notification.update).toHaveBeenCalledWith({
      where: { id: "notification-1" },
      data: expect.objectContaining({
        aggregateCount: 3,
        detail: "有 3 份新提交等待查看",
      }),
    });
  });

  it("does not let a user mutate another recipient's message", async () => {
    prisma.notificationRecipient.findUnique.mockResolvedValue(null);

    await expect(
      service.setRead("user-1", "notification-2", true),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.notificationRecipient.update).not.toHaveBeenCalled();
  });
});
