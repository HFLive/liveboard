-- Phase 6 is an additive migration. Existing users, passwords, roles, status,
-- relationships, and session versions are intentionally left unchanged.

-- Abort before adding the normalized uniqueness constraint when legacy rows
-- differ only by case or surrounding whitespace. An administrator must resolve
-- such ambiguity explicitly before retrying the migration.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "User"
    GROUP BY lower(btrim("username"))
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Phase 6 preflight failed: duplicate normalized usernames';
  END IF;
END $$;

ALTER TABLE "User"
  ADD COLUMN "email" TEXT,
  ADD COLUMN "emailNormalized" TEXT,
  ADD COLUMN "localPasswordEnabled" BOOLEAN NOT NULL DEFAULT true;

CREATE UNIQUE INDEX "User_emailNormalized_key" ON "User"("emailNormalized");
CREATE UNIQUE INDEX "User_username_normalized_key" ON "User"(lower(btrim("username")));

CREATE TYPE "ExternalIdentityStatus" AS ENUM ('ACTIVE', 'DISABLED', 'UNKNOWN');
CREATE TYPE "ExternalIdentitySyncState" AS ENUM ('CURRENT', 'PROFILE_CONFLICT', 'ERROR');
CREATE TYPE "ExternalIdentityLinkMethod" AS ENUM ('JIT', 'LOCAL_PASSWORD', 'LOCAL_SESSION', 'ADMIN');
CREATE TYPE "ExternalIdentityEventOutcome" AS ENUM ('APPLIED', 'IGNORED', 'FAILED');
CREATE TYPE "AuthenticationAuditOutcome" AS ENUM ('SUCCESS', 'FAILURE');

CREATE TABLE "ExternalIdentity" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "issuer" TEXT NOT NULL,
  "subject" TEXT NOT NULL,
  "preferredUsername" TEXT,
  "email" TEXT,
  "emailNormalized" TEXT,
  "emailVerified" BOOLEAN NOT NULL DEFAULT false,
  "displayName" TEXT,
  "picture" TEXT,
  "externalStatus" "ExternalIdentityStatus" NOT NULL DEFAULT 'UNKNOWN',
  "lastStatusConfirmedAt" TIMESTAMP(3),
  "statusRefreshLeaseUntil" TIMESTAMP(3),
  "lastStatusEventAt" TIMESTAMP(3),
  "lastProfileSyncedAt" TIMESTAMP(3),
  "directoryUpdatedAt" TIMESTAMP(3),
  "syncState" "ExternalIdentitySyncState" NOT NULL DEFAULT 'CURRENT',
  "syncErrorCode" TEXT,
  "linkMethod" "ExternalIdentityLinkMethod" NOT NULL,
  "linkedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ExternalIdentity_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ExternalIdentityEvent" (
  "eventId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "subject" TEXT NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "payloadDigest" TEXT NOT NULL,
  "outcome" "ExternalIdentityEventOutcome" NOT NULL,
  "errorCode" TEXT,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processedAt" TIMESTAMP(3),
  CONSTRAINT "ExternalIdentityEvent_pkey" PRIMARY KEY ("eventId")
);

CREATE TABLE "AuthenticationAuditEvent" (
  "id" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "actorUserId" TEXT,
  "subjectUserId" TEXT,
  "issuer" TEXT,
  "externalSubjectDigest" TEXT,
  "outcome" "AuthenticationAuditOutcome" NOT NULL,
  "errorCode" TEXT,
  "metadata" JSONB,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuthenticationAuditEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ExternalIdentity_issuer_subject_key" ON "ExternalIdentity"("issuer", "subject");
CREATE UNIQUE INDEX "ExternalIdentity_userId_issuer_key" ON "ExternalIdentity"("userId", "issuer");
CREATE INDEX "ExternalIdentity_userId_externalStatus_idx" ON "ExternalIdentity"("userId", "externalStatus");
CREATE INDEX "ExternalIdentityEvent_subject_occurredAt_idx" ON "ExternalIdentityEvent"("subject", "occurredAt");
CREATE INDEX "AuthenticationAuditEvent_createdAt_idx" ON "AuthenticationAuditEvent"("createdAt");
CREATE INDEX "AuthenticationAuditEvent_eventType_createdAt_idx" ON "AuthenticationAuditEvent"("eventType", "createdAt");
CREATE INDEX "AuthenticationAuditEvent_subjectUserId_createdAt_idx" ON "AuthenticationAuditEvent"("subjectUserId", "createdAt");

ALTER TABLE "ExternalIdentity"
  ADD CONSTRAINT "ExternalIdentity_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
