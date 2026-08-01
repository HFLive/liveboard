import { ServiceUnavailableException } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import { RedisService } from "../redis/redis.service";
import {
  LoginRateLimitService,
  MAX_LOGIN_ATTEMPTS,
} from "./login-rate-limit.service";

jest.mock("redis", () => ({
  createClient: () => ({
    isOpen: false,
    on: jest.fn(),
    connect: jest.fn().mockRejectedValue(new Error("Redis unavailable")),
    quit: jest.fn(),
  }),
}));

describe("LoginRateLimitService fallback", () => {
  it("blocks repeated failures and can clear them", async () => {
    const config = {
      get: (_key: string, fallback?: string) => fallback,
    } as unknown as ConfigService;
    const redis = new RedisService(config);
    const service = new LoginRateLimitService(redis);

    for (let attempt = 0; attempt < MAX_LOGIN_ATTEMPTS; attempt += 1) {
      await service.recordFailure("127.0.0.1", "teacher");
    }
    await expect(service.isBlocked("127.0.0.1", "teacher")).resolves.toBe(true);
    await service.clear("127.0.0.1", "teacher");
    await expect(service.isBlocked("127.0.0.1", "teacher")).resolves.toBe(
      false,
    );
  });

  it("fails closed when a production Redis command fails", async () => {
    const client = {
      get: jest.fn().mockRejectedValue(new Error("connection dropped")),
    };
    const redis = {
      fallbackAllowed: false,
      getClient: jest.fn().mockResolvedValue(client),
    } as unknown as RedisService;
    const service = new LoginRateLimitService(redis);

    await expect(
      service.isBlocked("127.0.0.1", "teacher"),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
