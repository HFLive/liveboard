CREATE TABLE "ClassroomAnnouncement" (
    "id" TEXT NOT NULL,
    "classroomId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClassroomAnnouncement_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ClassroomAnnouncement_classroomId_createdAt_idx"
ON "ClassroomAnnouncement"("classroomId", "createdAt");

CREATE INDEX "ClassroomAnnouncement_authorId_idx"
ON "ClassroomAnnouncement"("authorId");

ALTER TABLE "ClassroomAnnouncement"
ADD CONSTRAINT "ClassroomAnnouncement_classroomId_fkey"
FOREIGN KEY ("classroomId") REFERENCES "Classroom"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ClassroomAnnouncement"
ADD CONSTRAINT "ClassroomAnnouncement_authorId_fkey"
FOREIGN KEY ("authorId") REFERENCES "User"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
