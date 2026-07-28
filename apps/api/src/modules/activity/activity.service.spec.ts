import { ActivityService } from "./activity.service";
import { PrismaService } from "../prisma/prisma.service";

describe("ActivityService", () => {
  const updatedAt = new Date("2026-07-19T08:00:00.000Z");
  const activityId = `exercise-exercise-1-${updatedAt.toISOString()}`;
  let prisma: {
    user: { findUnique: jest.Mock; update: jest.Mock };
    exerciseSet: { findMany: jest.Mock };
    submission: { findMany: jest.Mock };
    file: { findMany: jest.Mock };
    forumThread: { findMany: jest.Mock };
    activityDismissal: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      create: jest.Mock;
    };
  };
  let service: ActivityService;

  beforeEach(() => {
    prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: "user-1",
          username: "learner",
          status: "active",
          activityReadAt: null,
        }),
        update: jest.fn(),
      },
      exerciseSet: { findMany: jest.fn().mockResolvedValue([]) },
      submission: { findMany: jest.fn().mockResolvedValue([]) },
      file: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "file-1",
            title: "课程说明",
            updatedAt,
          },
        ]),
      },
      forumThread: { findMany: jest.fn().mockResolvedValue([]) },
      activityDismissal: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
      },
    };
    service = new ActivityService(prisma as unknown as PrismaService);
  });

  beforeEach(() => {
    prisma.exerciseSet.findMany.mockResolvedValue([
      {
        id: "exercise-1",
        title: "课程练习",
        createdById: "teacher-1",
        updatedAt,
      },
    ]);
  });

  it("filters messages dismissed by the current user", async () => {
    prisma.activityDismissal.findMany.mockResolvedValue([{ activityId }]);

    await expect(service.list("user-1")).resolves.toEqual({
      items: [],
      unreadCount: 0,
    });
  });

  it("persists dismissal for a visible message", async () => {
    await expect(service.dismiss("user-1", activityId)).resolves.toEqual({
      dismissed: true,
    });
    expect(prisma.activityDismissal.create).toHaveBeenCalledWith({
      data: { userId: "user-1", activityId },
    });
  });

  it("does not derive notifications from document creator or updater fields", async () => {
    const result = await service.list("user-1");

    expect(prisma.file.findMany).not.toHaveBeenCalled();
    expect(result.items).toHaveLength(1);
    expect(result.items.map((item) => item.kind)).toEqual(["exercise"]);
  });

  it("only derives forum notifications from posts created by the user", async () => {
    await service.list("user-1");

    expect(prisma.forumThread.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          authorId: "user-1",
        }),
      }),
    );
    expect(
      prisma.forumThread.findMany.mock.calls[0]?.[0]?.where,
    ).not.toHaveProperty("OR");
  });
});
