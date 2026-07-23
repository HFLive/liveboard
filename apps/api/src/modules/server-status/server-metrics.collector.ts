import { Injectable } from "@nestjs/common";
import { statfs } from "node:fs/promises";
import { cpus, freemem, totalmem } from "node:os";

export interface CollectedServerMetrics {
  sampledAt: Date;
  cpuUsagePercent: number;
  memoryUsagePercent: number;
  memoryUsedBytes: number;
  memoryTotalBytes: number;
  diskUsagePercent: number;
  diskUsedBytes: number;
  diskTotalBytes: number;
}

@Injectable()
export class ServerMetricsCollector {
  async sample(): Promise<CollectedServerMetrics> {
    const [cpuUsagePercent, disk] = await Promise.all([
      sampleCpuUsage(),
      sampleDiskUsage(),
    ]);
    const memoryTotalBytes = totalmem();
    const memoryUsedBytes = Math.max(0, memoryTotalBytes - freemem());

    return {
      sampledAt: new Date(),
      cpuUsagePercent,
      memoryUsagePercent: percentage(memoryUsedBytes, memoryTotalBytes),
      memoryUsedBytes,
      memoryTotalBytes,
      diskUsagePercent: disk.usagePercent,
      diskUsedBytes: disk.usedBytes,
      diskTotalBytes: disk.totalBytes,
    };
  }
}

async function sampleCpuUsage() {
  const before = readCpuTimes();
  await new Promise<void>((resolve) => setTimeout(resolve, 200));
  const after = readCpuTimes();
  const idleDelta = after.idle - before.idle;
  const totalDelta = after.total - before.total;

  return totalDelta > 0 ? roundPercent((1 - idleDelta / totalDelta) * 100) : 0;
}

function readCpuTimes() {
  return cpus().reduce(
    (result, cpu) => {
      const total = Object.values(cpu.times).reduce(
        (sum, value) => sum + value,
        0,
      );
      result.idle += cpu.times.idle;
      result.total += total;
      return result;
    },
    { idle: 0, total: 0 },
  );
}

async function sampleDiskUsage() {
  const diskPath = process.env.SERVER_STATUS_DISK_PATH?.trim() || "/";
  const stats = await statfs(diskPath, { bigint: true });
  const totalBytes = Number(stats.blocks * stats.bsize);
  const freeBytes = Number(stats.bfree * stats.bsize);
  const usedBytes = Math.max(0, totalBytes - freeBytes);

  return {
    usagePercent: percentage(usedBytes, totalBytes),
    usedBytes,
    totalBytes,
  };
}

function percentage(used: number, total: number) {
  return total > 0 ? roundPercent((used / total) * 100) : 0;
}

function roundPercent(value: number) {
  return Math.round(Math.min(100, Math.max(0, value)) * 10) / 10;
}
