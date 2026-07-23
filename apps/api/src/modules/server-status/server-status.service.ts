import {
  ForbiddenException,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
  UnauthorizedException,
} from "@nestjs/common";
import { isSuperAdmin, type ServerStatusSummary } from "@liveboard/shared";
import { PrismaService } from "../prisma/prisma.service";
import { ServerMetricsCollector } from "./server-metrics.collector";

const SAMPLE_INTERVAL_MS = 60_000;
const RETENTION_HOURS = 24 * 7;

@Injectable()
export class ServerStatusService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(ServerStatusService.name);
  private sampleTimer?: NodeJS.Timeout;
  private capturePromise: Promise<void> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly collector: ServerMetricsCollector,
  ) {}

  onApplicationBootstrap() {
    void this.captureAndPersist();
    this.sampleTimer = setInterval(
      () => void this.captureAndPersist(),
      SAMPLE_INTERVAL_MS,
    );
    this.sampleTimer.unref();
  }

  onModuleDestroy() {
    if (this.sampleTimer) clearInterval(this.sampleTimer);
  }

  async getStatus(
    userId: string | null,
    requestedHours = 24,
  ): Promise<ServerStatusSummary> {
    await this.requireSuperAdmin(userId);
    const historyHours = normalizeHistoryHours(requestedHours);
    const since = new Date(Date.now() - historyHours * 60 * 60 * 1_000);
    const [current, history] = await Promise.all([
      this.collector.sample(),
      this.prisma.serverMetricSample.findMany({
        where: { sampledAt: { gte: since } },
        orderBy: { sampledAt: "asc" },
        select: {
          sampledAt: true,
          cpuUsagePercent: true,
          memoryUsagePercent: true,
          diskUsagePercent: true,
        },
      }),
    ]);

    return {
      current: {
        sampledAt: current.sampledAt.toISOString(),
        cpuUsagePercent: current.cpuUsagePercent,
        memory: {
          usagePercent: current.memoryUsagePercent,
          usedBytes: current.memoryUsedBytes,
          totalBytes: current.memoryTotalBytes,
        },
        disk: {
          usagePercent: current.diskUsagePercent,
          usedBytes: current.diskUsedBytes,
          totalBytes: current.diskTotalBytes,
        },
      },
      history: history.map((sample) => ({
        sampledAt: sample.sampledAt.toISOString(),
        cpuUsagePercent: sample.cpuUsagePercent,
        memoryUsagePercent: sample.memoryUsagePercent,
        diskUsagePercent: sample.diskUsagePercent,
      })),
      sampleIntervalSeconds: SAMPLE_INTERVAL_MS / 1_000,
      retentionHours: RETENTION_HOURS,
    };
  }

  private captureAndPersist() {
    if (this.capturePromise) return this.capturePromise;

    this.capturePromise = this.persistSample()
      .catch((error: unknown) => {
        this.logger.warn(
          `Server metric sample failed: ${
            error instanceof Error ? error.message : "unknown error"
          }`,
        );
      })
      .finally(() => {
        this.capturePromise = null;
      });

    return this.capturePromise;
  }

  private async persistSample() {
    const sample = await this.collector.sample();
    const retentionStart = new Date(
      Date.now() - RETENTION_HOURS * 60 * 60 * 1_000,
    );

    await this.prisma.$transaction([
      this.prisma.serverMetricSample.create({
        data: {
          sampledAt: sample.sampledAt,
          cpuUsagePercent: sample.cpuUsagePercent,
          memoryUsagePercent: sample.memoryUsagePercent,
          diskUsagePercent: sample.diskUsagePercent,
        },
      }),
      this.prisma.serverMetricSample.deleteMany({
        where: { sampledAt: { lt: retentionStart } },
      }),
    ]);
  }

  private async requireSuperAdmin(userId: string | null) {
    if (!userId) throw new UnauthorizedException("Missing session");

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { systemRole: true, status: true },
    });
    if (!user || user.status !== "active" || !isSuperAdmin(user.systemRole)) {
      throw new ForbiddenException(
        "Only super administrators can view server status",
      );
    }
  }
}

function normalizeHistoryHours(value: number) {
  if (!Number.isFinite(value)) return 24;
  return Math.min(24, Math.max(1, Math.round(value)));
}
