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
      profileUrl: "https://auth.hsfz.live/profile",
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

    expect(await screen.findByText("已关联 HFLive")).toBeInTheDocument();
    expect(screen.getByLabelText(/^显示名/)).toHaveAttribute("readonly");
    expect(screen.getByLabelText(/^个人简介/)).not.toHaveAttribute("readonly");
    expect(
      screen.queryByRole("button", { name: "上传头像" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getAllByRole("link", { name: /HFLive|统一资料/ })[0],
    ).toHaveAttribute("href", "https://auth.hsfz.live/profile");
    expect(
      container.querySelector(
        'img[src="https://auth.hsfz.live/api/profile/avatar/id?v=2"]',
      ),
    ).toBeInTheDocument();
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
