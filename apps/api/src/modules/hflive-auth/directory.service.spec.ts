import type { RedisClientType } from "redis";
import { RedisService } from "../redis/redis.service";
import type { HfliveAuthConfig } from "./hflive-auth.config";
import {
  DirectoryRequestError,
  HfliveDirectoryService,
} from "./directory.service";

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: jest.fn().mockResolvedValue(body),
    body: { cancel: jest.fn() },
  } as unknown as Response;
}

describe("HfliveDirectoryService token caching", () => {
  const config = {
    directoryClientId: "directory-client",
    directoryClientSecret: "directory-secret",
  };
  const redisClient = {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
  };
  const redis = { getClient: jest.fn() };
  let fetchMock: jest.Mock;
  let service: HfliveDirectoryService;

  beforeEach(() => {
    jest.resetAllMocks();
    fetchMock = jest.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    redisClient.get.mockResolvedValue(null);
    redisClient.set.mockResolvedValue("OK");
    redisClient.del.mockResolvedValue(1);
    redis.getClient.mockResolvedValue(
      redisClient as unknown as RedisClientType,
    );
    service = new HfliveDirectoryService(
      config as unknown as HfliveAuthConfig,
      redis as unknown as RedisService,
    );
  });

  it("caches the token and reuses it for a second request", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          access_token: "token-1",
          expires_in: 3600,
          scope: "directory:user:read",
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          subject: "s-1",
          status: "ACTIVE",
          updatedAt: "2026-08-11T00:00:00.000Z",
        }),
      );
    await service.getStatus("s-1");
    expect(redisClient.set).toHaveBeenCalledWith(
      "liveboard:hflive:directory-token",
      "token-1",
      expect.objectContaining({ EX: 3540 }),
    );

    // 第二次调用命中缓存，不再请求 token 端点。
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        subject: "s-1",
        status: "ACTIVE",
        updatedAt: "2026-08-11T00:00:00.000Z",
      }),
    );
    redisClient.get.mockResolvedValue("token-1");
    await service.getStatus("s-1");
    // 第一次：token + status；第二次：仅 status。
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[2][0]).not.toContain("/oauth2/token");
  });

  it("invalidates the cached token and refetches once on a 401 directory response", async () => {
    redisClient.get.mockResolvedValue("stale-token");
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ error: "unauthorized" }, 401))
      .mockResolvedValueOnce(
        jsonResponse({ access_token: "fresh-token", expires_in: 3600 }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          subject: "s-1",
          status: "ACTIVE",
          updatedAt: "2026-08-11T00:00:00.000Z",
        }),
      );
    await service.getStatus("s-1");
    expect(redisClient.del).toHaveBeenCalledWith(
      "liveboard:hflive:directory-token",
    );
    expect(fetchMock.mock.calls[1][0]).toContain("/oauth2/token");
    const directoryCall = fetchMock.mock.calls[2][1] as RequestInit;
    expect(directoryCall.headers).toEqual(
      expect.objectContaining({ authorization: "Bearer fresh-token" }),
    );
  });

  it("falls back to fetching a token per call when Redis is unavailable", async () => {
    redis.getClient.mockResolvedValue(null);
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({ access_token: "token-1", expires_in: 3600 }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          subject: "s-1",
          status: "ACTIVE",
          updatedAt: "2026-08-11T00:00:00.000Z",
        }),
      );
    await expect(service.getStatus("s-1")).resolves.toMatchObject({
      status: "ACTIVE",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("converts token endpoint auth failures to UNAUTHORIZED", async () => {
    redis.getClient.mockResolvedValue(null);
    fetchMock.mockResolvedValue(jsonResponse({ error: "invalid_client" }, 401));
    await expect(service.getStatus("s-1")).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("converts directory 404 to NOT_FOUND", async () => {
    redis.getClient.mockResolvedValue(null);
    fetchMock.mockResolvedValue(jsonResponse({ error: "not found" }, 404));
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ access_token: "token-1", expires_in: 3600 }),
    );
    await expect(service.getStatus("s-1")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});
