-- AlterTable
ALTER TABLE "FileAsset"
ADD COLUMN "forumPostId" TEXT,
ADD COLUMN "width" INTEGER,
ADD COLUMN "height" INTEGER,
ADD COLUMN "sortOrder" INTEGER;

-- CreateIndex
CREATE INDEX "FileAsset_forumPostId_sortOrder_idx" ON "FileAsset"("forumPostId", "sortOrder");

-- AddForeignKey
ALTER TABLE "FileAsset"
ADD CONSTRAINT "FileAsset_forumPostId_fkey"
FOREIGN KEY ("forumPostId") REFERENCES "ForumPost"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
