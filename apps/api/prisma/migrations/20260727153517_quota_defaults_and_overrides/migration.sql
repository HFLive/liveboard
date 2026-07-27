-- AlterTable
ALTER TABLE "Classroom" ALTER COLUMN "storageQuotaBytes" DROP NOT NULL,
ALTER COLUMN "storageQuotaBytes" DROP DEFAULT;

-- AlterTable
ALTER TABLE "User" ALTER COLUMN "storageQuotaBytes" DROP NOT NULL,
ALTER COLUMN "storageQuotaBytes" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Workspace" ADD COLUMN     "classroomStorageQuotaBytes" INTEGER,
ADD COLUMN     "memberAttachmentQuotaBytes" INTEGER;
