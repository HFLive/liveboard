import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getMe, listActivity } from "@/lib/api";
import { AppNav } from "./AppNav";

const navigationState = vi.hoisted(() => ({ pathname: "/app/forum" }));

vi.mock("next/navigation", () => ({
  usePathname: () => navigationState.pathname,
}));

vi.mock("@/lib/api", () => ({
  apiResourceUrl: (path: string) => path,
  dismissActivity: vi.fn(),
  getMe: vi.fn(),
  listActivity: vi.fn(),
  markActivityRead: vi.fn(),
}));

vi.mock("./LogoutButton", () => ({
  LogoutButton: () => <button type="button">退出登录</button>,
}));

describe("AppNav", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    navigationState.pathname = "/app/forum";
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn(),
    });
    vi.mocked(getMe).mockResolvedValue({
      user: {
        id: "user-1",
        username: "admin",
        displayName: "管理员",
        avatarUrl: null,
        bannerUrl: null,
        bio: null,
        systemRole: "admin",
        status: "active",
      },
    });
    vi.mocked(listActivity).mockResolvedValue({
      items: [],
      unreadCount: 0,
    });
  });

  it.each(["/app/ai", "/app/library"])(
    "keeps document navigation active for its tool route %s",
    (pathname) => {
      navigationState.pathname = pathname;
      render(<AppNav />);

      expect(screen.getByRole("link", { name: "文档" })).toHaveAttribute(
        "aria-current",
        "page",
      );
      expect(
        screen.getByRole("button", { name: "打开主菜单" }),
      ).toHaveTextContent("文档");
    },
  );

  it("shows the current section and exposes a compact mobile menu toggle", () => {
    render(<AppNav />);

    expect(screen.getByRole("link", { name: "论坛" })).toHaveAttribute(
      "aria-current",
      "page",
    );

    const toggle = screen.getByRole("button", { name: "打开主菜单" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(toggle);

    expect(
      screen
        .getAllByRole("button", { name: "关闭主菜单" })
        .find((button) => button.hasAttribute("aria-expanded")),
    ).toHaveAttribute("aria-expanded", "true");
  });

  it("keeps the account avatar in the expanded menu on profile routes", async () => {
    navigationState.pathname = "/app/users/user-1";
    vi.mocked(getMe).mockResolvedValue({
      user: {
        id: "user-1",
        username: "admin",
        displayName: "管理员",
        avatarUrl: "/users/user-1/avatar",
        bannerUrl: null,
        bio: null,
        systemRole: "admin",
        status: "active",
      },
    });

    const view = render(<AppNav />);

    await waitFor(() =>
      expect(
        view.container.querySelectorAll(
          ".rail-mobile-profile-avatar img[src='/users/user-1/avatar']",
        ),
      ).toHaveLength(1),
    );
    const toggle = screen.getByRole("button", { name: "打开主菜单" });
    expect(toggle).toHaveTextContent("个人主页");
    expect(toggle.querySelector(".rail-mobile-profile-avatar")).toBeNull();
    expect(toggle.querySelector("svg")).not.toBeNull();

    fireEvent.click(toggle);
    const profileLink = screen.getByRole("link", { name: "个人主页" });
    expect(
      profileLink.querySelector(".rail-mobile-profile-avatar img"),
    ).not.toBeNull();
    expect(
      view.container.querySelector(".rail-mobile-account-actions button"),
    ).not.toBeNull();
  });
});
