/**
 * 备份 dump 排除的表。与迁移导出（migration-history.ts）的差异：
 * - 备份必须保留 `_prisma_migrations`（同库回滚后 schema 版本与迁移历史一致，
 *   `prisma migrate deploy` 不会重复建表）；迁移搬家才排除它。
 * - `PendingUpload` 是短期的上传预留记录（超时被清理），`ServerMetricSample`
 *   是每分钟采样一次的宿主指标，两者无备份价值。
 */
export const BACKUP_EXCLUDED_TABLES = ["PendingUpload", "ServerMetricSample"] as const;

/**
 * pg_dump 的 --exclude-table-data 参数。混合大小写表名必须带引号（否则
 * pg_dump 按全小写解析，静默漏掉数据），与 migration-history.ts 同规则。
 */
export function backupExcludeTableDataArgs(): string[] {
  return BACKUP_EXCLUDED_TABLES.flatMap((table) => [
    "--exclude-table-data",
    `"${table}"`,
  ]);
}
