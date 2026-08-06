import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  archiveNotification,
  listNotifications,
  markAllNotificationsRead,
  setNotificationRead,
} from "@/lib/api";
import { NotificationsClient } from "./NotificationsClient";

const { routerReplaceMock, useSearchParamsMock } = vi.hoisted(() => ({
  routerReplaceMock: vi.fn(),
  useSearchParamsMock: vi.fn(() => new URLSearchParams("")),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/app/messages",
  useRouter: () => ({ replace: routerReplaceMock }),
  useSearchParams: useSearchParamsMock,
}));

vi.mock("@/lib/api", () => ({
  apiResourceUrl: (path: string) => path,
  archiveNotification: vi.fn(),
  listNotifications: vi.fn(),
  markAllNotificationsRead: vi.fn(),
  setNotificationRead: vi.fn(),
}));

const notification = {
  id: "notification-1",
  type: "submission_graded",
  category: "feedback" as const,
  priority: "important" as const,
  title: "第一章练习",
  detail: "批改已完成 · 18/20 分",
  href: "/app/exercises/exercise-1",
  classroomId: "classroom-1",
  classroomName: "高一物理",
  actor: null,
  aggregateCount: 1,
  occurredAt: "2026-07-29T12:00:00.000Z",
  unread: true,
};

describe("NotificationsClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSearchParamsMock.mockReturnValue(new URLSearchParams(""));
    vi.mocked(listNotifications).mockResolvedValue({
      items: [notification],
      unreadCount: 1,
      nextCursor: null,
    });
    vi.mocked(markAllNotificationsRead).mockResolvedValue({
      updatedCount: 1,
    });
    vi.mocked(setNotificationRead).mockResolvedValue({ read: true });
    vi.mocked(archiveNotification).mockResolvedValue({ archived: true });
  });

  it("loads persistent messages and marks all read explicitly", async () => {
    render(<NotificationsClient />);

    expect(
      await screen.findByRole("link", { name: /第一章练习/ }),
    ).toBeInTheDocument();
    expect(screen.getByText("1 条未读")).toBeInTheDocument();
    expect(markAllNotificationsRead).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "全部已读" }));
    await waitFor(() =>
      expect(markAllNotificationsRead).toHaveBeenCalledTimes(1),
    );
    // 工具栏计数与空状态各一处
    expect(screen.getAllByText("没有未读消息")).toHaveLength(2);
  });

  it("loads unread by default and switches between all and unread segments", async () => {
    render(<NotificationsClient />);
    await screen.findByRole("link", { name: /第一章练习/ });

    // 默认主页是未读
    expect(listNotifications).toHaveBeenLastCalledWith({
      status: "unread",
      category: undefined,
      limit: 30,
    });

    fireEvent.click(screen.getByRole("button", { name: "全部" }));
    await waitFor(() =>
      expect(listNotifications).toHaveBeenLastCalledWith({
        status: "all",
        category: undefined,
        limit: 30,
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "未读" }));
    await waitFor(() =>
      expect(listNotifications).toHaveBeenLastCalledWith({
        status: "unread",
        category: undefined,
        limit: 30,
      }),
    );
  });

  it("restores the all segment from the URL on first render", async () => {
    useSearchParamsMock.mockReturnValue(new URLSearchParams("?status=all"));
    render(<NotificationsClient />);
    await screen.findByRole("link", { name: /第一章练习/ });

    expect(listNotifications).toHaveBeenLastCalledWith({
      status: "all",
      category: undefined,
      limit: 30,
    });
    expect(screen.getByRole("button", { name: "全部" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "未读" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("syncs segment changes to the URL", async () => {
    render(<NotificationsClient />);
    await screen.findByRole("link", { name: /第一章练习/ });

    fireEvent.click(screen.getByRole("button", { name: "全部" }));
    await waitFor(() =>
      expect(routerReplaceMock).toHaveBeenCalledWith("/app/messages?status=all", {
        scroll: false,
      }),
    );

    routerReplaceMock.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "未读" }));
    await waitFor(() =>
      expect(routerReplaceMock).toHaveBeenCalledWith("/app/messages", {
        scroll: false,
      }),
    );
  });
});
