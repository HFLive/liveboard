import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getMe, listActivity } from "@/lib/api";
import { AppNav } from "./AppNav";

vi.mock("next/navigation", () => ({
  usePathname: () => "/app/forum",
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
});
