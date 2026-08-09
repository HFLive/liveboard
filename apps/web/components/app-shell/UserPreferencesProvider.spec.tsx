import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getMe } from "@/lib/api";
import {
  UserPreferencesProvider,
  useContentOpenMode,
} from "./UserPreferencesProvider";

vi.mock("@/lib/api", () => ({ getMe: vi.fn() }));

function Probe() {
  const openContentInCurrentTab = useContentOpenMode();
  return (
    <span data-testid="mode">
      {openContentInCurrentTab ? "current" : "new-tab"}
    </span>
  );
}

const baseUser = {
  id: "user-1",
  username: "admin",
  displayName: "管理员",
  avatarUrl: null,
  bannerUrl: null,
  bio: null,
  systemRole: "member" as const,
  status: "active" as const,
};

describe("UserPreferencesProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("用户偏好未加载时默认使用新标签页", () => {
    vi.mocked(getMe).mockReturnValue(new Promise(() => {}));
    render(
      <UserPreferencesProvider>
        <Probe />
      </UserPreferencesProvider>,
    );
    expect(screen.getByTestId("mode")).toHaveTextContent("new-tab");
  });

  it("getMe 返回偏好为当前标签页时对外暴露 true", async () => {
    vi.mocked(getMe).mockResolvedValue({
      user: { ...baseUser, openContentInCurrentTab: true },
    });
    render(
      <UserPreferencesProvider>
        <Probe />
      </UserPreferencesProvider>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("mode")).toHaveTextContent("current"),
    );
  });

  it("监听 liveboard:profile-updated 事件重新拉取偏好", async () => {
    vi.mocked(getMe)
      .mockResolvedValueOnce({
        user: { ...baseUser, openContentInCurrentTab: false },
      })
      .mockResolvedValueOnce({
        user: { ...baseUser, openContentInCurrentTab: true },
      });
    render(
      <UserPreferencesProvider>
        <Probe />
      </UserPreferencesProvider>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("mode")).toHaveTextContent("new-tab"),
    );

    window.dispatchEvent(new Event("liveboard:profile-updated"));

    await waitFor(() =>
      expect(screen.getByTestId("mode")).toHaveTextContent("current"),
    );
  });
});
