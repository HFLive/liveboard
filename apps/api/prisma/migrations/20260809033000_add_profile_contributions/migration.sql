-- Add profile contribution visibility and indexes used by yearly aggregation.
ALTER TABLE "User"
ADD COLUMN "showContributionGraph" BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX "File_updatedById_publishedAt_idx"
ON "File"("updatedById", "publishedAt");

CREATE INDEX "Submission_gradedById_gradedAt_idx"
ON "Submission"("gradedById", "gradedAt");
