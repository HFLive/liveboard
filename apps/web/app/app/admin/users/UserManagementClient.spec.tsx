import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminUserSummary } from "@liveboard/shared";
import {
  bulkUpdateUserStatus,
  getAdminHfliveIdentity,
  getAuthCapabilities,
  getMe,
  hfliveSyncUser,
  listUsers,
  listUserTags,
} from "@/lib/api";
import { UserManagementClient } from "./UserManagementClient";

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    listUsers: vi.fn(),
    listUserTags: vi.fn(),
    getMe: vi.fn(),
    getAuthCapabilities: vi.fn(),
    bulkUpdateUserStatus: vi.fn(),
    hfliveSyncUser: vi.fn(),
    getAdminHfliveIdentity: vi.fn(),
    createUserTag: vi.fn(),
    updateUserTag: vi.fn(),
    deleteUserTag: vi.fn(),
  };
});

const baseUser: AdminUserSummary = {
  id: "member-1",
  username: "teacher",
  displayName: "教师",
  status: "active",
  systemRole: "member",
  avatarUrl: null,
  badges: [],
  aiCallCount: 0,
  aiCallLimit: null,
};

function renderPage() {
  return render(<UserManagementClient />);
}

describe("UserManagementClient unified identity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAuthCapabilities).mockResolvedValue({
      mode: "hybrid",
      localLogin: true,
      hfliveOidc: true,
      breakglass: false,
      issuer: "https://auth.hsfz.live",
      profileUrl: "https://auth.hsfz.live/profile",
    });
    vi.mocked(getMe).mockResolvedValue({
      user: {
        id: "admin-1",
        username: "admin",
        displayName: "管理员",
        status: "active",
        systemRole: "super_admin",
        avatarUrl: null,
        badges: [],
        bio: null,
        bannerUrl: null,
        openContentInCurrentTab: false,
      },
    });
    vi.mocked(listUserTags).mockResolvedValue({ tags: [] });
    vi.mocked(getAdminHfliveIdentity).mockResolvedValue({
      linked: true,
      identity: {
        issuer: "https://auth.hsfz.live",
        preferredUsername: "teacher",
        email: null,
        displayName: "教师",
        picture: null,
        externalStatus: "ACTIVE",
        syncState: "CURRENT",
        syncErrorCode: null,
        linkMethod: "JIT",
        lastStatusConfirmedAt: "2026-08-11T06:00:00.000Z",
        lastProfileSyncedAt: "2026-08-11T06:00:00.000Z",
        directoryUpdatedAt: "2026-08-11T06:00:00.000Z",
      },
    });
  });

  it("shows a linked identity state badge and renders the identity column", async () => {
    vi.mocked(listUsers).mockResolvedValue({
      users: [
        {
          ...baseUser,
          hflive: {
            linked: true,
            syncState: "PROFILE_CONFLICT",
            externalStatus: "ACTIVE",
            linkMethod: "JIT",
            lastProfileSyncedAt: "2026-08-11T06:00:00.000Z",
          },
        },
        {
          ...baseUser,
          id: "member-2",
          username: "local",
          hflive: {
            linked: false,
            syncState: null,
            externalStatus: null,
            linkMethod: null,
            lastProfileSyncedAt: null,
          },
        },
      ],
    });

    renderPage();

    await waitFor(() =>
      expect(screen.getByText("同步冲突")).toBeInTheDocument(),
    );
    expect(
      screen.getByText("未绑定", { selector: "span" }),
    ).toBeInTheDocument();
    expect(screen.getByTitle(/绑定方式：登录时自动创建/)).toBeInTheDocument();
  });

  it("filters by identity attention state", async () => {
    vi.mocked(listUsers).mockResolvedValue({
      users: [
        {
          ...baseUser,
          hflive: {
            linked: true,
            syncState: "CURRENT",
            externalStatus: "DISABLED",
            linkMethod: "JIT",
            lastProfileSyncedAt: "2026-08-11T06:00:00.000Z",
          },
        },
        {
          ...baseUser,
          id: "member-2",
          username: "ok-user",
          displayName: "正常用户",
          hflive: {
            linked: true,
            syncState: "CURRENT",
            externalStatus: "ACTIVE",
            linkMethod: "JIT",
            lastProfileSyncedAt: "2026-08-11T06:00:00.000Z",
          },
        },
      ],
    });

    renderPage();
    await waitFor(() =>
      expect(screen.getByText("外部停用")).toBeInTheDocument(),
    );
    fireEvent.change(screen.getByLabelText("按统一身份筛选"), {
      target: { value: "attention" },
    });
    expect(screen.getByText("外部停用")).toBeInTheDocument();
    expect(screen.queryByText("正常用户")).not.toBeInTheDocument();
  });

  it("hides create and import buttons while AUTH_MODE=hflive_oidc", async () => {
    vi.mocked(getAuthCapabilities).mockResolvedValue({
      mode: "hflive_oidc",
      localLogin: false,
      hfliveOidc: true,
      breakglass: false,
      issuer: "https://auth.hsfz.live",
      profileUrl: "https://auth.hsfz.live/profile",
    });
    vi.mocked(listUsers).mockResolvedValue({ users: [baseUser] });

    renderPage();

    await waitFor(() =>
      expect(screen.getByText("标签管理")).toBeInTheDocument(),
    );
    expect(screen.queryByText("创建成员")).not.toBeInTheDocument();
    expect(screen.queryByText("批量导入")).not.toBeInTheDocument();
  });

  it("hides displayName and password inputs for a linked user in the edit modal", async () => {
    vi.mocked(listUsers).mockResolvedValue({
      users: [
        {
          ...baseUser,
          hflive: {
            linked: true,
            syncState: "CURRENT",
            externalStatus: "ACTIVE",
            linkMethod: "JIT",
            lastProfileSyncedAt: "2026-08-11T06:00:00.000Z",
          },
        },
      ],
    });

    renderPage();
    await waitFor(() =>
      expect(screen.getByTitle("编辑成员")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTitle("编辑成员"));

    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: /统一身份/ }),
      ).toBeInTheDocument(),
    );
    expect(
      screen.getByRole("heading", { name: /本地管理/ }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText(/^显示名/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/重置密码/)).not.toBeInTheDocument();
  });

  it("runs the bulk status endpoint from the batch bar", async () => {
    vi.mocked(listUsers).mockResolvedValue({
      users: [
        baseUser,
        {
          ...baseUser,
          id: "member-2",
          username: "member-2",
          displayName: "成员二",
        },
      ],
    });
    vi.mocked(bulkUpdateUserStatus).mockResolvedValue({
      result: { updated: 2, skipped: 0 },
    });

    renderPage();
    await waitFor(() => expect(screen.getByText("成员二")).toBeInTheDocument());
    const checkboxes = screen.getAllByRole("checkbox");
    fireEvent.click(checkboxes[0]!);
    fireEvent.click(checkboxes[1]!);
    fireEvent.click(screen.getByText("批量停用"));

    await waitFor(() =>
      expect(bulkUpdateUserStatus).toHaveBeenCalledWith(
        ["member-1", "member-2"],
        "disabled",
      ),
    );
  });

  it("syncs a linked identity from the edit modal", async () => {
    vi.mocked(listUsers).mockResolvedValue({
      users: [
        {
          ...baseUser,
          hflive: {
            linked: true,
            syncState: "ERROR",
            externalStatus: "ACTIVE",
            linkMethod: "JIT",
            lastProfileSyncedAt: null,
          },
        },
      ],
    });
    vi.mocked(hfliveSyncUser).mockResolvedValue({
      linked: true,
      identity: {
        issuer: "https://auth.hsfz.live",
        preferredUsername: "teacher",
        email: null,
        displayName: "教师",
        picture: null,
        externalStatus: "ACTIVE",
        syncState: "CURRENT",
        syncErrorCode: null,
        linkMethod: "JIT",
        lastStatusConfirmedAt: "2026-08-11T06:00:00.000Z",
        lastProfileSyncedAt: "2026-08-11T06:00:00.000Z",
        directoryUpdatedAt: "2026-08-11T06:00:00.000Z",
      },
    });

    renderPage();
    await waitFor(() =>
      expect(screen.getByText("同步异常")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTitle("编辑成员"));

    await waitFor(() =>
      expect(screen.getByText("立即同步")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByText("立即同步"));

    await waitFor(() =>
      expect(hfliveSyncUser).toHaveBeenCalledWith("member-1"),
    );
  });
});
