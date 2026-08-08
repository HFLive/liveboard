import { IS_PUBLIC_KEY } from "../../common/public.decorator";
import { StorageCronController } from "./storage-cron.controller";

/**
 * 回归测试：storage-cleanup cron 端点同样被全局 ActiveUserGuard 拦截过，
 * 必须带 @Public() 才能让 Vercel 每日清理真正执行（真实认证仍走 CRON_SECRET）。
 */
describe("StorageCronController cron 端点", () => {
  it("cleanup 带 @Public()（绕过全局会话守卫）", () => {
    const isPublic = Reflect.getMetadata(
      IS_PUBLIC_KEY,
      StorageCronController.prototype.cleanup,
    );
    expect(isPublic).toBe(true);
  });
});
