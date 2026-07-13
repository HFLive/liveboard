-- CreateTable
CREATE TABLE "TeachingDeck" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeachingDeck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeachingDeckItem" (
    "id" TEXT NOT NULL,
    "deckId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "sourceFileId" TEXT,
    "sourceBlockId" TEXT,
    "exerciseSetId" TEXT,
    "snapshotJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeachingDeckItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TeachingDeck_workspaceId_updatedAt_idx" ON "TeachingDeck"("workspaceId", "updatedAt");
CREATE INDEX "TeachingDeck_createdById_idx" ON "TeachingDeck"("createdById");
CREATE INDEX "TeachingDeckItem_deckId_sortOrder_idx" ON "TeachingDeckItem"("deckId", "sortOrder");
CREATE INDEX "TeachingDeckItem_sourceFileId_idx" ON "TeachingDeckItem"("sourceFileId");
CREATE INDEX "TeachingDeckItem_sourceBlockId_idx" ON "TeachingDeckItem"("sourceBlockId");
CREATE INDEX "TeachingDeckItem_exerciseSetId_idx" ON "TeachingDeckItem"("exerciseSetId");

ALTER TABLE "TeachingDeck" ADD CONSTRAINT "TeachingDeck_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TeachingDeck" ADD CONSTRAINT "TeachingDeck_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TeachingDeckItem" ADD CONSTRAINT "TeachingDeckItem_deckId_fkey" FOREIGN KEY ("deckId") REFERENCES "TeachingDeck"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TeachingDeckItem" ADD CONSTRAINT "TeachingDeckItem_sourceFileId_fkey" FOREIGN KEY ("sourceFileId") REFERENCES "File"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TeachingDeckItem" ADD CONSTRAINT "TeachingDeckItem_sourceBlockId_fkey" FOREIGN KEY ("sourceBlockId") REFERENCES "ContentBlock"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TeachingDeckItem" ADD CONSTRAINT "TeachingDeckItem_exerciseSetId_fkey" FOREIGN KEY ("exerciseSetId") REFERENCES "ExerciseSet"("id") ON DELETE SET NULL ON UPDATE CASCADE;
