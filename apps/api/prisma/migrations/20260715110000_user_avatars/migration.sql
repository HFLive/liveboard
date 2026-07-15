ALTER TABLE "User"
ADD COLUMN "avatarStorageKey" TEXT,
ADD COLUMN "avatarMimeType" TEXT,
ADD COLUMN "avatarUpdatedAt" TIMESTAMP(3);
