import { Logger } from "@nestjs/common";

/**
 * Neon Branching API 客户端（Vercel 部署的数据库备份/回滚）。
 *
 * 语义（api.neon.tech）：
 * - 备份 = 创建数据分支（不创建 compute endpoint，不产生计算小时，只占分支配额）。
 * - 回滚 = POST /projects/{project_id}/branches/{main}/restore，
 *   body `{ source_branch_id, preserve_under_name }`：把目标（主）分支整体替换
 *   为源分支 head；主分支旧状态保存为 preserve_under_name 分支（主分支有
 *   子分支时该字段必填，子分支会被移入新保存的分支）。
 * - 分支创建/恢复都是异步操作，需轮询 GET /operations/{id} 至 finished/failed。
 *
 * 凭据：NEON_API_KEY（Bearer）+ NEON_PROJECT_ID（路径参数），由调用方注入，
 * 缺失时构造抛错（Vercel 写端点已先行 503）。
 */

interface NeonBranch {
  id: string;
  name: string;
  primary?: boolean;
  parent_id?: string | null;
}

interface NeonOperation {
  id: string;
  status?: string;
  state?: string;
  error?: { message?: string } | null;
}

interface NeonApiErrorBody {
  message?: string;
  code?: string;
}

const NEON_API_BASE = "https://console.neon.tech/api/v2";
const OPERATION_POLL_INTERVAL_MS = 1500;
const OPERATION_TIMEOUT_MS = 5 * 60 * 1000;

export class NeonClient {
  private readonly logger = new Logger(NeonClient.name);
  private readonly baseUrl: string;

  constructor(
    private readonly apiKey: string,
    private readonly projectId: string,
  ) {
    this.baseUrl = process.env.NEON_API_BASE?.trim() || NEON_API_BASE;
  }

  /** 创建数据分支（无 compute endpoint）。返回分支 id 与首个操作 id。 */
  async createBranch(name: string): Promise<{
    branchId: string;
    operationId: string | null;
  }> {
    const body = await this.request<{
      branch: NeonBranch;
      operations?: NeonOperation[];
    }>("POST", `/projects/${this.projectId}/branches`, {
      branch: { name },
    });
    return {
      branchId: body.branch.id,
      operationId: body.operations?.[0]?.id ?? null,
    };
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
    const primary = body.branches.find((b) => b.primary) ?? null;
    return {
      branches: body.branches,
      primaryId: primary?.id ?? null,
    };
  }

  /**
   * 把目标分支整体替换为源分支 head。preserveUnderName 必传（主分支有
   * 子分支——备份分支是它的子分支，restore 时会被移入新保存的分支）。
   */
  async restoreBranch(options: {
    targetBranchId: string;
    sourceBranchId: string;
    preserveUnderName: string;
  }): Promise<string | null> {
    const body = await this.request<{ operations?: NeonOperation[] }>(
      "POST",
      `/projects/${this.projectId}/branches/${options.targetBranchId}/restore`,
      {
        source_branch_id: options.sourceBranchId,
        preserve_under_name: options.preserveUnderName,
      },
    );
    return body.operations?.[0]?.id ?? null;
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

  /** 轮询操作到 finished；failed 或超时抛错。 */
  async waitForOperation(
    operationId: string | null,
    timeoutMs: number = OPERATION_TIMEOUT_MS,
  ): Promise<void> {
    if (!operationId) return; // 部分响应无操作（如分支已是最新）。
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const body = await this.request<{ operation: NeonOperation }>(
        "GET",
        `/operations/${operationId}`,
      );
      const state = body.operation.state ?? body.operation.status;
      if (state === "finished") return;
      if (state === "failed") {
        throw new Error(
          `Neon 操作失败：${body.operation.error?.message ?? operationId}`,
        );
      }
      if (Date.now() >= deadline) {
        throw new Error(
          `Neon 操作超时（${timeoutMs / 1000}s）：${operationId}`,
        );
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
      });
    } catch (caught) {
      this.logger.error(
        `Neon API 请求失败 ${method} ${path}: ${messageOfNeon(caught)}`,
      );
      throw new Error(`Neon API 请求失败（网络错误），请稍后重试`);
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
