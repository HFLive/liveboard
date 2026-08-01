import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from "@nestjs/common";
import { createHash } from "node:crypto";
import type { RedisClientType } from "redis";
import { RedisService } from "../redis/redis.service";

const WINDOW_SECONDS = 15 * 60;
export const MAX_LOGIN_ATTEMPTS = 8;

@Injectable()
export class LoginRateLimitService {
  private readonly logger = new Logger(LoginRateLimitService.name);
  private readonly fallbackAttempts = new Map<
    string,
    { count: number; expiresAt: number }
  >();

  constructor(private readonly redis: RedisService) {}

  async isBlocked(clientAddress: string, username: string) {
    const key = this.key(clientAddress, username);
    const client = await this.redis.getClient();
    if (!client) return this.fallbackCount(key) >= MAX_LOGIN_ATTEMPTS;
    try {
      return Number((await client.get(key)) ?? 0) >= MAX_LOGIN_ATTEMPTS;
    } catch (caught) {
      this.logger.warn(`Redis login limiter read failed: ${String(caught)}`);
      this.assertFallbackAllowed();
      return this.fallbackCount(key) >= MAX_LOGIN_ATTEMPTS;
    }
  }

  async recordFailure(clientAddress: string, username: string) {
    const key = this.key(clientAddress, username);
    const client = await this.redis.getClient();
    if (!client) {
      this.recordFallback(key);
      return;
    }
    try {
      await client.eval(
        "local count = redis.call('INCR', KEYS[1]); if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]); end; return count",
        { keys: [key], arguments: [String(WINDOW_SECONDS)] },
      );
    } catch (caught) {
      this.logger.warn(`Redis login limiter write failed: ${String(caught)}`);
      this.assertFallbackAllowed();
      this.recordFallback(key);
    }
  }

  async clear(clientAddress: string, username: string) {
    const key = this.key(clientAddress, username);
    this.fallbackAttempts.delete(key);
    const client = await this.redis.getClient();
    if (!client) return;
    try {
      await client.del(key);
    } catch (caught) {
      this.logger.warn(`Redis login limiter clear failed: ${String(caught)}`);
      this.assertFallbackAllowed();
    }
  }

  private recordFallback(key: string) {
    const now = Date.now();
    const previous = this.fallbackAttempts.get(key);
    const count = previous && previous.expiresAt > now ? previous.count + 1 : 1;
    this.fallbackAttempts.set(key, {
      count,
      expiresAt: now + WINDOW_SECONDS * 1000,
    });
    this.pruneFallback(now);
  }

  private assertFallbackAllowed() {
    if (!this.redis.fallbackAllowed) {
      throw new ServiceUnavailableException("Redis 服务暂不可用");
    }
  }

  private key(clientAddress: string, username: string) {
    const identity = `${clientAddress}:${username.trim().toLowerCase()}`;
    return `liveboard:login-attempts:${createHash("sha256").update(identity).digest("hex")}`;
  }

  private fallbackCount(key: string) {
    const attempt = this.fallbackAttempts.get(key);
    if (!attempt || attempt.expiresAt <= Date.now()) {
      this.fallbackAttempts.delete(key);
      return 0;
    }
    return attempt.count;
  }

  private pruneFallback(now: number) {
    if (this.fallbackAttempts.size <= 1000) return;
    for (const [key, attempt] of this.fallbackAttempts) {
      if (attempt.expiresAt <= now) this.fallbackAttempts.delete(key);
    }
  }
}
