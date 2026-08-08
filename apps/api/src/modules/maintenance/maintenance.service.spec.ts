import { MaintenanceService } from "./maintenance.service";

describe("MaintenanceService Vercel Redis 状态", () => {
  const prisma = {
    user: { findUnique: jest.fn() },
  };
  const values = new Map<string, string>();
  const redisClient = {
    get: jest.fn((key: string) => Promise.resolve(values.get(key) ?? null)),
    set: jest.fn((key: string, value: string) => {
      values.set(key, value);
      return Promise.resolve("OK");
    }),
  };
  const redis = { getClient: jest.fn() };
  const config = {
    get: jest.fn((key: string, fallback?: string) =>
      key === "DEPLOYMENT_TARGET" ? "vercel" : fallback,
    ),
  };

  let service: MaintenanceService;

  beforeEach(() => {
    jest.clearAllMocks();
    values.clear();
    redis.getClient.mockResolvedValue(redisClient);
    prisma.user.findUnique.mockResolvedValue({
      systemRole: "super_admin",
      status: "active",
    });
    service = new MaintenanceService(
      prisma as never,
      config as never,
      redis as never,
    );
  });

  it("Vercel 无状态时关闭，系统开启后跨请求从 Redis 读取", async () => {
    await expect(service.getState()).resolves.toEqual({
      enabled: false,
      reason: null,
      updatedAt: null,
      updatedBy: null,
    });

    await service.setSystemEnabled(true, "正在执行 Neon 回滚");

    await expect(service.isEnabled()).resolves.toBe(true);
    await expect(service.getState()).resolves.toEqual(
      expect.objectContaining({
        enabled: true,
        reason: "正在执行 Neon 回滚",
        updatedBy: null,
      }),
    );
    expect(redisClient.set).toHaveBeenCalledWith(
      "liveboard:maintenance:state",
      expect.any(String),
    );
  });

  it("最高管理员可在 Vercel 手动关闭维护模式", async () => {
    await service.setSystemEnabled(true, "回滚中");
    const state = await service.setEnabled("admin-1", false);

    expect(state.enabled).toBe(false);
    expect(state.updatedBy).toBe("admin-1");
    await expect(service.isEnabled()).resolves.toBe(false);
  });

  it("Redis 读取失败时 isEnabled fail closed", async () => {
    redisClient.get.mockRejectedValueOnce(new Error("redis down"));

    await expect(service.isEnabled()).resolves.toBe(true);
  });
});
