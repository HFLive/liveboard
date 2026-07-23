import type { PrismaService } from "../prisma/prisma.service";
import type { AssetsService } from "../files/assets.service";
import type { PermissionsService } from "../permissions/permissions.service";
import { ForumService } from "./forum.service";

describe("ForumService", () => {
  const prisma = {
    $transaction: jest.fn(),
    user: { findUnique: jest.fn() },
    workspace: { findFirst: jest.fn() },
    forumCategory: {
      updateMany: jest.fn(),
      count: jest.fn(),
      findMany: jest.fn(),
    },
    forumThread: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      delete: jest.fn(),
    },
    forumThreadState: { upsert: jest.fn() },
    forumPost: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    forumPostVote: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  };
  let service: ForumService;
  const assets = { removeForumPostImages: jest.fn() };
  const permissions = { getEffectiveLevelForFile: jest.fn() };

  beforeEach(() => {
    jest.resetAllMocks();
    service = new ForumService(
      prisma as unknown as PrismaService,
      assets as unknown as AssetsService,
      permissions as unknown as PermissionsService,
    );
    prisma.forumPost.findMany.mockResolvedValue([]);
    prisma.$transaction.mockImplementation(
      async (callback: (tx: typeof prisma) => unknown) => callback(prisma),
    );
    prisma.forumThreadState.upsert.mockResolvedValue({ followed: false });
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

  it("keeps a thread followed when the current user has posted in it", async () => {
    prisma.forumThread.findUnique.mockResolvedValue({
      id: "thread-1",
      authorId: "author-1",
      posts: [{ id: "post-1" }],
    });
    prisma.forumThreadState.upsert.mockResolvedValue({ followed: true });

    const result = await service.setThreadFollow("user-1", "thread-1", false);

    expect(result).toEqual({ followed: true, followRequired: true });
    expect(prisma.forumThreadState.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: { followed: true } }),
    );
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
          upvoteCount: 2,
          downvoteCount: 1,
          votes: [{ value: 1 }],
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
    expect(result.posts[0]).toEqual(
      expect.objectContaining({
        upvoteCount: 2,
        downvoteCount: 1,
        viewerVote: "up",
      }),
    );
  });

  it("toggles the current user's forum vote and updates cached counts", async () => {
    prisma.forumPost.findUnique.mockResolvedValue({ id: "post-1" });
    prisma.forumPostVote.findUnique.mockResolvedValue({
      postId: "post-1",
      userId: "user-1",
      value: 1,
    });
    prisma.forumPost.update.mockResolvedValue({
      id: "post-1",
      upvoteCount: 3,
      downvoteCount: 1,
    });

    await expect(service.votePost("user-1", "post-1", "up")).resolves.toEqual({
      postId: "post-1",
      upvoteCount: 3,
      downvoteCount: 1,
      viewerVote: null,
    });
    expect(prisma.forumPostVote.delete).toHaveBeenCalledWith({
      where: { postId_userId: { postId: "post-1", userId: "user-1" } },
    });
    expect(prisma.forumPost.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          upvoteCount: { increment: -1 },
          downvoteCount: { increment: 0 },
        },
      }),
    );
  });

  it("rejects editing comments even for super admins", async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: "super-1",
      username: "root",
      displayName: "最高管理员",
      systemRole: "super_admin",
      status: "active",
    });
    prisma.forumPost.findUnique.mockResolvedValue({
      id: "comment-1",
      threadId: "thread-1",
      authorId: "author-1",
      thread: {
        id: "thread-1",
        authorId: "author-1",
        status: "open",
      },
    });
    prisma.forumPost.findFirst.mockResolvedValue({ id: "main-post-1" });

    await expect(
      service.updatePost("super-1", "comment-1", { body: "修改评论" }),
    ).rejects.toThrow("评论不支持编辑");
    expect(prisma.forumPost.update).not.toHaveBeenCalled();
  });

  it("does not allow regular admins to edit thread titles or bodies", async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: "admin-1",
      username: "admin",
      displayName: "管理员",
      systemRole: "admin",
      status: "active",
    });
    prisma.forumThread.findUnique.mockResolvedValue({
      id: "thread-1",
      authorId: "admin-1",
      workspaceId: "workspace-1",
      status: "open",
    });

    await expect(
      service.updateThread("admin-1", "thread-1", { title: "修改标题" }),
    ).rejects.toThrow("Only super admins can edit threads");

    prisma.forumPost.findUnique.mockResolvedValue({
      id: "post-1",
      threadId: "thread-1",
      authorId: "admin-1",
      thread: { id: "thread-1", authorId: "admin-1", status: "open" },
    });
    await expect(
      service.updatePost("admin-1", "post-1", { body: "修改正文" }),
    ).rejects.toThrow("Only super admins can edit threads");
  });

  it("permanently deletes a thread and its forum images", async () => {
    prisma.forumThread.findUnique.mockResolvedValue({
      id: "thread-1",
      authorId: "user-1",
      posts: [{ id: "post-1" }, { id: "post-2" }],
    });
    prisma.forumThread.delete.mockResolvedValue({ id: "thread-1" });

    await expect(service.deleteThread("user-1", "thread-1")).resolves.toEqual({
      ok: true,
    });
    expect(assets.removeForumPostImages).toHaveBeenCalledWith([
      "post-1",
      "post-2",
    ]);
    expect(prisma.forumThread.delete).toHaveBeenCalledWith({
      where: { id: "thread-1" },
    });
  });
});
