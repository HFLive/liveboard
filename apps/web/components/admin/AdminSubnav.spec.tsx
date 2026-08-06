import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getMe } from "@/lib/api";
import { AdminSubnav } from "./AdminSubnav";

vi.mock("next/navigation", () => ({
  usePathname: () => "/app/admin/users",
}));
vi.mock("@/lib/api", () => ({
  getMe: vi.fn(),
}));

const baseUser = {
  id: "user-1",
  username: "admin",
  displayName: "Admin",
  status: "active" as const,
  aiCallCount: 0,
  aiCallLimit: null,
  bio: "",
  bannerUrl: null,
  avatarUrl: null,
};

describe("AdminSubnav", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("groups management tools and marks the current page", async () => {
    vi.mocked(getMe).mockResolvedValue({
      user: { ...baseUser, systemRole: "super_admin" },
    });

    render(<AdminSubnav />);

    expect(screen.getByText("人员与权限")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByText("内容与资源")).toBeInTheDocument(),
    );
    expect(screen.getByText("系统与服务")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "成员管理" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "管理总览" })).toBeInTheDocument();
    expect(screen.queryByText("权限组")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "文档权限" })).toBeInTheDocument();
  });

  it("shows badges and access tokens to administrators while hiding capacity and forum management", async () => {
    vi.mocked(getMe).mockResolvedValue({
      user: { ...baseUser, systemRole: "admin" },
    });

    render(<AdminSubnav />);

    await waitFor(() => expect(getMe).toHaveBeenCalledTimes(1));
    // 管理员可见：徽章管理、访问令牌
    expect(screen.getByRole("link", { name: "徽章管理" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "访问令牌" })).toBeInTheDocument();
    // 管理员不可见：容量管理、版块管理、系统设置等最高管理员专属项
    expect(
      screen.queryByRole("link", { name: "容量管理" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "版块管理" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "系统设置" }),
    ).not.toBeInTheDocument();
  });
});
