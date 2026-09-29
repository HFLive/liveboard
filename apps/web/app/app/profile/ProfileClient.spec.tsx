import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getHfliveAccountContext, getMe, listMyBadges } from "@/lib/api";
import { ProfileClient } from "./ProfileClient";

vi.mock("@/lib/api", () => ({
  apiResourceUrl: (value: string) => value,
  changePassword: vi.fn(),
  getHfliveAccountContext: vi.fn(),
  getMe: vi.fn(),
  listMyBadges: vi.fn(),
  setEquippedBadges: vi.fn(),
  startHfliveAccountLink: vi.fn(),
  syncHfliveAccount: vi.fn(),
  updateProfile: vi.fn(),
  uploadAvatar: vi.fn(),
  uploadProfileBannerDirect: vi.fn(),
}));

const user = {
  id: "user-1",
  username: "teacher",
  displayName: "统一姓名",
  avatarUrl: "/auth/avatar/user-1?v=1",
  systemRole: "member" as const,
  status: "active" as const,
  bio: "LiveBoard 简介",
  bannerUrl: null,
  openContentInCurrentTab: false,
  badges: [],
};

describe("ProfileClient HFLive ownership", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getMe).mockResolvedValue({ user });
    vi.mocked(listMyBadges).mockResolvedValue({ badges: [] });
  });

  it("makes unified fields read-only while keeping app-private fields local", async () => {
    vi.mocked(getHfliveAccountContext).mockResolvedValue({
      mode: "hybrid",
      localLogin: true,
      hfliveOidc: true,
      breakglass: false,
      issuer: "https://auth.hsfz.live",
      profileUrl:
        "https://auth.hsfz.live/profile?returnTo=https%3A%2F%2Fboard.hsfz.live%2Fapp%2Fprofile",
      linked: true,
      authoritative: true,
      localPasswordEnabled: true,
      identity: {
        preferredUsername: "teacher",
        email: "teacher@example.invalid",
        displayName: "统一姓名",
        picture: "https://auth.hsfz.live/api/profile/avatar/id?v=2",
        externalStatus: "ACTIVE",
        syncState: "CURRENT",
        syncErrorCode: null,
        lastProfileSyncedAt: "2026-08-11T06:00:00.000Z",
      },
    });

    const { container } = render(<ProfileClient />);

    expect(
      await screen.findByRole("heading", { name: "账号资料" }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText(/^显示名/)).not.toBeInTheDocument();
    expect(screen.getByText("个人主页背景")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "更换背景" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("账号信息")).not.toBeInTheDocument();
    expect(screen.queryByText("状态")).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "修改登录用户名" }),
    ).toHaveAttribute(
      "href",
      expect.stringContaining("https://auth.hsfz.live/profile?"),
    );
    expect(screen.getByRole("link", { name: "修改邮箱" })).toHaveAttribute(
      "href",
      expect.stringContaining("https://auth.hsfz.live/profile?"),
    );
    expect(screen.getByLabelText(/^个人简介/)).not.toHaveAttribute("readonly");
    expect(
      screen.queryByRole("button", { name: "上传头像" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getAllByRole("link", { name: /HFLive|统一资料/ })[0],
    ).toHaveAttribute(
      "href",
      "https://auth.hsfz.live/profile?returnTo=https%3A%2F%2Fboard.hsfz.live%2Fapp%2Fprofile",
    );
    expect(
      container.querySelector(
        'img[src="https://auth.hsfz.live/api/profile/avatar/id?v=2"]',
      ),
    ).toBeInTheDocument();
  });

  it("keeps account settings available if badges cannot be loaded", async () => {
    vi.mocked(listMyBadges).mockRejectedValue(new Error("badges unavailable"));
    vi.mocked(getHfliveAccountContext).mockResolvedValue({
      mode: "local",
      localLogin: true,
      hfliveOidc: false,
      breakglass: false,
      issuer: "https://auth.hsfz.live",
      profileUrl: "https://auth.hsfz.live/profile",
      linked: false,
      authoritative: false,
      localPasswordEnabled: true,
      identity: null,
    });
    render(<ProfileClient />);
    expect(await screen.findByLabelText(/^个人简介/)).toBeInTheDocument();
  });

  it("keeps local profile controls editable in local mode", async () => {
    vi.mocked(getHfliveAccountContext).mockResolvedValue({
      mode: "local",
      localLogin: true,
      hfliveOidc: false,
      breakglass: false,
      issuer: "https://auth.hsfz.live",
      profileUrl: "https://auth.hsfz.live/profile",
      linked: false,
      authoritative: false,
      localPasswordEnabled: true,
      identity: null,
    });

    render(<ProfileClient />);

    expect(
      await screen.findByText("当前实例使用本地身份。"),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/^显示名/)).not.toHaveAttribute("readonly");
    expect(
      screen.getByRole("button", { name: "上传头像" }),
    ).toBeInTheDocument();
  });
});
