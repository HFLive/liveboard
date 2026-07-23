ALTER TABLE "Workspace"
ADD COLUMN "faviconStorageKey" TEXT,
ADD COLUMN "faviconMimeType" TEXT,
ADD COLUMN "faviconUpdatedAt" TIMESTAMP(3);

ALTER TABLE "ForumPost"
ADD COLUMN "upvoteCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "downvoteCount" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "ForumPostVote" (
    "postId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "value" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ForumPostVote_pkey" PRIMARY KEY ("postId", "userId"),
    CONSTRAINT "ForumPostVote_value_check" CHECK ("value" IN (-1, 1))
);

CREATE INDEX "ForumPostVote_userId_updatedAt_idx"
ON "ForumPostVote"("userId", "updatedAt");

ALTER TABLE "ForumPostVote"
ADD CONSTRAINT "ForumPostVote_postId_fkey"
FOREIGN KEY ("postId") REFERENCES "ForumPost"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ForumPostVote"
ADD CONSTRAINT "ForumPostVote_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
