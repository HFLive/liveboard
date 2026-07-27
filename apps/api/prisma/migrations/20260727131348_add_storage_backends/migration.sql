-- CreateEnum
CREATE TYPE "StorageBackend" AS ENUM ('minio', 'oss');

-- CreateEnum
CREATE TYPE "StorageDownloadMode" AS ENUM ('proxy', 'direct');

-- DropIndex
DROP INDEX "AiConversation_userId_pinnedAt_updatedAt_idx";

-- AlterTable
ALTER TABLE "ClassroomFile" ADD COLUMN     "storageBackend" "StorageBackend" NOT NULL DEFAULT 'minio';

-- AlterTable
ALTER TABLE "FileAsset" ADD COLUMN     "storageBackend" "StorageBackend" NOT NULL DEFAULT 'minio';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "avatarStorageBackend" "StorageBackend" NOT NULL DEFAULT 'minio',
ADD COLUMN     "bannerStorageBackend" "StorageBackend" NOT NULL DEFAULT 'minio';

-- AlterTable
ALTER TABLE "Workspace" ADD COLUMN     "faviconStorageBackend" "StorageBackend" NOT NULL DEFAULT 'minio';

-- CreateTable
CREATE TABLE "StorageSettings" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "backend" "StorageBackend" NOT NULL DEFAULT 'minio',
    "downloadMode" "StorageDownloadMode" NOT NULL DEFAULT 'proxy',
    "ossRegion" TEXT,
    "ossBucket" TEXT,
    "ossEndpoint" TEXT,
    "ossAccessKeyId" TEXT,
    "ossAccessKeySecret" TEXT,
    "ossInternal" BOOLEAN NOT NULL DEFAULT false,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StorageSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StorageSettings_workspaceId_key" ON "StorageSettings"("workspaceId");

-- AddForeignKey
ALTER TABLE "StorageSettings" ADD CONSTRAINT "StorageSettings_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
