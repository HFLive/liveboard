-- CreateEnum
CREATE TYPE "MigrationJobKind" AS ENUM ('export', 'import');

-- CreateEnum
CREATE TYPE "MigrationJobStatus" AS ENUM ('pending', 'running', 'succeeded', 'failed');

-- CreateTable
CREATE TABLE "MigrationJob" (
    "id" TEXT NOT NULL,
    "kind" "MigrationJobKind" NOT NULL,
    "status" "MigrationJobStatus" NOT NULL DEFAULT 'pending',
    "packageName" TEXT,
    "appVersion" TEXT,
    "manifest" JSONB,
    "phase" TEXT NOT NULL DEFAULT '',
    "progress" JSONB,
    "error" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MigrationJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MigrationJob_createdById_createdAt_idx" ON "MigrationJob"("createdById", "createdAt");

-- AddForeignKey
ALTER TABLE "MigrationJob" ADD CONSTRAINT "MigrationJob_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

