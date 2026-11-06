import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from "@nestjs/common";
import { Prisma, type AiRetrievalSettings } from "@prisma/client";
import { waitUntil } from "@vercel/functions";
import { randomUUID } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import { AiSecretService } from "./ai-secret.service";
import { blockToText } from "./ai-document-text";
import { chunkDocument, type SemanticHit } from "./ai-rag-retrieval";
import { embedTexts, embeddingEndpoint } from "./ai-embeddings";

export interface UpdateRetrievalInput {
  enabled: boolean;
  providerName?: string;
  baseUrl?: string;
  model?: string;
  apiKey?: string;
}

@Injectable()
export class AiRagService {
  private readonly logger = new Logger(AiRagService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly secrets: AiSecretService,
  ) {}

  private async adminWorkspace(userId: string | null) {
    if (!userId) throw new UnauthorizedException("Missing session");
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (user?.systemRole !== "super_admin" || user.status !== "active") {
      throw new ForbiddenException("只有最高管理员可以管理语义检索");
    }
    const workspace = await this.prisma.workspace.findFirst({
      orderBy: { createdAt: "asc" },
    });
    if (!workspace) throw new BadRequestException("工作区不存在");
    return workspace.id;
  }

  async getSettings(userId: string | null) {
    const workspaceId = await this.adminWorkspace(userId);
    return this.publicSettings(workspaceId);
  }

  private async publicSettings(workspaceId: string) {
    const config = await this.prisma.aiRetrievalSettings.upsert({
      where: { workspaceId },
      create: { workspaceId },
      update: {},
    });
    const [counts] = await this.prisma.$queryRaw<
      Array<{ total: number; ready: number; failed: number; chunks: number }>
    >(Prisma.sql`
      SELECT COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE i.generation = ${config.generation} AND i."fileVersion" = f.version AND i.status = 'ready')::int AS ready,
        COUNT(*) FILTER (WHERE i.generation = ${config.generation} AND i."fileVersion" = f.version AND i.status = 'error')::int AS failed,
        COALESCE(SUM(CASE WHEN i.generation = ${config.generation} AND i."fileVersion" = f.version THEN i."nextChunk" ELSE 0 END), 0)::int AS chunks
      FROM "File" f LEFT JOIN "AiDocumentIndex" i ON i."fileId" = f.id
      WHERE f."workspaceId" = ${workspaceId} AND f.type NOT IN ('asset', 'exercise_set') AND f.status <> 'archived'
    `);
    const failure = await this.prisma.aiDocumentIndex.findFirst({
      where: {
        generation: config.generation,
        status: "error",
        file: { workspaceId, status: { not: "archived" } },
      },
      orderBy: { updatedAt: "desc" },
      select: { lastError: true },
    });
    const stats = counts ?? { total: 0, ready: 0, failed: 0, chunks: 0 };
    return {
      enabled: config.enabled,
      providerName: config.providerName,
      baseUrl: config.baseUrl,
      model: config.model,
      dimensions: config.dimensions,
      apiKeyConfigured: Boolean(config.apiKey),
      totalDocuments: stats.total,
      indexedDocuments: stats.ready,
      pendingDocuments: stats.total - stats.ready - stats.failed,
      failedDocuments: stats.failed,
      indexedChunks: stats.chunks,
      indexing: Boolean(
        config.leaseUntil && config.leaseUntil.getTime() > Date.now(),
      ),
      lastError: failure?.lastError ?? null,
    };
  }

  async updateSettings(userId: string | null, input: UpdateRetrievalInput) {
    const workspaceId = await this.adminWorkspace(userId);
    const previous = await this.prisma.aiRetrievalSettings.findUnique({
      where: { workspaceId },
    });
    const baseUrl = (input.baseUrl ?? previous?.baseUrl ?? "")
      .trim()
      .replace(/\/+$/, "");
    const model = (input.model ?? previous?.model ?? "").trim();
    const providerName = (
      input.providerName ??
      previous?.providerName ??
      "custom"
    ).trim();
    const newKey = input.apiKey?.trim();
    const endpointChanged = Boolean(previous && previous.baseUrl !== baseUrl);
    const apiKey =
      newKey ||
      (input.enabled && !endpointChanged && previous?.apiKey
        ? this.secrets.decrypt(previous.apiKey)
        : "");
    let dimensions = previous?.dimensions ?? 0;
    if (input.enabled) {
      if (!baseUrl || !model || !apiKey)
        throw new BadRequestException("请填写向量服务地址、模型和 API Key");
      embeddingEndpoint(baseUrl);
      const [probe] = await embedTexts(
        { baseUrl, model, apiKey, dimensions: 0 },
        ["文档语义检索连接测试"],
      );
      dimensions = probe!.length;
    }
    const changed =
      !previous ||
      baseUrl !== previous.baseUrl ||
      model !== previous.model ||
      dimensions !== previous.dimensions;
    const values = {
      enabled: input.enabled,
      providerName,
      baseUrl,
      model,
      dimensions,
    };
    if (previous) {
      // A probe may overlap another administrator's save. Compare the configuration
      // atomically so an old endpoint cannot inherit the new endpoint's key or index.
      // Do not compare updatedAt: background workers update it when taking leases.
      const saved = await this.prisma.aiRetrievalSettings.updateMany({
        where: {
          workspaceId,
          generation: previous.generation,
          enabled: previous.enabled,
          providerName: previous.providerName,
          baseUrl: previous.baseUrl,
          model: previous.model,
          dimensions: previous.dimensions,
          apiKey: previous.apiKey,
        },
        data: {
          ...values,
          ...(newKey
            ? { apiKey: this.secrets.encrypt(newKey) }
            : endpointChanged
              ? { apiKey: "" }
              : {}),
          ...(changed
            ? { generation: randomUUID(), leaseToken: null, leaseUntil: null }
            : {}),
        },
      });
      if (saved.count !== 1)
        throw new ConflictException("语义检索配置已被修改，请刷新后重试");
    } else {
      try {
        await this.prisma.aiRetrievalSettings.create({
          data: {
            workspaceId,
            ...values,
            apiKey: apiKey ? this.secrets.encrypt(apiKey) : "",
          },
        });
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2002"
        )
          throw new ConflictException("语义检索配置已被修改，请刷新后重试");
        throw error;
      }
    }
    if (input.enabled) this.scheduleSync(workspaceId);
    return this.publicSettings(workspaceId);
  }

  async retryIndex(userId: string | null, retryFailures = false) {
    const workspaceId = await this.adminWorkspace(userId);
    if (retryFailures)
      await this.prisma.aiDocumentIndex.updateMany({
        where: { file: { workspaceId }, status: "error" },
        data: { retryAfter: null },
      });
    this.scheduleSync(workspaceId);
    return { scheduled: true };
  }

  /** Every background promise is registered with Vercel before returning a response. */
  scheduleSync(workspaceId?: string) {
    const task = this.syncPending(workspaceId).catch(() => {
      this.logger.warn("文档向量索引暂未完成，将在后续同步时重试");
    });
    waitUntil(task);
  }

  async syncPending(workspaceId?: string) {
    const configs = await this.prisma.aiRetrievalSettings.findMany({
      where: { enabled: true, ...(workspaceId ? { workspaceId } : {}) },
    });
    let processed = 0;
    // A bounded invocation; no self-calling functions or in-process timers.
    const deadline = Date.now() + 45_000;
    for (const config of configs) {
      if (Date.now() > deadline - 22_000) break;
      const token = randomUUID();
      const claimed = await this.prisma.aiRetrievalSettings.updateMany({
        where: {
          workspaceId: config.workspaceId,
          generation: config.generation,
          enabled: true,
          OR: [{ leaseUntil: null }, { leaseUntil: { lt: new Date() } }],
        },
        data: { leaseToken: token, leaseUntil: new Date(Date.now() + 60_000) },
      });
      if (!claimed.count) continue;
      try {
        while (Date.now() < deadline - 22_000) {
          if (!(await this.syncNextDocument(config, token))) break;
          processed += 1;
        }
      } finally {
        await this.prisma.aiRetrievalSettings.updateMany({
          where: { workspaceId: config.workspaceId, leaseToken: token },
          data: { leaseToken: null, leaseUntil: null },
        });
      }
    }
    return { processed };
  }

  private async syncNextDocument(config: AiRetrievalSettings, token: string) {
    const [candidate] = await this.prisma.$queryRaw<
      Array<{ id: string }>
    >(Prisma.sql`
      SELECT f.id FROM "File" f LEFT JOIN "AiDocumentIndex" i ON i."fileId" = f.id
      WHERE f."workspaceId" = ${config.workspaceId} AND f.type NOT IN ('asset', 'exercise_set') AND f.status <> 'archived'
        AND (i."fileId" IS NULL OR i.generation <> ${config.generation} OR i."fileVersion" <> f.version OR
          (i.status <> 'ready' AND (i."retryAfter" IS NULL OR i."retryAfter" <= (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'))))
      ORDER BY i."updatedAt" ASC NULLS FIRST, f.id LIMIT 1
    `);
    if (!candidate) return false;
    const file = await this.prisma.file.findUnique({
      where: { id: candidate.id },
      include: {
        aiIndex: true,
        blocks: {
          orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }, { id: "asc" }],
        },
      },
    });
    if (!file || file.status === "archived") return true;
    const chunks = chunkDocument({
      id: file.id,
      title: file.title,
      blocks: file.blocks.map((block) => ({
        ...block,
        text: blockToText(block.type, block.dataJson),
      })),
    });
    const current =
      file.aiIndex?.generation === config.generation &&
      file.aiIndex.fileVersion === file.version;
    const start = current ? file.aiIndex!.nextChunk : 0;
    const batch = chunks.slice(start, start + 16);
    let vectors: number[][] = [];
    let failure: string | null = null;
    try {
      if (batch.length)
        vectors = await embedTexts(
          {
            ...config,
            apiKey: this.secrets.decrypt(config.apiKey),
          },
          batch.map((chunk) => chunk.embeddingText),
        );
    } catch (error) {
      // Only our sanitized embedding error text is persisted.
      failure =
        error instanceof Error && error.message.startsWith("向量")
          ? error.message
          : "无法连接向量服务，请检查配置后重试";
    }
    const committed = await this.prisma.$transaction(async (tx) => {
      // Fence expired workers and configuration changes, including during an HTTP call.
      const [lease] = await tx.$queryRaw<
        Array<{ leaseToken: string }>
      >(Prisma.sql`
        SELECT "leaseToken" FROM "AiRetrievalSettings"
        WHERE "workspaceId" = ${config.workspaceId} AND generation = ${config.generation}
          AND enabled = true AND "leaseUntil" > (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') FOR UPDATE
      `);
      if (lease?.leaseToken !== token) return false;
      const [latest] = await tx.$queryRaw<
        Array<{ version: number; status: string }>
      >(Prisma.sql`
        SELECT version, status FROM "File" WHERE id = ${file.id} FOR SHARE
      `);
      if (
        !latest ||
        latest.version !== file.version ||
        latest.status === "archived"
      )
        return false;
      if (!current)
        await tx.aiDocumentIndex.deleteMany({ where: { fileId: file.id } });
      const nextChunk = failure ? start : start + batch.length;
      const data = {
        generation: config.generation,
        fileVersion: file.version,
        nextChunk,
        totalChunks: chunks.length,
        status: failure
          ? "error"
          : nextChunk === chunks.length
            ? "ready"
            : "pending",
        lastError: failure,
        retryAfter: failure ? new Date(Date.now() + 60_000) : null,
      };
      await tx.aiDocumentIndex.upsert({
        where: { fileId: file.id },
        create: { fileId: file.id, ...data },
        update: data,
      });
      if (!failure) {
        for (const [index, chunk] of batch.entries()) {
          await tx.$executeRaw(Prisma.sql`
            INSERT INTO "AiDocumentChunk" (id, "fileId", ordinal, "blockId", type, text, "sortOrder", embedding)
            VALUES (${randomUUID()}, ${file.id}, ${chunk.ordinal}, ${chunk.id}, ${chunk.type}, ${chunk.text},
              ${chunk.sortOrder}, ${JSON.stringify(vectors[index])}::vector)
            ON CONFLICT ("fileId", ordinal) DO NOTHING
          `);
        }
      }
      return true;
    });
    return committed;
  }

  async search(
    workspaceId: string,
    visibleIds: string[],
    question: string,
    signal?: AbortSignal,
  ): Promise<SemanticHit[]> {
    if (!visibleIds.length) return [];
    const config = await this.prisma.aiRetrievalSettings.findUnique({
      where: { workspaceId },
    });
    if (!config?.enabled) return [];
    try {
      const [query] = await embedTexts(
        { ...config, apiKey: this.secrets.decrypt(config.apiKey) },
        [question],
        { signal, timeoutMs: 5_000 },
      );
      signal?.throwIfAborted();
      // Filter authorized documents BEFORE top-k. Version/generation joins exclude stale vectors immediately.
      return await this.prisma.$queryRaw<SemanticHit[]>(Prisma.sql`
        SELECT * FROM (
          SELECT c."blockId" AS id, c."fileId", c.type, c.text, c."sortOrder",
            CASE WHEN vector_dims(c.embedding) = ${config.dimensions}
              THEN 1 - (c.embedding <=> ${JSON.stringify(query)}::vector) ELSE NULL END AS similarity
          FROM "AiDocumentChunk" c
          JOIN "AiDocumentIndex" i ON i."fileId" = c."fileId"
          JOIN "File" f ON f.id = i."fileId" AND f.version = i."fileVersion"
          JOIN "AiRetrievalSettings" r ON r."workspaceId" = f."workspaceId" AND r.generation = i.generation
          WHERE f.id IN (${Prisma.join(visibleIds)}) AND f."workspaceId" = ${workspaceId}
            AND f.type NOT IN ('asset', 'exercise_set') AND f.status <> 'archived' AND r.enabled = true
            AND r.generation = ${config.generation}
        ) matches WHERE similarity >= 0.35 ORDER BY similarity DESC, "fileId", "sortOrder" LIMIT 80
      `);
    } catch {
      signal?.throwIfAborted();
      this.logger.warn("语义检索暂不可用，本次使用关键词检索");
      return [];
    }
  }
}
