-- CreateEnum
CREATE TYPE "BackupJobKind" AS ENUM ('auto', 'manual', 'restore');

-- CreateEnum
CREATE TYPE "BackupJobStatus" AS ENUM ('pending', 'running', 'succeeded', 'failed');

-- CreateTable
CREATE TABLE "BackupSettings" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "scheduleMinutes" INTEGER NOT NULL DEFAULT 1440,
    "autoRetention" INTEGER NOT NULL DEFAULT 7,
    "manualRetention" INTEGER NOT NULL DEFAULT 20,
    "includeObjects" BOOLEAN NOT NULL DEFAULT true,
    "lastAutoBackupAt" TIMESTAMP(3),
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BackupSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BackupJob" (
    "id" TEXT NOT NULL,
    "kind" "BackupJobKind" NOT NULL,
    "status" "BackupJobStatus" NOT NULL DEFAULT 'pending',
    "backupPath" TEXT,
    "restoreFromId" TEXT,
    "neonBranchId" TEXT,
    "dumpSizeBytes" BIGINT,
    "objectCount" INTEGER,
    "includeObjects" BOOLEAN NOT NULL DEFAULT false,
    "manifest" JSONB,
    "phase" TEXT NOT NULL DEFAULT '',
    "progress" JSONB,
    "error" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BackupJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BackupSettings_workspaceId_key" ON "BackupSettings"("workspaceId");

-- CreateIndex
CREATE INDEX "BackupJob_kind_createdAt_idx" ON "BackupJob"("kind", "createdAt");

-- CreateIndex
CREATE INDEX "BackupJob_createdById_createdAt_idx" ON "BackupJob"("createdById", "createdAt");

-- AddForeignKey
ALTER TABLE "BackupSettings" ADD CONSTRAINT "BackupSettings_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BackupJob" ADD CONSTRAINT "BackupJob_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
