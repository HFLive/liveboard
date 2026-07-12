import type { PrismaService } from "../prisma/prisma.service";
import { ForumService } from "./forum.service";

describe("ForumService", () => {
  const prisma = {
    user: { findUnique: jest.fn() },
    workspace: { findFirst: jest.fn() },
    forumCategory: {
      updateMany: jest.fn(),
      count: jest.fn(),
      findMany: jest.fn(),
    },
    forumThread: { findMany: jest.fn() },
  };
  let service: ForumService;

  beforeEach(() => {
    jest.resetAllMocks();
    service = new ForumService(prisma as unknown as PrismaService);
    prisma.user.findUnique.mockResolvedValue({
      id: "user-1",
      username: "learner",
      displayName: "学习者",
      systemRole: "learner",
      status: "active",
    });
    prisma.workspace.findFirst.mockResolvedValue({ id: "workspace-1" });
    prisma.forumCategory.count.mockResolvedValue(1);
    prisma.forumCategory.findMany.mockResolvedValue([
      {
        id: "category-1",
        name: "课程交流",
        description: "交流课程内容",
        sortOrder: 10,
        _count: { threads: 1 },
      },
    ]);
  });

  it("returns a normalized first-post excerpt in the forum overview", async () => {
    prisma.forumThread.findMany.mockResolvedValue([
      {
        id: "thread-1",
        categoryId: "category-1",
        title: "主题",
        status: "open",
        author: {
          id: "user-1",
          username: "learner",
          displayName: "学习者",
          systemRole: "learner",
          status: "active",
        },
        createdAt: new Date("2026-01-01T00:00:00Z"),
        updatedAt: new Date("2026-01-01T00:00:00Z"),
        lastActivityAt: new Date("2026-01-01T00:00:00Z"),
        _count: { posts: 1 },
        posts: [{ body: "第一段\n\n   第二段" }],
      },
    ]);

    const result = await service.listOverview("user-1");

    expect(result.threads[0]?.excerpt).toBe("第一段 第二段");
    expect(prisma.forumCategory.updateMany).toHaveBeenCalledWith({
      where: { workspaceId: "workspace-1", name: "课程讨论" },
      data: expect.objectContaining({ name: "课程交流" }),
    });
  });
});
