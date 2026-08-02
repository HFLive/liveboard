import type { PrismaService } from "../prisma/prisma.service";
import type { StorageService } from "../storage/storage.service";
import type { HttpsAgentClient } from "./https-agent.client";
import { SettingsService } from "./settings.service";
import { PRIVATE_SHORT_CACHE_CONTROL } from "../../common/cache-control";

describe("SettingsService", () => {
  const workspace = {
    id: "workspace-1",
    name: "LiveBoard",
    slug: "liveboard",
    timeZone: "Asia/Shanghai",
    faviconStorageKey: null,
    faviconMimeType: null,
    faviconUpdatedAt: null,
    faviconStorageBackend: "minio" as const,
    faviconLightStorageKey: null,
    faviconLightMimeType: null,
    faviconLightUpdatedAt: null,
    faviconLightStorageBackend: "minio" as const,
    faviconDarkStorageKey: null,
    faviconDarkMimeType: null,
    faviconDarkUpdatedAt: null,
    faviconDarkStorageBackend: "minio" as const,
    updatedAt: new Date("2026-07-14T00:00:00Z"),
  };
  const prisma = {
    user: { findUnique: jest.fn() },
    workspace: { findFirst: jest.fn(), update: jest.fn() },
  };
  let service: SettingsService;
  const backend = {
    name: "minio" as const,
    putObject: jest.fn(),
    getObject: jest.fn(),
    removeObject: jest.fn(),
    presignGet: jest.fn(),
    healthCheck: jest.fn(),
  };
  const storage = {
    activeBackend: jest.fn(),
    backendFor: jest.fn(),
    presignDownload: jest.fn(),
    healthCheckActive: jest.fn(),
  };
  const httpsAgent = {
    status: jest.fn(),
    enable: jest.fn(),
    disable: jest.fn(),
    configureHttpAccess: jest.fn(),
    setAutoRenew: jest.fn(),
  };

  beforeEach(() => {
    jest.resetAllMocks();
    backend.putObject.mockResolvedValue(undefined);
    backend.removeObject.mockResolvedValue(undefined);
    backend.presignGet.mockResolvedValue(null);
    storage.activeBackend.mockResolvedValue(backend);
    storage.backendFor.mockResolvedValue(backend);
    storage.presignDownload.mockResolvedValue(null);
    service = new SettingsService(
      prisma as unknown as PrismaService,
      httpsAgent as unknown as HttpsAgentClient,
      storage as unknown as StorageService,
    );
    backend.healthCheck.mockResolvedValue(undefined);
    prisma.workspace.findFirst.mockResolvedValue(workspace);
    prisma.user.findUnique.mockResolvedValue({
      id: "admin-1",
      systemRole: "super_admin",
      status: "active",
    });
    httpsAgent.status.mockResolvedValue({
      available: true,
      enabled: false,
      domain: null,
      subjectType: null,
      challengeType: null,
      certificateProfile: null,
      autoRenewEnabled: false,
      httpHost: null,
      httpPrimaryHost: null,
      httpAllowedHosts: [],
      expiresAt: null,
      lastRenewedAt: null,
      lastRenewalCheckAt: null,
      lastError: null,
    });
    httpsAgent.enable.mockResolvedValue({
      available: true,
      enabled: true,
      domain: "board.example.com",
      subjectType: "domain",
      challengeType: "tls-alpn-01",
      certificateProfile: null,
      autoRenewEnabled: true,
      httpHost: null,
      httpPrimaryHost: "board.example.com",
      httpAllowedHosts: ["board.example.com"],
      expiresAt: "2026-10-24T00:00:00Z",
      lastRenewedAt: "2026-07-26T00:00:00Z",
      lastRenewalCheckAt: "2026-07-26T00:00:00Z",
      lastError: null,
    });
    httpsAgent.disable.mockResolvedValue({
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
    });
    httpsAgent.setAutoRenew.mockResolvedValue({
      available: true,
      enabled: true,
      domain: "board.example.com",
      subjectType: "domain",
      challengeType: "tls-alpn-01",
      certificateProfile: null,
      autoRenewEnabled: false,
      httpHost: null,
      httpPrimaryHost: "board.example.com",
      httpAllowedHosts: ["board.example.com"],
      expiresAt: "2026-10-24T00:00:00Z",
      lastRenewedAt: "2026-07-26T00:00:00Z",
      lastRenewalCheckAt: "2026-07-26T00:00:00Z",
      lastError: null,
    });
  });

  it("serves public workspace settings", async () => {
    await expect(service.getPublicSettings()).resolves.toEqual({
      workspaceName: "LiveBoard",
      workspaceSlug: "liveboard",
      timeZone: "Asia/Shanghai",
      faviconUrl: null,
      faviconLightUrl: null,
      faviconDarkUrl: null,
      updatedAt: "2026-07-14T00:00:00.000Z",
    });
  });

  it("normalizes and persists an IANA timezone for a super admin", async () => {
    prisma.workspace.update.mockResolvedValue({
      ...workspace,
      timeZone: "Europe/London",
    });

    await service.updateSettings("admin-1", { timeZone: " Europe/London " });

    expect(prisma.workspace.update).toHaveBeenCalledWith({
      where: { id: "workspace-1" },
      data: { timeZone: "Europe/London" },
    });
  });

  it("rejects invalid timezones", async () => {
    await expect(
      service.updateSettings("admin-1", { timeZone: "Mars/Olympus" }),
    ).rejects.toThrow("无效的 IANA 时区标识");
    expect(prisma.workspace.update).not.toHaveBeenCalled();
  });

  it("stores a validated favicon and publishes a versioned URL", async () => {
    prisma.workspace.update.mockResolvedValue({
      ...workspace,
      faviconStorageKey: "site/favicon/new.png",
      faviconMimeType: "image/png",
      faviconUpdatedAt: new Date("2026-07-23T15:00:00Z"),
      updatedAt: new Date("2026-07-23T15:00:00Z"),
    });
    const buffer = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);

    const result = await service.updateFavicon("admin-1", {
      originalname: "icon.png",
      mimetype: "image/png",
      size: buffer.length,
      buffer,
    });

    expect(backend.putObject).toHaveBeenCalledWith(
      expect.stringMatching(/^site\/favicon\/default\/.+\.png$/),
      buffer,
      "image/png",
    );
    expect(result.faviconUrl).toBe(
      `/settings/favicon?v=${new Date("2026-07-23T15:00:00Z").getTime()}`,
    );
  });

  it("gives a signed favicon response the same short browser cache", async () => {
    prisma.workspace.findFirst.mockResolvedValue({
      ...workspace,
      faviconStorageKey: "site/favicon/current.png",
      faviconMimeType: "image/png",
      faviconUpdatedAt: new Date("2026-08-02T00:00:00Z"),
      faviconStorageBackend: "r2",
    });
    storage.presignDownload.mockResolvedValue(
      "https://r2.example/signed-favicon",
    );

    await expect(service.getFavicon()).resolves.toMatchObject({
      redirectUrl: "https://r2.example/signed-favicon",
      stream: null,
    });
    expect(storage.presignDownload).toHaveBeenCalledWith(
      "r2",
      "site/favicon/current.png",
      {
        filename: "favicon",
        mimeType: "image/png",
        inline: true,
        cacheControl: PRIVATE_SHORT_CACHE_CONTROL,
      },
    );
  });

  it("stores an optional dark icon without replacing the default icon", async () => {
    prisma.workspace.update.mockResolvedValue({
      ...workspace,
      faviconDarkStorageKey: "site/favicon/dark/new.png",
      faviconDarkMimeType: "image/png",
      faviconDarkUpdatedAt: new Date("2026-07-23T15:00:00Z"),
      updatedAt: new Date("2026-07-23T15:00:00Z"),
    });
    const buffer = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);

    const result = await service.updateFavicon(
      "admin-1",
      {
        originalname: "icon-dark.png",
        mimetype: "image/png",
        size: buffer.length,
        buffer,
      },
      "dark",
    );

    expect(backend.putObject).toHaveBeenCalledWith(
      expect.stringMatching(/^site\/favicon\/dark\/.+\.png$/),
      buffer,
      "image/png",
    );
    expect(prisma.workspace.update).toHaveBeenCalledWith({
      where: { id: "workspace-1" },
      data: expect.objectContaining({
        faviconDarkStorageKey: expect.stringMatching(
          /^site\/favicon\/dark\/.+\.png$/,
        ),
        faviconDarkMimeType: "image/png",
        faviconDarkStorageBackend: "minio",
      }),
    });
    expect(result.faviconDarkUrl).toContain("/settings/favicon/dark?v=");
    expect(result.faviconUrl).toBeNull();
  });

  it("resets the favicon to the browser default and removes the stored object", async () => {
    prisma.workspace.findFirst.mockResolvedValue({
      ...workspace,
      faviconStorageKey: "site/favicon/old.png",
      faviconMimeType: "image/png",
      faviconUpdatedAt: new Date("2026-07-23T15:00:00Z"),
    });
    prisma.workspace.update.mockResolvedValue({
      ...workspace,
      updatedAt: new Date("2026-07-23T16:00:00Z"),
    });

    const result = await service.resetFavicon("admin-1");

    expect(prisma.workspace.update).toHaveBeenCalledWith({
      where: { id: "workspace-1" },
      data: {
        faviconStorageKey: null,
        faviconMimeType: null,
        faviconUpdatedAt: null,
      },
    });
    expect(backend.removeObject).toHaveBeenCalledWith("site/favicon/old.png");
    expect(result.faviconUrl).toBeNull();
  });

  it("rejects settings changes from ordinary members", async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: "user-1",
      systemRole: "member",
      status: "active",
    });

    await expect(
      service.updateSettings("user-1", { timeZone: "UTC" }),
    ).rejects.toThrow("Only super administrators");
  });

  it("returns HTTPS host status only to a super administrator", async () => {
    await expect(service.getHttpsStatus("admin-1")).resolves.toMatchObject({
      available: true,
      enabled: false,
    });
    expect(httpsAgent.status).toHaveBeenCalledTimes(1);
  });

  it("normalizes HTTPS inputs before calling the host agent", async () => {
    await service.enableHttps(
      "admin-1",
      " board.example.com ",
      " admin@example.com ",
    );

    expect(httpsAgent.enable).toHaveBeenCalledWith(
      "board.example.com",
      "admin@example.com",
    );
  });

  it("allows the host agent to use the saved HTTP settings when disabling HTTPS", async () => {
    await service.disableHttps("admin-1");

    expect(httpsAgent.disable).toHaveBeenCalledWith(undefined);
  });

  it("normalizes a legacy HTTP fallback host before disabling HTTPS", async () => {
    await service.disableHttps("admin-1", " 8.166.143.156 ");

    expect(httpsAgent.disable).toHaveBeenCalledWith("8.166.143.156");
  });

  it("normalizes and saves HTTP access settings through the host agent", async () => {
    await service.configureHttpAccess("admin-1", " 8.166.143.156 ", [
      " board.example.com ",
      " ",
    ]);

    expect(httpsAgent.configureHttpAccess).toHaveBeenCalledWith(
      "8.166.143.156",
      ["board.example.com"],
    );
  });

  it("updates automatic renewal through the host agent", async () => {
    await service.setHttpsAutoRenew("admin-1", false);

    expect(httpsAgent.setAutoRenew).toHaveBeenCalledWith(false);
  });
});
