-- CreateTable
CREATE TABLE "AiProviderConfig" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "providerName" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "apiKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiProviderConfig_pkey" PRIMARY KEY ("id")
);

-- Preserve the existing single provider as the first named configuration.
INSERT INTO "AiProviderConfig" (
    "id",
    "workspaceId",
    "name",
    "providerName",
    "baseUrl",
    "model",
    "apiKey",
    "createdAt",
    "updatedAt"
)
SELECT
    'migrated-' || "id",
    "workspaceId",
    CASE
        WHEN BTRIM("providerName") = '' THEN '默认配置'
        ELSE "providerName"
    END,
    CASE
        WHEN BTRIM("providerName") = '' THEN '其他兼容服务'
        ELSE "providerName"
    END,
    "baseUrl",
    "model",
    "apiKey",
    "createdAt",
    "updatedAt"
FROM "AiSettings";

-- AlterTable
ALTER TABLE "AiSettings" ADD COLUMN "activeConfigId" TEXT;

UPDATE "AiSettings"
SET "activeConfigId" = 'migrated-' || "id";

ALTER TABLE "AiSettings"
    DROP COLUMN "providerName",
    DROP COLUMN "baseUrl",
    DROP COLUMN "model",
    DROP COLUMN "apiKey",
    DROP COLUMN "temperature";

-- CreateIndex
CREATE UNIQUE INDEX "AiProviderConfig_workspaceId_name_key" ON "AiProviderConfig"("workspaceId", "name");

-- CreateIndex
CREATE INDEX "AiProviderConfig_workspaceId_updatedAt_idx" ON "AiProviderConfig"("workspaceId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AiSettings_activeConfigId_key" ON "AiSettings"("activeConfigId");

-- AddForeignKey
ALTER TABLE "AiProviderConfig" ADD CONSTRAINT "AiProviderConfig_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiSettings" ADD CONSTRAINT "AiSettings_activeConfigId_fkey" FOREIGN KEY ("activeConfigId") REFERENCES "AiProviderConfig"("id") ON DELETE SET NULL ON UPDATE CASCADE;
