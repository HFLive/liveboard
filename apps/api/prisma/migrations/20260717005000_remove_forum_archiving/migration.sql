DELETE FROM "ForumThread"
WHERE "status" = 'archived';

ALTER TYPE "ForumThreadStatus" RENAME TO "ForumThreadStatus_old";

CREATE TYPE "ForumThreadStatus" AS ENUM ('open', 'locked');

ALTER TABLE "ForumThread"
ALTER COLUMN "status" DROP DEFAULT,
ALTER COLUMN "status" TYPE "ForumThreadStatus"
USING ("status"::text::"ForumThreadStatus"),
ALTER COLUMN "status" SET DEFAULT 'open';

DROP TYPE "ForumThreadStatus_old";
