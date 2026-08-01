-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "SystemRole" AS ENUM ('super_admin', 'admin', 'member');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('active', 'disabled');

-- CreateEnum
CREATE TYPE "PermissionLevel" AS ENUM ('owner', 'editor', 'lecturer', 'viewer', 'no_access');

-- CreateEnum
CREATE TYPE "PermissionTargetType" AS ENUM ('workspace', 'folder', 'file');

-- CreateEnum
CREATE TYPE "FileType" AS ENUM ('book', 'lesson', 'course', 'exercise_set', 'doc', 'asset');

-- CreateEnum
CREATE TYPE "FileStatus" AS ENUM ('draft', 'published', 'archived');

-- CreateEnum
CREATE TYPE "QuestionType" AS ENUM ('single_choice', 'multiple_choice', 'true_false', 'fill_blank', 'short_answer');

-- CreateEnum
CREATE TYPE "SubmissionStatus" AS ENUM ('not_started', 'in_progress', 'submitted', 'auto_graded', 'needs_manual_review', 'graded', 'late');

-- CreateEnum
CREATE TYPE "ClassroomMemberRole" AS ENUM ('teacher', 'student');

-- CreateEnum
CREATE TYPE "ForumThreadStatus" AS ENUM ('open', 'locked');

-- CreateEnum
CREATE TYPE "StorageBackend" AS ENUM ('minio', 'oss', 'r2');

-- CreateEnum
CREATE TYPE "StorageDownloadMode" AS ENUM ('proxy', 'direct');

-- CreateEnum
CREATE TYPE "StorageUploadMode" AS ENUM ('relay', 'direct');

-- CreateEnum
CREATE TYPE "PendingUploadKind" AS ENUM ('asset', 'classroom', 'forum_image', 'profile_banner');

-- CreateEnum
CREATE TYPE "FileAssetKind" AS ENUM ('embedded', 'standalone');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "avatarStorageKey" TEXT,
    "avatarMimeType" TEXT,
    "avatarUpdatedAt" TIMESTAMP(3),
    "avatarStorageBackend" "StorageBackend" NOT NULL DEFAULT 'minio',
    "bio" TEXT,
    "bannerStorageKey" TEXT,
    "bannerMimeType" TEXT,
    "bannerUpdatedAt" TIMESTAMP(3),
    "bannerStorageBackend" "StorageBackend" NOT NULL DEFAULT 'minio',
    "sessionVersion" INTEGER NOT NULL DEFAULT 0,
    "systemRole" "SystemRole" NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'active',
    "storageQuotaBytes" INTEGER,
    "aiCallCount" INTEGER NOT NULL DEFAULT 0,
    "aiCallLimit" INTEGER,
    "aiCallDateKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "priority" TEXT NOT NULL DEFAULT 'normal',
    "actorId" TEXT,
    "classroomId" TEXT,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "href" TEXT NOT NULL,
    "groupKey" TEXT,
    "aggregateCount" INTEGER NOT NULL DEFAULT 1,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationRecipient" (
    "notificationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "readAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationRecipient_pkey" PRIMARY KEY ("notificationId","userId")
);

-- CreateTable
CREATE TABLE "ServerMetricSample" (
    "id" TEXT NOT NULL,
    "cpuUsagePercent" DOUBLE PRECISION NOT NULL,
    "memoryUsagePercent" DOUBLE PRECISION NOT NULL,
    "diskUsagePercent" DOUBLE PRECISION NOT NULL,
    "sampledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ServerMetricSample_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Workspace" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "timeZone" TEXT NOT NULL DEFAULT 'Asia/Shanghai',
    "faviconStorageKey" TEXT,
    "faviconMimeType" TEXT,
    "faviconUpdatedAt" TIMESTAMP(3),
    "faviconStorageBackend" "StorageBackend" NOT NULL DEFAULT 'minio',
    "faviconLightStorageKey" TEXT,
    "faviconLightMimeType" TEXT,
    "faviconLightUpdatedAt" TIMESTAMP(3),
    "faviconLightStorageBackend" "StorageBackend" NOT NULL DEFAULT 'minio',
    "faviconDarkStorageKey" TEXT,
    "faviconDarkMimeType" TEXT,
    "faviconDarkUpdatedAt" TIMESTAMP(3),
    "faviconDarkStorageBackend" "StorageBackend" NOT NULL DEFAULT 'minio',
    "memberAttachmentQuotaBytes" INTEGER,
    "classroomStorageQuotaBytes" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Workspace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ForumCategory" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ForumCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ForumThread" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "isAnonymous" BOOLEAN NOT NULL DEFAULT false,
    "status" "ForumThreadStatus" NOT NULL DEFAULT 'open',
    "relatedResources" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ForumThread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ForumPost" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "parentId" TEXT,
    "replyToId" TEXT,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "isAnonymous" BOOLEAN NOT NULL DEFAULT false,
    "upvoteCount" INTEGER NOT NULL DEFAULT 0,
    "downvoteCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ForumPost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ForumPostVote" (
    "postId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "value" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ForumPostVote_pkey" PRIMARY KEY ("postId","userId"),
    CONSTRAINT "ForumPostVote_value_check" CHECK ("value" IN (-1, 1))
);

-- CreateTable
CREATE TABLE "Folder" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "parentId" TEXT,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "pinnedOrder" INTEGER,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Folder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "File" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "folderId" TEXT NOT NULL,
    "type" "FileType" NOT NULL,
    "title" TEXT NOT NULL,
    "status" "FileStatus" NOT NULL DEFAULT 'draft',
    "version" INTEGER NOT NULL DEFAULT 1,
    "pinnedOrder" INTEGER,
    "importWarnings" JSONB,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "File_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserTag" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserTag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserTagAssignment" (
    "tagId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserTagAssignment_pkey" PRIMARY KEY ("tagId","userId")
);

-- CreateTable
CREATE TABLE "Badge" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "color" TEXT NOT NULL DEFAULT 'gold',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Badge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserBadge" (
    "badgeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "awardedById" TEXT NOT NULL,
    "awardedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "equippedOrder" INTEGER,

    CONSTRAINT "UserBadge_pkey" PRIMARY KEY ("badgeId","userId")
);

-- CreateTable
CREATE TABLE "PermissionGrant" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "targetType" "PermissionTargetType" NOT NULL,
    "targetId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "level" "PermissionLevel" NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PermissionGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentBlock" (
    "id" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "parentBlockId" TEXT,
    "type" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "dataJson" JSONB NOT NULL,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentBlock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExerciseSet" (
    "id" TEXT NOT NULL,
    "classroomId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "fileId" TEXT,
    "openAt" TIMESTAMP(3),
    "dueAt" TIMESTAMP(3),
    "allowMultipleSubmissions" BOOLEAN NOT NULL DEFAULT false,
    "showAnswerAfterSubmit" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExerciseSet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeachingDeck" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "classroomId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeachingDeck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeachingDeckItem" (
    "id" TEXT NOT NULL,
    "deckId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "sourceFileId" TEXT,
    "sourceBlockId" TEXT,
    "exerciseSetId" TEXT,
    "assetId" TEXT,
    "snapshotJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeachingDeckItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Classroom" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdById" TEXT NOT NULL,
    "storageQuotaBytes" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Classroom_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClassroomMember" (
    "classroomId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "ClassroomMemberRole" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClassroomMember_pkey" PRIMARY KEY ("classroomId","userId")
);

-- CreateTable
CREATE TABLE "ClassroomFile" (
    "id" TEXT NOT NULL,
    "classroomId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "storageBackend" "StorageBackend" NOT NULL DEFAULT 'minio',
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "uploadedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClassroomFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClassroomAnnouncement" (
    "id" TEXT NOT NULL,
    "classroomId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClassroomAnnouncement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Question" (
    "id" TEXT NOT NULL,
    "exerciseSetId" TEXT NOT NULL,
    "type" "QuestionType" NOT NULL,
    "promptJson" JSONB NOT NULL,
    "optionsJson" JSONB,
    "answerJson" JSONB,
    "score" INTEGER NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Question_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Submission" (
    "id" TEXT NOT NULL,
    "exerciseSetId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "SubmissionStatus" NOT NULL,
    "score" INTEGER,
    "maxScore" INTEGER NOT NULL,
    "submittedAt" TIMESTAMP(3),
    "gradedAt" TIMESTAMP(3),
    "gradedById" TEXT,
    "feedback" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Submission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubmissionAnswer" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "answerJson" JSONB NOT NULL,
    "score" INTEGER,
    "feedback" TEXT,
    "autoGraded" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubmissionAnswer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FileAsset" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "folderId" TEXT,
    "fileId" TEXT,
    "forumPostId" TEXT,
    "storageKey" TEXT NOT NULL,
    "storageBackend" "StorageBackend" NOT NULL DEFAULT 'minio',
    "kind" "FileAssetKind" NOT NULL DEFAULT 'embedded',
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "sortOrder" INTEGER,
    "uploadedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FileAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StorageSettings" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "backend" "StorageBackend" NOT NULL DEFAULT 'minio',
    "downloadMode" "StorageDownloadMode" NOT NULL DEFAULT 'proxy',
    "uploadMode" "StorageUploadMode" NOT NULL DEFAULT 'relay',
    "ossRegion" TEXT,
    "ossBucket" TEXT,
    "ossEndpoint" TEXT,
    "ossAccessKeyId" TEXT,
    "ossAccessKeySecret" TEXT,
    "ossInternal" BOOLEAN NOT NULL DEFAULT false,
    "ossInternalEndpoint" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StorageSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PendingUpload" (
    "id" TEXT NOT NULL,
    "kind" "PendingUploadKind" NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "folderId" TEXT,
    "fileId" TEXT,
    "classroomId" TEXT,
    "forumPostId" TEXT,
    "storageBackend" "StorageBackend" NOT NULL DEFAULT 'minio',
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "uploadedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PendingUpload_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiSettings" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "activeConfigId" TEXT,
    "maxContextFiles" INTEGER NOT NULL DEFAULT 6,
    "maxContextChars" INTEGER NOT NULL DEFAULT 12000,
    "defaultCallLimit" INTEGER NOT NULL DEFAULT 100,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiProviderConfig" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "providerName" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "apiKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiProviderConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiConversation" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "pinnedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiMessage" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "sourcesJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE INDEX "Notification_classroomId_occurredAt_idx" ON "Notification"("classroomId", "occurredAt");

-- CreateIndex
CREATE INDEX "Notification_category_occurredAt_idx" ON "Notification"("category", "occurredAt");

-- CreateIndex
CREATE INDEX "Notification_groupKey_occurredAt_idx" ON "Notification"("groupKey", "occurredAt");

-- CreateIndex
CREATE INDEX "NotificationRecipient_userId_archivedAt_readAt_createdAt_idx" ON "NotificationRecipient"("userId", "archivedAt", "readAt", "createdAt");

-- CreateIndex
CREATE INDEX "ServerMetricSample_sampledAt_idx" ON "ServerMetricSample"("sampledAt");

-- CreateIndex
CREATE UNIQUE INDEX "Workspace_slug_key" ON "Workspace"("slug");

-- CreateIndex
CREATE INDEX "ForumCategory_workspaceId_sortOrder_idx" ON "ForumCategory"("workspaceId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "ForumCategory_workspaceId_name_key" ON "ForumCategory"("workspaceId", "name");

-- CreateIndex
CREATE INDEX "ForumThread_workspaceId_lastActivityAt_idx" ON "ForumThread"("workspaceId", "lastActivityAt");

-- CreateIndex
CREATE INDEX "ForumThread_categoryId_lastActivityAt_idx" ON "ForumThread"("categoryId", "lastActivityAt");

-- CreateIndex
CREATE INDEX "ForumPost_threadId_createdAt_idx" ON "ForumPost"("threadId", "createdAt");

-- CreateIndex
CREATE INDEX "ForumPost_parentId_createdAt_idx" ON "ForumPost"("parentId", "createdAt");

-- CreateIndex
CREATE INDEX "ForumPost_replyToId_createdAt_idx" ON "ForumPost"("replyToId", "createdAt");

-- CreateIndex
CREATE INDEX "ForumPost_authorId_createdAt_idx" ON "ForumPost"("authorId", "createdAt");

-- CreateIndex
CREATE INDEX "ForumPostVote_userId_updatedAt_idx" ON "ForumPostVote"("userId", "updatedAt");

-- CreateIndex
CREATE INDEX "Folder_workspaceId_parentId_sortOrder_idx" ON "Folder"("workspaceId", "parentId", "sortOrder");

-- CreateIndex
CREATE INDEX "Folder_workspaceId_pinnedOrder_idx" ON "Folder"("workspaceId", "pinnedOrder");

-- CreateIndex
CREATE INDEX "File_folderId_status_updatedAt_idx" ON "File"("folderId", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "File_workspaceId_pinnedOrder_idx" ON "File"("workspaceId", "pinnedOrder");

-- CreateIndex
CREATE INDEX "UserTag_workspaceId_name_idx" ON "UserTag"("workspaceId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "UserTag_workspaceId_name_key" ON "UserTag"("workspaceId", "name");

-- CreateIndex
CREATE INDEX "UserTagAssignment_userId_idx" ON "UserTagAssignment"("userId");

-- CreateIndex
CREATE INDEX "Badge_workspaceId_createdAt_idx" ON "Badge"("workspaceId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Badge_workspaceId_name_key" ON "Badge"("workspaceId", "name");

-- CreateIndex
CREATE INDEX "UserBadge_userId_equippedOrder_idx" ON "UserBadge"("userId", "equippedOrder");

-- CreateIndex
CREATE INDEX "UserBadge_awardedById_idx" ON "UserBadge"("awardedById");

-- CreateIndex
CREATE INDEX "PermissionGrant_workspaceId_targetType_targetId_idx" ON "PermissionGrant"("workspaceId", "targetType", "targetId");

-- CreateIndex
CREATE INDEX "PermissionGrant_userId_idx" ON "PermissionGrant"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "PermissionGrant_targetType_targetId_userId_key" ON "PermissionGrant"("targetType", "targetId", "userId");

-- CreateIndex
CREATE INDEX "ContentBlock_fileId_sortOrder_idx" ON "ContentBlock"("fileId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "ExerciseSet_fileId_key" ON "ExerciseSet"("fileId");

-- CreateIndex
CREATE INDEX "ExerciseSet_classroomId_updatedAt_idx" ON "ExerciseSet"("classroomId", "updatedAt");

-- CreateIndex
CREATE INDEX "ExerciseSet_createdById_idx" ON "ExerciseSet"("createdById");

-- CreateIndex
CREATE INDEX "TeachingDeck_classroomId_updatedAt_idx" ON "TeachingDeck"("classroomId", "updatedAt");

-- CreateIndex
CREATE INDEX "TeachingDeck_workspaceId_updatedAt_idx" ON "TeachingDeck"("workspaceId", "updatedAt");

-- CreateIndex
CREATE INDEX "TeachingDeck_createdById_idx" ON "TeachingDeck"("createdById");

-- CreateIndex
CREATE INDEX "TeachingDeckItem_deckId_sortOrder_idx" ON "TeachingDeckItem"("deckId", "sortOrder");

-- CreateIndex
CREATE INDEX "TeachingDeckItem_sourceFileId_idx" ON "TeachingDeckItem"("sourceFileId");

-- CreateIndex
CREATE INDEX "TeachingDeckItem_sourceBlockId_idx" ON "TeachingDeckItem"("sourceBlockId");

-- CreateIndex
CREATE INDEX "TeachingDeckItem_exerciseSetId_idx" ON "TeachingDeckItem"("exerciseSetId");

-- CreateIndex
CREATE INDEX "TeachingDeckItem_assetId_idx" ON "TeachingDeckItem"("assetId");

-- CreateIndex
CREATE INDEX "Classroom_workspaceId_updatedAt_idx" ON "Classroom"("workspaceId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Classroom_workspaceId_name_key" ON "Classroom"("workspaceId", "name");

-- CreateIndex
CREATE INDEX "ClassroomMember_userId_role_idx" ON "ClassroomMember"("userId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "ClassroomFile_storageKey_key" ON "ClassroomFile"("storageKey");

-- CreateIndex
CREATE INDEX "ClassroomFile_classroomId_createdAt_idx" ON "ClassroomFile"("classroomId", "createdAt");

-- CreateIndex
CREATE INDEX "ClassroomFile_uploadedBy_createdAt_idx" ON "ClassroomFile"("uploadedBy", "createdAt");

-- CreateIndex
CREATE INDEX "ClassroomAnnouncement_classroomId_createdAt_idx" ON "ClassroomAnnouncement"("classroomId", "createdAt");

-- CreateIndex
CREATE INDEX "ClassroomAnnouncement_authorId_idx" ON "ClassroomAnnouncement"("authorId");

-- CreateIndex
CREATE INDEX "Submission_exerciseSetId_userId_submittedAt_idx" ON "Submission"("exerciseSetId", "userId", "submittedAt");

-- CreateIndex
CREATE UNIQUE INDEX "FileAsset_storageKey_key" ON "FileAsset"("storageKey");

-- CreateIndex
CREATE INDEX "FileAsset_folderId_kind_createdAt_idx" ON "FileAsset"("folderId", "kind", "createdAt");

-- CreateIndex
CREATE INDEX "FileAsset_forumPostId_sortOrder_idx" ON "FileAsset"("forumPostId", "sortOrder");

-- CreateIndex
CREATE INDEX "FileAsset_uploadedBy_createdAt_idx" ON "FileAsset"("uploadedBy", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "StorageSettings_workspaceId_key" ON "StorageSettings"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "PendingUpload_storageKey_key" ON "PendingUpload"("storageKey");

-- CreateIndex
CREATE INDEX "PendingUpload_uploadedBy_expiresAt_idx" ON "PendingUpload"("uploadedBy", "expiresAt");

-- CreateIndex
CREATE INDEX "PendingUpload_forumPostId_idx" ON "PendingUpload"("forumPostId");

-- CreateIndex
CREATE UNIQUE INDEX "AiSettings_workspaceId_key" ON "AiSettings"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "AiSettings_activeConfigId_key" ON "AiSettings"("activeConfigId");

-- CreateIndex
CREATE INDEX "AiProviderConfig_workspaceId_updatedAt_idx" ON "AiProviderConfig"("workspaceId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AiProviderConfig_workspaceId_name_key" ON "AiProviderConfig"("workspaceId", "name");

-- CreateIndex
CREATE INDEX "AiConversation_userId_updatedAt_idx" ON "AiConversation"("userId", "updatedAt");

-- CreateIndex
CREATE INDEX "AiMessage_conversationId_createdAt_idx" ON "AiMessage"("conversationId", "createdAt");

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_classroomId_fkey" FOREIGN KEY ("classroomId") REFERENCES "Classroom"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationRecipient" ADD CONSTRAINT "NotificationRecipient_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "Notification"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationRecipient" ADD CONSTRAINT "NotificationRecipient_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForumCategory" ADD CONSTRAINT "ForumCategory_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForumThread" ADD CONSTRAINT "ForumThread_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForumThread" ADD CONSTRAINT "ForumThread_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ForumCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForumThread" ADD CONSTRAINT "ForumThread_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForumPost" ADD CONSTRAINT "ForumPost_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "ForumThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForumPost" ADD CONSTRAINT "ForumPost_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "ForumPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForumPost" ADD CONSTRAINT "ForumPost_replyToId_fkey" FOREIGN KEY ("replyToId") REFERENCES "ForumPost"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForumPost" ADD CONSTRAINT "ForumPost_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForumPostVote" ADD CONSTRAINT "ForumPostVote_postId_fkey" FOREIGN KEY ("postId") REFERENCES "ForumPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForumPostVote" ADD CONSTRAINT "ForumPostVote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Folder" ADD CONSTRAINT "Folder_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Folder" ADD CONSTRAINT "Folder_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Folder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Folder" ADD CONSTRAINT "Folder_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "File" ADD CONSTRAINT "File_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "File" ADD CONSTRAINT "File_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "Folder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "File" ADD CONSTRAINT "File_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "File" ADD CONSTRAINT "File_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserTag" ADD CONSTRAINT "UserTag_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserTagAssignment" ADD CONSTRAINT "UserTagAssignment_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "UserTag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserTagAssignment" ADD CONSTRAINT "UserTagAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Badge" ADD CONSTRAINT "Badge_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Badge" ADD CONSTRAINT "Badge_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserBadge" ADD CONSTRAINT "UserBadge_badgeId_fkey" FOREIGN KEY ("badgeId") REFERENCES "Badge"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserBadge" ADD CONSTRAINT "UserBadge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserBadge" ADD CONSTRAINT "UserBadge_awardedById_fkey" FOREIGN KEY ("awardedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PermissionGrant" ADD CONSTRAINT "PermissionGrant_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PermissionGrant" ADD CONSTRAINT "PermissionGrant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PermissionGrant" ADD CONSTRAINT "PermissionGrant_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentBlock" ADD CONSTRAINT "ContentBlock_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "File"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentBlock" ADD CONSTRAINT "ContentBlock_parentBlockId_fkey" FOREIGN KEY ("parentBlockId") REFERENCES "ContentBlock"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExerciseSet" ADD CONSTRAINT "ExerciseSet_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExerciseSet" ADD CONSTRAINT "ExerciseSet_classroomId_fkey" FOREIGN KEY ("classroomId") REFERENCES "Classroom"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExerciseSet" ADD CONSTRAINT "ExerciseSet_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "File"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeachingDeck" ADD CONSTRAINT "TeachingDeck_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeachingDeck" ADD CONSTRAINT "TeachingDeck_classroomId_fkey" FOREIGN KEY ("classroomId") REFERENCES "Classroom"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeachingDeck" ADD CONSTRAINT "TeachingDeck_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeachingDeckItem" ADD CONSTRAINT "TeachingDeckItem_deckId_fkey" FOREIGN KEY ("deckId") REFERENCES "TeachingDeck"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeachingDeckItem" ADD CONSTRAINT "TeachingDeckItem_sourceFileId_fkey" FOREIGN KEY ("sourceFileId") REFERENCES "File"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeachingDeckItem" ADD CONSTRAINT "TeachingDeckItem_sourceBlockId_fkey" FOREIGN KEY ("sourceBlockId") REFERENCES "ContentBlock"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeachingDeckItem" ADD CONSTRAINT "TeachingDeckItem_exerciseSetId_fkey" FOREIGN KEY ("exerciseSetId") REFERENCES "ExerciseSet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeachingDeckItem" ADD CONSTRAINT "TeachingDeckItem_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "FileAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Classroom" ADD CONSTRAINT "Classroom_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Classroom" ADD CONSTRAINT "Classroom_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassroomMember" ADD CONSTRAINT "ClassroomMember_classroomId_fkey" FOREIGN KEY ("classroomId") REFERENCES "Classroom"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassroomMember" ADD CONSTRAINT "ClassroomMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassroomFile" ADD CONSTRAINT "ClassroomFile_classroomId_fkey" FOREIGN KEY ("classroomId") REFERENCES "Classroom"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassroomFile" ADD CONSTRAINT "ClassroomFile_uploadedBy_fkey" FOREIGN KEY ("uploadedBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassroomAnnouncement" ADD CONSTRAINT "ClassroomAnnouncement_classroomId_fkey" FOREIGN KEY ("classroomId") REFERENCES "Classroom"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassroomAnnouncement" ADD CONSTRAINT "ClassroomAnnouncement_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Question" ADD CONSTRAINT "Question_exerciseSetId_fkey" FOREIGN KEY ("exerciseSetId") REFERENCES "ExerciseSet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_exerciseSetId_fkey" FOREIGN KEY ("exerciseSetId") REFERENCES "ExerciseSet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubmissionAnswer" ADD CONSTRAINT "SubmissionAnswer_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubmissionAnswer" ADD CONSTRAINT "SubmissionAnswer_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FileAsset" ADD CONSTRAINT "FileAsset_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FileAsset" ADD CONSTRAINT "FileAsset_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "Folder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FileAsset" ADD CONSTRAINT "FileAsset_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "File"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FileAsset" ADD CONSTRAINT "FileAsset_forumPostId_fkey" FOREIGN KEY ("forumPostId") REFERENCES "ForumPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FileAsset" ADD CONSTRAINT "FileAsset_uploadedBy_fkey" FOREIGN KEY ("uploadedBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StorageSettings" ADD CONSTRAINT "StorageSettings_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PendingUpload" ADD CONSTRAINT "PendingUpload_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PendingUpload" ADD CONSTRAINT "PendingUpload_forumPostId_fkey" FOREIGN KEY ("forumPostId") REFERENCES "ForumPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiSettings" ADD CONSTRAINT "AiSettings_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiSettings" ADD CONSTRAINT "AiSettings_activeConfigId_fkey" FOREIGN KEY ("activeConfigId") REFERENCES "AiProviderConfig"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiProviderConfig" ADD CONSTRAINT "AiProviderConfig_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiConversation" ADD CONSTRAINT "AiConversation_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiConversation" ADD CONSTRAINT "AiConversation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiMessage" ADD CONSTRAINT "AiMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "AiConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
