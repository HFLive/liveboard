import { BackupVercelExecutor } from "./backup-vercel-executor";

/**
 * 回归测试：Neon Snapshot restore 换库会把备份点之后创建的任务行从 BackupJob
 * 抹掉，旧代码 post-swap 的 row.update 全部 P2025 打空，
 * 最终状态只写进 Redis 而 listJobs 从不读它——回滚行静默蒸发、源备份行
 * 永远卡在「执行中」。修复：Redis 状态带行元数据，换库后从 Redis 重建行、
 * 回拷前缀改用源备份 id，并只清理 Neon 明确标记的被替换分支。
 */

/** Neon mock 共享的分支表：executor 每次 this.neon() 都 new 新实例，共享数据让测试可控。 */
const mockBranches: {
  branches: Array<{
    id: string;
    name: string;
    parent_id?: string | null;
    restored_from?: string | null;
    restored_as?: string | null;
  }>;
  primaryId: string;
} = {
  branches: [],
  primaryId: "primary-1",
};
/** 共享 waitForOperation mock：默认已完成；测试可改为 false 模拟长操作。 */
const mockWaitForOperation = jest.fn().mockResolvedValue(true);
/** 共享 deleteBranch mock：孤儿分支清扫断言用。 */
const mockDeleteBranch = jest.fn().mockResolvedValue(undefined);
const mockSnapshots: Array<{ id: string; name: string; created_at: string }> =
  [];
const mockDeleteSnapshot = jest.fn().mockResolvedValue({ operationIds: [] });
const mockCreateSnapshot = jest.fn().mockResolvedValue({
  snapshotId: "snap-1",
  operationId: "op-snapshot-1",
  operationIds: ["op-snapshot-1"],
});
const mockRestoreSnapshot = jest.fn().mockResolvedValue({
  branchId: "br-restored-1",
  replacedBranchId: "primary-1",
  operationId: "op-restore-1",
  operationIds: ["op-restore-1"],
});

jest.mock("./neon.client", () => ({
  NeonClient: jest.fn().mockImplementation(() => ({
    createBranch: jest.fn().mockResolvedValue({
      branchId: "br-1",
      operationId: "op-1",
      operationIds: ["op-1"],
    }),
    createSnapshot: mockCreateSnapshot,
    listSnapshots: jest.fn().mockImplementation(async () => mockSnapshots),
    deleteSnapshot: mockDeleteSnapshot,
    listBranches: jest.fn().mockResolvedValue(mockBranches),
    restoreSnapshot: mockRestoreSnapshot,
    restoreBranch: jest.fn(),
    waitForOperation: mockWaitForOperation,
    deleteBranch: mockDeleteBranch,
  })),
}));

describe("BackupVercelExecutor 换库后的行重建", () => {
  const prisma = {
    backupJob: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      upsert: jest.fn(),
      delete: jest.fn(),
    },
    backupSettings: { findFirst: jest.fn(), updateMany: jest.fn() },
  };
  const redisClient = {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
    keys: jest.fn(),
  };
  const redis = { getClient: jest.fn() };
  const storageBackend = {
    statObject: jest.fn(),
    copyObject: jest.fn(),
    removeObject: jest.fn(),
    putObject: jest.fn(),
    presignGet: jest.fn(),
  };
  const storage = { backendFor: jest.fn() };
  const config = {
    get: jest.fn((key: string) =>
      key === "NEON_API_KEY" || key === "NEON_PROJECT_ID"
        ? "configured-value"
        : null,
    ),
  };
  const maintenance = {
    setSystemEnabled: jest.fn(),
  };

  let executor: BackupVercelExecutor;

  beforeEach(() => {
    jest.clearAllMocks();
    mockBranches.branches = [];
    mockBranches.primaryId = "primary-1";
    mockSnapshots.splice(0, mockSnapshots.length);
    mockWaitForOperation.mockResolvedValue(true);
    mockDeleteBranch.mockResolvedValue(undefined);
    mockRestoreSnapshot.mockResolvedValue({
      branchId: "br-restored-1",
      replacedBranchId: "primary-1",
      operationId: "op-restore-1",
      operationIds: ["op-restore-1"],
    });
    redis.getClient.mockResolvedValue(redisClient);
    redisClient.get.mockResolvedValue(null);
    redisClient.set.mockResolvedValue("OK");
    redisClient.del.mockResolvedValue(1);
    redisClient.keys.mockResolvedValue([]);
    storage.backendFor.mockResolvedValue(storageBackend);
    storageBackend.statObject.mockResolvedValue(null);
    storageBackend.copyObject.mockResolvedValue(undefined);
    maintenance.setSystemEnabled.mockResolvedValue({ enabled: false });
    prisma.backupJob.create.mockResolvedValue({ id: "row-1" });
    prisma.backupJob.delete.mockResolvedValue({ id: "row-1" });
    prisma.backupJob.findFirst.mockResolvedValue(null);
    prisma.backupJob.upsert.mockResolvedValue({ id: "row-1" });
    prisma.backupJob.findMany.mockResolvedValue([]);
    executor = new BackupVercelExecutor(
      prisma as never,
      storage as never,
      redis as never,
      config as never,
      maintenance as never,
    );
  });

  afterEach(() => {
    delete process.env.CRON_SECRET;
    delete process.env.API_PUBLIC_URL;
  });

  describe("Neon Free 分支容量预检", () => {
    function branches(count: number) {
      mockBranches.primaryId = "branch-0";
      return Array.from({ length: count }, (_, index) => ({
        id: `branch-${index}`,
        name: index === 0 ? "main" : `user-branch-${index}`,
        parent_id: index === 0 ? null : "branch-0",
      }));
    }

    it("手动备份在免费版已有一个 Snapshot 时于创建任务前拒绝", async () => {
      mockBranches.branches = branches(1);
      mockSnapshots.push({
        id: "snap-existing",
        name: "backup-existing",
        created_at: new Date().toISOString(),
      });

      await expect(
        executor.assertBranchCapacity("backup", "manual"),
      ).rejects.toThrow("Neon 免费版只允许 1 个手动 Snapshot");
    });

    it("Redis 不可用时在创建任务前 fail closed", async () => {
      redis.getClient.mockRejectedValue(new Error("redis down"));

      await expect(executor.assertBranchCapacity("backup")).rejects.toThrow(
        "redis down",
      );
      expect(prisma.backupJob.create).not.toHaveBeenCalled();
    });

    it("Snapshot 回滚预留一个瞬态分支空位", async () => {
      mockBranches.branches = branches(10);
      await expect(executor.assertBranchCapacity("restore")).rejects.toThrow(
        "回滚至少需要 1 个空位",
      );

      mockBranches.branches = branches(9);
      await expect(
        executor.assertBranchCapacity("restore"),
      ).resolves.toBeUndefined();
    });
  });

  describe("失败备份清理", () => {
    it("任务行缺少 Snapshot id 时按 backup-<jobId> 名称删除 Snapshot", async () => {
      prisma.backupJob.findUnique.mockResolvedValue({
        id: "failed-1",
        status: "failed",
        neonBranchId: null,
        manifest: null,
      });
      mockSnapshots.push({
        id: "snap-timeout-created",
        name: "backup-failed-1",
        created_at: new Date().toISOString(),
      });

      await executor.deleteBackupNow("failed-1");

      expect(mockDeleteSnapshot).toHaveBeenCalledWith("snap-timeout-created");
      expect(prisma.backupJob.delete).toHaveBeenCalledWith({
        where: { id: "failed-1" },
      });
    });
  });

  describe("Vercel 跨实例任务互斥", () => {
    it("优先识别数据库里的活跃任务", async () => {
      prisma.backupJob.findFirst.mockResolvedValue({ id: "db-running-1" });

      await expect(executor.findInFlightJobId()).resolves.toBe("db-running-1");
      expect(redisClient.keys).not.toHaveBeenCalled();
    });

    it("换库后 DB 行消失时仍识别 Redis 里的活跃回滚", async () => {
      prisma.backupJob.findFirst.mockResolvedValue(null);
      redisClient.keys.mockResolvedValue([
        "liveboard:backup:job:redis-restore-1",
      ]);
      redisClient.get.mockResolvedValue(
        JSON.stringify({
          jobId: "redis-restore-1",
          kind: "restore",
          progress: {
            stage: "restore/wait",
            done: 0,
            total: 1,
            protectJobId: "protect-1",
          },
        }),
      );

      await expect(executor.findInFlightJobId()).resolves.toBe(
        "redis-restore-1",
      );
    });

    it("DB 已落 failed 时忽略 Redis 残留进度，不永久阻塞新任务", async () => {
      prisma.backupJob.findFirst.mockResolvedValue(null);
      prisma.backupJob.findMany.mockResolvedValue([{ id: "stale-restore-1" }]);
      redisClient.keys.mockResolvedValue([
        "liveboard:backup:job:stale-restore-1",
      ]);
      redisClient.get.mockResolvedValue(
        JSON.stringify({
          jobId: "stale-restore-1",
          kind: "restore",
          progress: {
            stage: "restore/wait",
            done: 0,
            total: 1,
            protectJobId: "protect-1",
          },
        }),
      );

      await expect(executor.findInFlightJobId()).resolves.toBeNull();
    });

    it("每日兜底不会从 Redis 复活 DB 已失败的回滚", async () => {
      redisClient.keys.mockResolvedValue([
        "liveboard:backup:job:failed-restore-1",
      ]);
      redisClient.get.mockResolvedValue(
        JSON.stringify({
          jobId: "failed-restore-1",
          kind: "restore",
          progress: {
            stage: "restore/wait",
            done: 0,
            total: 1,
            operationId: "op-old",
          },
        }),
      );
      prisma.backupJob.findUnique.mockResolvedValue({ status: "failed" });

      const orphaned = await (
        executor as unknown as {
          listOrphanedInFlightJobs: (dbIds: Set<string>) => Promise<string[]>;
        }
      ).listOrphanedInFlightJobs(new Set());

      expect(orphaned).toEqual([]);
    });
  });

  describe("recoverJobRow（换库后从 Redis 重建行）", () => {
    it("按 Redis 状态重建 restore 行（kind/restoreFromId/includeObjects/protectJobId）", async () => {
      redisClient.get.mockResolvedValue(
        JSON.stringify({
          jobId: "rest-1",
          kind: "restore",
          restoreFromId: "src-1",
          includeObjects: true,
          isProtection: false,
          progress: {
            stage: "restore/wait",
            done: 0,
            total: 1,
            operationId: "op-9",
            protectJobId: "prot-1",
          },
          updatedAt: "2026-08-08T03:00:00Z",
        }),
      );

      const row = await (
        executor as unknown as {
          recoverJobRow: (jobId: string) => Promise<unknown>;
        }
      ).recoverJobRow("rest-1");

      expect(prisma.backupJob.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            id: "rest-1",
            kind: "restore",
            status: "running",
            restoreFromId: "src-1",
            includeObjects: true,
            progress: expect.objectContaining({
              stage: "restore/wait",
              protectJobId: "prot-1",
            }),
          }),
        }),
      );
      expect(row).toEqual(
        expect.objectContaining({
          id: "rest-1",
          kind: "restore",
          status: "running",
          restoreFromId: "src-1",
          includeObjects: true,
          isProtection: false,
        }),
      );
    });

    it("Redis 无状态时返回 null（不重建）", async () => {
      redisClient.get.mockResolvedValue(null);
      const row = await (
        executor as unknown as {
          recoverJobRow: (jobId: string) => Promise<unknown>;
        }
      ).recoverJobRow("rest-1");
      expect(row).toBeNull();
      expect(prisma.backupJob.create).not.toHaveBeenCalled();
    });

    it("终态（done/failed）与未推进（stage 空）不重建", async () => {
      for (const stage of ["done", "failed", ""]) {
        redisClient.get.mockResolvedValue(
          JSON.stringify({
            jobId: "rest-1",
            kind: "restore",
            progress: { stage, done: 0, total: 0 },
          }),
        );
        const row = await (
          executor as unknown as {
            recoverJobRow: (jobId: string) => Promise<unknown>;
          }
        ).recoverJobRow("rest-1");
        expect(row).toBeNull();
      }
      expect(prisma.backupJob.create).not.toHaveBeenCalled();
    });
  });

  describe("Redis 任务状态与互斥锁隔离", () => {
    it("armRestoreChain 写入状态后仍能抢锁推进，解锁不会删除状态", async () => {
      const values = new Map<string, string>();
      redisClient.set.mockImplementation(
        async (key: string, value: string, options?: { NX?: boolean }) => {
          if (options?.NX && values.has(key)) return null;
          values.set(key, value);
          return "OK";
        },
      );
      redisClient.get.mockImplementation(async (key: string) => {
        return values.get(key) ?? null;
      });
      redisClient.del.mockImplementation(async (key: string) => {
        return values.delete(key) ? 1 : 0;
      });

      await executor.armRestoreChain("rest-1", "src-1", "prot-1", true);

      let advanced = false;
      await (
        executor as unknown as {
          withJobLock: (
            jobId: string,
            fn: () => Promise<void>,
          ) => Promise<void | undefined>;
        }
      ).withJobLock("rest-1", async () => {
        advanced = true;
      });

      expect(advanced).toBe(true);
      expect(values.has("liveboard:backup:lock:rest-1")).toBe(false);
      expect(values.get("liveboard:backup:job:rest-1")).toContain(
        '"protectJobId":"prot-1"',
      );
      expect(redisClient.set).toHaveBeenCalledWith(
        "liveboard:backup:lock:rest-1",
        "1",
        { NX: true, PX: 60_000 },
      );
      expect(redisClient.del).not.toHaveBeenCalledWith(
        "liveboard:backup:job:rest-1",
      );
    });

    it("armRestoreChain 写 Redis 失败时抛错，不允许继续 Neon 回滚", async () => {
      redisClient.set.mockRejectedValue(new Error("redis write failed"));

      await expect(
        executor.armRestoreChain("rest-1", "src-1", "prot-1", true),
      ).rejects.toThrow("redis write failed");
      expect(mockRestoreSnapshot).not.toHaveBeenCalled();
    });
  });

  describe("repairSourceBackupRow（源备份行回到快照时刻后的修复）", () => {
    it("重建 manifest、找回 Snapshot id、标成功", async () => {
      // 首次读取是旧数据库中的执行中行；upsert 落库后
      // 再读返回修复后的行（与真实 upsert 行为一致）。
      prisma.backupJob.findUnique
        .mockResolvedValueOnce({
          id: "src-1",
          kind: "manual",
          status: "running",
          includeObjects: true,
          isProtection: false,
          manifest: null,
          neonBranchId: null,
        })
        .mockResolvedValue({
          id: "src-1",
          kind: "manual",
          status: "succeeded",
          includeObjects: true,
          isProtection: false,
          manifest: {
            formatVersion: 1,
            objects: [{ storageKey: "a.txt", sizeBytes: 10, mimeType: null }],
          },
          neonBranchId: "snap-src-1",
        });
      redisClient.get.mockResolvedValue(
        JSON.stringify({
          jobId: "src-1",
          kind: "manual",
          progress: {
            stage: "copy-objects",
            objects: [{ storageKey: "a.txt", sizeBytes: 10, mimeType: null }],
          },
          updatedAt: "2026-08-08T03:10:00Z",
        }),
      );
      mockSnapshots.push({
        id: "snap-src-1",
        name: "backup-src-1",
        created_at: new Date().toISOString(),
      });
      const source = (await (
        executor as unknown as {
          repairSourceBackupRow: (sourceId: string) => Promise<unknown>;
        }
      ).repairSourceBackupRow("src-1")) as {
        manifest?: { objects?: unknown[] };
      };

      expect(prisma.backupJob.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "src-1" },
          update: expect.objectContaining({
            status: "succeeded",
            phase: "done",
            neonBranchId: "snap-src-1",
            manifest: expect.objectContaining({
              objects: [{ storageKey: "a.txt", sizeBytes: 10, mimeType: null }],
            }),
          }),
        }),
      );
      expect(source?.manifest?.objects).toHaveLength(1);
    });

    it("行完好（有 manifest 且成功）时不改动", async () => {
      prisma.backupJob.findUnique.mockResolvedValue({
        id: "src-1",
        kind: "manual",
        status: "succeeded",
        includeObjects: true,
        isProtection: false,
        manifest: { formatVersion: 1, objects: [] },
        neonBranchId: "br-ok",
      });
      const source = (await (
        executor as unknown as {
          repairSourceBackupRow: (sourceId: string) => Promise<unknown>;
        }
      ).repairSourceBackupRow("src-1")) as { manifest?: unknown };

      expect(prisma.backupJob.upsert).not.toHaveBeenCalled();
      expect(source?.manifest).toEqual({ formatVersion: 1, objects: [] });
    });
  });

  describe("advanceBackup（Neon Snapshot）", () => {
    it("从默认根分支创建命名 Snapshot，并把 Snapshot id 写回任务", async () => {
      mockBranches.primaryId = "primary-1";
      mockBranches.branches = [
        { id: "primary-1", name: "production", parent_id: null },
      ];
      const job = {
        id: "job-1",
        kind: "manual",
        status: "pending",
        phase: "",
        neonBranchId: null,
        restoreFromId: null,
        includeObjects: true,
        isProtection: false,
        error: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        progress: null,
      };

      await (
        executor as unknown as {
          advanceJob: (row: unknown) => Promise<void>;
        }
      ).advanceJob(job);

      expect(mockCreateSnapshot).toHaveBeenCalledWith(
        "primary-1",
        "backup-job-1",
      );
      expect(prisma.backupJob.update).toHaveBeenLastCalledWith({
        where: { id: "job-1" },
        data: expect.objectContaining({ neonBranchId: "snap-1" }),
      });
    });
  });

  describe("repairProtectionRow（保护备份行换库后重建）", () => {
    it("按 Redis 状态重建为成功、isProtection=true", async () => {
      redisClient.get.mockResolvedValue(
        JSON.stringify({
          jobId: "prot-1",
          kind: "manual",
          includeObjects: true,
          isProtection: true,
          progress: {
            stage: "done",
            done: 1,
            total: 1,
            objects: [{ storageKey: "b.txt", sizeBytes: 5, mimeType: null }],
          },
          updatedAt: "2026-08-08T03:05:00Z",
        }),
      );
      await (
        executor as unknown as {
          repairProtectionRow: (protectId: string) => Promise<void>;
        }
      ).repairProtectionRow("prot-1");

      expect(prisma.backupJob.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "prot-1" },
          create: expect.objectContaining({
            id: "prot-1",
            kind: "manual",
            isProtection: true,
            includeObjects: true,
          }),
          update: expect.objectContaining({
            status: "succeeded",
            phase: "done",
            manifest: expect.objectContaining({
              objects: [{ storageKey: "b.txt", sizeBytes: 5, mimeType: null }],
            }),
          }),
        }),
      );
    });
  });

  describe("advanceRestore restore/objects 阶段", () => {
    it("对象回拷读 backup/<源备份 id>/ 前缀（不是回滚行自己的 id）", async () => {
      // 源备份行完好（有 manifest 且成功）→ 直接回拷。
      prisma.backupJob.findUnique.mockResolvedValue({
        id: "src-1",
        kind: "manual",
        status: "succeeded",
        includeObjects: true,
        isProtection: false,
        manifest: {
          formatVersion: 1,
          objects: [
            { storageKey: "a.txt", sizeBytes: 10, mimeType: "text/plain" },
          ],
        },
        neonBranchId: "br-src-1",
      });
      storageBackend.statObject.mockImplementation((key: string) =>
        key === "backup/src-1/a.txt"
          ? Promise.resolve({ size: 10 })
          : Promise.resolve(null),
      );

      await (
        executor as unknown as {
          advanceJob: (job: unknown) => Promise<void>;
        }
      ).advanceJob({
        id: "rest-1",
        kind: "restore",
        status: "running",
        phase: "restore/objects",
        neonBranchId: null,
        restoreFromId: "src-1",
        includeObjects: true,
        isProtection: false,
        error: null,
        createdAt: new Date(),
        progress: {
          stage: "restore/objects",
          done: 0,
          total: 1,
          protectJobId: "prot-1",
        },
      });

      // 旧 bug：源对象读 backup/rest-1/...（回滚行 id），永远找不到。
      expect(storageBackend.statObject).toHaveBeenCalledWith(
        "backup/src-1/a.txt",
      );
      expect(storageBackend.statObject).not.toHaveBeenCalledWith(
        "backup/rest-1/a.txt",
      );
      expect(storageBackend.copyObject).toHaveBeenCalledWith(
        "backup/src-1/a.txt",
        "a.txt",
        "text/plain",
      );
    });

    it("目标对象已一致时计入完成，避免永远重复同一批对象", async () => {
      prisma.backupJob.findUnique.mockResolvedValue({
        id: "src-1",
        kind: "manual",
        status: "succeeded",
        includeObjects: true,
        isProtection: false,
        manifest: {
          formatVersion: 1,
          objects: [
            { storageKey: "same.txt", sizeBytes: 10, mimeType: "text/plain" },
          ],
        },
        neonBranchId: "br-src-1",
      });
      storageBackend.statObject.mockImplementation((key: string) =>
        key === "backup/src-1/same.txt" || key === "same.txt"
          ? Promise.resolve({ size: 10 })
          : Promise.resolve(null),
      );

      await (
        executor as unknown as {
          advanceJob: (job: unknown) => Promise<void>;
        }
      ).advanceJob({
        id: "rest-1",
        kind: "restore",
        status: "running",
        phase: "restore/objects",
        neonBranchId: null,
        restoreFromId: "src-1",
        includeObjects: true,
        isProtection: false,
        error: null,
        createdAt: new Date(),
        progress: {
          stage: "restore/objects",
          done: 0,
          total: 1,
          protectJobId: "prot-1",
        },
      });

      expect(storageBackend.copyObject).not.toHaveBeenCalled();
      expect(prisma.backupJob.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({
            phase: "restore/cleanup",
            progress: expect.objectContaining({
              stage: "restore/cleanup",
              done: 1,
              total: 1,
            }),
          }),
        }),
      );
    });
  });

  describe("advanceRestore restore/wait 阶段（预算感知等待）", () => {
    const restoreWaitJob = {
      id: "rest-1",
      kind: "restore",
      status: "running",
      phase: "restore/restore",
      neonBranchId: null,
      restoreFromId: "src-1",
      includeObjects: true,
      isProtection: false,
      error: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      progress: {
        stage: "restore/wait",
        done: 0,
        total: 1,
        operationId: "op-9",
        targetBranchId: "br-old",
        restoredBranchId: "br-new",
        replacedBranchId: "br-old",
      },
    };

    it("Neon 操作未完成：心跳更新进度与新旧分支 id，不落 failed", async () => {
      mockWaitForOperation.mockResolvedValue(false);

      await (
        executor as unknown as {
          advanceJob: (job: unknown) => Promise<void>;
        }
      ).advanceJob(restoreWaitJob);

      expect(prisma.backupJob.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "rest-1" },
          update: expect.objectContaining({
            phase: "restore/restore",
            progress: expect.objectContaining({
              stage: "restore/wait",
              operationId: "op-9",
              restoredBranchId: "br-new",
              replacedBranchId: "br-old",
            }),
          }),
        }),
      );
      // 心跳写入推进 updatedAt → 接力续跑继续轮询，绝不能落 failed。
      const failedCalls = (
        prisma.backupJob.upsert as jest.Mock
      ).mock.calls.filter(
        (call) =>
          (call[0] as { update?: { status?: string } })?.update?.status ===
          "failed",
      );
      expect(failedCalls).toHaveLength(0);
    });

    describe("reconcileOrphanedBranches（孤儿分支清扫）", () => {
      it("backup-<id> 无对应行或任务失败 → 删；成功行 → 保留", async () => {
        mockBranches.branches = [
          { id: "br-orphan", name: "backup-cmsjuxxx", parent_id: "br-root" },
          { id: "br-failed", name: "backup-cmsjfail", parent_id: "br-root" },
          { id: "br-keep", name: "backup-cmsjwgle", parent_id: "br-main" },
        ];
        prisma.backupJob.findMany.mockResolvedValue([
          { id: "cmsjfail", status: "failed" },
          { id: "cmsjwgle", status: "succeeded" },
        ]);

        await (
          executor as unknown as {
            reconcileOrphanedBranches: () => Promise<void>;
          }
        ).reconcileOrphanedBranches();

        expect(mockDeleteBranch).toHaveBeenCalledWith("br-orphan");
        expect(mockDeleteBranch).toHaveBeenCalledWith("br-failed");
        expect(mockDeleteBranch).not.toHaveBeenCalledWith("br-keep");
      });

      it("pre-restore-<id> 行缺失或已终态 → 删；仍执行中 → 保留", async () => {
        mockBranches.branches = [
          { id: "br-gone", name: "pre-restore-cmsjv12hq", parent_id: "br-r" },
          { id: "br-failed", name: "pre-restore-cmsj9qfk", parent_id: "br-r" },
          { id: "br-running", name: "pre-restore-cmsjwj74", parent_id: "br-r" },
        ];
        prisma.backupJob.findMany.mockResolvedValue([
          { id: "cmsj9qfk", status: "failed" },
          { id: "cmsjwj74", status: "running" },
        ]);

        await (
          executor as unknown as {
            reconcileOrphanedBranches: () => Promise<void>;
          }
        ).reconcileOrphanedBranches();

        expect(mockDeleteBranch).toHaveBeenCalledWith("br-gone");
        expect(mockDeleteBranch).toHaveBeenCalledWith("br-failed");
        expect(mockDeleteBranch).not.toHaveBeenCalledWith("br-running");
      });

      it("根分支（parent_id 为空）跳过，即使名字匹配孤儿前缀", async () => {
        mockBranches.branches = [
          { id: "br-root", name: "pre-restore-cmsjv12hq", parent_id: null },
          { id: "br-orphan", name: "backup-cmsjuxxx", parent_id: "br-root" },
        ];
        prisma.backupJob.findMany.mockResolvedValue([]);

        await (
          executor as unknown as {
            reconcileOrphanedBranches: () => Promise<void>;
          }
        ).reconcileOrphanedBranches();

        expect(mockDeleteBranch).toHaveBeenCalledWith("br-orphan");
        expect(mockDeleteBranch).not.toHaveBeenCalledWith("br-root");
      });

      it("先删叶子（backup-*）再删父（pre-restore-*）", async () => {
        mockBranches.branches = [
          { id: "br-pre", name: "pre-restore-cmsjv12hq", parent_id: "br-r" },
          { id: "br-backup", name: "backup-cmsjuxxx", parent_id: "br-pre" },
        ];
        prisma.backupJob.findMany.mockResolvedValue([]);

        await (
          executor as unknown as {
            reconcileOrphanedBranches: () => Promise<void>;
          }
        ).reconcileOrphanedBranches();

        const calls = (mockDeleteBranch as jest.Mock).mock.calls.map(
          (c) => c[0] as string,
        );
        expect(calls).toEqual(["br-backup", "br-pre"]);
      });

      it("换库后 DB 行暂时消失时，保留 Redis 活跃回滚及其保护分支", async () => {
        mockBranches.branches = [
          {
            id: "br-protect",
            name: "backup-protect-1",
            parent_id: "br-pre",
          },
          {
            id: "br-pre",
            name: "pre-restore-rest-1",
            parent_id: "br-root",
          },
        ];
        prisma.backupJob.findMany.mockResolvedValue([]);
        redisClient.keys.mockResolvedValue([
          "liveboard:backup:job:rest-1",
          "liveboard:backup:job:protect-1",
        ]);
        redisClient.get.mockImplementation(async (key: string) => {
          if (key === "liveboard:backup:job:rest-1") {
            return JSON.stringify({
              jobId: "rest-1",
              kind: "restore",
              progress: {
                stage: "restore/verify",
                done: 0,
                total: 1,
                protectJobId: "protect-1",
              },
            });
          }
          if (key === "liveboard:backup:job:protect-1") {
            return JSON.stringify({
              jobId: "protect-1",
              kind: "manual",
              isProtection: true,
              progress: { stage: "done", done: 1, total: 1 },
            });
          }
          return null;
        });

        await (
          executor as unknown as {
            reconcileOrphanedBranches: () => Promise<void>;
          }
        ).reconcileOrphanedBranches();

        expect(mockDeleteBranch).not.toHaveBeenCalledWith("br-protect");
        expect(mockDeleteBranch).not.toHaveBeenCalledWith("br-pre");
      });

      it("deleteBranch 失败不抛错（下轮 tick 重试）", async () => {
        mockBranches.branches = [
          { id: "br-orphan", name: "backup-cmsjuxxx", parent_id: "br-root" },
        ];
        prisma.backupJob.findMany.mockResolvedValue([]);
        mockDeleteBranch.mockRejectedValue(new Error("neon down"));

        await expect(
          (
            executor as unknown as {
              reconcileOrphanedBranches: () => Promise<void>;
            }
          ).reconcileOrphanedBranches(),
        ).resolves.toBeUndefined();
      });
    });

    it("Neon 操作完成：进入 verify", async () => {
      mockWaitForOperation.mockResolvedValue(true);

      await (
        executor as unknown as {
          advanceJob: (job: unknown) => Promise<void>;
        }
      ).advanceJob(restoreWaitJob);

      expect(prisma.backupJob.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({
            phase: "restore/verify",
            progress: expect.objectContaining({ stage: "restore/verify" }),
          }),
        }),
      );
    });
  });

  describe('advanceRestore stage ""（Snapshot finalized restore）', () => {
    const stageZeroJob = {
      id: "rest-1",
      kind: "restore",
      status: "running",
      phase: "restore/prepare",
      neonBranchId: null,
      restoreFromId: "src-1",
      includeObjects: true,
      isProtection: false,
      error: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      progress: { stage: "", done: 0, total: 0 },
    };

    beforeEach(() => {
      prisma.backupJob.findUnique.mockResolvedValue({
        id: "src-1",
        kind: "manual",
        status: "succeeded",
        includeObjects: true,
        isProtection: false,
        manifest: null,
        neonBranchId: "snap-src-1",
      });
    });

    it("默认分支不是根时拒绝，避免继续制造祖先依赖链", async () => {
      mockBranches.primaryId = "primary-1";
      mockBranches.branches = [
        { id: "primary-1", name: "production", parent_id: "br-root" },
      ];

      await (
        executor as unknown as {
          advanceJob: (job: unknown) => Promise<void>;
        }
      ).advanceJob(stageZeroJob);

      expect(mockRestoreSnapshot).not.toHaveBeenCalled();
      expect(prisma.backupJob.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({ status: "failed" }),
        }),
      );
    });

    it("从 Snapshot 恢复根分支并立即 finalize", async () => {
      mockBranches.primaryId = "primary-1";
      mockBranches.branches = [
        { id: "primary-1", name: "production", parent_id: null },
      ];

      await (
        executor as unknown as {
          advanceJob: (job: unknown) => Promise<void>;
        }
      ).advanceJob(stageZeroJob);

      expect(mockRestoreSnapshot).toHaveBeenCalledWith({
        snapshotId: "snap-src-1",
        targetBranchId: "primary-1",
      });
      expect(maintenance.setSystemEnabled).toHaveBeenCalledWith(
        true,
        "正在从备份 #src-1 回滚",
      );
    });

    it("restore POST 超时结果未知时保留 requesting，禁止落 failed 或重发", async () => {
      mockBranches.primaryId = "primary-1";
      mockBranches.branches = [
        { id: "primary-1", name: "main", parent_id: null },
      ];
      mockRestoreSnapshot.mockRejectedValueOnce(
        Object.assign(new Error("请求可能已被接受，禁止自动重试"), {
          neonMutationUncertain: true,
        }),
      );

      await (
        executor as unknown as {
          advanceJob: (job: unknown) => Promise<void>;
        }
      ).advanceJob(stageZeroJob);

      expect(prisma.backupJob.upsert).toHaveBeenLastCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({
            status: "running",
            phase: "restore/requesting",
            error: expect.stringContaining("禁止自动重试"),
          }),
        }),
      );
      expect(prisma.backupJob.upsert).not.toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({ status: "failed" }),
        }),
      );
      expect(mockRestoreSnapshot).toHaveBeenCalledTimes(1);
      expect(maintenance.setSystemEnabled).not.toHaveBeenCalledWith(false);
    });

    it("restore POST 被 Neon 明确拒绝时关闭维护模式并落 failed", async () => {
      mockBranches.primaryId = "primary-1";
      mockBranches.branches = [
        { id: "primary-1", name: "main", parent_id: null },
      ];
      mockRestoreSnapshot.mockRejectedValueOnce(
        Object.assign(new Error("Neon API 错误 409：branch name conflict"), {
          status: 409,
        }),
      );

      await (
        executor as unknown as {
          advanceJob: (job: unknown) => Promise<void>;
        }
      ).advanceJob(stageZeroJob);

      expect(maintenance.setSystemEnabled).toHaveBeenNthCalledWith(
        1,
        true,
        "正在从备份 #src-1 回滚",
      );
      expect(maintenance.setSystemEnabled).toHaveBeenNthCalledWith(2, false);
      expect(prisma.backupJob.upsert).toHaveBeenLastCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({
            status: "failed",
            error: expect.stringContaining("409"),
          }),
        }),
      );
    });

    it("requesting 看到 restored_from/restored_as 后只读恢复到 verify", async () => {
      mockBranches.branches = [
        {
          id: "br-restored",
          name: "production",
          parent_id: null,
          restored_from: "snap-src-1",
          restored_as: "br-old-main",
        },
      ];
      const requestingJob = {
        ...stageZeroJob,
        phase: "restore/requesting",
        progress: {
          stage: "restore/requesting",
          done: 0,
          total: 1,
          targetBranchId: "br-old-main",
          restoreRequestStartedAt: new Date().toISOString(),
        },
      };

      await (
        executor as unknown as {
          advanceJob: (job: unknown) => Promise<void>;
        }
      ).advanceJob(requestingJob);

      expect(mockRestoreSnapshot).not.toHaveBeenCalled();
      expect(prisma.backupJob.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({
            phase: "restore/verify",
            error: null,
            progress: expect.objectContaining({ stage: "restore/verify" }),
          }),
        }),
      );
    });
  });

  describe("advanceRestore restore/cleanup（Vercel 维护模式）", () => {
    const cleanupJob = {
      id: "rest-cleanup-1",
      kind: "restore",
      status: "running",
      phase: "restore/cleanup",
      neonBranchId: null,
      restoreFromId: "src-1",
      includeObjects: true,
      isProtection: false,
      error: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      progress: {
        stage: "restore/cleanup",
        done: 1,
        total: 1,
        protectJobId: null,
      },
    };

    it("全部恢复步骤完成后先关闭维护模式，再把任务标成功", async () => {
      mockBranches.branches = [];

      await (
        executor as unknown as {
          advanceJob: (job: unknown) => Promise<void>;
        }
      ).advanceJob(cleanupJob);

      expect(maintenance.setSystemEnabled).toHaveBeenCalledWith(false);
      expect(prisma.backupJob.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({
            status: "succeeded",
            phase: "done",
            error: null,
          }),
        }),
      );
    });

    it("关闭维护模式失败时保留 running/cleanup，供下一棒重试", async () => {
      maintenance.setSystemEnabled.mockRejectedValueOnce(
        new Error("redis unavailable"),
      );

      await (
        executor as unknown as {
          advanceJob: (job: unknown) => Promise<void>;
        }
      ).advanceJob(cleanupJob);

      expect(prisma.backupJob.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({
            status: "running",
            phase: "restore/cleanup",
            error: expect.stringContaining("等待关闭维护模式"),
          }),
        }),
      );
      expect(prisma.backupJob.upsert).not.toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({ status: "succeeded" }),
        }),
      );
    });
  });
});
