import { Logger } from "@nestjs/common";

/**
 * Neon Snapshot API 客户端（Vercel 部署的数据库备份/回滚）。
 *
 * 语义（api.neon.tech）：
 * - 备份 = 从默认根分支创建手动 Snapshot。
 * - 回滚 = 从 Snapshot 创建恢复分支并立即 finalize：compute/连接地址迁到新
 *   分支，旧默认分支保留为可删除的被替换分支，避免 branch restore 把备份
 *   分支变成祖先、形成免费版中无法清理的依赖链。
 * - Snapshot 创建/恢复都是异步操作，一次响应可能返回多条 operations；必须逐条轮询
 *   GET /operations/{id} 至全部 finished，任一 failed 都中止。
 *
 * 凭据：NEON_API_KEY（Bearer）+ NEON_PROJECT_ID（路径参数），由调用方注入，
 * 缺失时构造抛错（Vercel 写端点已先行 503）。
 */

interface NeonBranch {
  id: string;
  name: string;
  primary?: boolean;
  default?: boolean;
  parent_id?: string | null;
  restored_from?: string | null;
  restored_as?: string | null;
  restore_status?: string | null;
}

export interface NeonSnapshot {
  id: string;
  name: string;
  source_branch_id?: string;
  created_at: string;
  expires_at?: string | null;
  manual?: boolean;
}

interface NeonOperation {
  id: string;
  status?: string;
  state?: string;
  error?: string | { message?: string } | null;
}

interface NeonApiErrorBody {
  message?: string;
  code?: string;
}

const NEON_API_BASE = "https://console.neon.tech/api/v2";
const OPERATION_POLL_INTERVAL_MS = 1500;
const OPERATION_TIMEOUT_MS = 5 * 60 * 1000;
/**
 * 单次 Neon API 请求超时：fetch 无超时会挂到函数被杀（5 分钟）——曾导致
 * restoreBranch 挂死后占着 tick 锁，手动 Run 全部 skipped、回滚行永远停
 * 在「准备」（任务既不前进也不失败）。20s 足够服务端正常响应，超时即
 * 快速失败，任务落 failed 可重新发起。
 */
const NEON_REQUEST_TIMEOUT_MS = 20_000;

/**
 * POST 发生网络错误或客户端超时时，Neon 可能已经接受了非幂等变更。调用方
 * 必须先查询资源状态，不能直接重放请求。
 */
export class NeonMutationUncertainError extends Error {
  readonly neonMutationUncertain = true;

  constructor(message: string) {
    super(message);
    this.name = "NeonMutationUncertainError";
  }
}

export class NeonClient {
  private readonly logger = new Logger(NeonClient.name);
  private readonly baseUrl: string;

  constructor(
    private readonly apiKey: string,
    private readonly projectId: string,
  ) {
    this.baseUrl = process.env.NEON_API_BASE?.trim() || NEON_API_BASE;
  }

  /** 兼容旧分支备份的清理与迁移；新备份不得再调用。 */
  async createBranch(name: string): Promise<{
    branchId: string;
    operationId: string | null;
    operationIds: string[];
  }> {
    const body = await this.request<{
      branch: NeonBranch;
      operations?: NeonOperation[];
    }>("POST", `/projects/${this.projectId}/branches`, {
      branch: { name },
    });
    const operationIds = (body.operations ?? []).map((item) => item.id);
    return {
      branchId: body.branch.id,
      operationId: operationIds[0] ?? null,
      operationIds,
    };
  }

  /** 从默认根分支创建 Snapshot。 */
  async createSnapshot(
    branchId: string,
    name: string,
  ): Promise<{
    snapshotId: string;
    operationId: string | null;
    operationIds: string[];
  }> {
    const query = new URLSearchParams({ name }).toString();
    const body = await this.request<{
      snapshot: NeonSnapshot;
      operations?: NeonOperation[];
    }>(
      "POST",
      `/projects/${this.projectId}/branches/${branchId}/snapshot?${query}`,
    );
    const operationIds = (body.operations ?? []).map((item) => item.id);
    return {
      snapshotId: body.snapshot.id,
      operationId: operationIds[0] ?? null,
      operationIds,
    };
  }

  async listSnapshots(): Promise<NeonSnapshot[]> {
    const body = await this.request<{ snapshots: NeonSnapshot[] }>(
      "GET",
      `/projects/${this.projectId}/snapshots`,
    );
    return body.snapshots;
  }

  /** 列出项目全部分支，返回 { branches, primaryId }。 */
  async listBranches(): Promise<{
    branches: NeonBranch[];
    primaryId: string | null;
  }> {
    const body = await this.request<{ branches: NeonBranch[] }>(
      "GET",
      `/projects/${this.projectId}/branches`,
    );
    const primary =
      body.branches.find((branch) => branch.default) ??
      body.branches.find((branch) => branch.primary) ??
      null;
    return {
      branches: body.branches,
      primaryId: primary?.id ?? null,
    };
  }

  /**
   * 从 Snapshot 恢复并立即 finalize。返回的新分支会承接原默认分支的 compute；
   * replacedBranchId 是 Neon 明确标记为被替换的旧分支，验证后才允许删除。
   */
  async restoreSnapshot(options: {
    snapshotId: string;
    targetBranchId: string;
    name: string;
  }): Promise<{
    branchId: string;
    replacedBranchId: string | null;
    operationId: string | null;
    operationIds: string[];
  }> {
    const body = await this.request<{
      branch: NeonBranch;
      operations?: NeonOperation[];
    }>(
      "POST",
      `/projects/${this.projectId}/snapshots/${options.snapshotId}/restore`,
      {
        name: options.name,
        target_branch_id: options.targetBranchId,
        finalize_restore: true,
      },
    );
    const operationIds = (body.operations ?? []).map((item) => item.id);
    return {
      branchId: body.branch.id,
      replacedBranchId: body.branch.restored_as ?? options.targetBranchId,
      operationId: operationIds[0] ?? null,
      operationIds,
    };
  }

  /** 删除 Snapshot。404 视为幂等成功。 */
  async deleteSnapshot(snapshotId: string): Promise<{
    operationIds: string[];
  }> {
    try {
      const body = await this.request<{ operations?: NeonOperation[] }>(
        "DELETE",
        `/projects/${this.projectId}/snapshots/${snapshotId}`,
      );
      return { operationIds: (body.operations ?? []).map((item) => item.id) };
    } catch (caught) {
      const status = (caught as { status?: number }).status;
      if (status === 404) return { operationIds: [] };
      throw caught;
    }
  }

  /**
   * 把目标分支整体替换为源分支 head。preserveUnderName 可选：不传则旧主
   * 分支数据被直接覆盖（用于旧主是根分支时——根分支不可删除，改名保留会
   * 产生永久占位的 pre-restore-* 孤儿）。
   */
  async restoreBranch(options: {
    targetBranchId: string;
    sourceBranchId: string;
    preserveUnderName?: string;
  }): Promise<{ operationId: string | null; operationIds: string[] }> {
    const body = await this.request<{ operations?: NeonOperation[] }>(
      "POST",
      `/projects/${this.projectId}/branches/${options.targetBranchId}/restore`,
      {
        source_branch_id: options.sourceBranchId,
        ...(options.preserveUnderName !== undefined
          ? { preserve_under_name: options.preserveUnderName }
          : {}),
      },
    );
    const operationIds = (body.operations ?? []).map((item) => item.id);
    return { operationId: operationIds[0] ?? null, operationIds };
  }

  /** 删除分支（备份保留策略清理）。404（已被删）视为幂等成功。 */
  async deleteBranch(branchId: string): Promise<void> {
    try {
      await this.request<{ branch: NeonBranch }>(
        "DELETE",
        `/projects/${this.projectId}/branches/${branchId}`,
      );
    } catch (caught) {
      const status = (caught as { status?: number }).status;
      if (status === 404) return; // 幂等：已不存在。
      throw caught;
    }
  }

  /**
   * 轮询操作到 finished。返回 true=已完成；false=timeoutMs 内未完成（调用方
   * 自行决定：executor 用短窗口轮询 + 心跳保持接力链，超时不代表失败）。
   * failed 状态抛错；timeoutMs 默认 5 分钟仅用于非预算调用方。
   */
  async waitForOperation(
    operationId: string | string[] | null,
    timeoutMs: number = OPERATION_TIMEOUT_MS,
  ): Promise<boolean> {
    const pending = new Set(
      (Array.isArray(operationId) ? operationId : [operationId]).filter(
        (id): id is string => Boolean(id),
      ),
    );
    if (!pending.size) return true; // 部分响应无操作（如分支已是最新）。
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      for (const id of [...pending]) {
        // 操作查询是项目级接口：旧版顶层 /operations/{id} 路径在现网已不存在
        // （404 Not Found），必须带项目前缀（OpenAPI: GET /projects/{project_id}/operations/{operation_id}）。
        const body = await this.request<{ operation: NeonOperation }>(
          "GET",
          `/projects/${this.projectId}/operations/${id}`,
        );
        const state = body.operation.state ?? body.operation.status;
        if (state === "finished") pending.delete(id);
        if (state === "failed") {
          const detail = body.operation.error;
          throw new Error(
            `Neon 操作失败：${typeof detail === "string" ? detail : (detail?.message ?? id)}`,
          );
        }
      }
      if (!pending.size) return true;
      if (Date.now() >= deadline) {
        return false; // 未超时抛错：长操作由调用方分棒等待（预算感知）。
      }
      await sleep(OPERATION_POLL_INTERVAL_MS);
    }
  }

  private async request<T>(
    method: "GET" | "POST" | "DELETE" | "PATCH",
    path: string,
    body?: unknown,
  ): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          Accept: "application/json",
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        // 必须带超时：无超时的 fetch 会挂到函数被杀，占用 tick/per-job 锁。
        signal: AbortSignal.timeout(NEON_REQUEST_TIMEOUT_MS),
      });
    } catch (caught) {
      const isTimeout =
        caught instanceof DOMException && caught.name === "TimeoutError";
      this.logger.error(
        `Neon API 请求${isTimeout ? "超时" : "失败"} ${method} ${path}: ${messageOfNeon(caught)}`,
      );
      const message = isTimeout
        ? `Neon API 请求超时（${NEON_REQUEST_TIMEOUT_MS / 1000}s）`
        : "Neon API 请求失败（网络错误）";
      if (method === "POST") {
        throw new NeonMutationUncertainError(
          `${message}；请求可能已被接受，必须先查询 Neon 状态，禁止自动重试`,
        );
      }
      throw new Error(`${message}，请稍后重试`);
    }
    if (response.ok) {
      return (await response.json()) as T;
    }
    const errorBody = (await response
      .json()
      .catch(() => null)) as NeonApiErrorBody | null;
    const detail = errorBody?.message ?? response.statusText;
    if (response.status === 429) {
      throw new Error(
        `Neon API 速率限制（429），请稍后重试或减少备份频率：${detail}`,
      );
    }
    if (response.status === 403) {
      throw new Error(
        `Neon API 权限不足（403），请检查 NEON_API_KEY：${detail}`,
      );
    }
    // 附带 status（deleteBranch 幂等 404 依赖它），不改变消息结构。
    throw Object.assign(
      new Error(`Neon API 错误 ${response.status}：${detail}`),
      { status: response.status },
    );
  }
}

function messageOfNeon(caught: unknown): string {
  if (caught instanceof Error) return caught.message;
  return String(caught);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
