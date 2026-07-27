/*
  Warnings:

  - Added the required column `updatedAt` to the `FileAsset` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "FileAssetKind" AS ENUM ('embedded', 'standalone');

-- AlterTable
ALTER TABLE "FileAsset" ADD COLUMN     "kind" "FileAssetKind" NOT NULL DEFAULT 'embedded',
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateIndex
CREATE INDEX "FileAsset_folderId_kind_createdAt_idx" ON "FileAsset"("folderId", "kind", "createdAt");
