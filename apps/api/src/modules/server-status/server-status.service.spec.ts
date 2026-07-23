import type { PrismaService } from "../prisma/prisma.service";
import type { ServerMetricsCollector } from "./server-metrics.collector";
import { ServerStatusService } from "./server-status.service";

describe("ServerStatusService", () => {
  const sampledAt = new Date("2026-07-23T14:00:00.000Z");
  const prisma = {
    user: { findUnique: jest.fn() },
    serverMetricSample: {
      findMany: jest.fn(),
      create: jest.fn(),
      deleteMany: jest.fn(),
    },
    $transaction: jest.fn(),
  };
  const collector = {
    sample: jest.fn(),
  };
  let service: ServerStatusService;

  beforeEach(() => {
    jest.resetAllMocks();
    service = new ServerStatusService(
      prisma as unknown as PrismaService,
      collector as unknown as ServerMetricsCollector,
    );
    prisma.user.findUnique.mockResolvedValue({
      systemRole: "super_admin",
      status: "active",
    });
    prisma.serverMetricSample.findMany.mockResolvedValue([
      {
        sampledAt: new Date("2026-07-23T13:59:00.000Z"),
        cpuUsagePercent: 18.5,
        memoryUsagePercent: 42.1,
        diskUsagePercent: 63.4,
      },
    ]);
    collector.sample.mockResolvedValue({
      sampledAt,
      cpuUsagePercent: 21.2,
      memoryUsagePercent: 43.6,
      memoryUsedBytes: 7_000,
      memoryTotalBytes: 16_000,
      diskUsagePercent: 63.4,
      diskUsedBytes: 63_400,
      diskTotalBytes: 100_000,
    });
  });

  it("returns current usage and ordered history for a super admin", async () => {
    await expect(service.getStatus("admin-1", 6)).resolves.toMatchObject({
      current: {
        sampledAt: "2026-07-23T14:00:00.000Z",
        cpuUsagePercent: 21.2,
        memory: {
          usagePercent: 43.6,
          usedBytes: 7_000,
          totalBytes: 16_000,
        },
        disk: {
          usagePercent: 63.4,
          usedBytes: 63_400,
          totalBytes: 100_000,
        },
      },
      history: [
        {
          sampledAt: "2026-07-23T13:59:00.000Z",
          cpuUsagePercent: 18.5,
          memoryUsagePercent: 42.1,
          diskUsagePercent: 63.4,
        },
      ],
      sampleIntervalSeconds: 60,
      retentionHours: 168,
    });
    expect(prisma.serverMetricSample.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: { sampledAt: "asc" },
      }),
    );
  });

  it("rejects ordinary administrators", async () => {
    prisma.user.findUnique.mockResolvedValue({
      systemRole: "admin",
      status: "active",
    });

    await expect(service.getStatus("admin-2")).rejects.toThrow(
      "Only super administrators",
    );
    expect(collector.sample).not.toHaveBeenCalled();
  });
});
