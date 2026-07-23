import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getMe } from "@/lib/api";
import { AdminSubnav } from "./AdminSubnav";

vi.mock("next/navigation", () => ({
  usePathname: () => "/app/admin/groups",
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
    expect(screen.getByText("内容与资源")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByText("系统与服务")).toBeInTheDocument(),
    );
    expect(screen.getByRole("link", { name: "权限组" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("hides super administrator services from ordinary administrators", async () => {
    vi.mocked(getMe).mockResolvedValue({
      user: { ...baseUser, systemRole: "admin" },
    });

    render(<AdminSubnav />);

    await waitFor(() => expect(getMe).toHaveBeenCalledTimes(1));
    expect(screen.queryByText("系统与服务")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "系统设置" }),
    ).not.toBeInTheDocument();
  });
});
