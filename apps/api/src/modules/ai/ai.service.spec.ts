import type { PermissionsService } from "../permissions/permissions.service";
import type { PrismaService } from "../prisma/prisma.service";
import { AiService } from "./ai.service";
import type { AiSecretService } from "./ai-secret.service";

describe("AiService", () => {
  const config = {
    id: "config-1",
    workspaceId: "workspace-1",
    name: "DeepSeek 主力配置",
    providerName: "DeepSeek",
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-chat",
    apiKey: "secret-key",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
  };
  const settings = {
    id: "settings-1",
    workspaceId: "workspace-1",
    enabled: true,
    activeConfigId: config.id,
    activeConfig: config,
    maxContextFiles: 6,
    maxContextChars: 12000,
    updatedById: "admin-1",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
  };
  const prisma = {
    user: { findUnique: jest.fn() },
    workspace: { findFirst: jest.fn() },
    aiSettings: { upsert: jest.fn(), update: jest.fn() },
    aiProviderConfig: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    file: { findMany: jest.fn() },
  };
  const permissions = { getEffectiveLevelsForFiles: jest.fn() };
  let service: AiService;

  beforeEach(() => {
    jest.resetAllMocks();
    service = new AiService(
      prisma as unknown as PrismaService,
      permissions as unknown as PermissionsService,
      {
        encrypt: (value: string) => `encrypted:${value}`,
        decrypt: (value: string) => value,
        isEncrypted: () => true,
      } as unknown as AiSecretService,
    );
    prisma.user.findUnique.mockResolvedValue({
      id: "admin-1",
      systemRole: "super_admin",
      status: "active",
    });
    prisma.workspace.findFirst.mockResolvedValue({ id: "workspace-1" });
    prisma.aiSettings.upsert.mockResolvedValue(settings);
    prisma.aiSettings.update.mockResolvedValue(settings);
    prisma.aiProviderConfig.findFirst.mockResolvedValue(config);
    prisma.aiProviderConfig.findMany.mockResolvedValue([config]);
    permissions.getEffectiveLevelsForFiles.mockResolvedValue(new Map());
  });

  it("uses the system temperature for the active configuration", async () => {
    (
      service as unknown as {
        buildContext: jest.Mock;
      }
    ).buildContext = jest.fn().mockResolvedValue([]);

    const prepared = await service.prepareQuestion(
      "user-1",
      "课程重点是什么？",
    );

    expect(prepared.settings).toEqual(
      expect.objectContaining({
        baseUrl: config.baseUrl,
        model: config.model,
        temperature: 0.2,
      }),
    );
  });

  it("resolves AI context permissions in one batch", async () => {
    prisma.file.findMany.mockResolvedValue([
      {
        id: "file-1",
        title: "课程介绍",
        type: "doc",
        status: "published",
        updatedAt: new Date("2026-01-01T00:00:00Z"),
        blocks: [
          { id: "block-1", type: "paragraph", dataJson: { text: "重点" } },
        ],
      },
    ]);
    permissions.getEffectiveLevelsForFiles.mockResolvedValue(
      new Map([["file-1", "viewer"]]),
    );

    const prepared = await service.prepareQuestion("user-1", "课程重点");

    expect(prepared.sources).toHaveLength(1);
    expect(permissions.getEffectiveLevelsForFiles).toHaveBeenCalledWith(
      "user-1",
      ["file-1"],
    );
  });

  it("does not delete the active provider configuration", async () => {
    await expect(
      service.deleteProviderConfig("admin-1", config.id),
    ).rejects.toThrow("请先切换当前配置，再删除该配置");
    expect(prisma.aiProviderConfig.delete).not.toHaveBeenCalled();
  });

  it("switches the active provider configuration explicitly", async () => {
    const result = await service.activateProviderConfig("admin-1", config.id);

    expect(prisma.aiSettings.update).toHaveBeenCalledWith({
      where: { id: settings.id },
      data: { activeConfigId: config.id, updatedById: "admin-1" },
      include: { activeConfig: true },
    });
    expect(result.activeConfigId).toBe(config.id);
  });
});
