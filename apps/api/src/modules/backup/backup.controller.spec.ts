import { IS_PUBLIC_KEY } from "../../common/public.decorator";
import { BackupController } from "./backup.controller";

/**
 * 回归测试：ActiveUserGuard 是全局守卫（app.module APP_GUARD），cron 请求
 * 只有 Bearer CRON_SECRET、没有会话 cookie。cronTick 必须带 @Public()，
 * 否则守卫会在 isAuthorized 之前以 401「Missing or invalid session」拦截，
 * Vercel 闹钟与接力续跑（self-invocation）全部静默失效（线上曾因此排障数日）。
 */
describe("BackupController cron 端点", () => {
  it("cronTick 带 @Public()（绕过全局会话守卫）", () => {
    const isPublic = Reflect.getMetadata(
      IS_PUBLIC_KEY,
      BackupController.prototype.cronTick,
    );
    expect(isPublic).toBe(true);
  });

  it("admin 端点不受影响（不带 @Public()）", () => {
    const isPublic = Reflect.getMetadata(
      IS_PUBLIC_KEY,
      BackupController.prototype.listJobs,
    );
    expect(isPublic).toBeFalsy();
  });
});
