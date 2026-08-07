-- 标记回滚前自动创建的保护备份（与普通手动备份区分，UI 显示「回滚前自动备份」）。
ALTER TABLE "BackupJob" ADD COLUMN "isProtection" BOOLEAN NOT NULL DEFAULT false;
