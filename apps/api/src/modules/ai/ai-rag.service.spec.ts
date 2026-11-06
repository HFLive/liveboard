import { AiRagService } from "./ai-rag.service";
import type { PrismaService } from "../prisma/prisma.service";
import type { AiSecretService } from "./ai-secret.service";

describe("RAG settings and secrets", () => {
  const stored = {
    workspaceId: "workspace",
    enabled: true,
    generation: "g1",
    providerName: "custom",
    baseUrl: "https://provider.test/v1",
    model: "embedding",
    apiKey: "encrypted:secret",
    dimensions: 2,
    leaseUntil: null,
  };
  const prisma = {
    user: { findUnique: jest.fn() },
    workspace: { findFirst: jest.fn() },
    aiRetrievalSettings: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
      updateMany: jest.fn(),
      create: jest.fn(),
    },
    aiDocumentIndex: { findFirst: jest.fn() },
    $queryRaw: jest.fn(),
  };
  let service: AiRagService;
  beforeEach(() => {
    jest.resetAllMocks();
    service = new AiRagService(
      prisma as unknown as PrismaService,
      {
        encrypt: (value: string) => "encrypted:" + value,
        decrypt: (value: string) => value.replace("encrypted:", ""),
      } as AiSecretService,
    );
    jest.spyOn(service, "scheduleSync").mockImplementation(() => {});
    prisma.user.findUnique.mockResolvedValue({
      systemRole: "super_admin",
      status: "active",
    });
    prisma.workspace.findFirst.mockResolvedValue({ id: "workspace" });
    prisma.aiRetrievalSettings.findUnique.mockResolvedValue(stored);
    prisma.aiRetrievalSettings.upsert.mockResolvedValue(stored);
    prisma.aiRetrievalSettings.updateMany.mockResolvedValue({ count: 1 });
    prisma.$queryRaw.mockResolvedValue([
      { total: 3, ready: 1, failed: 1, chunks: 5 },
    ]);
    prisma.aiDocumentIndex.findFirst.mockResolvedValue(null);
  });
  afterEach(() => jest.restoreAllMocks());

  it("returns status counts without returning the stored key", async () => {
    const settings = await service.getSettings("admin");
    expect(settings).toMatchObject({
      pendingDocuments: 1,
      indexedDocuments: 1,
      failedDocuments: 1,
      apiKeyConfigured: true,
    });
    expect(JSON.stringify(settings)).not.toContain("secret");
    expect(settings).not.toHaveProperty("apiKey");
  });

  it("denies members before reading provider settings", async () => {
    prisma.user.findUnique.mockResolvedValue({
      systemRole: "member",
      status: "active",
    });
    await expect(service.getSettings("member")).rejects.toThrow("最高管理员");
    expect(prisma.aiRetrievalSettings.upsert).not.toHaveBeenCalled();
  });

  it("never sends an existing provider key to a changed endpoint", async () => {
    const fetchMock = jest.spyOn(globalThis, "fetch");
    await expect(
      service.updateSettings("admin", {
        enabled: true,
        baseUrl: "https://other.test/v1",
      }),
    ).rejects.toThrow("API Key");
    expect(fetchMock).not.toHaveBeenCalled();
    await service.updateSettings("admin", {
      enabled: false,
      baseUrl: "https://other.test/v1",
    });
    expect(prisma.aiRetrievalSettings.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          apiKey: "",
          generation: expect.any(String),
        }),
      }),
    );
  });

  it("tests a new model and rotates the index generation before scheduling", async () => {
    jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(
          JSON.stringify({ data: [{ index: 0, embedding: [1, 0, 0] }] }),
        ),
      );
    await service.updateSettings("admin", {
      enabled: true,
      model: "new-model",
      apiKey: "new-secret",
    });
    expect(prisma.aiRetrievalSettings.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          apiKey: "encrypted:new-secret",
          dimensions: 3,
          generation: expect.any(String),
          leaseToken: null,
        }),
      }),
    );
    expect(service.scheduleSync).toHaveBeenCalledWith("workspace");
  });

  it("does not replace a working configuration when the probe fails", async () => {
    jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("fail", { status: 503 }));
    await expect(
      service.updateSettings("admin", { enabled: true, model: "bad" }),
    ).rejects.toThrow();
    expect(prisma.aiRetrievalSettings.upsert).not.toHaveBeenCalled();
    expect(prisma.aiRetrievalSettings.updateMany).not.toHaveBeenCalled();
  });

  it("can disable retrieval when the stored key can no longer be decrypted", async () => {
    const decrypt = jest.fn(() => {
      throw new Error("Invalid encryption key");
    });
    service = new AiRagService(
      prisma as unknown as PrismaService,
      {
        decrypt,
      } as unknown as AiSecretService,
    );
    const fetchMock = jest.spyOn(globalThis, "fetch");
    await service.updateSettings("admin", { enabled: false });
    expect(decrypt).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(prisma.aiRetrievalSettings.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ enabled: false }),
      }),
    );
  });

  it("rejects a stale save rather than mixing the endpoint, key and index generation", async () => {
    jest.spyOn(globalThis, "fetch").mockImplementation(async () => {
      prisma.aiRetrievalSettings.updateMany.mockResolvedValue({ count: 0 });
      return new Response(
        JSON.stringify({ data: [{ index: 0, embedding: [1, 0] }] }),
      );
    });
    await expect(
      service.updateSettings("admin", { enabled: true }),
    ).rejects.toThrow("配置已被修改");
    expect(prisma.aiRetrievalSettings.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          generation: "g1",
          baseUrl: stored.baseUrl,
          model: stored.model,
          dimensions: 2,
          apiKey: stored.apiKey,
        }),
      }),
    );
    expect(service.scheduleSync).not.toHaveBeenCalled();
  });
});
