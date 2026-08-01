import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { RedisService } from "../redis/redis.service";
import { StorageService } from "../storage/storage.service";

@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly storage: StorageService,
  ) {}

  async check() {
    const checks = await Promise.allSettled([
      withTimeout(this.prisma.$queryRaw`SELECT 1`, 2_000),
      withTimeout(requireHealthyRedis(this.redis.ping()), 2_000),
      withTimeout(this.storage.healthCheckActive(), 2_000),
    ]);
    const names = ["postgres", "redis", "storage"];
    const dependencies = Object.fromEntries(
      checks.map((result, index) => [
        names[index],
        result.status === "fulfilled" ? "ok" : "unavailable",
      ]),
    );
    if (checks.some((result) => result.status === "rejected")) {
      throw new ServiceUnavailableException({
        ok: false,
        service: "liveboard-api",
        dependencies,
      });
    }
    return {
      ok: true,
      service: "liveboard-api",
      dependencies,
      timestamp: new Date().toISOString(),
    };
  }
}

async function requireHealthyRedis(check: Promise<boolean>) {
  if (!(await check)) throw new Error("Redis health check failed");
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number) {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Dependency health check timed out")),
          timeoutMs,
        );
        timer.unref();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
