import {
  Injectable,
  OnModuleDestroy,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Client as MinioClient } from "minio";
import { createClient, type RedisClientType } from "redis";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class HealthService implements OnModuleDestroy {
  private readonly redis: RedisClientType;
  private readonly minio: MinioClient;
  private redisConnectPromise: Promise<unknown> | null = null;

  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    this.redis = createClient({
      url: config.get<string>("REDIS_URL", "redis://localhost:6379"),
      socket: { connectTimeout: 1_500, reconnectStrategy: false },
    });
    this.redis.on("error", () => undefined);
    this.minio = new MinioClient({
      endPoint: config.get<string>("MINIO_ENDPOINT", "localhost"),
      port: config.get<number>("MINIO_PORT", 9000),
      useSSL: config.get<string>("MINIO_USE_SSL", "false") === "true",
      accessKey: config.get<string>("MINIO_ROOT_USER", "liveboard"),
      secretKey: config.get<string>(
        "MINIO_ROOT_PASSWORD",
        "replace-with-a-strong-password",
      ),
    });
  }

  async check() {
    const checks = await Promise.allSettled([
      withTimeout(this.prisma.$queryRaw`SELECT 1`, 2_000),
      withTimeout(this.pingRedis(), 2_000),
      withTimeout(this.minio.listBuckets(), 2_000),
    ]);
    const names = ["postgres", "redis", "minio"];
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

  async onModuleDestroy() {
    if (this.redis.isOpen) await this.redis.quit();
  }

  private async pingRedis() {
    if (!this.redis.isOpen) {
      this.redisConnectPromise ??= this.redis.connect().finally(() => {
        this.redisConnectPromise = null;
      });
      await this.redisConnectPromise;
    }
    return this.redis.ping();
  }
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
