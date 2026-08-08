import { BackupService } from "./backup.service";

/**
 * 回归测试：Vercel 无状态文件，running 任务接力断裂/调用挂死后永远停在
 * 「进行中」（曾线上表现为回滚行冻结在唤醒时刻，updatedAt 不再前进，
 * 任何 Run/接力都推不动、UI 永久显示进行中）。reconcileStaleRunningJobs
 * 对超过 30 分钟无进度更新的 running 任务落 failed，可清除后重新发起。
 */
describe("BackupService reconcileStaleRunningJobs", () => {
  const prisma = {
    backupJob: { findMany: jest.fn(), update: jest.fn() },
    backupSettings: { findFirst: jest.fn(), updateMany: jest.fn() },
  };
  const config = {
    get: jest.fn(() => undefined),
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
});
