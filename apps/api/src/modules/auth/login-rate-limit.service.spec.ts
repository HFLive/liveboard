import type { ConfigService } from "@nestjs/config";
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
    const service = new LoginRateLimitService({
      get: (_key: string, fallback?: string) => fallback,
    } as unknown as ConfigService);

    for (let attempt = 0; attempt < MAX_LOGIN_ATTEMPTS; attempt += 1) {
      await service.recordFailure("127.0.0.1", "teacher");
    }
    await expect(service.isBlocked("127.0.0.1", "teacher")).resolves.toBe(true);
    await service.clear("127.0.0.1", "teacher");
    await expect(service.isBlocked("127.0.0.1", "teacher")).resolves.toBe(
      false,
    );
  });
});
