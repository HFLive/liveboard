import { ServiceUnavailableException } from "@nestjs/common";
import { HealthService } from "./health.service";

describe("HealthService", () => {
  function createService() {
    const service = Object.create(HealthService.prototype) as unknown as {
      check: HealthService["check"];
      prisma: { $queryRaw: jest.Mock };
      redis: { ping: jest.Mock };
      storage: { healthCheckActive: jest.Mock };
    };
    service.prisma = { $queryRaw: jest.fn().mockResolvedValue([{ one: 1 }]) };
    service.redis = { ping: jest.fn().mockResolvedValue(true) };
    service.storage = {
      healthCheckActive: jest.fn().mockResolvedValue(undefined),
    };
    return service;
  }

  it("reports all required dependencies", async () => {
    await expect(createService().check()).resolves.toMatchObject({
      ok: true,
      dependencies: { postgres: "ok", redis: "ok", storage: "ok" },
    });
  });

  it("returns 503 when a required dependency is unavailable", async () => {
    const service = createService();
    service.storage.healthCheckActive.mockRejectedValue(new Error("offline"));

    await expect(service.check()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it("returns 503 when Redis ping resolves false", async () => {
    const service = createService();
    service.redis.ping.mockResolvedValue(false);

    await expect(service.check()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
