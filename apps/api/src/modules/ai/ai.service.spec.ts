import type { PermissionsService } from "../permissions/permissions.service";
import type { PrismaService } from "../prisma/prisma.service";
import { AiService } from "./ai.service";
import type { AiSecretService } from "./ai-secret.service";
import { formatDateKey } from "../../common/date-key";

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
    defaultCallLimit: 100,
    updatedById: "admin-1",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
  };
  const prisma = {
    user: { findUnique: jest.fn(), updateMany: jest.fn() },
    workspace: { findFirst: jest.fn() },
    aiSettings: { upsert: jest.fn(), update: jest.fn() },
    aiProviderConfig: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    aiConversation: { findUnique: jest.fn() },
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
    prisma.user.updateMany.mockResolvedValue({ count: 1 });
    prisma.workspace.findFirst.mockResolvedValue({
      id: "workspace-1",
      timeZone: "Asia/Shanghai",
    });
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

  it("does not retrieve documents for a greeting", async () => {
    const buildContext = jest.fn().mockResolvedValue([]);
    (
      service as unknown as {
        buildContext: jest.Mock;
      }
    ).buildContext = buildContext;

    const prepared = await service.prepareQuestion("user-1", "你好");

    expect(buildContext).not.toHaveBeenCalled();
    expect(prepared.contextText).toBe("");
    expect(prepared.sources).toEqual([]);
  });

  it("uses the workspace timezone for the daily quota date", () => {
    expect(
      formatDateKey(new Date("2026-07-18T16:30:00.000Z"), "Asia/Shanghai"),
    ).toBe("2026-07-19");
  });

  it("resets stale usage before consuming the daily quota", async () => {
    prisma.user.findUnique.mockResolvedValue({
      aiCallCount: 99,
      aiCallLimit: null,
      aiCallDateKey: "2026-07-18",
    });

    await service.consumeCallQuota("user-1");

    expect(prisma.user.updateMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        data: expect.objectContaining({ aiCallCount: 0 }),
      }),
    );
    expect(prisma.user.updateMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        data: { aiCallCount: { increment: 1 } },
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

  it("excludes published documents with no relevant keyword match", async () => {
    prisma.file.findMany.mockResolvedValue([
      {
        id: "file-1",
        title: "课程介绍",
        type: "doc",
        status: "published",
        updatedAt: new Date("2026-01-01T00:00:00Z"),
        blocks: [
          { id: "block-1", type: "paragraph", dataJson: { text: "课程重点" } },
        ],
      },
    ]);
    permissions.getEffectiveLevelsForFiles.mockResolvedValue(
      new Map([["file-1", "viewer"]]),
    );

    const prepared = await service.prepareQuestion("user-1", "设备清单");

    expect(prepared.sources).toEqual([]);
    expect(prepared.contextText).toBe("");
  });

  it("keeps only explicitly cited sources and removes citation markers", () => {
    const sources = [
      {
        id: "file-1",
        title: "资料一",
        type: "doc",
        updatedAt: "2026-07-19T00:00:00.000Z",
        blocks: [],
      },
      {
        id: "file-2",
        title: "资料二",
        type: "doc",
        updatedAt: "2026-07-19T00:00:00.000Z",
        blocks: [],
      },
    ];

    expect(
      service.finalizeGeneratedAnswer("第一项结论。[资料2]", sources),
    ).toEqual({
      answer: "第一项结论。",
      sources: [sources[1]],
    });
  });

  it("marks deleted and inaccessible historical sources as unavailable", async () => {
    prisma.aiConversation.findUnique.mockResolvedValue({
      id: "conversation-1",
      userId: "user-1",
      title: "历史对话",
      createdAt: new Date("2026-07-15T00:00:00Z"),
      updatedAt: new Date("2026-07-15T00:00:00Z"),
      messages: [
        {
          id: "message-1",
          role: "assistant",
          content: "回答",
          createdAt: new Date("2026-07-15T00:00:00Z"),
          sourcesJson: [
            { id: "file-1", title: "可查看", type: "doc", updatedAt: "" },
            { id: "file-2", title: "无权限", type: "doc", updatedAt: "" },
            { id: "file-3", title: "已删除", type: "doc", updatedAt: "" },
          ],
        },
      ],
    });
    prisma.file.findMany.mockResolvedValue([
      { id: "file-1", status: "published" },
      { id: "file-2", status: "draft" },
    ]);
    permissions.getEffectiveLevelsForFiles.mockResolvedValue(
      new Map([
        ["file-1", "viewer"],
        ["file-2", "viewer"],
      ]),
    );

    const conversation = await service.getConversation(
      "user-1",
      "conversation-1",
    );

    expect(
      conversation.messages[0]?.sources.map((source) => ({
        id: source.id,
        unavailable: source.unavailable,
      })),
    ).toEqual([
      { id: "file-1", unavailable: undefined },
      { id: "file-2", unavailable: true },
      { id: "file-3", unavailable: true },
    ]);
    expect(permissions.getEffectiveLevelsForFiles).toHaveBeenCalledWith(
      "user-1",
      ["file-1", "file-2"],
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
