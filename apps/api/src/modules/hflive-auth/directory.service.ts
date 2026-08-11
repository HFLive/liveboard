import { Injectable } from "@nestjs/common";
import { RedisService } from "../redis/redis.service";
import { HFLIVE_ISSUER, HfliveAuthConfig } from "./hflive-auth.config";

const DIRECTORY_TOKEN_KEY = "liveboard:hflive:directory-token";

export type DirectoryStatus = "ACTIVE" | "DISABLED";

export interface DirectoryProfile {
  subject: string;
  preferredUsername: string;
  name: string;
  picture: string | null;
  email: string | null;
  emailVerified: boolean;
  status: DirectoryStatus;
  updatedAt: string;
}

export class DirectoryRequestError extends Error {
  constructor(
    readonly code:
      "UNAVAILABLE" | "UNAUTHORIZED" | "NOT_FOUND" | "INVALID_RESPONSE",
  ) {
    super(code);
  }
}

@Injectable()
export class HfliveDirectoryService {
  private inFlightTokenPromise: Promise<string> | null = null;

  constructor(
    private readonly config: HfliveAuthConfig,
    private readonly redis: RedisService,
  ) {}

  async getStatus(subject: string) {
    return this.request<{
      subject: string;
      status: DirectoryStatus;
      updatedAt: string;
    }>(subject, "status", "directory:user:status");
  }

  async getProfile(subject: string) {
    return this.request<DirectoryProfile>(
      subject,
      "profile",
      "directory:user:read",
    );
  }

  private async request<T>(
    subject: string,
    kind: "status" | "profile",
    scope: string,
  ) {
    const suffix = kind === "status" ? "/status" : "";
    const directoryFetch = (token: string) =>
      fetch(
        `${HFLIVE_ISSUER}/api/directory/users/${encodeURIComponent(subject)}${suffix}`,
        {
          redirect: "error",
          signal: AbortSignal.timeout(5_000),
          headers: {
            authorization: `Bearer ${token}`,
            accept: "application/json",
          },
        },
      );
    let token = await this.getAccessToken(scope);
    let response: Response;
    try {
      response = await directoryFetch(token);
    } catch {
      throw new DirectoryRequestError("UNAVAILABLE");
    }
    // 上游轮换后缓存 token 失效：清除缓存并用新 token 重试一次。
    if (response.status === 401 || response.status === 403) {
      await response.body?.cancel();
      await this.invalidateToken();
      try {
        token = await this.fetchAccessToken(scope);
        response = await directoryFetch(token);
      } catch (caught) {
        if (caught instanceof DirectoryRequestError) throw caught;
        throw new DirectoryRequestError("UNAVAILABLE");
      }
    }
    if (response.status === 401 || response.status === 403) {
      await response.body?.cancel();
      throw new DirectoryRequestError("UNAUTHORIZED");
    }
    if (response.status === 404) {
      await response.body?.cancel();
      throw new DirectoryRequestError("NOT_FOUND");
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new DirectoryRequestError("UNAVAILABLE");
    }
    try {
      return (await response.json()) as T;
    } catch {
      throw new DirectoryRequestError("INVALID_RESPONSE");
    }
  }

  /**
   * client_credentials token 缓存在 Redis（TTL = expires_in - 60s），并做
   * 进程内单飞合并并发请求。Redis 不可用时（本地开发/测试允许内存降级）回退
   * 为每次调用都重新获取。
   */
  private async getAccessToken(scope: string) {
    const client = await this.redis.getClient().catch(() => null);
    if (client) {
      const cached = await client.get(DIRECTORY_TOKEN_KEY).catch(() => null);
      if (cached) return cached;
    }
    if (this.inFlightTokenPromise) return this.inFlightTokenPromise;
    this.inFlightTokenPromise = this.fetchAccessToken(scope, client).finally(
      () => {
        this.inFlightTokenPromise = null;
      },
    );
    return this.inFlightTokenPromise;
  }

  private async invalidateToken() {
    this.inFlightTokenPromise = null;
    const client = await this.redis.getClient().catch(() => null);
    if (client) await client.del(DIRECTORY_TOKEN_KEY).catch(() => undefined);
  }

  private async fetchAccessToken(
    scope: string,
    client?: Awaited<ReturnType<RedisService["getClient"]>> | null,
  ) {
    const authorization = Buffer.from(
      `${this.config.directoryClientId}:${this.config.directoryClientSecret}`,
    ).toString("base64");
    let response: Response;
    try {
      response = await fetch(`${HFLIVE_ISSUER}/api/auth/oauth2/token`, {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(5_000),
        headers: {
          authorization: `Basic ${authorization}`,
          "content-type": "application/x-www-form-urlencoded",
          accept: "application/json",
        },
        body: new URLSearchParams({ grant_type: "client_credentials", scope }),
      });
    } catch {
      throw new DirectoryRequestError("UNAVAILABLE");
    }
    if (
      response.status === 400 ||
      response.status === 401 ||
      response.status === 403
    ) {
      await response.body?.cancel();
      throw new DirectoryRequestError("UNAUTHORIZED");
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new DirectoryRequestError("UNAVAILABLE");
    }
    const payload = (await response.json().catch(() => null)) as {
      access_token?: unknown;
      expires_in?: unknown;
    } | null;
    if (!payload || typeof payload.access_token !== "string") {
      throw new DirectoryRequestError("INVALID_RESPONSE");
    }
    if (client && typeof payload.expires_in === "number") {
      const ttlSeconds = Math.max(60, Math.floor(payload.expires_in) - 60);
      await client
        .set(DIRECTORY_TOKEN_KEY, payload.access_token, {
          EX: ttlSeconds,
        })
        .catch(() => undefined);
    }
    return payload.access_token;
  }
}
