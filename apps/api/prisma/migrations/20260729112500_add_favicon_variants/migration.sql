ALTER TABLE "Workspace"
ADD COLUMN "faviconLightStorageKey" TEXT,
ADD COLUMN "faviconLightMimeType" TEXT,
ADD COLUMN "faviconLightUpdatedAt" TIMESTAMP(3),
ADD COLUMN "faviconLightStorageBackend" "StorageBackend" NOT NULL DEFAULT 'minio',
ADD COLUMN "faviconDarkStorageKey" TEXT,
ADD COLUMN "faviconDarkMimeType" TEXT,
ADD COLUMN "faviconDarkUpdatedAt" TIMESTAMP(3),
ADD COLUMN "faviconDarkStorageBackend" "StorageBackend" NOT NULL DEFAULT 'minio';
