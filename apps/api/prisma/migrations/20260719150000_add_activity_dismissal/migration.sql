CREATE TABLE "ActivityDismissal" (
    "userId" TEXT NOT NULL,
    "activityId" TEXT NOT NULL,
    "dismissedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActivityDismissal_pkey" PRIMARY KEY ("userId", "activityId")
);

CREATE INDEX "ActivityDismissal_userId_dismissedAt_idx"
ON "ActivityDismissal"("userId", "dismissedAt");

ALTER TABLE "ActivityDismissal"
ADD CONSTRAINT "ActivityDismissal_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
