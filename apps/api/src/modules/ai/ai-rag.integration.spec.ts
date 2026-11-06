import { ConfigService } from "@nestjs/config";
import { randomUUID } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import { PermissionsService } from "../permissions/permissions.service";
import type { HfliveAuthConfig } from "../hflive-auth/hflive-auth.config";
import { AiSecretService } from "./ai-secret.service";
import { AiRagService } from "./ai-rag.service";
import { AiService } from "./ai.service";

// Run only against a disposable PostgreSQL database after prisma migrate deploy.
const integration =
  process.env.RUN_RAG_TESTS === "true" ? describe : describe.skip;
integration("RAG with real PostgreSQL + pgvector", () => {
  const namespace = "rag-test-" + randomUUID();
  let prisma: PrismaService;
  let rag: AiRagService;
  let ai: AiService;
  let workspaceId: string;
  let folderId: string;
  let adminId: string;
  let memberId: string;
  let hook: ((inputs: string[]) => Promise<void>) | undefined;
  let failBatch = 0;
  let calls: string[][] = [];
  const secrets = new AiSecretService(
    new ConfigService({ AI_ENCRYPTION_KEY: "isolated-rag-test-key" }),
  );

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    const workspace = await prisma.workspace.create({
      data: { name: namespace, slug: namespace, createdAt: new Date(0) },
    });
    workspaceId = workspace.id;
    const admin = await prisma.user.create({
      data: {
        username: namespace + "-admin",
        displayName: "测试管理员",
        passwordHash: "unused",
        systemRole: "super_admin",
      },
    });
    const member = await prisma.user.create({
      data: {
        username: namespace + "-member",
        displayName: "测试成员",
        passwordHash: "unused",
        systemRole: "member",
      },
    });
    adminId = admin.id;
    memberId = member.id;
    folderId = (
      await prisma.folder.create({
        data: { workspaceId, name: "测试资料", createdById: adminId },
      })
    ).id;
    const config = await prisma.aiProviderConfig.create({
      data: {
        workspaceId,
        name: "测试回答",
        providerName: "custom",
        baseUrl: "https://embedding.test/v1",
        model: "test-chat",
        apiKey: secrets.encrypt("test-key"),
      },
    });
    await prisma.aiSettings.create({
      data: { workspaceId, enabled: true, activeConfigId: config.id },
    });
    rag = new AiRagService(prisma, secrets);
    jest.spyOn(rag, "scheduleSync").mockImplementation(() => {});
    ai = new AiService(
      prisma,
      new PermissionsService(prisma, { enabled: false } as HfliveAuthConfig),
      secrets,
      rag,
    );
    jest.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const { input } = JSON.parse(init!.body as string) as { input: string[] };
      calls.push(input);
      if (calls.length === failBatch) throw new Error("provider offline");
      await hook?.(input);
      return new Response(
        JSON.stringify({
          data: input.map((_text, index) => ({ index, embedding: [1, 0, 0] })),
        }),
      );
    });
  });

  beforeEach(async () => {
    calls = [];
    hook = undefined;
    failBatch = 0;
    await prisma.permissionGrant.deleteMany({ where: { workspaceId } });
    await prisma.file.deleteMany({ where: { workspaceId } });
    const data = {
      enabled: true,
      baseUrl: "https://embedding.test/v1",
      model: "embedding-test",
      apiKey: secrets.encrypt("test-key"),
      dimensions: 3,
      generation: randomUUID(),
      leaseToken: null,
      leaseUntil: null,
    };
    await prisma.aiRetrievalSettings.upsert({
      where: { workspaceId },
      create: { workspaceId, ...data },
      update: data,
    });
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    if (prisma) {
      await prisma.aiSettings.deleteMany({ where: { workspaceId } });
      await prisma.aiProviderConfig.deleteMany({ where: { workspaceId } });
      await prisma.folder.deleteMany({ where: { workspaceId } });
      await prisma.workspace.delete({ where: { id: workspaceId } });
      await prisma.user.deleteMany({
        where: { id: { in: [adminId, memberId] } },
      });
      await prisma.$disconnect();
    }
  });

  async function document(
    text = "显示设备发生故障，请检查电源接线。",
    count = 1,
  ) {
    return prisma.file.create({
      data: {
        workspaceId,
        folderId,
        title: "检修手册",
        type: "doc",
        status: "published",
        createdById: adminId,
        updatedById: adminId,
        blocks: {
          create: Array.from({ length: count }, (_, index) => ({
            type: "paragraph",
            sortOrder: index,
            dataJson: { text: text + " 段落" + index },
            createdById: adminId,
            updatedById: adminId,
          })),
        },
      },
    });
  }

  it("answers a synonym query using fresh vectors and real permission resolution", async () => {
    const file = await document();
    await rag.syncPending(workspaceId);
    const prepared = await ai.prepareQuestion(memberId, "画面突然黑了");
    expect(prepared.sources.map((source) => source.id)).toEqual([file.id]);
    expect(prepared.contextText).toContain("检查电源接线");
  });

  it("keeps a newer configuration when another save finishes during the probe", async () => {
    const replacement = {
      baseUrl: "https://replacement.test/v1",
      apiKey: secrets.encrypt("replacement-key"),
      generation: randomUUID(),
    };
    hook = async () => {
      await prisma.aiRetrievalSettings.update({
        where: { workspaceId },
        data: replacement,
      });
    };
    await expect(
      rag.updateSettings(adminId, { enabled: true }),
    ).rejects.toThrow("配置已被修改");
    expect(
      await prisma.aiRetrievalSettings.findUnique({ where: { workspaceId } }),
    ).toMatchObject(replacement);
  });

  it("filters authorized IDs before taking top-k, even with more than 80 other matches", async () => {
    const allowed = await document();
    for (let index = 0; index < 82; index += 1) await document("其他资料");
    await rag.syncPending(workspaceId);
    const hits = await rag.search(workspaceId, [allowed.id], "画面突然黑了");
    expect(hits).toHaveLength(1);
    expect(hits[0]?.fileId).toBe(allowed.id);
  });

  it("rechecks permissions changed during the embedding request", async () => {
    const file = await document();
    await rag.syncPending(workspaceId);
    hook = async () => {
      await prisma.permissionGrant.create({
        data: {
          workspaceId,
          targetType: "file",
          targetId: file.id,
          userId: memberId,
          createdById: adminId,
          level: "no_access",
        },
      });
    };
    const prepared = await ai.prepareQuestion(memberId, "画面突然黑了");
    expect(prepared.sources).toEqual([]);
    expect(prepared.contextText).toBe("");
  });

  it("excludes old versions immediately, rebuilds, and cascade-deletes vectors", async () => {
    const file = await document();
    await rag.syncPending(workspaceId);
    await prisma.file.update({
      where: { id: file.id },
      data: { title: "新版检修手册", version: { increment: 1 } },
    });
    expect(await rag.search(workspaceId, [file.id], "故障")).toEqual([]);
    await rag.syncPending(workspaceId);
    expect(await rag.search(workspaceId, [file.id], "故障")).toHaveLength(1);
    await prisma.file.delete({ where: { id: file.id } });
    expect(
      await prisma.aiDocumentChunk.count({ where: { fileId: file.id } }),
    ).toBe(0);
  });

  it("resumes a failed long document from its persisted chunk cursor", async () => {
    const file = await document("分段资料", 25);
    failBatch = 2;
    await rag.syncPending(workspaceId);
    expect(
      await prisma.aiDocumentIndex.findUnique({ where: { fileId: file.id } }),
    ).toMatchObject({ status: "error", nextChunk: 16 });
    await prisma.aiDocumentIndex.update({
      where: { fileId: file.id },
      data: { retryAfter: null },
    });
    failBatch = 0;
    calls = [];
    await rag.syncPending(workspaceId);
    expect(calls[0]).toHaveLength(9);
    expect(calls[0]?.[0]).toContain("段落16");
    expect(
      await prisma.aiDocumentChunk.count({ where: { fileId: file.id } }),
    ).toBe(25);
    expect(
      await prisma.aiDocumentIndex.findUnique({ where: { fileId: file.id } }),
    ).toMatchObject({ status: "ready", nextChunk: 25 });
  });

  it("fences a worker when the model changes while embeddings are being generated", async () => {
    const file = await document();
    hook = async () => {
      await prisma.aiRetrievalSettings.update({
        where: { workspaceId },
        data: { generation: randomUUID(), leaseToken: null, leaseUntil: null },
      });
    };
    await rag.syncPending(workspaceId);
    expect(
      await prisma.aiDocumentChunk.count({ where: { fileId: file.id } }),
    ).toBe(0);
  });

  it("does not let a second worker claim an active database lease", async () => {
    await document();
    await prisma.aiRetrievalSettings.update({
      where: { workspaceId },
      data: {
        leaseToken: "other-worker",
        leaseUntil: new Date(Date.now() + 60_000),
      },
    });
    expect(await rag.syncPending(workspaceId)).toEqual({ processed: 0 });
    expect(calls).toEqual([]);
  });

  it("falls back to keyword results when the query embedding provider is down", async () => {
    const file = await document();
    await rag.syncPending(workspaceId);
    failBatch = calls.length + 1;
    const prepared = await ai.prepareQuestion(memberId, "电源接线");
    expect(prepared.sources.map((source) => source.id)).toEqual([file.id]);
  });
});
