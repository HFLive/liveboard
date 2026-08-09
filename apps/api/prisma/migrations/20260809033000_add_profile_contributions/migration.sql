-- Add indexes used by profile contribution aggregation.

CREATE INDEX "File_updatedById_publishedAt_idx"
ON "File"("updatedById", "publishedAt");

CREATE INDEX "Submission_gradedById_gradedAt_idx"
ON "Submission"("gradedById", "gradedAt");
