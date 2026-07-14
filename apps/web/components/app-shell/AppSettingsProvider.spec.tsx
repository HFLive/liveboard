import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getPublicSettings } from "@/lib/api";
import { setAppTimeZone } from "@/lib/labels";
import { AppSettingsProvider } from "./AppSettingsProvider";

vi.mock("@/lib/api", () => ({ getPublicSettings: vi.fn() }));
vi.mock("@/lib/labels", () => ({ setAppTimeZone: vi.fn() }));

const settingsResult = {
  settings: {
    workspaceName: "LiveBoard",
    workspaceSlug: "liveboard",
    timeZone: "Asia/Shanghai",
    updatedAt: "2026-07-14T00:00:00.000Z",
  },
};

describe("AppSettingsProvider", () => {
  beforeEach(() => vi.clearAllMocks());

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
  });

  it("keeps the cached timezone when public settings fail", async () => {
    vi.mocked(getPublicSettings).mockRejectedValue(new Error("offline"));

    render(<AppSettingsProvider>内容</AppSettingsProvider>);

    await waitFor(() => expect(getPublicSettings).toHaveBeenCalledTimes(1));
    expect(setAppTimeZone).not.toHaveBeenCalled();
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
