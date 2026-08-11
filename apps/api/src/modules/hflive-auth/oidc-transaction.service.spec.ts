import {
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import type { RedisService } from "../redis/redis.service";
import { OidcTransactionService } from "./oidc-transaction.service";

describe("OidcTransactionService", () => {
  beforeEach(() => {
    process.env.SESSION_SECRET = "phase-6-test-session-secret";
  });

  it("stores only a digested key and consumes state exactly once", async () => {
    const values = new Map<string, string>();
    const client = {
      set: jest.fn(async (key: string, value: string) =>
        values.set(key, value),
      ),
      getDel: jest.fn(async (key: string) => {
        const value = values.get(key) ?? null;
        values.delete(key);
        return value;
      }),
    };
    const service = new OidcTransactionService({
      getClient: jest.fn().mockResolvedValue(client),
    } as unknown as RedisService);
    const transaction = {
      codeVerifier: "verifier",
      nonce: "nonce",
      returnTo: "/app",
      intent: "LOGIN" as const,
      createdAt: new Date().toISOString(),
    };
    await service.storeOidc("raw-state", transaction);
    expect(client.set.mock.calls[0]![0]).not.toContain("raw-state");
    await expect(service.consumeOidc("raw-state")).resolves.toEqual(
      transaction,
    );
    await expect(service.consumeOidc("raw-state")).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it("rejects external, protocol-relative, and backslash return paths", () => {
    const service = new OidcTransactionService({} as RedisService);
    expect(() => service.normalizeReturnTo("https://evil.example")).toThrow();
    expect(() => service.normalizeReturnTo("//evil.example")).toThrow();
    expect(() => service.normalizeReturnTo("/\\evil")).toThrow();
    expect(() => service.normalizeReturnTo("/%5c%5cevil.example")).toThrow();
    expect(() => service.normalizeReturnTo("/%2f%2fevil.example")).toThrow();
    expect(service.normalizeReturnTo("/app/files?id=1")).toBe(
      "/app/files?id=1",
    );
  });

  it("fails closed when development Redis would otherwise fall back to memory", async () => {
    const service = new OidcTransactionService({
      getClient: jest.fn().mockResolvedValue(null),
    } as unknown as RedisService);
    await expect(
      service.storeOidc("state", {
        codeVerifier: "v",
        nonce: "n",
        returnTo: "/app",
        intent: "LOGIN",
        createdAt: new Date().toISOString(),
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
