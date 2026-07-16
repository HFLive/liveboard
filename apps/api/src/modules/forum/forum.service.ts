import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import type {
  ForumCategorySummary,
  ForumPostSummary,
  ForumThreadDetail,
  ForumThreadSummary,
  UserSummary,
} from "@liveboard/shared";
import { isSuperAdmin, isSystemAdmin } from "@liveboard/shared";
import { PrismaService } from "../prisma/prisma.service";
import { AssetsService } from "../files/assets.service";
import type {
  CreateForumCategoryDto,
  CreateForumPostDto,
  CreateForumThreadDto,
  UpdateForumCategoryDto,
  UpdateForumPostDto,
  UpdateForumThreadDto,
} from "./forum.dto";
import { DEFAULT_FORUM_CATEGORIES } from "./forum-defaults";

type ForumUserRecord = {
  id: string;
  username: string;
  displayName: string;
  avatarUpdatedAt?: Date | null;
  systemRole: UserSummary["systemRole"];
  status: UserSummary["status"];
};

type ForumCategoryRecord = {
  id: string;
  name: string;
  description: string | null;
  sortOrder: number;
  _count?: { threads: number };
};

type ForumThreadRecord = {
  id: string;
  categoryId: string;
  title: string;
  excerpt?: string;
  status: ForumThreadSummary["status"];
  isAnonymous: boolean;
  author: ForumUserRecord;
  createdAt: Date;
  updatedAt: Date;
  lastActivityAt: Date;
  _count?: { posts: number };
  posts?: ForumPostRecord[];
};

type ForumPostRecord = {
  id: string;
  threadId: string;
  parentId: string | null;
  replyToId: string | null;
  body: string;
  isAnonymous: boolean;
  images: Array<{
    id: string;
    width: number | null;
    height: number | null;
    sortOrder: number | null;
  }>;
  author: ForumUserRecord;
  replyTo?: {
    id: string;
    isAnonymous: boolean;
    author: ForumUserRecord;
  } | null;
  createdAt: Date;
  updatedAt: Date;
};

type ForumPermissionContext = {
  userId: string;
  isAdmin: boolean;
  threadAuthorId: string;
  threadStatus: ForumThreadSummary["status"];
  canRevealAnonymous: boolean;
  mainPostId: string | null;
};

const ANONYMOUS_FORUM_USER: UserSummary = {
  id: "anonymous",
  username: "anonymous",
  displayName: "匿名用户",
  avatarUrl: null,
  systemRole: "member",
  status: "active",
};

@Injectable()
export class ForumService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly assets: AssetsService,
  ) {}

  async listOverview(userId: string | null) {
    const user = await this.requireActiveUser(userId);
    const isAdmin = isSystemAdmin(user.systemRole);
    const workspace = await this.getDefaultWorkspace();
    await this.ensureDefaultCategories(workspace.id);

    const [categories, threads] = await Promise.all([
      this.prisma.forumCategory.findMany({
        where: { workspaceId: workspace.id },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        include: {
          _count: {
            select: {
              threads: isAdmin
                ? true
                : { where: { status: { not: "archived" } } },
            },
          },
        },
      }),
      this.prisma.forumThread.findMany({
        where: {
          workspaceId: workspace.id,
          ...(isAdmin ? {} : { status: { not: "archived" } }),
        },
        orderBy: [{ lastActivityAt: "desc" }],
        take: 40,
        include: {
          author: true,
          _count: { select: { posts: true } },
          posts: {
            orderBy: [{ createdAt: "asc" }],
            take: 1,
            select: { body: true },
          },
        },
      }),
    ]);

    return {
      categories: categories.map((category) =>
        this.toCategorySummary(category),
      ),
      threads: threads.map(({ posts, ...thread }) =>
        this.toThreadSummary(
          {
            ...thread,
            excerpt: posts[0]?.body ?? "",
          },
          isSuperAdmin(user.systemRole),
        ),
      ),
    };
  }

  async getThread(
    userId: string | null,
    threadId: string,
  ): Promise<ForumThreadDetail> {
    const user = await this.requireActiveUser(userId);

    const thread = await this.prisma.forumThread.findUnique({
      where: { id: threadId },
      include: {
        author: true,
        category: {
          include: {
            _count: {
              select: {
                threads: { where: { status: { not: "archived" } } },
              },
            },
          },
        },
        posts: {
          orderBy: [{ createdAt: "asc" }],
          include: {
            author: true,
            replyTo: { include: { author: true } },
            images: { orderBy: { sortOrder: "asc" } },
          },
        },
        _count: { select: { posts: true } },
      },
    });

    if (
      !thread ||
      (thread.status === "archived" && !isSystemAdmin(user.systemRole))
    ) {
      throw new NotFoundException("Forum thread not found");
    }

    return this.toThreadDetail(thread, user);
  }

  async createThread(
    userId: string | null,
    input: CreateForumThreadDto,
  ): Promise<ForumThreadDetail> {
    const user = await this.requireActiveUser(userId);
    const workspace = await this.getDefaultWorkspace();
    await this.ensureDefaultCategories(workspace.id);
    const title = this.normalizeTitle(input.title);
    const body = this.normalizeBody(input.body);

    const category = await this.prisma.forumCategory.findFirst({
      where: {
        id: input.categoryId,
        workspaceId: workspace.id,
      },
    });

    if (!category) {
      throw new NotFoundException("Forum category not found");
    }

    const now = new Date();
    const thread = await this.prisma.forumThread.create({
      data: {
        workspaceId: workspace.id,
        categoryId: category.id,
        authorId: user.id,
        title,
        isAnonymous: input.isAnonymous ?? false,
        lastActivityAt: now,
        posts: {
          create: {
            authorId: user.id,
            body,
            isAnonymous: input.isAnonymous ?? false,
          },
        },
      },
      include: {
        author: true,
        category: {
          include: {
            _count: {
              select: {
                threads: { where: { status: { not: "archived" } } },
              },
            },
          },
        },
        posts: {
          orderBy: [{ createdAt: "asc" }],
          include: {
            author: true,
            replyTo: { include: { author: true } },
            images: { orderBy: { sortOrder: "asc" } },
          },
        },
        _count: { select: { posts: true } },
      },
    });

    return this.toThreadDetail(thread, user);
  }

  async createPost(
    userId: string | null,
    threadId: string,
    input: CreateForumPostDto,
  ): Promise<ForumPostSummary> {
    const user = await this.requireActiveUser(userId);
    const body = this.normalizeBody(input.body);

    const thread = await this.prisma.forumThread.findUnique({
      where: { id: threadId },
    });

    if (!thread || thread.status === "archived") {
      throw new NotFoundException("Forum thread not found");
    }

    if (thread.status === "locked") {
      throw new ForbiddenException("该帖子已锁定，不能继续回复");
    }

    const parentPost = input.parentId
      ? await this.prisma.forumPost.findFirst({
          where: {
            id: input.parentId,
            threadId: thread.id,
          },
          select: {
            id: true,
            parentId: true,
          },
        })
      : null;

    if (input.parentId && !parentPost) {
      throw new NotFoundException("Forum post not found");
    }

    const parentId = parentPost?.parentId ?? parentPost?.id ?? null;

    const post = await this.prisma.$transaction(async (tx) => {
      const created = await tx.forumPost.create({
        data: {
          threadId: thread.id,
          parentId,
          replyToId: parentPost?.id ?? null,
          authorId: user.id,
          body,
          isAnonymous: input.isAnonymous ?? false,
        },
        include: {
          author: true,
          replyTo: { include: { author: true } },
          images: { orderBy: { sortOrder: "asc" } },
        },
      });

      await tx.forumThread.update({
        where: { id: thread.id },
        data: {
          lastActivityAt: created.createdAt,
          updatedAt: created.createdAt,
        },
      });

      return created;
    });

    return this.toPostSummary(post, {
      userId: user.id,
      isAdmin: isSystemAdmin(user.systemRole),
      threadAuthorId: thread.authorId,
      threadStatus: thread.status,
      canRevealAnonymous: isSuperAdmin(user.systemRole),
      mainPostId: null,
    });
  }

  async updateThread(
    userId: string | null,
    threadId: string,
    input: UpdateForumThreadDto,
  ): Promise<ForumThreadDetail> {
    const user = await this.requireActiveUser(userId);
    const existing = await this.prisma.forumThread.findUnique({
      where: { id: threadId },
    });

    if (
      !existing ||
      (existing.status === "archived" && !isSystemAdmin(user.systemRole))
    ) {
      throw new NotFoundException("Forum thread not found");
    }

    const isAdmin = isSystemAdmin(user.systemRole);
    const isAuthor = existing.authorId === user.id;

    if (!isAdmin && !isAuthor) {
      throw new ForbiddenException("No permission to edit thread");
    }

    if (["locked", "archived"].includes(existing.status) && !isAdmin) {
      throw new ForbiddenException("该帖子已锁定，不能编辑");
    }

    const data: {
      title?: string;
      categoryId?: string;
      status?: ForumThreadSummary["status"];
    } = {};

    if (typeof input.title === "string") {
      data.title = this.normalizeTitle(input.title);
    }

    if (typeof input.categoryId === "string") {
      const category = await this.prisma.forumCategory.findFirst({
        where: {
          id: input.categoryId,
          workspaceId: existing.workspaceId,
        },
      });

      if (!category) {
        throw new NotFoundException("Forum category not found");
      }

      data.categoryId = category.id;
    }

    if (input.status) {
      if (!isAdmin) {
        throw new ForbiddenException("Only admins can change thread status");
      }

      data.status = input.status;
    }

    const thread = await this.prisma.forumThread.update({
      where: { id: threadId },
      data,
      include: {
        author: true,
        category: {
          include: {
            _count: {
              select: {
                threads: { where: { status: { not: "archived" } } },
              },
            },
          },
        },
        posts: {
          orderBy: [{ createdAt: "asc" }],
          include: {
            author: true,
            replyTo: { include: { author: true } },
            images: { orderBy: { sortOrder: "asc" } },
          },
        },
        _count: { select: { posts: true } },
      },
    });

    return this.toThreadDetail(thread, user);
  }

  async archiveThread(userId: string | null, threadId: string) {
    const user = await this.requireActiveUser(userId);
    const thread = await this.prisma.forumThread.findUnique({
      where: { id: threadId },
    });

    if (!thread || thread.status === "archived") {
      throw new NotFoundException("Forum thread not found");
    }

    if (thread.authorId !== user.id && !isSystemAdmin(user.systemRole)) {
      throw new ForbiddenException("No permission to archive thread");
    }

    await this.prisma.forumThread.update({
      where: { id: threadId },
      data: { status: "archived" },
    });

    return { ok: true };
  }

  async updatePost(
    userId: string | null,
    postId: string,
    input: UpdateForumPostDto,
  ): Promise<ForumPostSummary> {
    const user = await this.requireActiveUser(userId);
    const body = this.normalizeBody(input.body);
    const post = await this.prisma.forumPost.findUnique({
      where: { id: postId },
      include: { thread: true },
    });

    const isAdmin = isSystemAdmin(user.systemRole);

    if (!post || (post.thread.status === "archived" && !isAdmin)) {
      throw new NotFoundException("Forum post not found");
    }

    if (!isAdmin && post.authorId !== user.id) {
      throw new ForbiddenException("No permission to edit post");
    }

    if (post.thread.status === "locked" && !isAdmin) {
      throw new ForbiddenException("该帖子已锁定，不能编辑回复");
    }

    const mainPost = await this.prisma.forumPost.findFirst({
      where: { threadId: post.threadId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true },
    });

    if (!mainPost || mainPost.id !== post.id) {
      throw new ForbiddenException("评论不支持编辑");
    }

    const updated = await this.prisma.forumPost.update({
      where: { id: postId },
      data: { body },
      include: {
        author: true,
        replyTo: { include: { author: true } },
        images: { orderBy: { sortOrder: "asc" } },
      },
    });

    return this.toPostSummary(updated, {
      userId: user.id,
      isAdmin,
      threadAuthorId: post.thread.authorId,
      threadStatus: post.thread.status,
      canRevealAnonymous: isSuperAdmin(user.systemRole),
      mainPostId: mainPost.id,
    });
  }

  async deletePost(userId: string | null, postId: string) {
    const user = await this.requireActiveUser(userId);
    const post = await this.prisma.forumPost.findUnique({
      where: { id: postId },
      include: {
        thread: {
          include: {
            posts: {
              orderBy: [{ createdAt: "asc" }],
              select: { id: true, parentId: true },
            },
          },
        },
      },
    });

    const isAdmin = isSystemAdmin(user.systemRole);

    if (!post || (post.thread.status === "archived" && !isAdmin)) {
      throw new NotFoundException("Forum post not found");
    }

    const isAuthor = post.authorId === user.id;
    const isFirstPost = post.thread.posts[0]?.id === post.id;

    if (!isAdmin && !isAuthor) {
      throw new ForbiddenException("No permission to delete post");
    }

    if (post.thread.status === "locked" && !isAdmin) {
      throw new ForbiddenException("该帖子已锁定，不能删除回复");
    }

    if (isFirstPost) {
      await this.prisma.forumThread.update({
        where: { id: post.threadId },
        data: { status: "archived" },
      });
      return { ok: true, archivedThread: true };
    }

    const deletingPostIds = post.thread.posts
      .filter((candidate) =>
        candidate.id === post.id ? true : candidate.parentId === post.id,
      )
      .map((candidate) => candidate.id);
    await this.assets.removeForumPostImages(deletingPostIds);

    const deletedCount = await this.prisma.$transaction(async (tx) => {
      const deletedCount =
        1 +
        (await tx.forumPost.count({
          where: { parentId: postId },
        }));

      await tx.forumPost.delete({ where: { id: postId } });
      const latestPost = await tx.forumPost.findFirst({
        where: { threadId: post.threadId },
        orderBy: [{ createdAt: "desc" }],
        select: { createdAt: true },
      });

      await tx.forumThread.update({
        where: { id: post.threadId },
        data: {
          lastActivityAt: latestPost?.createdAt ?? post.thread.createdAt,
        },
      });

      return deletedCount;
    });

    return { ok: true, archivedThread: false, deletedCount };
  }

  async listCategoriesForAdmin(
    userId: string | null,
  ): Promise<ForumCategorySummary[]> {
    await this.requireAdmin(userId);
    const workspace = await this.getDefaultWorkspace();
    await this.ensureDefaultCategories(workspace.id);
    const categories = await this.prisma.forumCategory.findMany({
      where: { workspaceId: workspace.id },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      include: { _count: { select: { threads: true } } },
    });

    return categories.map((category) => this.toCategorySummary(category));
  }

  async createCategory(
    userId: string | null,
    input: CreateForumCategoryDto,
  ): Promise<ForumCategorySummary> {
    await this.requireAdmin(userId);
    const workspace = await this.getDefaultWorkspace();
    const category = await this.prisma.forumCategory.create({
      data: {
        workspaceId: workspace.id,
        name: this.normalizeCategoryName(input.name),
        description: this.normalizeCategoryDescription(input.description),
        sortOrder: input.sortOrder ?? 100,
      },
      include: { _count: { select: { threads: true } } },
    });

    return this.toCategorySummary(category);
  }

  async updateCategory(
    userId: string | null,
    categoryId: string,
    input: UpdateForumCategoryDto,
  ): Promise<ForumCategorySummary> {
    await this.requireAdmin(userId);
    const data: {
      name?: string;
      description?: string | null;
      sortOrder?: number;
    } = {};

    if (typeof input.name === "string") {
      data.name = this.normalizeCategoryName(input.name);
    }

    if (input.description !== undefined) {
      data.description = this.normalizeCategoryDescription(input.description);
    }

    if (input.sortOrder !== undefined) {
      data.sortOrder = input.sortOrder;
    }

    const category = await this.prisma.forumCategory.update({
      where: { id: categoryId },
      data,
      include: { _count: { select: { threads: true } } },
    });

    return this.toCategorySummary(category);
  }

  async deleteCategory(userId: string | null, categoryId: string) {
    await this.requireAdmin(userId);
    const threadCount = await this.prisma.forumThread.count({
      where: { categoryId },
    });

    if (threadCount > 0) {
      throw new ConflictException("该版块已有帖子，不能删除");
    }

    await this.prisma.forumCategory.delete({ where: { id: categoryId } });
    return { ok: true };
  }

  private normalizeTitle(value: string) {
    const title = value.trim().replace(/\s+/g, " ");

    if (!title) {
      throw new BadRequestException("帖子标题不能为空");
    }

    if (title.length > 120) {
      throw new BadRequestException("帖子标题不能超过 120 个字");
    }

    return title;
  }

  private normalizeBody(value: string) {
    const body = value.trim();

    if (!body) {
      throw new BadRequestException("内容不能为空");
    }

    if (body.length > 8000) {
      throw new BadRequestException("内容不能超过 8000 个字");
    }

    return body;
  }

  private normalizeCategoryName(value: string) {
    const name = value.trim().replace(/\s+/g, " ");

    if (!name) {
      throw new BadRequestException("版块名称不能为空");
    }

    if (name.length > 40) {
      throw new BadRequestException("版块名称不能超过 40 个字");
    }

    return name;
  }

  private normalizeCategoryDescription(value: string | undefined) {
    const description = value?.trim() ?? "";

    if (!description) {
      return null;
    }

    if (description.length > 140) {
      throw new BadRequestException("版块描述不能超过 140 个字");
    }

    return description;
  }

  private async requireActiveUser(userId: string | null) {
    if (!userId) {
      throw new UnauthorizedException("Missing session");
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user || user.status !== "active") {
      throw new NotFoundException("User not found");
    }

    return user;
  }

  private async requireAdmin(userId: string | null) {
    const user = await this.requireActiveUser(userId);

    if (!isSystemAdmin(user.systemRole)) {
      throw new ForbiddenException("Only admins can manage forum settings");
    }

    return user;
  }

  private async getDefaultWorkspace() {
    const workspace = await this.prisma.workspace.findFirst({
      orderBy: [{ createdAt: "asc" }],
    });

    if (!workspace) {
      throw new NotFoundException("Workspace not found");
    }

    return workspace;
  }

  private async ensureDefaultCategories(workspaceId: string) {
    await this.prisma.forumCategory.updateMany({
      where: { workspaceId, name: "课程讨论" },
      data: {
        name: "课程交流",
        description: "围绕课程内容、作业思路和课堂延伸展开交流。",
      },
    });

    const categoryCount = await this.prisma.forumCategory.count({
      where: { workspaceId },
    });

    if (categoryCount > 0) {
      return;
    }

    await this.prisma.forumCategory.createMany({
      data: DEFAULT_FORUM_CATEGORIES.map((category) => ({
        workspaceId,
        ...category,
      })),
      skipDuplicates: true,
    });
  }

  private toCategorySummary(
    category: ForumCategoryRecord,
  ): ForumCategorySummary {
    return {
      id: category.id,
      name: category.name,
      description: category.description,
      sortOrder: category.sortOrder,
      threadCount: category._count?.threads ?? 0,
    };
  }

  private toThreadSummary(
    thread: ForumThreadRecord,
    canRevealAnonymous = false,
  ): ForumThreadSummary {
    return {
      id: thread.id,
      categoryId: thread.categoryId,
      title: thread.title,
      excerpt: this.toExcerpt(thread.excerpt ?? thread.posts?.[0]?.body ?? ""),
      status: thread.status,
      isAnonymous: thread.isAnonymous,
      author: this.toVisibleAuthor(
        thread.author,
        thread.isAnonymous,
        canRevealAnonymous,
      ),
      postCount: thread._count?.posts ?? thread.posts?.length ?? 0,
      createdAt: thread.createdAt.toISOString(),
      updatedAt: thread.updatedAt.toISOString(),
      lastActivityAt: thread.lastActivityAt.toISOString(),
    };
  }

  private toExcerpt(value: string) {
    const normalized = value.replace(/\s+/g, " ").trim();
    return normalized.length > 180
      ? `${normalized.slice(0, 177)}…`
      : normalized;
  }

  private toThreadDetail(
    thread: ForumThreadRecord & {
      category: ForumCategoryRecord;
      posts: ForumPostRecord[];
    },
    user: ForumUserRecord,
  ): ForumThreadDetail {
    const isAdmin = isSystemAdmin(user.systemRole);
    const canEdit =
      isAdmin || (thread.author.id === user.id && thread.status === "open");
    const canArchive =
      thread.status !== "archived" && (isAdmin || thread.author.id === user.id);
    const permissions = {
      userId: user.id,
      isAdmin,
      threadAuthorId: thread.author.id,
      threadStatus: thread.status,
      canRevealAnonymous: isSuperAdmin(user.systemRole),
      mainPostId: thread.posts[0]?.id ?? null,
    };

    return {
      ...this.toThreadSummary(thread, permissions.canRevealAnonymous),
      category: this.toCategorySummary(thread.category),
      canEdit,
      canArchive,
      canModerate: isAdmin,
      canReply: thread.status === "open",
      posts: thread.posts.map((post) => this.toPostSummary(post, permissions)),
    };
  }

  private toPostSummary(
    post: ForumPostRecord,
    permissions?: ForumPermissionContext,
  ): ForumPostSummary {
    const canMutate =
      permissions?.isAdmin ||
      (permissions?.threadStatus === "open" &&
        post.author.id === permissions?.userId);
    const canEdit = canMutate && post.id === permissions?.mainPostId;

    return {
      id: post.id,
      threadId: post.threadId,
      parentId: post.parentId,
      replyToId: post.replyToId,
      replyTo: post.replyTo
        ? {
            id: post.replyTo.id,
            isAnonymous: post.replyTo.isAnonymous,
            author: this.toVisibleAuthor(
              post.replyTo.author,
              post.replyTo.isAnonymous,
              permissions?.canRevealAnonymous ?? false,
            ),
          }
        : null,
      isAnonymous: post.isAnonymous,
      author: this.toVisibleAuthor(
        post.author,
        post.isAnonymous,
        permissions?.canRevealAnonymous ?? false,
      ),
      body: post.body,
      images: post.images.map((image) => ({
        id: image.id,
        url: `/assets/${image.id}`,
        width: image.width ?? 1,
        height: image.height ?? 1,
        sortOrder: image.sortOrder ?? 0,
      })),
      createdAt: post.createdAt.toISOString(),
      updatedAt: post.updatedAt.toISOString(),
      canEdit: canEdit ?? false,
      canDelete: canMutate ?? false,
    };
  }

  private toUserSummary(user: ForumUserRecord): UserSummary {
    return {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      avatarUrl: user.avatarUpdatedAt
        ? `/auth/avatar/${user.id}?v=${user.avatarUpdatedAt.getTime()}`
        : null,
      systemRole: user.systemRole,
      status: user.status,
    };
  }

  private toVisibleAuthor(
    user: ForumUserRecord,
    isAnonymous: boolean,
    canRevealAnonymous: boolean,
  ): UserSummary {
    return isAnonymous && !canRevealAnonymous
      ? ANONYMOUS_FORUM_USER
      : this.toUserSummary(user);
  }
}
