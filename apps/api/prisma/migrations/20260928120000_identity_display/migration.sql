ALTER TABLE "User" ADD COLUMN "identityLabel" VARCHAR(40), ADD COLUMN "realName" VARCHAR(80);
ALTER TABLE "ExternalIdentity" ADD COLUMN "identityLabel" VARCHAR(40), ADD COLUMN "realName" VARCHAR(80);
