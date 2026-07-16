import type { PrismaService } from "../prisma/prisma.service";
import type { AssetsService } from "../files/assets.service";
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
    forumThread: { findMany: jest.fn(), findUnique: jest.fn() },
    forumPost: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
  };
  let service: ForumService;
  const assets = { removeForumPostImages: jest.fn() };

  beforeEach(() => {
    jest.resetAllMocks();
    service = new ForumService(
      prisma as unknown as PrismaService,
      assets as unknown as AssetsService,
    );
    prisma.user.findUnique.mockResolvedValue({
      id: "user-1",
      username: "learner",
      displayName: "学习者",
      systemRole: "member",
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
        isAnonymous: false,
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

  it.each(["member", "admin"] as const)(
    "hides anonymous thread authors from %s users",
    async (systemRole) => {
      prisma.user.findUnique.mockResolvedValue({
        id: "viewer-1",
        username: "viewer",
        displayName: "查看者",
        systemRole,
        status: "active",
      });
      prisma.forumThread.findMany.mockResolvedValue([
        {
          id: "thread-1",
          categoryId: "category-1",
          title: "匿名主题",
          status: "open",
          isAnonymous: true,
          author: {
            id: "author-secret",
            username: "secret-user",
            displayName: "真实作者",
            systemRole: "member",
            status: "active",
          },
          createdAt: new Date("2026-01-01T00:00:00Z"),
          updatedAt: new Date("2026-01-01T00:00:00Z"),
          lastActivityAt: new Date("2026-01-01T00:00:00Z"),
          _count: { posts: 1 },
          posts: [{ body: "匿名正文" }],
        },
      ]);

      const result = await service.listOverview("viewer-1");

      expect(result.threads[0]?.author).toEqual(
        expect.objectContaining({
          id: "anonymous",
          username: "anonymous",
          displayName: "匿名用户",
        }),
      );
    },
  );

  it("reveals anonymous thread and reply authors only to super admins", async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: "super-1",
      username: "root",
      displayName: "最高管理员",
      systemRole: "super_admin",
      status: "active",
    });
    prisma.forumThread.findUnique.mockResolvedValue({
      id: "thread-1",
      categoryId: "category-1",
      title: "匿名主题",
      status: "open",
      isAnonymous: true,
      author: {
        id: "author-secret",
        username: "secret-user",
        displayName: "真实作者",
        systemRole: "member",
        status: "active",
      },
      category: {
        id: "category-1",
        name: "课程交流",
        description: null,
        sortOrder: 10,
        _count: { threads: 1 },
      },
      posts: [
        {
          id: "post-1",
          threadId: "thread-1",
          parentId: null,
          replyToId: null,
          body: "匿名正文",
          isAnonymous: true,
          author: {
            id: "author-secret",
            username: "secret-user",
            displayName: "真实作者",
            systemRole: "member",
            status: "active",
          },
          replyTo: null,
          images: [],
          createdAt: new Date("2026-01-01T00:00:00Z"),
          updatedAt: new Date("2026-01-01T00:00:00Z"),
        },
      ],
      createdAt: new Date("2026-01-01T00:00:00Z"),
      updatedAt: new Date("2026-01-01T00:00:00Z"),
      lastActivityAt: new Date("2026-01-01T00:00:00Z"),
      _count: { posts: 1 },
    });

    const result = await service.getThread("super-1", "thread-1");

    expect(result.author.id).toBe("author-secret");
    expect(result.posts[0]?.author.id).toBe("author-secret");
    expect(result.isAnonymous).toBe(true);
    expect(result.posts[0]?.isAnonymous).toBe(true);
  });

  it("rejects editing comments while keeping the main post editable", async () => {
    prisma.forumPost.findUnique.mockResolvedValue({
      id: "comment-1",
      threadId: "thread-1",
      authorId: "user-1",
      thread: {
        id: "thread-1",
        authorId: "user-1",
        status: "open",
      },
    });
    prisma.forumPost.findFirst.mockResolvedValue({ id: "main-post-1" });

    await expect(
      service.updatePost("user-1", "comment-1", { body: "修改评论" }),
    ).rejects.toThrow("评论不支持编辑");
    expect(prisma.forumPost.update).not.toHaveBeenCalled();
  });
});
