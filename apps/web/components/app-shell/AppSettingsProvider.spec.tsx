import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiResourceUrl, getPublicSettings } from "@/lib/api";
import { setAppTimeZone } from "@/lib/labels";
import { AppSettingsProvider, setAppFavicon } from "./AppSettingsProvider";

vi.mock("@/lib/api", () => ({
  apiResourceUrl: vi.fn((path: string) => `http://api.test${path}`),
  getPublicSettings: vi.fn(),
}));
vi.mock("@/lib/labels", () => ({ setAppTimeZone: vi.fn() }));

const settingsResult = {
  settings: {
    workspaceName: "LiveBoard",
    workspaceSlug: "liveboard",
    timeZone: "Asia/Shanghai",
    faviconUrl: null,
    updatedAt: "2026-07-14T00:00:00.000Z",
  },
};

describe("AppSettingsProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.head
      .querySelectorAll("link[rel~='icon']")
      .forEach((link) => link.remove());
  });

  it("renders children and applies the workspace timezone", async () => {
    vi.mocked(getPublicSettings).mockResolvedValue(settingsResult);

    render(
      <AppSettingsProvider>
        <span>工作区内容</span>
      </AppSettingsProvider>,
    );

    expect(screen.getByText("工作区内容")).toBeInTheDocument();
    await waitFor(() =>
      expect(setAppTimeZone).toHaveBeenCalledWith("Asia/Shanghai"),
    );
    expect(
      document.head
        .querySelector<HTMLLinkElement>("link[data-liveboard-favicon='true']")
        ?.getAttribute("href"),
    ).toBe("/favicon.ico?v=liveboard-default-1");
  });

  it("keeps the cached timezone when public settings fail", async () => {
    vi.mocked(getPublicSettings).mockRejectedValue(new Error("offline"));

    render(<AppSettingsProvider>内容</AppSettingsProvider>);

    await waitFor(() => expect(getPublicSettings).toHaveBeenCalledTimes(1));
    expect(setAppTimeZone).not.toHaveBeenCalled();
  });

  it("installs the uploaded workspace favicon", async () => {
    vi.mocked(getPublicSettings).mockResolvedValue({
      settings: {
        ...settingsResult.settings,
        faviconUrl: "/settings/favicon?v=1",
      },
    });

    render(<AppSettingsProvider>内容</AppSettingsProvider>);

    await waitFor(() =>
      expect(
        document.head.querySelector<HTMLLinkElement>(
          "link[data-liveboard-favicon='true']",
        )?.href,
      ).toBe("http://api.test/settings/favicon?v=1"),
    );
    expect(apiResourceUrl).toHaveBeenCalledWith("/settings/favicon?v=1");
  });

  it("replaces the uploaded favicon with one consistent default URL", () => {
    setAppFavicon("/settings/favicon?v=1");
    setAppFavicon(null);

    expect(
      document.head
        .querySelector<HTMLLinkElement>("link[data-liveboard-favicon='true']")
        ?.getAttribute("href"),
    ).toBe("/favicon.ico?v=liveboard-default-1");
  });

  it("removes conflicting route-level favicon declarations", () => {
    const conflicting = document.createElement("link");
    conflicting.rel = "icon";
    conflicting.href = "/old-page-icon.png";
    document.head.appendChild(conflicting);

    setAppFavicon("/settings/favicon?v=2");

    expect(document.head.querySelectorAll("link[rel~='icon']")).toHaveLength(1);
  });

  it("does not update state after unmounting", async () => {
    let resolveSettings: ((value: typeof settingsResult) => void) | undefined;
    vi.mocked(getPublicSettings).mockReturnValue(
      new Promise((resolve) => {
        resolveSettings = resolve;
      }),
    );
    const view = render(<AppSettingsProvider>内容</AppSettingsProvider>);

    view.unmount();
    resolveSettings?.(settingsResult);
    await Promise.resolve();

    expect(setAppTimeZone).not.toHaveBeenCalled();
  });
});
