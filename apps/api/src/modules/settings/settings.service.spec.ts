import type { PrismaService } from "../prisma/prisma.service";
import type { ConfigService } from "@nestjs/config";
import { SettingsService } from "./settings.service";

describe("SettingsService", () => {
  const workspace = {
    id: "workspace-1",
    name: "LiveBoard",
    slug: "liveboard",
    timeZone: "Asia/Shanghai",
    faviconStorageKey: null,
    faviconMimeType: null,
    faviconUpdatedAt: null,
    updatedAt: new Date("2026-07-14T00:00:00Z"),
  };
  const prisma = {
    user: { findUnique: jest.fn() },
    workspace: { findFirst: jest.fn(), update: jest.fn() },
  };
  let service: SettingsService;
  const minio = {
    bucketExists: jest.fn(),
    makeBucket: jest.fn(),
    putObject: jest.fn(),
    removeObject: jest.fn(),
  };
  const config = {
    get: jest.fn((_key: string, fallback: unknown) => fallback),
  };

  beforeEach(() => {
    jest.resetAllMocks();
    config.get.mockImplementation(
      (_key: string, fallback: unknown) => fallback,
    );
    service = new SettingsService(
      prisma as unknown as PrismaService,
      config as unknown as ConfigService,
    );
    Object.assign(service as unknown as { minio: typeof minio }, { minio });
    minio.bucketExists.mockResolvedValue(true);
    minio.putObject.mockResolvedValue({ etag: "etag", versionId: null });
    minio.removeObject.mockResolvedValue(undefined);
    prisma.workspace.findFirst.mockResolvedValue(workspace);
    prisma.user.findUnique.mockResolvedValue({
      id: "admin-1",
      systemRole: "super_admin",
      status: "active",
    });
  });

  it("serves public workspace settings", async () => {
    await expect(service.getPublicSettings()).resolves.toEqual({
      workspaceName: "LiveBoard",
      workspaceSlug: "liveboard",
      timeZone: "Asia/Shanghai",
      faviconUrl: null,
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

    expect(minio.putObject).toHaveBeenCalledWith(
      "liveboard-assets",
      expect.stringMatching(/^site\/favicon\/.+\.png$/),
      buffer,
      buffer.length,
      { "Content-Type": "image/png" },
    );
    expect(result.faviconUrl).toBe(
      `/settings/favicon?v=${new Date("2026-07-23T15:00:00Z").getTime()}`,
    );
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
    expect(minio.removeObject).toHaveBeenCalledWith(
      "liveboard-assets",
      "site/favicon/old.png",
    );
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
});
