import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getMe } from "@/lib/api";
import { AdminOverviewClient } from "./AdminOverviewClient";

vi.mock("@/lib/api", () => ({
  getMe: vi.fn(),
}));

vi.mock("@/lib/useDocumentTitle", () => ({
  useDocumentTitle: vi.fn(),
}));

const user = {
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

describe("AdminOverviewClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("organizes management entries into task groups", async () => {
    vi.mocked(getMe).mockResolvedValue({
      user: { ...user, systemRole: "super_admin" },
    });

    render(<AdminOverviewClient />);

    expect(
      screen.getByRole("heading", { level: 1, name: "管理总览" }),
    ).toBeInTheDocument();
    expect(screen.getByText("人员与权限")).toBeInTheDocument();
    expect(screen.getByText("内容与资源")).toBeInTheDocument();
    await waitFor(() =>
      expect(
        screen.getByRole("link", { name: /存储后端/ }),
      ).toBeInTheDocument(),
    );
  });

  it("does not expose super administrator entries to administrators", async () => {
    vi.mocked(getMe).mockResolvedValue({
      user: { ...user, systemRole: "admin" },
    });

    render(<AdminOverviewClient />);

    await waitFor(() => expect(getMe).toHaveBeenCalledTimes(1));
    expect(
      screen.queryByRole("link", { name: /系统设置/ }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /成员管理/ })).toBeInTheDocument();
  });
});
