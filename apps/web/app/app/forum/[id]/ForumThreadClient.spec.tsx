import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ForumThreadDetail } from "@liveboard/shared";
import { getForumThread, listForumOverview } from "@/lib/api";
import { ForumThreadClient } from "./ForumThreadClient";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/lib/api", () => ({
  createForumPost: vi.fn(),
  deleteForumPost: vi.fn(),
  deleteForumThread: vi.fn(),
  getForumThread: vi.fn(),
  listForumOverview: vi.fn(),
  updateForumPost: vi.fn(),
  updateForumThread: vi.fn(),
  uploadForumPostImages: vi.fn(),
  voteForumPost: vi.fn(),
}));

vi.mock("../ForumImagePicker", () => ({
  ForumImagePicker: () => <div data-testid="image-picker" />,
}));

const thread: ForumThreadDetail = {
  id: "thread-1",
  categoryId: "category-1",
  category: {
    id: "category-1",
    name: "课程交流",
    description: null,
    sortOrder: 0,
    threadCount: 1,
  },
  title: "第一次课程讨论",
  excerpt: "整理本周课堂中的疑问。",
  status: "open",
  isAnonymous: false,
  author: {
    id: "user-1",
    username: "teacher",
    displayName: "张老师",
    avatarUrl: null,
    systemRole: "member",
    status: "active",
  },
  postCount: 1,
  createdAt: "2026-07-28T08:00:00.000Z",
  updatedAt: "2026-07-28T08:00:00.000Z",
  lastActivityAt: "2026-07-28T08:00:00.000Z",
  canEdit: true,
  canDelete: true,
  canModerate: true,
  canReply: true,
  posts: [
    {
      id: "post-1",
      threadId: "thread-1",
      parentId: null,
      replyToId: null,
      replyTo: null,
      isAnonymous: false,
      author: {
        id: "user-1",
        username: "teacher",
        displayName: "张老师",
        avatarUrl: null,
        systemRole: "member",
        status: "active",
      },
      body: "欢迎讨论本周课程。",
      images: [],
      createdAt: "2026-07-28T08:00:00.000Z",
      updatedAt: "2026-07-28T08:00:00.000Z",
      upvoteCount: 0,
      downvoteCount: 0,
      viewerVote: null,
      canDelete: true,
    },
  ],
};

describe("ForumThreadClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getForumThread).mockResolvedValue({ thread });
    vi.mocked(listForumOverview).mockResolvedValue({
      categories: [thread.category],
      threads: [],
    });
  });

  it("uses a compact reading header and collects moderation actions", async () => {
    const { container } = render(<ForumThreadClient threadId={thread.id} />);

    expect(
      await screen.findByRole("heading", { name: thread.title }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "返回论坛" })).toHaveAttribute(
      "href",
      "/app/forum",
    );
    expect(
      screen.queryByRole("textbox", { name: "在帖子内搜索" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(thread.category.name)).toBeInTheDocument();

    const byline = container.querySelector(".forum-main-post-byline");
    expect(byline).not.toBeNull();
    expect(
      within(byline as HTMLElement).getByText("张老师"),
    ).toBeInTheDocument();

    const moreMenu = container.querySelector(".forum-thread-more-menu");
    expect(moreMenu).not.toBeNull();
    expect(
      within(moreMenu as HTMLElement).getByText("编辑帖子"),
    ).toBeInTheDocument();
    expect(
      within(moreMenu as HTMLElement).getByText("锁定帖子"),
    ).toBeInTheDocument();
    expect(
      within(moreMenu as HTMLElement).getByText("删除帖子"),
    ).toBeInTheDocument();
  });
});
