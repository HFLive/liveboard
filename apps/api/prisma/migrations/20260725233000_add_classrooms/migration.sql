CREATE TYPE "ClassroomMemberRole" AS ENUM ('teacher', 'student');

CREATE TABLE "Classroom" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Classroom_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ClassroomMember" (
  "classroomId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "role" "ClassroomMemberRole" NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ClassroomMember_pkey" PRIMARY KEY ("classroomId", "userId")
);

CREATE TABLE "ClassroomFile" (
  "id" TEXT NOT NULL,
  "classroomId" TEXT NOT NULL,
  "storageKey" TEXT NOT NULL,
  "filename" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "sizeBytes" INTEGER NOT NULL,
  "uploadedBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ClassroomFile_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "TeachingDeck" ADD COLUMN "classroomId" TEXT;
ALTER TABLE "ExerciseSet" ADD COLUMN "classroomId" TEXT;

INSERT INTO "Classroom" (
  "id",
  "workspaceId",
  "name",
  "description",
  "createdById",
  "createdAt",
  "updatedAt"
)
SELECT
  'legacy-' || md5(workspace."id"),
  workspace."id",
  '历史课堂',
  '由升级前已有的课件和练习自动整理。',
  COALESCE(
    (
      SELECT deck."createdById"
      FROM "TeachingDeck" deck
      WHERE deck."workspaceId" = workspace."id"
      ORDER BY deck."createdAt" ASC
      LIMIT 1
    ),
    (SELECT "id" FROM "User" ORDER BY "createdAt" ASC LIMIT 1)
  ),
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "Workspace" workspace
WHERE EXISTS (SELECT 1 FROM "User")
  AND (
    EXISTS (
      SELECT 1
      FROM "TeachingDeck" deck
      WHERE deck."workspaceId" = workspace."id"
    )
    OR EXISTS (SELECT 1 FROM "ExerciseSet")
  );

UPDATE "TeachingDeck" deck
SET "classroomId" = 'legacy-' || md5(deck."workspaceId");

UPDATE "ExerciseSet" exercise
SET "classroomId" = COALESCE(
  (
    SELECT 'legacy-' || md5(file."workspaceId")
    FROM "File" file
    WHERE file."id" = exercise."fileId"
  ),
  (SELECT classroom."id" FROM "Classroom" classroom ORDER BY classroom."createdAt" ASC LIMIT 1)
);

INSERT INTO "ClassroomMember" (
  "classroomId",
  "userId",
  "role",
  "createdAt",
  "updatedAt"
)
SELECT DISTINCT
  deck."classroomId",
  deck."createdById",
  'teacher'::"ClassroomMemberRole",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "TeachingDeck" deck
WHERE deck."classroomId" IS NOT NULL
ON CONFLICT ("classroomId", "userId") DO UPDATE
SET "role" = 'teacher'::"ClassroomMemberRole", "updatedAt" = CURRENT_TIMESTAMP;

INSERT INTO "ClassroomMember" (
  "classroomId",
  "userId",
  "role",
  "createdAt",
  "updatedAt"
)
SELECT DISTINCT
  exercise."classroomId",
  exercise."createdById",
  'teacher'::"ClassroomMemberRole",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "ExerciseSet" exercise
WHERE exercise."classroomId" IS NOT NULL
ON CONFLICT ("classroomId", "userId") DO UPDATE
SET "role" = 'teacher'::"ClassroomMemberRole", "updatedAt" = CURRENT_TIMESTAMP;

INSERT INTO "ClassroomMember" (
  "classroomId",
  "userId",
  "role",
  "createdAt",
  "updatedAt"
)
SELECT DISTINCT
  deck."classroomId",
  viewer."userId",
  'student'::"ClassroomMemberRole",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "TeachingDeckViewer" viewer
JOIN "TeachingDeck" deck ON deck."id" = viewer."deckId"
WHERE deck."classroomId" IS NOT NULL
ON CONFLICT ("classroomId", "userId") DO NOTHING;

INSERT INTO "ClassroomMember" (
  "classroomId",
  "userId",
  "role",
  "createdAt",
  "updatedAt"
)
SELECT DISTINCT
  exercise."classroomId",
  viewer."userId",
  'student'::"ClassroomMemberRole",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "ExerciseSetViewer" viewer
JOIN "ExerciseSet" exercise ON exercise."id" = viewer."exerciseSetId"
WHERE exercise."classroomId" IS NOT NULL
ON CONFLICT ("classroomId", "userId") DO NOTHING;

DROP TABLE "TeachingDeckViewer";
DROP TABLE "ExerciseSetViewer";

ALTER TABLE "TeachingDeck" ALTER COLUMN "classroomId" SET NOT NULL;
ALTER TABLE "ExerciseSet" ALTER COLUMN "classroomId" SET NOT NULL;

CREATE UNIQUE INDEX "Classroom_workspaceId_name_key" ON "Classroom"("workspaceId", "name");
CREATE INDEX "Classroom_workspaceId_updatedAt_idx" ON "Classroom"("workspaceId", "updatedAt");
CREATE INDEX "ClassroomMember_userId_role_idx" ON "ClassroomMember"("userId", "role");
CREATE UNIQUE INDEX "ClassroomFile_storageKey_key" ON "ClassroomFile"("storageKey");
CREATE INDEX "ClassroomFile_classroomId_createdAt_idx" ON "ClassroomFile"("classroomId", "createdAt");
CREATE INDEX "ClassroomFile_uploadedBy_createdAt_idx" ON "ClassroomFile"("uploadedBy", "createdAt");
CREATE INDEX "TeachingDeck_classroomId_updatedAt_idx" ON "TeachingDeck"("classroomId", "updatedAt");
CREATE INDEX "ExerciseSet_classroomId_updatedAt_idx" ON "ExerciseSet"("classroomId", "updatedAt");

ALTER TABLE "Classroom"
ADD CONSTRAINT "Classroom_workspaceId_fkey"
FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Classroom"
ADD CONSTRAINT "Classroom_createdById_fkey"
FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ClassroomMember"
ADD CONSTRAINT "ClassroomMember_classroomId_fkey"
FOREIGN KEY ("classroomId") REFERENCES "Classroom"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ClassroomMember"
ADD CONSTRAINT "ClassroomMember_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ClassroomFile"
ADD CONSTRAINT "ClassroomFile_classroomId_fkey"
FOREIGN KEY ("classroomId") REFERENCES "Classroom"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ClassroomFile"
ADD CONSTRAINT "ClassroomFile_uploadedBy_fkey"
FOREIGN KEY ("uploadedBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TeachingDeck"
ADD CONSTRAINT "TeachingDeck_classroomId_fkey"
FOREIGN KEY ("classroomId") REFERENCES "Classroom"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ExerciseSet"
ADD CONSTRAINT "ExerciseSet_classroomId_fkey"
FOREIGN KEY ("classroomId") REFERENCES "Classroom"("id") ON DELETE CASCADE ON UPDATE CASCADE;
