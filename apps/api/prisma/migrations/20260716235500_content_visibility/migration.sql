ALTER TABLE "TeachingDeckItem" ADD COLUMN "assetId" TEXT;

CREATE TABLE "TeachingDeckViewer" (
    "deckId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeachingDeckViewer_pkey" PRIMARY KEY ("deckId", "userId")
);

CREATE TABLE "ExerciseSetViewer" (
    "exerciseSetId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExerciseSetViewer_pkey" PRIMARY KEY ("exerciseSetId", "userId")
);

CREATE INDEX "TeachingDeckItem_assetId_idx" ON "TeachingDeckItem"("assetId");
CREATE INDEX "TeachingDeckViewer_userId_idx" ON "TeachingDeckViewer"("userId");
CREATE INDEX "ExerciseSetViewer_userId_idx" ON "ExerciseSetViewer"("userId");

INSERT INTO "TeachingDeckViewer" ("deckId", "userId")
SELECT "id", "createdById" FROM "TeachingDeck"
ON CONFLICT DO NOTHING;

INSERT INTO "ExerciseSetViewer" ("exerciseSetId", "userId")
SELECT "ExerciseSet"."id", "File"."createdById"
FROM "ExerciseSet"
INNER JOIN "File" ON "File"."id" = "ExerciseSet"."fileId"
ON CONFLICT DO NOTHING;

UPDATE "TeachingDeckItem"
SET "assetId" = "snapshotJson"->'dataJson'->>'assetId'
WHERE "type" = 'content_block'
  AND "snapshotJson"->>'type' IN ('image', 'attachment')
  AND EXISTS (
    SELECT 1 FROM "FileAsset"
    WHERE "FileAsset"."id" = "TeachingDeckItem"."snapshotJson"->'dataJson'->>'assetId'
  );

ALTER TABLE "TeachingDeckItem"
ADD CONSTRAINT "TeachingDeckItem_assetId_fkey"
FOREIGN KEY ("assetId") REFERENCES "FileAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TeachingDeckViewer"
ADD CONSTRAINT "TeachingDeckViewer_deckId_fkey"
FOREIGN KEY ("deckId") REFERENCES "TeachingDeck"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TeachingDeckViewer"
ADD CONSTRAINT "TeachingDeckViewer_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ExerciseSetViewer"
ADD CONSTRAINT "ExerciseSetViewer_exerciseSetId_fkey"
FOREIGN KEY ("exerciseSetId") REFERENCES "ExerciseSet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ExerciseSetViewer"
ADD CONSTRAINT "ExerciseSetViewer_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
