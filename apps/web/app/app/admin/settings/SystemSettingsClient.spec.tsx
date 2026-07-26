import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SystemSettingsClient } from "./SystemSettingsClient";

const apiMocks = vi.hoisted(() => ({
  enableHttps: vi.fn(),
  getHttpsStatus: vi.fn(),
  getSystemSettings: vi.fn(),
  resetSystemFavicon: vi.fn(),
  updateSystemSettings: vi.fn(),
  uploadSystemFavicon: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  ...apiMocks,
  apiResourceUrl: (path: string) => path,
}));

vi.mock("@/components/app-shell/AppSettingsProvider", () => ({
  setAppFavicon: vi.fn(),
}));

describe("SystemSettingsClient HTTPS settings", () => {
  beforeEach(() => {
    apiMocks.getSystemSettings.mockResolvedValue({
      settings: {
        workspaceName: "LiveBoard",
        workspaceSlug: "liveboard",
        timeZone: "Asia/Shanghai",
        faviconUrl: null,
        updatedAt: "2026-07-26T00:00:00.000Z",
      },
    });
    apiMocks.getHttpsStatus.mockResolvedValue({
      https: {
        available: true,
        enabled: false,
        domain: null,
        expiresAt: null,
        lastRenewedAt: null,
        lastRenewalCheckAt: null,
        lastError: null,
      },
    });
    apiMocks.enableHttps.mockResolvedValue({
      https: {
        available: true,
        enabled: true,
        domain: "board.example.com",
        expiresAt: "2026-10-24T00:00:00.000Z",
        lastRenewedAt: "2026-07-26T00:00:00.000Z",
        lastRenewalCheckAt: "2026-07-26T00:00:00.000Z",
        lastError: null,
      },
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("enables provider-neutral HTTPS from the system settings form", async () => {
    render(<SystemSettingsClient />);

    const domain = await screen.findByLabelText("网站域名");
    fireEvent.change(domain, { target: { value: "board.example.com" } });
    fireEvent.change(screen.getByLabelText("证书通知邮箱"), {
      target: { value: "admin@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "检查并启用 HTTPS" }));

    await waitFor(() => {
      expect(apiMocks.enableHttps).toHaveBeenCalledWith({
        domain: "board.example.com",
        email: "admin@example.com",
      });
    });
    expect(await screen.findByText("HTTPS 已启用")).toBeInTheDocument();
  });
});
