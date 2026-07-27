-- 旧的系统默认值改为 NULL，跟随新的默认配额模型（成员 128MB、课堂 512MB）
UPDATE "User" SET "storageQuotaBytes" = NULL WHERE "storageQuotaBytes" = 536870912;
UPDATE "Classroom" SET "storageQuotaBytes" = NULL WHERE "storageQuotaBytes" = 1073741824;
