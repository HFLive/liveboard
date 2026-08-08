import { NeonClient } from "./neon.client";

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
    expect(result).toEqual({ branchId: "br-123", operationId: "op-1" });
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

  it("restoreBranch 带 source_branch_id 与 preserve_under_name", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ operations: [{ id: "op-9" }] }),
    );
    const operationId = await client.restoreBranch({
      targetBranchId: "br-main",
      sourceBranchId: "br-backup",
      preserveUnderName: "pre-restore-r1",
    });
    expect(operationId).toBe("op-9");
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
    await expect(client.createBranch("x")).rejects.toThrow("Neon API 速率限制");
  });

  it("请求超时（AbortSignal.timeout）抛友好错误，不挂死吃锁", async () => {
    fetchMock.mockRejectedValueOnce(
      new DOMException(
        "The operation was aborted due to timeout",
        "TimeoutError",
      ),
    );
    await expect(client.createBranch("x")).rejects.toThrow("Neon API 请求超时");
  });

  it("deleteBranch 对 404 幂等成功", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ message: "not found" }, 404),
    );
    await expect(client.deleteBranch("br-gone")).resolves.toBeUndefined();
  });
});
