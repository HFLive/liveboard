-- CreateEnum
CREATE TYPE "StorageUploadMode" AS ENUM ('relay', 'direct');

-- CreateEnum
CREATE TYPE "PendingUploadKind" AS ENUM ('asset', 'classroom');

-- AlterTable
ALTER TABLE "FileAsset" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "StorageSettings" ADD COLUMN     "uploadMode" "StorageUploadMode" NOT NULL DEFAULT 'relay';

-- CreateTable
CREATE TABLE "PendingUpload" (
    "id" TEXT NOT NULL,
    "kind" "PendingUploadKind" NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "folderId" TEXT,
    "fileId" TEXT,
    "classroomId" TEXT,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "uploadedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PendingUpload_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PendingUpload_storageKey_key" ON "PendingUpload"("storageKey");

-- CreateIndex
CREATE INDEX "PendingUpload_uploadedBy_expiresAt_idx" ON "PendingUpload"("uploadedBy", "expiresAt");

-- AddForeignKey
ALTER TABLE "PendingUpload" ADD CONSTRAINT "PendingUpload_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
