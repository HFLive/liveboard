-- 自动备份从「间隔分钟」改为「固定时刻」（每天/每周 HH:MM）。
-- 旧数据的间隔无法映射到固定时刻，统一落到「每天 3:00」；
-- lastAutoBackupAt 保留原值，避免升级后立即触发备份。
ALTER TABLE "BackupSettings" ADD COLUMN "scheduleHour" INTEGER NOT NULL DEFAULT 3;
ALTER TABLE "BackupSettings" ADD COLUMN "scheduleMinute" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "BackupSettings" ADD COLUMN "scheduleWeekday" INTEGER;
ALTER TABLE "BackupSettings" DROP COLUMN "scheduleMinutes";
-- 手动备份（含回滚前保护备份）不再限份数。
ALTER TABLE "BackupSettings" DROP COLUMN "manualRetention";
