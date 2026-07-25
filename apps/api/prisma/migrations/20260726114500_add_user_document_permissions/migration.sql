CREATE TYPE "PermissionLevel" AS ENUM (
  'owner',
  'editor',
  'lecturer',
  'viewer',
  'no_access'
);

CREATE TYPE "PermissionTargetType" AS ENUM (
  'workspace',
  'folder',
  'file'
);

CREATE TABLE "PermissionGrant" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "targetType" "PermissionTargetType" NOT NULL,
  "targetId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "level" "PermissionLevel" NOT NULL,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "PermissionGrant_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PermissionGrant_targetType_targetId_userId_key"
ON "PermissionGrant"("targetType", "targetId", "userId");

CREATE INDEX "PermissionGrant_workspaceId_targetType_targetId_idx"
ON "PermissionGrant"("workspaceId", "targetType", "targetId");

CREATE INDEX "PermissionGrant_userId_idx"
ON "PermissionGrant"("userId");

ALTER TABLE "PermissionGrant"
ADD CONSTRAINT "PermissionGrant_workspaceId_fkey"
FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PermissionGrant"
ADD CONSTRAINT "PermissionGrant_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PermissionGrant"
ADD CONSTRAINT "PermissionGrant_createdById_fkey"
FOREIGN KEY ("createdById") REFERENCES "User"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
