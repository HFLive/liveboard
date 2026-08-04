import { ConfigService } from "@nestjs/config";
import { mkdirSync } from "node:fs";
import path from "node:path";

/**
 * 数据迁移的本地数据目录。自托管经 docker-compose 把宿主机
 * `/opt/liveboard/migration` 挂载到容器 `/data/migration`；Vercel 无持久盘，
 * 不提供迁移按钮（相关流程由管理员电脑执行）。
 */
export const DEFAULT_MIGRATION_DATA_DIR = "/data/migration";

export function resolveMigrationDataDir(config: ConfigService): string {
  const value = config.get<string>("MIGRATION_DATA_DIR")?.trim();
  return value || DEFAULT_MIGRATION_DATA_DIR;
}

export interface MigrationDataPaths {
  dataDir: string;
  exportsDir: string;
  incomingDir: string;
  jobsDir: string;
  maintenanceFile: string;
}

export function migrationDataPaths(config: ConfigService): MigrationDataPaths {
  const dataDir = resolveMigrationDataDir(config);
  return {
    dataDir,
    exportsDir: path.join(dataDir, "exports"),
    incomingDir: path.join(dataDir, "incoming"),
    jobsDir: path.join(dataDir, "jobs"),
    maintenanceFile: path.join(dataDir, "maintenance.json"),
  };
}

/**
 * 幂等创建迁移数据目录（mode 700，只允许容器运行用户读写）。Vercel 无持久
 * 盘或宿主未挂载时返回 false，调用方据此降级（维护模式视为关闭、迁移功能禁用）。
 */
export function ensureMigrationDirs(paths: MigrationDataPaths): boolean {
  try {
    mkdirSync(paths.dataDir, { recursive: true, mode: 0o700 });
    mkdirSync(paths.exportsDir, { recursive: true, mode: 0o700 });
    mkdirSync(paths.incomingDir, { recursive: true, mode: 0o700 });
    mkdirSync(paths.jobsDir, { recursive: true, mode: 0o700 });
    return true;
  } catch {
    return false;
  }
}
