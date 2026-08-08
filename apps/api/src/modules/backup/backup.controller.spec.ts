import { IS_PUBLIC_KEY } from "../../common/public.decorator";
import { waitUntil } from "@vercel/functions";
import { BackupController } from "./backup.controller";

jest.mock("@vercel/functions", () => ({ waitUntil: jest.fn() }));

/**
 * 回归测试：ActiveUserGuard 是全局守卫（app.module APP_GUARD），cron 请求
 * 只有 Bearer CRON_SECRET、没有会话 cookie。cronTick 必须带 @Public()，
 * 否则守卫会在 isAuthorized 之前以 401「Missing or invalid session」拦截，
 * Vercel 闹钟与接力续跑（self-invocation）全部静默失效（线上曾因此排障数日）。
 */
describe("BackupController cron 端点", () => {
  afterEach(() => {
    delete process.env.VERCEL;
    jest.clearAllMocks();
  });
  it("cronTick 带 @Public()（绕过全局会话守卫）", () => {
    const isPublic = Reflect.getMetadata(
      IS_PUBLIC_KEY,
      BackupController.prototype.cronTick,
    );
    expect(isPublic).toBe(true);
  });

  it("删除备份把当前用户传给服务层做 super_admin 校验", async () => {
    const backup = {
      deleteBackup: jest.fn().mockResolvedValue({ deleted: true }),
    };
    const controller = new BackupController(
      { get: jest.fn().mockReturnValue("secret") } as never,
      {} as never,
      backup as never,
    );

    await controller.deleteJob("super-admin-1", "backup-1");

    expect(backup.deleteBackup).toHaveBeenCalledWith(
      "super-admin-1",
      "backup-1",
    );
  });

  it("admin 端点不受影响（不带 @Public()）", () => {
    const isPublic = Reflect.getMetadata(
      IS_PUBLIC_KEY,
      BackupController.prototype.listJobs,
    );
    expect(isPublic).toBeFalsy();
  });

  it("Vercel 接力立即响应，并用 waitUntil 托管实际推进", async () => {
    process.env.VERCEL = "1";
    const continuation = new Promise<{ continued: boolean }>(() => undefined);
    const backup = {
      continueVercelJob: jest.fn().mockReturnValue(continuation),
    };
    const controller = new BackupController(
      { get: jest.fn().mockReturnValue("secret") } as never,
      {} as never,
      backup as never,
    );

    await expect(
      controller.cronTick("Bearer secret", "job-1"),
    ).resolves.toEqual({ ok: true, continued: true, accepted: true });
    expect(waitUntil).toHaveBeenCalledWith(expect.any(Promise));
    expect(backup.continueVercelJob).toHaveBeenCalledWith("job-1");
  });

  it("非 Vercel 环境保持同步等待，便于本地验证", async () => {
    const backup = {
      continueVercelJob: jest.fn().mockResolvedValue({ continued: true }),
    };
    const controller = new BackupController(
      { get: jest.fn().mockReturnValue("secret") } as never,
      {} as never,
      backup as never,
    );

    await expect(
      controller.cronTick("Bearer secret", "job-1"),
    ).resolves.toEqual({ ok: true, continued: true });
    expect(waitUntil).not.toHaveBeenCalled();
  });
});
