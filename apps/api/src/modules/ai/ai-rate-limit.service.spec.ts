import { HttpException } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import { AiRateLimitService } from "./ai-rate-limit.service";

jest.mock("redis", () => ({
  createClient: () => ({
    isOpen: false,
    on: jest.fn(),
    connect: jest.fn().mockRejectedValue(new Error("Redis unavailable")),
    quit: jest.fn(),
  }),
}));

function createService(values: Record<string, string>) {
  return new AiRateLimitService({
    get: (key: string, fallback?: string) => values[key] ?? fallback,
  } as unknown as ConfigService);
}

describe("AiRateLimitService fallback", () => {
  it("limits concurrent requests per user", async () => {
    const service = createService({ AI_MAX_CONCURRENT_PER_USER: "2" });
    const releaseFirst = await service.acquire("user-1");
    const releaseSecond = await service.acquire("user-1");

    await expect(service.acquire("user-1")).rejects.toBeInstanceOf(
      HttpException,
    );
    await releaseFirst();
    await expect(service.acquire("user-1")).resolves.toEqual(
      expect.any(Function),
    );
    await releaseSecond();
  });

  it("limits requests within the configured window", async () => {
    const service = createService({
      AI_RATE_LIMIT_MAX_REQUESTS: "2",
      AI_MAX_CONCURRENT_PER_USER: "2",
    });
    const first = await service.acquire("user-1");
    await first();
    const second = await service.acquire("user-1");
    await second();

    await expect(service.acquire("user-1")).rejects.toThrow("AI 请求过于频繁");
  });
});
