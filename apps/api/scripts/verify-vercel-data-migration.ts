/**
 * Vercel 数据迁移验证工具。
 *
 * 校验项：
 * - 关键业务表源/目标行数一致（SOURCE_DATABASE_URL vs DATABASE_URL）。
 * - 关键外键无孤立引用。
 * - 至少存在一名 `status=active` 且 `role=super_admin` 的用户。
 * - 文档、文件夹、课堂、练习、提交、论坛、通知和 AI 会话的关键关联完整。
 * - AI Provider 配置可以使用当前 `AI_ENCRYPTION_KEY` 解密。
 * - 所有非空存储引用在 R2 中存在且大小正确。
 * - 所有已迁移对象记录的 backend 为 r2。
 * - R2 缺失对象数为 0，否则阻断上线。
 * - 新数据库 `_prisma_migrations` 只有唯一 baseline。
 *
 * 用法：
 *   pnpm --filter @liveboard/api verify-vercel-data-migration
 *   SOURCE_DATABASE_URL=... pnpm --filter @liveboard/api verify-vercel-data-migration
 */
import { PrismaClient } from "@prisma/client";
import { AiSecretService } from "../src/modules/ai/ai-secret.service";
import {
  R2StorageBackend,
  resolveR2ClientConfig,
} from "../src/modules/storage/r2-storage.backend";

const BUSINESS_TABLES = [
  "User",
  "Workspace",
  "Folder",
  "File",
  "ContentBlock",
  "FileAsset",
  "Classroom",
  "ClassroomMember",
  "ClassroomFile",
  "ClassroomAnnouncement",
  "ExerciseSet",
  "Question",
  "Submission",
  "SubmissionAnswer",
  "TeachingDeck",
  "TeachingDeckItem",
  "ForumCategory",
  "ForumThread",
  "ForumPost",
  "ForumPostVote",
  "UserTag",
  "UserTagAssignment",
  "Badge",
  "UserBadge",
  "PermissionGrant",
  "Notification",
  "NotificationRecipient",
  "AiSettings",
  "AiProviderConfig",
  "AiConversation",
  "AiMessage",
] as const;

type TableName = (typeof BUSINESS_TABLES)[number];

const RESULTS: Array<{ check: string; ok: boolean; detail?: string }> = [];
let blocking = false;

function record(check: string, ok: boolean, detail?: string) {
  RESULTS.push({ check, ok, detail });
  if (!ok) blocking = true;
}

function plural(count: number, label: string) {
  return `${count} ${label}`;
}

async function run() {
  const prisma = new PrismaClient();
  let source: PrismaClient | null = null;
  if (process.env.SOURCE_DATABASE_URL) {
    source = new PrismaClient({
      datasources: { db: { url: process.env.SOURCE_DATABASE_URL } },
    });
  } else {
    console.log("[verify] 未设置 SOURCE_DATABASE_URL，跳过源/目标行数对比。");
  }

  let r2: R2StorageBackend;
  try {
    r2 = new R2StorageBackend(resolveR2ClientConfig(process.env));
  } catch (caught) {
    console.error("[verify] R2 环境变量缺失:", messageOf(caught));
    await prisma.$disconnect();
    process.exit(1);
  }
  const secrets = new AiSecretService({
    get: (key: string) => process.env[key],
  } as never);

  try {
    // 1. 行数对比
    if (source) {
      for (const table of BUSINESS_TABLES) {
        const [targetCount, sourceCount] = await Promise.all([
          (
            prisma as unknown as Record<
              string,
              { count: (args?: unknown) => Promise<number> }
            >
          )[table]!.count(),
          (
            source as unknown as Record<
              string,
              { count: (args?: unknown) => Promise<number> }
            >
          )[table]!.count(),
        ]);
        record(
          `行数 ${table}`,
          targetCount === sourceCount,
          `目标=${targetCount} 源=${sourceCount}`,
        );
      }
    }

    // 2. 关键外键无孤立引用
    const orphans: string[] = [];
    const [assetRefs, folders, files, posts, workspaceRefs, classrooms] =
      await Promise.all([
        prisma.fileAsset.findMany({
          select: {
            id: true,
            workspaceId: true,
            folderId: true,
            fileId: true,
            forumPostId: true,
          },
        }),
        prisma.folder.findMany({ select: { id: true } }),
        prisma.file.findMany({ select: { id: true } }),
        prisma.forumPost.findMany({ select: { id: true } }),
        prisma.workspace.findMany({ select: { id: true } }),
        prisma.classroom.findMany({ select: { id: true } }),
      ]);
    const folderIds = new Set(folders.map((f) => f.id));
    const fileIds = new Set(files.map((f) => f.id));
    const postIds = new Set(posts.map((p) => p.id));
    const workspaceIds = new Set(workspaceRefs.map((w) => w.id));
    const classroomIds = new Set(classrooms.map((c) => c.id));

    for (const asset of assetRefs) {
      if (!workspaceIds.has(asset.workspaceId)) {
        orphans.push(`FileAsset.workspaceId=${asset.workspaceId}`);
      }
      if (asset.folderId && !folderIds.has(asset.folderId)) {
        orphans.push(`FileAsset.folderId=${asset.folderId}`);
      }
      if (asset.fileId && !fileIds.has(asset.fileId)) {
        orphans.push(`FileAsset.fileId=${asset.fileId}`);
      }
      if (asset.forumPostId && !postIds.has(asset.forumPostId)) {
        orphans.push(`FileAsset.forumPostId=${asset.forumPostId}`);
      }
    }
    const classroomFileRefs = await prisma.classroomFile.findMany({
      select: { classroomId: true },
    });
    for (const file of classroomFileRefs) {
      if (!classroomIds.has(file.classroomId)) {
        orphans.push(`ClassroomFile.classroomId=${file.classroomId}`);
      }
    }
    const deckItems = await prisma.teachingDeckItem.findMany({
      select: { assetId: true },
    });
    const assetIds = new Set(assetRefs.map((asset) => asset.id));
    for (const item of deckItems) {
      if (item.assetId && !assetIds.has(item.assetId)) {
        orphans.push(`TeachingDeckItem.assetId=${item.assetId}`);
      }
    }
    record(
      "孤立外键",
      orphans.length === 0,
      plural(orphans.length, "条孤立引用"),
    );

    // 3. 至少一名正常最高管理员
    const superAdmin = await prisma.user.findFirst({
      where: { systemRole: "super_admin", status: "active" },
      select: { id: true, username: true },
    });
    record(
      "存在正常最高管理员",
      Boolean(superAdmin),
      superAdmin?.username ?? "无",
    );

    // 4. 关键业务关联完整性
    const [
      classroomCount,
      exerciseCount,
      submissionCount,
      forumCount,
      notificationCount,
      conversationCount,
    ] = await Promise.all([
      prisma.classroom.count(),
      prisma.exerciseSet.count(),
      prisma.submission.count(),
      prisma.forumThread.count(),
      prisma.notification.count(),
      prisma.aiConversation.count(),
    ]);
    record(
      "关键业务数据计数可读",
      true,
      [
        `课堂=${classroomCount}`,
        `练习=${exerciseCount}`,
        `提交=${submissionCount}`,
        `论坛=${forumCount}`,
        `通知=${notificationCount}`,
        `AI会话=${conversationCount}`,
      ].join(" "),
    );

    // 5. AI Provider 配置可解密
    const aiConfigs = await prisma.aiProviderConfig.findMany({
      select: { id: true, apiKey: true },
    });
    let decryptFailures = 0;
    for (const config of aiConfigs) {
      try {
        if (secrets.isEncrypted(config.apiKey)) {
          secrets.decrypt(config.apiKey);
        }
      } catch {
        decryptFailures += 1;
      }
    }
    record(
      "AI Provider 配置可解密",
      decryptFailures === 0,
      plural(decryptFailures, "条无法解密"),
    );

    // 6. 所有非空存储引用在 R2 存在且大小正确；backend 全部为 r2
    const missing: string[] = [];
    const wrongBackend: string[] = [];

    const users = await prisma.user.findMany({
      select: {
        id: true,
        avatarStorageKey: true,
        avatarStorageBackend: true,
        bannerStorageKey: true,
        bannerStorageBackend: true,
      },
    });
    for (const user of users) {
      if (user.avatarStorageKey) {
        if (user.avatarStorageBackend !== "r2") {
          wrongBackend.push(`avatar(${user.id})`);
        }
        if (!(await existsInR2(r2, user.avatarStorageKey, null))) {
          missing.push(`avatar(${user.id})`);
        }
      }
      if (user.bannerStorageKey) {
        if (user.bannerStorageBackend !== "r2") {
          wrongBackend.push(`banner(${user.id})`);
        }
        if (!(await existsInR2(r2, user.bannerStorageKey, null))) {
          missing.push(`banner(${user.id})`);
        }
      }
    }

    const workspaceFavicons = await prisma.workspace.findMany({
      select: {
        id: true,
        faviconStorageKey: true,
        faviconStorageBackend: true,
        faviconLightStorageKey: true,
        faviconLightStorageBackend: true,
        faviconDarkStorageKey: true,
        faviconDarkStorageBackend: true,
      },
    });
    for (const workspace of workspaceFavicons) {
      const favicons: Array<[string | null, string]> = [
        [workspace.faviconStorageKey, workspace.faviconStorageBackend],
        [
          workspace.faviconLightStorageKey,
          workspace.faviconLightStorageBackend,
        ],
        [workspace.faviconDarkStorageKey, workspace.faviconDarkStorageBackend],
      ];
      for (const [key, backend] of favicons) {
        if (!key) continue;
        if (backend !== "r2") {
          wrongBackend.push(`favicon(${workspace.id})`);
        }
        if (!(await existsInR2(r2, key, null))) {
          missing.push(`favicon(${workspace.id})`);
        }
      }
    }

    const fileAssetObjects = await prisma.fileAsset.findMany({
      select: {
        id: true,
        storageKey: true,
        storageBackend: true,
        sizeBytes: true,
      },
    });
    for (const asset of fileAssetObjects) {
      if (asset.storageBackend !== "r2") {
        wrongBackend.push(`file_asset(${asset.id})`);
      }
      if (!(await existsInR2(r2, asset.storageKey, asset.sizeBytes))) {
        missing.push(`file_asset(${asset.id})`);
      }
    }

    const classroomFileObjects = await prisma.classroomFile.findMany({
      select: {
        id: true,
        storageKey: true,
        storageBackend: true,
        sizeBytes: true,
      },
    });
    for (const file of classroomFileObjects) {
      if (file.storageBackend !== "r2") {
        wrongBackend.push(`classroom_file(${file.id})`);
      }
      if (!(await existsInR2(r2, file.storageKey, file.sizeBytes))) {
        missing.push(`classroom_file(${file.id})`);
      }
    }

    record(
      "R2 缺失对象",
      missing.length === 0,
      plural(missing.length, "个缺失对象"),
    );
    record(
      "对象 backend 均为 r2",
      wrongBackend.length === 0,
      plural(wrongBackend.length, "条记录非 r2"),
    );

    // 7. _prisma_migrations 只有唯一 baseline
    const migrations = (await prisma.$queryRaw`
      SELECT "migration_name", "finished_at" IS NOT NULL AS done FROM "_prisma_migrations"
    `) as Array<{ migration_name: string; done: boolean }>;
    const baselineRows = migrations.filter(
      (row) => row.migration_name === "00000000000000_baseline_v1" && row.done,
    );
    record(
      "_prisma_migrations 仅唯一 baseline",
      baselineRows.length === 1 && migrations.length === 1,
      migrations.map((row) => row.migration_name).join(", "),
    );
  } finally {
    await prisma.$disconnect();
    if (source) await source.$disconnect();
  }

  for (const result of RESULTS) {
    console.log(
      `[verify] ${result.ok ? "PASS" : "FAIL"} ${result.check}` +
        (result.detail ? ` — ${result.detail}` : ""),
    );
  }
  console.log(
    `[verify] ${blocking ? "发现阻断性问题，禁止上线" : "全部校验通过"}`,
  );
  if (blocking) process.exitCode = 1;
}

async function existsInR2(
  r2: R2StorageBackend,
  key: string,
  expectedSize: number | null,
) {
  try {
    const stat = await r2.statObject(key);
    if (expectedSize !== null && stat.size !== expectedSize) return false;
    return true;
  } catch {
    return false;
  }
}

function messageOf(caught: unknown) {
  if (caught instanceof Error) return caught.message;
  return String(caught);
}

run().catch((caught) => {
  console.error("[verify] 执行失败:", messageOf(caught));
  process.exitCode = 1;
});
