CREATE TABLE "Badge" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "color" TEXT NOT NULL DEFAULT 'gold',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Badge_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "UserBadge" (
    "badgeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "awardedById" TEXT NOT NULL,
    "awardedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "equippedOrder" INTEGER,

    CONSTRAINT "UserBadge_pkey" PRIMARY KEY ("badgeId","userId")
);

CREATE UNIQUE INDEX "Badge_workspaceId_name_key" ON "Badge"("workspaceId", "name");
CREATE INDEX "Badge_workspaceId_createdAt_idx" ON "Badge"("workspaceId", "createdAt");
CREATE INDEX "UserBadge_userId_equippedOrder_idx" ON "UserBadge"("userId", "equippedOrder");
CREATE INDEX "UserBadge_awardedById_idx" ON "UserBadge"("awardedById");

ALTER TABLE "Badge" ADD CONSTRAINT "Badge_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Badge" ADD CONSTRAINT "Badge_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "UserBadge" ADD CONSTRAINT "UserBadge_badgeId_fkey" FOREIGN KEY ("badgeId") REFERENCES "Badge"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserBadge" ADD CONSTRAINT "UserBadge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserBadge" ADD CONSTRAINT "UserBadge_awardedById_fkey" FOREIGN KEY ("awardedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
