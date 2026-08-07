/**
 * 备份包格式版本（独立于迁移包的 MIGRATION_FORMAT_VERSION）。
 * 单独成文件：backup-run 与 backup-restore 都要引用，但 backup-restore
 * 不能 import backup-run（其顶层 main() 会作为模块副作用执行，导致
 * 回滚前先跑一次备份）。
 */
export const BACKUP_FORMAT_VERSION = 1;
