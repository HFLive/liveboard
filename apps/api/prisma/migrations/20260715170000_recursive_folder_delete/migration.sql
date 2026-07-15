-- Allow a confirmed folder deletion to remove the complete folder subtree and
-- all document-owned records. FileAsset already uses ON DELETE SET NULL so
-- uploaded objects remain available when their original folder is removed.
ALTER TABLE "Folder" DROP CONSTRAINT "Folder_parentId_fkey";
ALTER TABLE "Folder" ADD CONSTRAINT "Folder_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Folder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "File" DROP CONSTRAINT "File_folderId_fkey";
ALTER TABLE "File" ADD CONSTRAINT "File_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "Folder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ContentBlock" DROP CONSTRAINT "ContentBlock_fileId_fkey";
ALTER TABLE "ContentBlock" ADD CONSTRAINT "ContentBlock_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "File"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ContentBlock" DROP CONSTRAINT "ContentBlock_parentBlockId_fkey";
ALTER TABLE "ContentBlock" ADD CONSTRAINT "ContentBlock_parentBlockId_fkey" FOREIGN KEY ("parentBlockId") REFERENCES "ContentBlock"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ExerciseSet" DROP CONSTRAINT "ExerciseSet_fileId_fkey";
ALTER TABLE "ExerciseSet" ADD CONSTRAINT "ExerciseSet_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "File"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Question" DROP CONSTRAINT "Question_exerciseSetId_fkey";
ALTER TABLE "Question" ADD CONSTRAINT "Question_exerciseSetId_fkey" FOREIGN KEY ("exerciseSetId") REFERENCES "ExerciseSet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Submission" DROP CONSTRAINT "Submission_exerciseSetId_fkey";
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_exerciseSetId_fkey" FOREIGN KEY ("exerciseSetId") REFERENCES "ExerciseSet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SubmissionAnswer" DROP CONSTRAINT "SubmissionAnswer_submissionId_fkey";
ALTER TABLE "SubmissionAnswer" ADD CONSTRAINT "SubmissionAnswer_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SubmissionAnswer" DROP CONSTRAINT "SubmissionAnswer_questionId_fkey";
ALTER TABLE "SubmissionAnswer" ADD CONSTRAINT "SubmissionAnswer_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE CASCADE ON UPDATE CASCADE;
