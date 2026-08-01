import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createClient, type RedisClientType } from "redis";
import {
  getDeploymentTarget,
  type DeploymentTarget,
} from "../../common/deployment-target";

/**
 * 全局共享的惰性 Redis 连接。
 *
 * - 同一函数实例复用同一个客户端，首次使用时才建连。
 * - 支持 `rediss://` TLS 地址。
 * - 断线时有限重连，避免无限阻塞请求。
 * - 本地开发/测试允许内存 fallback（getClient 返回 null）；Vercel 和其他
 *   生产环境禁止 fallback，Redis 不可用时抛出 503。
 */
@Injectable()
export class RedisService {
  private readonly logger = new Logger(RedisService.name);
  private readonly url: string;
  private readonly deploymentTarget: DeploymentTarget;
  private readonly production: boolean;
  private client: RedisClientType | null = null;
  private connectPromise: Promise<unknown> | null = null;

  constructor(config: ConfigService) {
    this.url = config.get<string>("REDIS_URL", "redis://localhost:6379");
    this.deploymentTarget = getDeploymentTarget(config);
    this.production = process.env.NODE_ENV === "production";
  }

  /** 是否允许在 Redis 不可用时使用进程内内存降级。 */
  get fallbackAllowed() {
    return this.deploymentTarget !== "vercel" && !this.production;
  }

  /**
   * 获取共享 Redis 客户端。
   * - Redis 可用：返回客户端。
   * - Redis 不可用且允许内存降级：返回 null。
   * - Redis 不可用且禁止降级（Vercel/生产）：抛出 503。
   */
  async getClient(): Promise<RedisClientType | null> {
    if (this.client?.isOpen) return this.client;
    try {
      await this.connect();
      return this.client;
    } catch (caught) {
      this.logger.warn(
        `Redis unavailable: ${caught instanceof Error ? caught.message : String(caught)}`,
      );
      if (this.fallbackAllowed) return null;
      throw new ServiceUnavailableException("Redis 服务暂不可用");
    }
  }

  /** 健康检查用：Redis 是否可 ping。 */
  async ping(): Promise<boolean> {
    try {
      const client = await this.getClient();
      if (!client) return false;
      await client.ping();
      return true;
    } catch {
      return false;
    }
  }

  private connect() {
    if (!this.client) {
      this.client = createClient({
        url: this.url,
        socket: {
          connectTimeout: 1_000,
          // 有限重连，避免在不可用的 Redis 上无限重试阻塞请求。
          reconnectStrategy: (retries) =>
            retries > 5 ? false : Math.min(100 * 2 ** retries, 2_000),
        },
      });
      this.client.on("error", (error) => {
        this.logger.warn(`Redis error: ${error.message}`);
      });
    }
    if (this.client.isOpen) return Promise.resolve();
    this.connectPromise ??= this.client.connect().finally(() => {
      this.connectPromise = null;
    });
    return this.connectPromise;
  }
}
