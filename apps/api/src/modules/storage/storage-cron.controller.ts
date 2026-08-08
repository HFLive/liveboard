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
import { StorageService } from "./storage.service";

const CLEANUP_LOCK_KEY = "liveboard:cron:storage-cleanup";
const CLEANUP_LOCK_TTL_MS = 5 * 60 * 1000;

/**
 * Vercel 每日一次的上传清理入口。Self-hosted 继续使用进程内 setInterval，
 * Vercel 是 Serverless，禁用常驻定时器，改由 Cron + 请求时惰性清理 +
 * R2 Lifecycle 共同保证过期上传不会残留。
 *
 * - 认证：`Authorization: Bearer ${CRON_SECRET}`，恒定时间比较。
 * - Redis 分布式锁防止重复执行；清理逻辑幂等。
 * - 未授权一律 401，不返回任何清理信息。
 */
@Controller("internal/cron")
export class StorageCronController {
  private readonly logger = new Logger(StorageCronController.name);
  private readonly expectedSecret: string;

  constructor(
    config: ConfigService,
    private readonly redis: RedisService,
    private readonly storage: StorageService,
  ) {
    this.expectedSecret = config.get<string>("CRON_SECRET", "") ?? "";
  }

  /**
   * @Public：ActiveUserGuard 是全局守卫，不带 @Public() 的端点必须先有会话
   * cookie 才放行——cron 请求只有 Bearer CRON_SECRET，会被守卫在 isAuthorized
   * 之前以 401 拦掉（曾导致 Vercel 上每日清理从不执行）。真实认证在下方
   * isAuthorized（恒定时间比较），放行后仍需密钥。
   */
  @Public()
  @Get("storage-cleanup")
  async cleanup(@Headers("authorization") authorization?: string) {
    if (!this.isAuthorized(authorization)) {
      throw new UnauthorizedException();
    }

    const client = await this.redis.getClient().catch(() => null);
    let releaseLock: (() => Promise<void>) | null = null;
    if (client) {
      const acquired = await client.set(CLEANUP_LOCK_KEY, "1", {
        NX: true,
        PX: CLEANUP_LOCK_TTL_MS,
      });
      if (acquired !== "OK") {
        // 另一个实例正在清理，跳过本次。
        return { ok: true, cleaned: 0, skipped: true };
      }
      releaseLock = () =>
        client
          .del(CLEANUP_LOCK_KEY)
          .then(() => undefined)
          .catch(() => undefined);
    } else {
      this.logger.warn(
        "Redis 不可用，跳过分布式锁直接执行幂等清理（R2 Lifecycle 仍兜底）",
      );
    }

    try {
      const cleaned = await this.storage.cleanupExpiredPendingUploads();
      return { ok: true, cleaned, skipped: false };
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
