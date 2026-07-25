CREATE TABLE "UserTag" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "UserTag_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "UserTagAssignment" (
  "tagId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "UserTagAssignment_pkey" PRIMARY KEY ("tagId", "userId")
);

INSERT INTO "UserTag" ("id", "workspaceId", "name", "createdAt", "updatedAt")
SELECT "id", "workspaceId", "name", "createdAt", "updatedAt"
FROM "PermissionGroup";

INSERT INTO "UserTagAssignment" ("tagId", "userId", "createdAt")
SELECT "groupId", "userId", "createdAt"
FROM "PermissionGroupMember";

CREATE UNIQUE INDEX "UserTag_workspaceId_name_key"
ON "UserTag"("workspaceId", "name");

CREATE INDEX "UserTag_workspaceId_name_idx"
ON "UserTag"("workspaceId", "name");

CREATE INDEX "UserTagAssignment_userId_idx"
ON "UserTagAssignment"("userId");

ALTER TABLE "UserTag"
ADD CONSTRAINT "UserTag_workspaceId_fkey"
FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "UserTagAssignment"
ADD CONSTRAINT "UserTagAssignment_tagId_fkey"
FOREIGN KEY ("tagId") REFERENCES "UserTag"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "UserTagAssignment"
ADD CONSTRAINT "UserTagAssignment_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

DROP TABLE "PermissionGrant";
DROP TABLE "PermissionGroupMember";
DROP TABLE "PermissionGroup";

DROP TYPE "PermissionTargetType";
DROP TYPE "PermissionLevel";
