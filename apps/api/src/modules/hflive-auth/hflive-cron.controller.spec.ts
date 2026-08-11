import { UnauthorizedException } from "@nestjs/common";
import { IS_PUBLIC_KEY } from "../../common/public.decorator";
import type { RedisClientType } from "redis";
import { RedisService } from "../redis/redis.service";
import type { StorageService } from "../storage/storage.service";
import { HfliveCronController } from "./hflive-cron.controller";
import type { HfliveAuthService } from "./hflive-auth.service";

function controllerWith(overrides: {
  secret?: string;
  redis?: { client?: unknown; setResult?: string | null };
  reconcile?: ReturnType<typeof jest.fn>;
  cleanup?: ReturnType<typeof jest.fn>;
}) {
  const redisClient = {
    set: jest
      .fn()
      .mockResolvedValue(
        overrides.redis?.setResult === undefined
          ? "OK"
          : overrides.redis.setResult,
      ),
    del: jest.fn().mockResolvedValue(1),
  };
  const redis = {
    getClient: jest
      .fn()
      .mockResolvedValue(overrides.redis?.client ?? redisClient),
  };
  const reconcile =
    overrides.reconcile ??
    jest.fn().mockResolvedValue({
      scanned: 2,
      repaired: 1,
      failed: 1,
    });
  const cleanup = overrides.cleanup ?? jest.fn().mockResolvedValue(3);
  const controller = new HfliveCronController(
    {
      get: jest.fn((key: string) =>
        key === "CRON_SECRET" ? (overrides.secret ?? "cron-secret") : undefined,
      ),
    } as never,
    redis as unknown as RedisService,
    { cleanupExpiredPendingUploads: cleanup } as unknown as StorageService,
    { reconcileStaleIdentities: reconcile } as unknown as HfliveAuthService,
  );
  return { controller, redisClient, redis, reconcile, cleanup };
}

describe("HfliveCronController identity reconciliation", () => {
  it("identity-sync 与 daily 都带 @Public()（绕过全局会话守卫）", () => {
    expect(
      Reflect.getMetadata(
        IS_PUBLIC_KEY,
        HfliveCronController.prototype.identitySync,
      ),
    ).toBe(true);
    expect(
      Reflect.getMetadata(IS_PUBLIC_KEY, HfliveCronController.prototype.daily),
    ).toBe(true);
  });

  it("未携带密钥时一律 401", async () => {
    const { controller } = controllerWith({});
    await expect(controller.identitySync()).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    await expect(
      controller.identitySync("Bearer wrong-secret"),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(controller.daily()).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it("锁已被占用时跳过本次对账", async () => {
    const { controller, reconcile } = controllerWith({
      redis: { setResult: null },
    });
    await expect(
      controller.identitySync("Bearer cron-secret"),
    ).resolves.toMatchObject({ ok: true, skipped: true });
    expect(reconcile).not.toHaveBeenCalled();
  });

  it("清扫通过服务层执行并持锁释放", async () => {
    const { controller, redisClient, reconcile } = controllerWith({});
    await expect(
      controller.identitySync("Bearer cron-secret"),
    ).resolves.toMatchObject({ scanned: 2, repaired: 1, failed: 1 });
    expect(reconcile).toHaveBeenCalledWith(30);
    expect(redisClient.set).toHaveBeenCalledWith(
      "liveboard:cron:identity-sync",
      "1",
      expect.objectContaining({ NX: true, PX: 10 * 60 * 1000 }),
    );
    expect(redisClient.del).toHaveBeenCalledWith(
      "liveboard:cron:identity-sync",
    );
  });

  it("daily 顺序执行存储清理与身份对账，各自持锁", async () => {
    const { controller, redisClient, cleanup, reconcile } = controllerWith({});
    const result = await controller.daily("Bearer cron-secret");
    expect(result).toMatchObject({
      ok: true,
      storage: { skipped: false, cleaned: 3 },
      identity: { skipped: false, scanned: 2 },
    });
    expect(cleanup).toHaveBeenCalled();
    expect(reconcile).toHaveBeenCalledWith(30);
    expect(redisClient.set).toHaveBeenCalledWith(
      "liveboard:cron:storage-cleanup",
      "1",
      expect.objectContaining({ PX: 5 * 60 * 1000 }),
    );
    expect(redisClient.set).toHaveBeenCalledWith(
      "liveboard:cron:identity-sync",
      "1",
      expect.objectContaining({ PX: 10 * 60 * 1000 }),
    );
  });
});
