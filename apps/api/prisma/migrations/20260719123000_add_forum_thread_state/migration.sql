CREATE TABLE "ForumThreadState" (
  "threadId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "followed" BOOLEAN NOT NULL DEFAULT false,
  "lastReadAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ForumThreadState_pkey" PRIMARY KEY ("threadId", "userId")
);

CREATE INDEX "ForumThreadState_userId_followed_updatedAt_idx"
ON "ForumThreadState"("userId", "followed", "updatedAt");

ALTER TABLE "ForumThreadState"
ADD CONSTRAINT "ForumThreadState_threadId_fkey"
FOREIGN KEY ("threadId") REFERENCES "ForumThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ForumThreadState"
ADD CONSTRAINT "ForumThreadState_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
