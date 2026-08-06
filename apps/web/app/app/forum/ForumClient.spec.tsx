import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { listForumOverview } from "@/lib/api";
import { ForumClient } from "./ForumClient";

const routerState = vi.hoisted(() => ({ push: vi.fn() }));
const openModeState = vi.hoisted(() => ({ current: false }));

vi.mock("next/navigation", () => ({
  useRouter: () => routerState,
}));

vi.mock("@/components/app-shell/UserPreferencesProvider", () => ({
  useContentOpenMode: () => openModeState.current,
}));

vi.mock("@/lib/api", () => ({
  listForumOverview: vi.fn(),
}));

describe("ForumClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    openModeState.current = false;
    routerState.push.mockClear();
    vi.mocked(listForumOverview).mockResolvedValue({
      categories: [
        {
          id: "category-1",
          name: "课程交流",
          description: null,
          sortOrder: 0,
          threadCount: 1,
        },
      ],
      threads: [
        {
          id: "thread-1",
          categoryId: "category-1",
          title: "第一次课程讨论",
          excerpt: "整理本周课堂中的疑问。",
          status: "open",
          isAnonymous: false,
          author: {
            id: "user-1",
            username: "teacher",
            displayName: "张老师",
            avatarUrl: null,
            badges: [
              {
                id: "badge-1",
                name: "优秀教师",
                description: "教学认证",
                color: "blue",
              },
            ],
            systemRole: "member",
            status: "active",
          },
          postCount: 3,
          createdAt: "2026-07-28T08:00:00.000Z",
          updatedAt: "2026-07-28T09:00:00.000Z",
          lastActivityAt: "2026-07-28T09:00:00.000Z",
        },
      ],
    });
  });

  it("places category navigation beside the feed and keeps the mobile selector", async () => {
    const { container } = render(<ForumClient />);

    expect(
      await screen.findByRole("option", { name: "全部版块（1）" }),
    ).toBeInTheDocument();
    const categorySidebar = container.querySelector(".forum-category-sidebar");
    expect(categorySidebar).not.toBeNull();
    expect(
      within(categorySidebar as HTMLElement).getByRole("button", {
        name: "全部版块 1",
      }),
    ).toBeInTheDocument();
    expect(
      within(categorySidebar as HTMLElement).getByRole("button", {
        name: "课程交流 1",
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "发布内容" })).toHaveAttribute(
      "href",
      "/app/forum/new",
    );
    expect(screen.getByRole("link", { name: "发布内容" })).toHaveClass(
      "mobile-icon-action",
    );
    expect(
      screen.queryByRole("button", { name: "未读" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "全部" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "提及我" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "关注" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "论坛" }),
    ).not.toBeInTheDocument();
  });

  it("presents each topic as title, excerpt, then supporting metadata", async () => {
    render(<ForumClient />);

    const topic = (await screen.findByText("第一次课程讨论")).closest(
      ".forum-topic-content",
    );
    expect(topic).not.toBeNull();

    const title = within(topic as HTMLElement).getByText("第一次课程讨论");
    const heading = title.closest(".forum-topic-heading");
    const excerpt = within(topic as HTMLElement).getByText(
      "整理本周课堂中的疑问。",
    );
    const author = within(topic as HTMLElement).getByText("张老师");
    const category = within(topic as HTMLElement).getByText("课程交流");

    expect(heading).not.toBeNull();
    expect(
      title.compareDocumentPosition(category) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      title.compareDocumentPosition(excerpt) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      excerpt.compareDocumentPosition(author) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      within(topic as HTMLElement).getByText("2 条回复"),
    ).toBeInTheDocument();
    expect(topic?.querySelector(".user-badges--compact")).not.toBeNull();
  });

  it("偏好为当前标签页时，帖子标题链接不带 target 且点帖子行走 router.push", async () => {
    openModeState.current = true;
    render(<ForumClient />);

    const title = await screen.findByRole("link", { name: "第一次课程讨论" });
    expect(title).not.toHaveAttribute("target", "_blank");

    const topic = screen.getByText("整理本周课堂中的疑问。").closest("article");
    expect(topic).not.toBeNull();
    fireEvent.click(topic as HTMLElement);

    expect(routerState.push).toHaveBeenCalledWith("/app/forum/thread-1");
  });
});
