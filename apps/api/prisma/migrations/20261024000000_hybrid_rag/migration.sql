-- Requires the pgvector-enabled PostgreSQL image shipped with this release.
-- Neon supplies the extension; existing migrations and baseline stay unchanged.
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE "AiRetrievalSettings" (
    "workspaceId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "providerName" TEXT NOT NULL DEFAULT 'custom',
    "baseUrl" TEXT NOT NULL DEFAULT '',
    "model" TEXT NOT NULL DEFAULT '',
    "apiKey" TEXT NOT NULL DEFAULT '',
    "dimensions" INTEGER NOT NULL DEFAULT 0,
    "generation" TEXT NOT NULL,
    "leaseToken" TEXT,
    "leaseUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AiRetrievalSettings_pkey" PRIMARY KEY ("workspaceId"),
    CONSTRAINT "AiRetrievalSettings_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "AiDocumentIndex" (
    "fileId" TEXT NOT NULL,
    "generation" TEXT NOT NULL,
    "fileVersion" INTEGER NOT NULL,
    "nextChunk" INTEGER NOT NULL DEFAULT 0,
    "totalChunks" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "lastError" TEXT,
    "retryAfter" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AiDocumentIndex_pkey" PRIMARY KEY ("fileId"),
    CONSTRAINT "AiDocumentIndex_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "File"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "AiDocumentChunk" (
    "id" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "blockId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "embedding" vector NOT NULL,
    CONSTRAINT "AiDocumentChunk_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AiDocumentChunk_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "AiDocumentIndex"("fileId") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "AiDocumentChunk_fileId_ordinal_key" ON "AiDocumentChunk"("fileId", "ordinal");
