-- AlterTable
ALTER TABLE "ForumThread" ADD COLUMN "isAnonymous" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "ForumPost" ADD COLUMN "isAnonymous" BOOLEAN NOT NULL DEFAULT false;
