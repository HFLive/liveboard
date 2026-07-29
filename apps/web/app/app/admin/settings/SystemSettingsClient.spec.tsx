import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SystemSettingsClient } from "./SystemSettingsClient";

const apiMocks = vi.hoisted(() => ({
  configureHttpAccess: vi.fn(),
  disableHttps: vi.fn(),
  enableHttps: vi.fn(),
  getHttpsStatus: vi.fn(),
  getSystemSettings: vi.fn(),
  resetSystemFavicon: vi.fn(),
  setHttpsAutoRenew: vi.fn(),
  updateSystemSettings: vi.fn(),
  uploadSystemFavicon: vi.fn(),
}));

const readinessMocks = vi.hoisted(() => ({
  waitForWebReady: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  ...apiMocks,
  apiResourceUrl: (path: string) => path,
}));

vi.mock("@/lib/waitForWebReady", () => readinessMocks);

vi.mock("@/components/app-shell/AppSettingsProvider", () => ({
  setAppIconSettings: vi.fn(),
}));

describe("SystemSettingsClient HTTPS settings", () => {
  beforeEach(() => {
    readinessMocks.waitForWebReady.mockReturnValue(new Promise(() => {}));
    apiMocks.getSystemSettings.mockResolvedValue({
      settings: {
        workspaceName: "LiveBoard",
        workspaceSlug: "liveboard",
        timeZone: "Asia/Shanghai",
        faviconUrl: null,
        faviconLightUrl: null,
        faviconDarkUrl: null,
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
    apiMocks.configureHttpAccess.mockResolvedValue({
      https: {
        available: true,
        enabled: true,
        domain: "8.166.143.156",
        subjectType: "ip",
        challengeType: "tls-alpn-01",
        certificateProfile: "shortlived",
        autoRenewEnabled: true,
        httpHost: "8.166.143.156",
        httpPrimaryHost: "8.166.143.156",
        httpAllowedHosts: ["8.166.143.156", "board.example.com"],
        expiresAt: "2026-08-01T00:00:00.000Z",
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

  it("offers optional light and dark website icon variants", async () => {
    render(<SystemSettingsClient />);

    expect(await screen.findByText("默认图标")).toBeInTheDocument();
    expect(screen.getByText("浅色界面")).toBeInTheDocument();
    expect(screen.getByText("深色界面")).toBeInTheDocument();
    expect(screen.getAllByText("可选")).toHaveLength(2);
    expect(screen.getByLabelText("上传默认图标")).toBeInTheDocument();
    expect(screen.getByLabelText("上传浅色界面")).toBeInTheDocument();
    expect(screen.getByLabelText("上传深色界面")).toBeInTheDocument();
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
    await waitFor(() => {
      expect(readinessMocks.waitForWebReady).toHaveBeenCalledWith(
        "https://board.example.com",
      );
    });
    expect(await screen.findByText("HTTPS 已启用")).toBeInTheDocument();
    expect(
      screen.getByText(/续期验证时 HTTPS 可能短暂不可用/),
    ).toBeInTheDocument();
  });

  it("offers the confirmed HTTPS target when web readiness times out", async () => {
    readinessMocks.waitForWebReady.mockResolvedValueOnce(false);
    apiMocks.enableHttps.mockResolvedValueOnce({
      https: {
        available: true,
        enabled: true,
        domain: "8.166.143.156",
        subjectType: "ip",
        challengeType: "tls-alpn-01",
        certificateProfile: "shortlived",
        autoRenewEnabled: true,
        httpHost: null,
        httpPrimaryHost: "8.166.143.156",
        httpAllowedHosts: ["8.166.143.156"],
        expiresAt: "2026-08-01T00:00:00.000Z",
        lastRenewedAt: "2026-07-26T00:00:00.000Z",
        lastRenewalCheckAt: "2026-07-26T00:00:00.000Z",
        lastError: null,
      },
    });
    render(<SystemSettingsClient />);

    const domain = await screen.findByLabelText("网站域名或公网 IPv4");
    fireEvent.change(domain, { target: { value: "8.166.143.156" } });
    fireEvent.change(screen.getByLabelText("证书通知邮箱"), {
      target: { value: "admin@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "检查并启用 HTTPS" }));

    expect(
      await screen.findByText(/等待 Web 服务恢复超时/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "打开 HTTPS 管理页面" }),
    ).toHaveAttribute("href", "https://8.166.143.156/app/admin/settings");
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

    fireEvent.change(screen.getByLabelText("其他允许地址"), {
      target: { value: "board.example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存降级设置" }));
    await waitFor(() => {
      expect(apiMocks.configureHttpAccess).toHaveBeenCalledWith({
        primaryHost: "8.166.143.156",
        allowedHosts: ["8.166.143.156", "board.example.com"],
      });
    });
    fireEvent.click(screen.getByRole("button", { name: "停用 HTTPS" }));
    await waitFor(() => {
      expect(apiMocks.disableHttps).toHaveBeenCalledWith();
    });
  });

  it("applies HTTP access settings while HTTPS is disabled", async () => {
    const httpStatus = {
      available: true,
      enabled: false,
      domain: null,
      subjectType: null,
      challengeType: null,
      certificateProfile: null,
      autoRenewEnabled: false,
      httpHost: "8.166.143.156",
      httpPrimaryHost: "8.166.143.156",
      httpAllowedHosts: ["8.166.143.156"],
      expiresAt: null,
      lastRenewedAt: null,
      lastRenewalCheckAt: null,
      lastError: null,
    };
    apiMocks.getHttpsStatus.mockResolvedValueOnce({ https: httpStatus });
    apiMocks.configureHttpAccess.mockResolvedValueOnce({
      https: {
        ...httpStatus,
        httpAllowedHosts: ["8.166.143.156", "board.example.com"],
      },
    });
    render(<SystemSettingsClient />);

    await screen.findByText("HTTP 访问设置");
    fireEvent.change(screen.getByLabelText("其他允许地址"), {
      target: { value: "board.example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "应用 HTTP 设置" }));

    await waitFor(() => {
      expect(apiMocks.configureHttpAccess).toHaveBeenCalledWith({
        primaryHost: "8.166.143.156",
        allowedHosts: ["8.166.143.156", "board.example.com"],
      });
    });
    expect(readinessMocks.waitForWebReady).toHaveBeenCalledWith(
      "http://8.166.143.156",
    );
  });
});
