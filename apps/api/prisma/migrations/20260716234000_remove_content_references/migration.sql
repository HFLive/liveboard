ALTER TABLE "ContentBlock"
DROP COLUMN "referenceMode",
DROP COLUMN "sourceBlockId",
DROP COLUMN "sourceFileId";

DROP TYPE "ReferenceMode";
