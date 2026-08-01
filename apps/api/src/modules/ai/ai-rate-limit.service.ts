import {
  HttpException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHash } from "node:crypto";
import type { RedisClientType } from "redis";
import { RedisService } from "../redis/redis.service";

interface FallbackState {
  count: number;
  expiresAt: number;
  concurrent: number;
}

@Injectable()
export class AiRateLimitService {
  private readonly logger = new Logger(AiRateLimitService.name);
  private readonly maxRequests: number;
  private readonly windowSeconds: number;
  private readonly maxConcurrent: number;
  private readonly fallback = new Map<string, FallbackState>();

  constructor(
    config: ConfigService,
    private readonly redis: RedisService,
  ) {
    this.maxRequests = positiveInt(
      config.get<string>("AI_RATE_LIMIT_MAX_REQUESTS"),
      30,
    );
    this.windowSeconds = positiveInt(
      config.get<string>("AI_RATE_LIMIT_WINDOW_SECONDS"),
      900,
    );
    this.maxConcurrent = positiveInt(
      config.get<string>("AI_MAX_CONCURRENT_PER_USER"),
      2,
    );
  }

  async acquire(userId: string | null) {
    if (!userId) throw new HttpException("Missing session", 401);
    const identity = createHash("sha256").update(userId).digest("hex");
    const rateKey = `liveboard:ai-rate:${identity}`;
    const concurrentKey = `liveboard:ai-concurrent:${identity}`;
    const client = await this.redis.getClient();
    if (!client) {
      return this.acquireFallback(identity);
    }
    try {
      const result = (await client.eval(
        [
          "local rate = redis.call('INCR', KEYS[1])",
          "if rate == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end",
          "if rate > tonumber(ARGV[2]) then return {0, rate} end",
          "local active = redis.call('INCR', KEYS[2])",
          "redis.call('EXPIRE', KEYS[2], ARGV[3])",
          "if active > tonumber(ARGV[4]) then redis.call('DECR', KEYS[2]); return {1, active} end",
          "return {2, active}",
        ].join("; "),
        {
          keys: [rateKey, concurrentKey],
          arguments: [
            String(this.windowSeconds),
            String(this.maxRequests),
            "180",
            String(this.maxConcurrent),
          ],
        },
      )) as number[];
      if (Number(result[0]) === 0) {
        throw new HttpException("AI 请求过于频繁，请稍后再试", 429);
      }
      if (Number(result[0]) === 1) {
        throw new HttpException("当前 AI 请求尚未完成，请稍后再试", 429);
      }
      let released = false;
      return async () => {
        if (released) return;
        released = true;
        await client
          .eval(
            "local value = tonumber(redis.call('GET', KEYS[1]) or '0'); if value <= 1 then return redis.call('DEL', KEYS[1]) else return redis.call('DECR', KEYS[1]) end",
            { keys: [concurrentKey], arguments: [] },
          )
          .catch(() => undefined);
      };
    } catch (caught) {
      if (caught instanceof HttpException) throw caught;
      if (!this.redis.fallbackAllowed) {
        throw new ServiceUnavailableException("Redis 服务暂不可用");
      }
      return this.acquireFallback(identity);
    }
  }

  private acquireFallback(identity: string) {
    const now = Date.now();
    const previous = this.fallback.get(identity);
    const state =
      previous && previous.expiresAt > now
        ? previous
        : {
            count: 0,
            concurrent: previous?.concurrent ?? 0,
            expiresAt: now + this.windowSeconds * 1000,
          };
    if (state.count >= this.maxRequests) {
      throw new HttpException("AI 请求过于频繁，请稍后再试", 429);
    }
    if (state.concurrent >= this.maxConcurrent) {
      throw new HttpException("当前 AI 请求尚未完成，请稍后再试", 429);
    }
    state.count += 1;
    state.concurrent += 1;
    this.fallback.set(identity, state);
    let released = false;
    return async () => {
      if (released) return;
      released = true;
      const current = this.fallback.get(identity);
      if (current) current.concurrent = Math.max(0, current.concurrent - 1);
    };
  }
}

function positiveInt(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
