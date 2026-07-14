import type { PrismaService } from "../prisma/prisma.service";
import { SettingsService } from "./settings.service";

describe("SettingsService", () => {
  const workspace = {
    id: "workspace-1",
    name: "LiveBoard",
    slug: "liveboard",
    timeZone: "Asia/Shanghai",
    updatedAt: new Date("2026-07-14T00:00:00Z"),
  };
  const prisma = {
    user: { findUnique: jest.fn() },
    workspace: { findFirst: jest.fn(), update: jest.fn() },
  };
  let service: SettingsService;

  beforeEach(() => {
    jest.resetAllMocks();
    service = new SettingsService(prisma as unknown as PrismaService);
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
