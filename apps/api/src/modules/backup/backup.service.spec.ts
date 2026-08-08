import { BackupService } from "./backup.service";

/**
 * 回归测试：Vercel 无状态文件，running 任务接力断裂/调用挂死后永远停在
 * 「进行中」（曾线上表现为回滚行冻结在唤醒时刻，updatedAt 不再前进，
 * 任何 Run/接力都推不动、UI 永久显示进行中）。reconcileStaleRunningJobs
 * 对超过 30 分钟无进度更新的 running 任务落 failed，可清除后重新发起。
 */
describe("BackupService reconcileStaleRunningJobs", () => {
  const prisma = {
    backupJob: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    backupSettings: { findFirst: jest.fn(), updateMany: jest.fn() },
  };
  const config = {
    get: jest.fn((_key?: string): string | undefined => undefined),
  };
  const vercelExecutor = {};

  let service: BackupService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new BackupService(
      prisma as never,
      config as never,
      vercelExecutor as never,
    );
  });

  it("running 超过 30 分钟无更新的任务落 failed（带可重新发起提示）", async () => {
    prisma.backupJob.findMany.mockResolvedValue([
      { id: "rest-1", kind: "restore", phase: "restore/prepare" },
    ]);
    prisma.backupJob.update.mockResolvedValue({ id: "rest-1" });

    await (
      service as unknown as {
        reconcileStaleRunningJobs: () => Promise<void>;
      }
    ).reconcileStaleRunningJobs();

    expect(prisma.backupJob.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: "running",
          updatedAt: { lt: expect.any(Date) },
        }),
      }),
    );
    expect(prisma.backupJob.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "rest-1" },
        data: expect.objectContaining({
          status: "failed",
          error: expect.stringContaining("重新发起"),
          finishedAt: expect.any(Date),
        }),
      }),
    );
  });

  it("没有卡死的 running 任务时不更新任何行", async () => {
    prisma.backupJob.findMany.mockResolvedValue([]);

    await (
      service as unknown as {
        reconcileStaleRunningJobs: () => Promise<void>;
      }
    ).reconcileStaleRunningJobs();

    expect(prisma.backupJob.update).not.toHaveBeenCalled();
  });

  it("findMany 失败时静默跳过（tick 兜底不阻塞）", async () => {
    prisma.backupJob.findMany.mockRejectedValue(new Error("db down"));

    await expect(
      (
        service as unknown as {
          reconcileStaleRunningJobs: () => Promise<void>;
        }
      ).reconcileStaleRunningJobs(),
    ).resolves.toBeUndefined();
  });

  it("Vercel pending 回滚的保护备份已成功时重新唤醒，不误标失败", async () => {
    config.get.mockImplementation((key?: string) =>
      key === "DEPLOYMENT_TARGET" ? "vercel" : undefined,
    );
    prisma.backupJob.findMany.mockResolvedValue([
      {
        id: "rest-1",
        kind: "restore",
        status: "pending",
        progress: { protectJobId: "protect-1" },
      },
    ]);
    prisma.backupJob.findUnique.mockResolvedValue({ status: "succeeded" });
    prisma.backupJob.update.mockResolvedValue({ id: "rest-1" });

    await (
      service as unknown as {
        reconcileOrphanedRestores: () => Promise<void>;
      }
    ).reconcileOrphanedRestores();

    expect(prisma.backupJob.update).toHaveBeenCalledWith({
      where: { id: "rest-1" },
      data: {
        status: "running",
        phase: "restore/prepare",
        startedAt: expect.any(Date),
      },
    });
    expect(prisma.backupJob.update).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "failed" }),
      }),
    );
  });

  it("Vercel 缺少 CRON_SECRET 时判定备份不可用，避免创建无法接力的任务", () => {
    const previous = {
      NEON_API_KEY: process.env.NEON_API_KEY,
      NEON_PROJECT_ID: process.env.NEON_PROJECT_ID,
      REDIS_URL: process.env.REDIS_URL,
      CRON_SECRET: process.env.CRON_SECRET,
    };
    process.env.NEON_API_KEY = "configured";
    process.env.NEON_PROJECT_ID = "configured";
    process.env.REDIS_URL = "rediss://configured.example";
    delete process.env.CRON_SECRET;

    try {
      const missing = (
        service as unknown as {
          missingVercelBackupConfig: () => string[];
        }
      ).missingVercelBackupConfig();
      expect(missing).toEqual(["CRON_SECRET"]);
    } finally {
      for (const [name, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  });
});

describe("BackupService Vercel warm instance 进程内锁", () => {
  const previousEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const name of [
      "NEON_API_KEY",
      "NEON_PROJECT_ID",
      "REDIS_URL",
      "CRON_SECRET",
    ]) {
      previousEnv[name] = process.env[name];
      process.env[name] = "configured";
    }
  });

  afterEach(() => {
    for (const [name, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  it("一次手动备份请求结束后释放本地哨兵，复用实例可再次启动", async () => {
    let nextJob = 0;
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: "admin-1",
          username: "admin",
          systemRole: "super_admin",
          status: "active",
        }),
      },
      backupSettings: { findFirst: jest.fn().mockResolvedValue(null) },
      backupJob: {
        create: jest.fn().mockImplementation(() => {
          nextJob += 1;
          return Promise.resolve({ id: `job-${nextJob}` });
        }),
        findUnique: jest.fn().mockImplementation(({ where: { id } }) =>
          Promise.resolve({
            id,
            kind: "manual",
            status: "succeeded",
            phase: "done",
            backupPath: null,
            restoreFromId: null,
            neonBranchId: `branch-${id}`,
            dumpSizeBytes: null,
            objectCount: 0,
            includeObjects: false,
            isProtection: false,
            manifest: null,
            error: null,
            createdById: "admin-1",
            createdAt: new Date(),
            startedAt: new Date(),
            finishedAt: new Date(),
            updatedAt: new Date(),
          }),
        ),
      },
    };
    const config = {
      get: jest.fn((key?: string) =>
        key === "DEPLOYMENT_TARGET" ? "vercel" : undefined,
      ),
    };
    const vercelExecutor = {
      findInFlightJobId: jest.fn().mockResolvedValue(null),
      assertBranchCapacity: jest.fn().mockResolvedValue(undefined),
      advanceUntilFinished: jest.fn().mockResolvedValue(undefined),
    };
    const service = new BackupService(
      prisma as never,
      config as never,
      vercelExecutor as never,
    );

    await expect(
      service.startManualBackup("admin-1", { includeObjects: false }),
    ).resolves.toMatchObject({ id: "job-1", status: "succeeded" });
    await expect(
      service.startManualBackup("admin-1", { includeObjects: false }),
    ).resolves.toMatchObject({ id: "job-2", status: "succeeded" });

    expect(vercelExecutor.advanceUntilFinished).toHaveBeenCalledTimes(2);
  });

  it("Vercel 回滚不创建第二个保护 Snapshot，直接建立 restore 任务", async () => {
    const now = new Date();
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: "admin-1",
          username: "admin",
          systemRole: "super_admin",
          status: "active",
        }),
      },
      backupSettings: { findFirst: jest.fn().mockResolvedValue(null) },
      backupJob: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: "restore-1" }),
        update: jest.fn(),
        findUnique: jest.fn().mockImplementation(({ where: { id } }) => {
          if (id === "backup-1") {
            return Promise.resolve({
              id,
              kind: "manual",
              status: "succeeded",
              includeObjects: true,
              neonBranchId: "snap-1",
            });
          }
          return Promise.resolve({
            id: "restore-1",
            kind: "restore",
            status: "running",
            phase: "restore/prepare",
            restoreFromId: "backup-1",
            neonBranchId: null,
            dumpSizeBytes: null,
            objectCount: null,
            includeObjects: true,
            isProtection: false,
            manifest: null,
            error: null,
            createdById: "admin-1",
            createdAt: now,
            startedAt: now,
            finishedAt: null,
            updatedAt: now,
          });
        }),
      },
    };
    const config = {
      get: jest.fn((key?: string) =>
        key === "DEPLOYMENT_TARGET" ? "vercel" : undefined,
      ),
    };
    const vercelExecutor = {
      findInFlightJobId: jest.fn().mockResolvedValue(null),
      assertBranchCapacity: jest.fn().mockResolvedValue(undefined),
      armRestoreChain: jest.fn().mockResolvedValue(undefined),
      advanceUntilFinished: jest.fn().mockResolvedValue(undefined),
    };
    const service = new BackupService(
      prisma as never,
      config as never,
      vercelExecutor as never,
    );

    await expect(
      service.startRestore("admin-1", "backup-1", {
        confirm: "CONFIRM-RESTORE",
      }),
    ).resolves.toMatchObject({
      preBackup: null,
      restore: { id: "restore-1" },
    });
    expect(prisma.backupJob.create).toHaveBeenCalledTimes(1);
    expect(vercelExecutor.armRestoreChain).toHaveBeenCalledWith(
      "restore-1",
      "backup-1",
      null,
      true,
    );
  });
});
