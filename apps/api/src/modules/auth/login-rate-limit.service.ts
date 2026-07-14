import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHash } from "node:crypto";
import { createClient, type RedisClientType } from "redis";

const WINDOW_SECONDS = 15 * 60;
export const MAX_LOGIN_ATTEMPTS = 8;

@Injectable()
export class LoginRateLimitService implements OnModuleDestroy {
  private readonly logger = new Logger(LoginRateLimitService.name);
  private readonly client: RedisClientType;
  private connectPromise: Promise<unknown> | null = null;
  private readonly fallbackAttempts = new Map<
    string,
    { count: number; expiresAt: number }
  >();

  constructor(config: ConfigService) {
    this.client = createClient({
      url: config.get<string>("REDIS_URL", "redis://localhost:6379"),
      socket: {
        connectTimeout: 1_000,
        reconnectStrategy: false,
      },
    });
    this.client.on("error", (error) => {
      this.logger.warn(`Redis login limiter unavailable: ${error.message}`);
    });
  }

  async isBlocked(clientAddress: string, username: string) {
    const key = this.key(clientAddress, username);
    try {
      const client = await this.getClient();
      return Number((await client.get(key)) ?? 0) >= MAX_LOGIN_ATTEMPTS;
    } catch {
      return this.fallbackCount(key) >= MAX_LOGIN_ATTEMPTS;
    }
  }

  async recordFailure(clientAddress: string, username: string) {
    const key = this.key(clientAddress, username);
    try {
      const client = await this.getClient();
      await client.eval(
        "local count = redis.call('INCR', KEYS[1]); if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]); end; return count",
        { keys: [key], arguments: [String(WINDOW_SECONDS)] },
      );
    } catch {
      const now = Date.now();
      const previous = this.fallbackAttempts.get(key);
      const count =
        previous && previous.expiresAt > now ? previous.count + 1 : 1;
      this.fallbackAttempts.set(key, {
        count,
        expiresAt: now + WINDOW_SECONDS * 1000,
      });
      this.pruneFallback(now);
    }
  }

  async clear(clientAddress: string, username: string) {
    const key = this.key(clientAddress, username);
    this.fallbackAttempts.delete(key);
    try {
      const client = await this.getClient();
      await client.del(key);
    } catch {
      // The in-memory fallback is already clear.
    }
  }

  async onModuleDestroy() {
    if (this.client.isOpen) {
      await this.client.quit();
    }
  }

  private async getClient() {
    if (!this.client.isOpen) {
      this.connectPromise ??= this.client.connect().finally(() => {
        this.connectPromise = null;
      });
      await this.connectPromise;
    }
    return this.client;
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
