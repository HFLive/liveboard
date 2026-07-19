CREATE INDEX "FileAsset_uploadedBy_createdAt_idx" ON "FileAsset"("uploadedBy", "createdAt");

ALTER TABLE "FileAsset"
ADD CONSTRAINT "FileAsset_uploadedBy_fkey"
FOREIGN KEY ("uploadedBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
