import {
  Controller,
  Get,
  Headers,
  Logger,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { timingSafeEqual } from "node:crypto";
import { Public } from "../../common/public.decorator";
import { RedisService } from "../redis/redis.service";
import { StorageService } from "../storage/storage.service";
import { HfliveAuthService } from "./hflive-auth.service";

const IDENTITY_SYNC_LOCK_KEY = "liveboard:cron:identity-sync";
const IDENTITY_SYNC_LOCK_TTL_MS = 10 * 60 * 1000;
const STORAGE_CLEANUP_LOCK_KEY = "liveboard:cron:storage-cleanup";
const STORAGE_CLEANUP_LOCK_TTL_MS = 5 * 60 * 1000;
const IDENTITY_SYNC_BATCH = 30;

/**
 * Vercel 每日一次的身份对账入口（自托管继续由进程内 setInterval / 登录路径
 * 兜底）。Vercel 是 Serverless，禁用常驻定时器，改由 Cron + 请求触发对账。
 *
 * - 认证：`Authorization: Bearer ${CRON_SECRET}`，恒定时间比较（与
 *   storage-cron.controller.ts 同一安全模式）。
 * - Redis 分布式锁防止同一任务并发执行；清理逻辑幂等。
 * - 未授权一律 401，不返回任何信息。
 *
 * `identity-sync` 清扫 syncState != CURRENT / 超过 7 天未同步资料的身份；
 * `daily` 顺序执行「存储清理 + 身份对账」，两个子任务各自持有自己的锁。
 */
@Controller("internal/cron")
export class HfliveCronController {
  private readonly logger = new Logger(HfliveCronController.name);
  private readonly expectedSecret: string;

  constructor(
    config: ConfigService,
    private readonly redis: RedisService,
    private readonly storage: StorageService,
    private readonly hflive: HfliveAuthService,
  ) {
    this.expectedSecret = config.get<string>("CRON_SECRET", "") ?? "";
  }

  /**
   * @Public：ActiveUserGuard 是全局守卫，不带 @Public() 的端点必须先有会话
   * cookie 才放行——cron 请求只有 Bearer CRON_SECRET。真实认证在下方
   * isAuthorized（恒定时间比较）。
   */
  @Public()
  @Get("identity-sync")
  async identitySync(@Headers("authorization") authorization?: string) {
    if (!this.isAuthorized(authorization)) {
      throw new UnauthorizedException();
    }
    const client = await this.redis.getClient().catch(() => null);
    let releaseLock: (() => Promise<void>) | null = null;
    if (client) {
      const acquired = await client.set(IDENTITY_SYNC_LOCK_KEY, "1", {
        NX: true,
        PX: IDENTITY_SYNC_LOCK_TTL_MS,
      });
      if (acquired !== "OK") {
        // 另一个实例正在对账，跳过本次。
        return { ok: true, skipped: true, scanned: 0, repaired: 0, failed: 0 };
      }
      releaseLock = () =>
        client
          .del(IDENTITY_SYNC_LOCK_KEY)
          .then(() => undefined)
          .catch(() => undefined);
    } else {
      this.logger.warn(
        "Redis 不可用，跳过分布式锁直接执行幂等对账（请求驱动刷新仍兜底）",
      );
    }
    try {
      const result =
        await this.hflive.reconcileStaleIdentities(IDENTITY_SYNC_BATCH);
      this.logger.log(
        `identity-sync scanned=${result.scanned} repaired=${result.repaired} failed=${result.failed}`,
      );
      return { ok: true, skipped: false, ...result };
    } finally {
      await releaseLock?.();
    }
  }

  /**
   * Vercel cron 指向的合并入口：存储清理 + 身份对账顺序执行，各自持锁。
   * 旧的 /internal/cron/storage-cleanup 端点保留（自托管/回滚兼容）。
   */
  @Public()
  @Get("daily")
  async daily(@Headers("authorization") authorization?: string) {
    if (!this.isAuthorized(authorization)) {
      throw new UnauthorizedException();
    }
    const storage = await this.runWithLock(
      STORAGE_CLEANUP_LOCK_KEY,
      STORAGE_CLEANUP_LOCK_TTL_MS,
      async () => {
        const cleaned = await this.storage.cleanupExpiredPendingUploads();
        return { cleaned };
      },
    );
    const identity = await this.runWithLock(
      IDENTITY_SYNC_LOCK_KEY,
      IDENTITY_SYNC_LOCK_TTL_MS,
      () => this.hflive.reconcileStaleIdentities(IDENTITY_SYNC_BATCH),
    );
    return { ok: true, storage, identity };
  }

  private async runWithLock<T>(
    lockKey: string,
    ttlMs: number,
    operation: () => Promise<T>,
  ): Promise<{ skipped: boolean } & T> {
    const client = await this.redis.getClient().catch(() => null);
    let releaseLock: (() => Promise<void>) | null = null;
    if (client) {
      const acquired = await client.set(lockKey, "1", { NX: true, PX: ttlMs });
      if (acquired !== "OK") {
        return { skipped: true } as { skipped: boolean } & T;
      }
      releaseLock = () =>
        client
          .del(lockKey)
          .then(() => undefined)
          .catch(() => undefined);
    } else {
      this.logger.warn(
        "Redis 不可用，跳过分布式锁直接执行幂等任务（请求驱动刷新仍兜底）",
      );
    }
    try {
      const result = await operation();
      return { skipped: false, ...result };
    } finally {
      await releaseLock?.();
    }
  }

  private isAuthorized(authorization: string | undefined) {
    if (!this.expectedSecret) return false;
    const expected = `Bearer ${this.expectedSecret}`;
    const actual = authorization ?? "";
    const expectedBuffer = Buffer.from(expected);
    const actualBuffer = Buffer.from(actual);
    if (expectedBuffer.length !== actualBuffer.length) return false;
    return timingSafeEqual(expectedBuffer, actualBuffer);
  }
}
