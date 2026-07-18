-- AlterTable
ALTER TABLE "AiSettings" ADD COLUMN     "defaultCallLimit" INTEGER NOT NULL DEFAULT 100;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "aiCallCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "aiCallLimit" INTEGER;
