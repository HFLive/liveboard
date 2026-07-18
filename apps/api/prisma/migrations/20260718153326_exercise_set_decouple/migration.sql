-- 测验与文档文件夹解耦：ExerciseSet 自带标题与创建者，fileId 变为可选的历史关联。
-- 新增列先允许为空，从关联的 exercise_set 文件回填后再设为必填。
-- AlterTable
ALTER TABLE "ExerciseSet" ADD COLUMN "createdById" TEXT,
ADD COLUMN "title" TEXT,
ALTER COLUMN "fileId" DROP NOT NULL;

-- 回填：沿用原 exercise_set 文件的标题和创建者
UPDATE "ExerciseSet"
SET "title" = "File"."title",
    "createdById" = "File"."createdById"
FROM "File"
WHERE "File"."id" = "ExerciseSet"."fileId";

-- 兜底：没有关联文件的记录不应存在，防御性填充
UPDATE "ExerciseSet" SET "title" = '未命名测验' WHERE "title" IS NULL;
UPDATE "ExerciseSet"
SET "createdById" = (SELECT "id" FROM "User" WHERE "systemRole" = 'super_admin' ORDER BY "createdAt" LIMIT 1)
WHERE "createdById" IS NULL;

ALTER TABLE "ExerciseSet" ALTER COLUMN "createdById" SET NOT NULL,
ALTER COLUMN "title" SET NOT NULL;

-- CreateIndex
CREATE INDEX "ExerciseSet_createdById_idx" ON "ExerciseSet"("createdById");

-- AddForeignKey
ALTER TABLE "ExerciseSet" ADD CONSTRAINT "ExerciseSet_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
