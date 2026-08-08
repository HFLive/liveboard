import { NeonClient, NeonMutationUncertainError } from "./neon.client";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("NeonClient", () => {
  const fetchMock = jest.fn();
  let client: NeonClient;

  beforeAll(() => {
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  beforeEach(() => {
    fetchMock.mockReset();
    client = new NeonClient("test-api-key", "project-1");
  });

  it("createBranch 发 POST /branches 并解析分支 id 与操作 id", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          branch: { id: "br-123", name: "backup-j1" },
          operations: [{ id: "op-1" }],
        },
        201,
      ),
    );
    const result = await client.createBranch("backup-j1");
    expect(result).toEqual({
      branchId: "br-123",
      operationId: "op-1",
      operationIds: ["op-1"],
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://console.neon.tech/api/v2/projects/project-1/branches",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer test-api-key",
        }),
        body: JSON.stringify({ branch: { name: "backup-j1" } }),
      }),
    );
  });

  it("listBranches 找出主分支", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        branches: [
          { id: "br-1", name: "main", primary: true },
          { id: "br-2", name: "backup-x", primary: false },
        ],
      }),
    );
    const { primaryId } = await client.listBranches();
    expect(primaryId).toBe("br-1");
  });

  it("listBranches 优先使用新的 default 字段", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        branches: [
          { id: "br-old", name: "old", primary: true, default: false },
          { id: "br-current", name: "production", default: true },
        ],
      }),
    );
    await expect(client.listBranches()).resolves.toMatchObject({
      primaryId: "br-current",
    });
  });

  it("createSnapshot 从指定分支创建命名快照", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        snapshot: {
          id: "snap-1",
          name: "backup-j1",
          created_at: "2026-08-09T00:00:00Z",
        },
        operations: [{ id: "op-snapshot" }],
      }),
    );
    await expect(
      client.createSnapshot("br-main", "backup-j1"),
    ).resolves.toEqual({
      snapshotId: "snap-1",
      operationId: "op-snapshot",
      operationIds: ["op-snapshot"],
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://console.neon.tech/api/v2/projects/project-1/branches/br-main/snapshot?name=backup-j1",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("listSnapshots 与 deleteSnapshot 使用项目级路径", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          snapshots: [
            {
              id: "snap-1",
              name: "backup-j1",
              created_at: "2026-08-09T00:00:00Z",
            },
          ],
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ operations: [] }, 202));
    await expect(client.listSnapshots()).resolves.toHaveLength(1);
    await expect(client.deleteSnapshot("snap-1")).resolves.toEqual({
      operationIds: [],
    });
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "https://console.neon.tech/api/v2/projects/project-1/snapshots/snap-1",
    );
  });

  it("restoreSnapshot 立即 finalize 并返回新旧分支", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        branch: {
          id: "br-restored",
          name: "production",
          restored_from: "snap-1",
          restored_as: "br-old",
        },
        operations: [{ id: "op-restore" }],
      }),
    );
    await expect(
      client.restoreSnapshot({
        snapshotId: "snap-1",
        targetBranchId: "br-old",
      }),
    ).resolves.toEqual({
      branchId: "br-restored",
      replacedBranchId: "br-old",
      operationId: "op-restore",
      operationIds: ["op-restore"],
    });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.body).toBe(
      JSON.stringify({
        target_branch_id: "br-old",
        finalize_restore: true,
      }),
    );
  });

  it("restoreBranch 带 source_branch_id 与 preserve_under_name", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ operations: [{ id: "op-9" }, { id: "op-10" }] }),
    );
    const operation = await client.restoreBranch({
      targetBranchId: "br-main",
      sourceBranchId: "br-backup",
      preserveUnderName: "pre-restore-r1",
    });
    expect(operation).toEqual({
      operationId: "op-9",
      operationIds: ["op-9", "op-10"],
    });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe("POST");
    expect(init.body).toBe(
      JSON.stringify({
        source_branch_id: "br-backup",
        preserve_under_name: "pre-restore-r1",
      }),
    );
  });

  it("waitForOperation 轮询到 finished（项目级路径）", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({ operation: { id: "op-1", state: "running" } }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ operation: { id: "op-1", state: "running" } }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ operation: { id: "op-1", state: "finished" } }),
      );
    await expect(client.waitForOperation("op-1", 10_000)).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    // 操作查询是项目级接口，必须带 /projects/{project_id} 前缀。
    expect(fetchMock).toHaveBeenCalledWith(
      "https://console.neon.tech/api/v2/projects/project-1/operations/op-1",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("waitForOperation 会等待同一 API 返回的全部操作", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({ operation: { id: "op-1", status: "finished" } }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ operation: { id: "op-2", status: "running" } }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ operation: { id: "op-2", status: "finished" } }),
      );

    await expect(
      client.waitForOperation(["op-1", "op-2"], 10_000),
    ).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("waitForOperation 在 failed 状态抛错", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        operation: { id: "op-1", state: "failed", error: { message: "boom" } },
      }),
    );
    await expect(client.waitForOperation("op-1", 10_000)).rejects.toThrow(
      "Neon 操作失败",
    );
  });

  it("waitForOperation 超时返回 false（不抛错，调用方分棒等待）", async () => {
    // 每个请求都必须返回全新的 Response（Response body 只能读一次）。
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        jsonResponse({ operation: { id: "op-1", state: "running" } }),
      ),
    );
    await expect(client.waitForOperation("op-1", 50)).resolves.toBe(false);
  });

  it("429 抛出速率限制错误", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ message: "rate limited" }, 429),
    );
    await expect(client.createBranch("x")).rejects.toMatchObject({
      status: 429,
      message: expect.stringContaining("Neon API 速率限制"),
    });
  });

  it("403 保留 HTTP 状态供回滚状态机识别明确拒绝", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ message: "forbidden" }, 403),
    );
    await expect(
      client.restoreSnapshot({
        snapshotId: "snap-1",
        targetBranchId: "br-main",
      }),
    ).rejects.toMatchObject({
      status: 403,
      message: expect.stringContaining("Neon API 权限不足"),
    });
  });

  it("POST 请求超时标记为结果未知，调用方不得盲目重试", async () => {
    fetchMock.mockRejectedValueOnce(
      new DOMException(
        "The operation was aborted due to timeout",
        "TimeoutError",
      ),
    );
    await expect(client.createBranch("x")).rejects.toMatchObject({
      name: "NeonMutationUncertainError",
      neonMutationUncertain: true,
      message: expect.stringContaining("禁止自动重试"),
    } satisfies Partial<NeonMutationUncertainError>);
  });

  it("deleteBranch 对 404 幂等成功", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ message: "not found" }, 404),
    );
    await expect(client.deleteBranch("br-gone")).resolves.toBeUndefined();
  });
});
