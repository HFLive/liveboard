import { ConfigService } from "@nestjs/config";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { resolveMigrationDataDir } from "../migration/migration-dirs";

/**
 * 备份数据目录。复用迁移模块的数据目录挂载（自托管经 docker-compose 把宿主机
 * `/opt/liveboard/migration` 挂载到容器 `/data/migration`），在下面新增独立子目录：
 * - `backups/<jobId>/`：备份内容（database.dump + objects/ + manifest.json）
 * - `backup-jobs/<jobId>.json`：备份任务状态文件（独立于迁移的 jobs/，
 *   避免污染迁移任务列表；互斥扫描时两个目录都检查）。
 * Vercel 无持久盘，备份不落本地（走 Neon 分支 + R2），目录可用性仅影响自托管路径。
 */
export interface BackupDataPaths {
  dataDir: string;
  backupsDir: string;
  backupJobsDir: string;
}

export function backupDataPaths(config: ConfigService): BackupDataPaths {
  const dataDir = resolveMigrationDataDir(config);
  return {
    dataDir,
    backupsDir: path.join(dataDir, "backups"),
    backupJobsDir: path.join(dataDir, "backup-jobs"),
  };
}

/**
 * 幂等创建备份数据目录（mode 700，只允许容器运行用户读写）。Vercel 无持久
 * 盘或宿主未挂载时返回 false，调用方据此禁用自托管备份路径。
 */
export function ensureBackupDirs(paths: BackupDataPaths): boolean {
  try {
    mkdirSync(paths.backupsDir, { recursive: true, mode: 0o700 });
    mkdirSync(paths.backupJobsDir, { recursive: true, mode: 0o700 });
    return true;
  } catch {
    return false;
  }
}

/** 备份内容目录（相对数据目录的 backups/<jobId>）。jobId 必须已通过 jobId 校验。 */
export function backupContentDir(paths: BackupDataPaths, jobId: string): string {
  return path.join(paths.backupsDir, jobId);
}
