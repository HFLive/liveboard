import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SystemSettingsClient } from "./SystemSettingsClient";

const apiMocks = vi.hoisted(() => ({
  disableHttps: vi.fn(),
  enableHttps: vi.fn(),
  getHttpsStatus: vi.fn(),
  getSystemSettings: vi.fn(),
  resetSystemFavicon: vi.fn(),
  setHttpsAutoRenew: vi.fn(),
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
        subjectType: null,
        challengeType: null,
        certificateProfile: null,
        autoRenewEnabled: false,
        httpHost: null,
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
        subjectType: "domain",
        challengeType: "tls-alpn-01",
        certificateProfile: null,
        autoRenewEnabled: true,
        httpHost: null,
        expiresAt: "2026-10-24T00:00:00.000Z",
        lastRenewedAt: "2026-07-26T00:00:00.000Z",
        lastRenewalCheckAt: "2026-07-26T00:00:00.000Z",
        lastError: null,
      },
    });
    apiMocks.setHttpsAutoRenew.mockResolvedValue({
      https: {
        available: true,
        enabled: true,
        domain: "board.example.com",
        subjectType: "domain",
        challengeType: "tls-alpn-01",
        certificateProfile: null,
        autoRenewEnabled: false,
        httpHost: null,
        expiresAt: "2026-10-24T00:00:00.000Z",
        lastRenewedAt: "2026-07-26T00:00:00.000Z",
        lastRenewalCheckAt: "2026-07-26T00:00:00.000Z",
        lastError: null,
      },
    });
    apiMocks.disableHttps.mockResolvedValue({
      https: {
        available: true,
        enabled: false,
        domain: null,
        subjectType: null,
        challengeType: null,
        certificateProfile: null,
        autoRenewEnabled: false,
        httpHost: "8.166.143.156",
        expiresAt: null,
        lastRenewedAt: null,
        lastRenewalCheckAt: null,
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

    const domain = await screen.findByLabelText("网站域名或公网 IPv4");
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
    expect(
      screen.getByText(/续期验证时 HTTPS 可能短暂不可用/),
    ).toBeInTheDocument();
  });

  it("toggles renewal and disables HTTPS to the selected HTTP host", async () => {
    apiMocks.getHttpsStatus.mockResolvedValueOnce({
      https: {
        available: true,
        enabled: true,
        domain: "8.166.143.156",
        subjectType: "ip",
        challengeType: "tls-alpn-01",
        certificateProfile: "shortlived",
        autoRenewEnabled: true,
        httpHost: null,
        expiresAt: "2026-08-01T00:00:00.000Z",
        lastRenewedAt: "2026-07-26T00:00:00.000Z",
        lastRenewalCheckAt: "2026-07-26T00:00:00.000Z",
        lastError: null,
      },
    });
    render(<SystemSettingsClient />);

    const renewal = await screen.findByRole("checkbox", {
      name: "自动续期",
    });
    fireEvent.click(renewal);
    await waitFor(() => {
      expect(apiMocks.setHttpsAutoRenew).toHaveBeenCalledWith(false);
    });

    fireEvent.change(screen.getByLabelText("停用后的 HTTP 访问地址"), {
      target: { value: "8.166.143.156" },
    });
    fireEvent.click(screen.getByRole("button", { name: "停用 HTTPS" }));
    await waitFor(() => {
      expect(apiMocks.disableHttps).toHaveBeenCalledWith({
        httpHost: "8.166.143.156",
      });
    });
  });
});
