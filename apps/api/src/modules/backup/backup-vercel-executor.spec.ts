import { BackupVercelExecutor } from "./backup-vercel-executor";

/**
 * 回归测试：Neon restoreBranch 换库会把备份点之后创建的任务行从 BackupJob
 * 抹掉（回滚行/保护备份行），旧代码 post-swap 的 row.update 全部 P2025 打空，
 * 最终状态只写进 Redis 而 listJobs 从不读它——回滚行静默蒸发、源备份行
 * 永远卡在「执行中」。修复：Redis 状态带行元数据，换库后从 Redis 重建行、
 * 回拷前缀改用源备份 id、收尾重建保护备份行。
 */

/** Neon mock 共享的分支表：executor 每次 this.neon() 都 new 新实例，共享数据让测试可控。 */
const mockBranches: {
  branches: Array<{ id: string; name: string; parent_id?: string | null }>;
  primaryId: string;
} = {
  branches: [],
  primaryId: "primary-1",
};
/** 共享 waitForOperation mock：默认已完成；测试可改为 false 模拟长操作。 */
const mockWaitForOperation = jest.fn().mockResolvedValue(true);
/** 共享 deleteBranch mock：孤儿分支清扫断言用。 */
const mockDeleteBranch = jest.fn().mockResolvedValue(undefined);
/** 共享 restoreBranch mock：preserve 参数断言用。 */
const mockRestoreBranch = jest.fn().mockResolvedValue("op-restore-1");

jest.mock("./neon.client", () => ({
  NeonClient: jest.fn().mockImplementation(() => ({
    createBranch: jest
      .fn()
      .mockResolvedValue({ branchId: "br-1", operationId: "op-1" }),
    listBranches: jest.fn().mockResolvedValue(mockBranches),
    restoreBranch: mockRestoreBranch,
    waitForOperation: mockWaitForOperation,
    deleteBranch: mockDeleteBranch,
  })),
}));

describe("BackupVercelExecutor 换库后的行重建", () => {
  const prisma = {
    backupJob: {
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

  let executor: BackupVercelExecutor;

  beforeEach(() => {
    jest.clearAllMocks();
    mockBranches.branches = [];
    mockBranches.primaryId = "primary-1";
    mockWaitForOperation.mockResolvedValue(true);
    mockDeleteBranch.mockResolvedValue(undefined);
    mockRestoreBranch.mockResolvedValue("op-restore-1");
    redis.getClient.mockResolvedValue(redisClient);
    redisClient.get.mockResolvedValue(null);
    redisClient.set.mockResolvedValue("OK");
    redisClient.keys.mockResolvedValue([]);
    storage.backendFor.mockResolvedValue(storageBackend);
    storageBackend.statObject.mockResolvedValue(null);
    storageBackend.copyObject.mockResolvedValue(undefined);
    prisma.backupJob.create.mockResolvedValue({ id: "row-1" });
    prisma.backupJob.upsert.mockResolvedValue({ id: "row-1" });
    prisma.backupJob.findMany.mockResolvedValue([]);
    executor = new BackupVercelExecutor(
      prisma as never,
      storage as never,
      redis as never,
      config as never,
    );
  });

  afterEach(() => {
    delete process.env.CRON_SECRET;
    delete process.env.API_PUBLIC_URL;
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

  describe("repairSourceBackupRow（源备份行回到快照时刻后的修复）", () => {
    it("重建 manifest、找回分支 id、标成功", async () => {
      // 首次读取是快照行（执行中、无 manifest、无分支 id）；upsert 落库后
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
          neonBranchId: "br-src-1",
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
      mockBranches.branches = [{ id: "br-src-1", name: "backup-src-1" }];
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
            neonBranchId: "br-src-1",
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
        protectJobId: "prot-1",
      },
    };

    it("Neon 操作未完成：心跳更新进度（stage 不变、protectJobId 保留），不落 failed", async () => {
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
              protectJobId: "prot-1",
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
      it("backup-<id> 无对应行 → 删；有行 → 保留", async () => {
        mockBranches.branches = [
          { id: "br-orphan", name: "backup-cmsjuxxx", parent_id: "br-root" },
          { id: "br-keep", name: "backup-cmsjwgle", parent_id: "br-main" },
        ];
        prisma.backupJob.findMany.mockResolvedValue([
          { id: "cmsjwgle", status: "succeeded" },
        ]);

        await (
          executor as unknown as {
            reconcileOrphanedBranches: () => Promise<void>;
          }
        ).reconcileOrphanedBranches();

        expect(mockDeleteBranch).toHaveBeenCalledWith("br-orphan");
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

  describe('advanceRestore stage ""（换库 preserve 决策）', () => {
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
      progress: { stage: "", done: 0, total: 0, protectJobId: "prot-1" },
    };

    beforeEach(() => {
      prisma.backupJob.findUnique.mockResolvedValue({
        id: "src-1",
        kind: "manual",
        status: "succeeded",
        includeObjects: true,
        isProtection: false,
        manifest: null,
        neonBranchId: "br-src-1",
      });
    });

    it("旧主是普通分支：preserve 为 pre-restore-<id>（最后防线）", async () => {
      mockBranches.primaryId = "primary-1";
      mockBranches.branches = [
        { id: "primary-1", name: "production", parent_id: "br-root" },
      ];

      await (
        executor as unknown as {
          advanceJob: (job: unknown) => Promise<void>;
        }
      ).advanceJob(stageZeroJob);

      expect(mockRestoreBranch).toHaveBeenCalledWith(
        expect.objectContaining({
          preserveUnderName: "pre-restore-rest-1",
        }),
      );
    });

    it("旧主是根分支（parent_id 为空）：跳过 preserve，不产生删不掉的根孤儿", async () => {
      mockBranches.primaryId = "primary-1";
      mockBranches.branches = [
        { id: "primary-1", name: "main", parent_id: null },
      ];

      await (
        executor as unknown as {
          advanceJob: (job: unknown) => Promise<void>;
        }
      ).advanceJob(stageZeroJob);

      const call = (mockRestoreBranch as jest.Mock).mock.calls[0][0] as Record<
        string,
        unknown
      >;
      expect(call.preserveUnderName).toBeUndefined();
      expect(call).toEqual(
        expect.objectContaining({
          targetBranchId: "primary-1",
          sourceBranchId: "br-src-1",
        }),
      );
    });
  });
});
