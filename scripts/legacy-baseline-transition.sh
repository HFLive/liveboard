#!/bin/sh
#
# 既有自托管数据库的历史过渡脚本。
#
# 仓库从 41 个历史 migration 收口为单个 `00000000000000_baseline_v1` 后，
# 既有自托管数据库仍保存旧 41 条 `_prisma_migrations` 记录。如果直接让普通
# `prisma migrate deploy` 对这些数据库运行，baseline 会被视为未应用并尝试
# 重复建表。
#
# 本脚本在数据库备份后、正常 `migrate deploy` 前调用：
#   1. 只读检查 `_prisma_migrations` 精确匹配已知的旧 LiveBoard 历史，
#      且所有记录成功完成（校验名称与 checksum，不接受只看数量）。
#   2. 检查实际 schema 与旧版本期望状态一致；存在未知 migration、失败记录
#      或 schema drift 时立即停止，禁止自动 resolve。
#   3. 执行经过审查的“旧最终 schema → 新最终 schema”桥接 SQL（不放回
#      Prisma migration 目录）。
#   4. 运行 `prisma migrate resolve --applied 00000000000000_baseline_v1`。
#   5. 再运行正常 `prisma migrate deploy`，确认无 pending。
#
# 默认只检查并输出计划，显式 `--execute` 才执行写入。
# 未知状态一律 fail closed。
#
# 用法：
#   DATABASE_URL=<url> sh scripts/legacy-baseline-transition.sh           # 只检查
#   DATABASE_URL=<url> sh scripts/legacy-baseline-transition.sh --execute # 执行过渡
set -eu

EXECUTE=0
for arg in "$@"; do
  case "$arg" in
    --execute) EXECUTE=1 ;;
    --help|-h)
      echo "用法: $0 [--execute]"
      echo "  --execute  执行桥接 SQL 与 baseline resolve；缺省只检查并输出计划。"
      exit 0
      ;;
  esac
done

: "${DATABASE_URL:?请设置 DATABASE_URL}"
# 可通过环境变量覆盖，Release 安装器用 compose 包装脚本在容器内执行。
PSQL="${PSQL:-psql}"
PRISMA_CMD="${PRISMA_CMD:-prisma}"

BASELINE="00000000000000_baseline_v1"

# 已知旧历史的 golden manifest：migration_name=checksum（从既有自托管数据库
# 的 `_prisma_migrations` 提取）。任何名称或 checksum 不符都会 fail closed。
GOLDEN_MANIFEST='
20260712130736_initial=862116419305c1df947d83cdea1f16657870c64357270678a1bb5a64a5e03139
20260713053000_ai_provider_configs=4290bdde755591b39e690570f4478c7e60b57d096b5ed0e1017987cce2db2fad
20260713140000_teaching_decks=14ce25252828bf49f71470c296bedc4c30702227b8282dc62ef3b6b1cd4d017b
20260714130000_revocable_sessions=7561dce7c6c763c8bb0f97ebc21d497bbecebffd75bab5cb6b2d463c6d1e95a4
20260715110000_user_avatars=dcc42cd2a3de95c3b99c0cf13ddcf871dc9dbb970519196f5ee81ac6bc127800
20260715170000_recursive_folder_delete=87be4c1b82915aeece52202a637cc8b04ef073765ca25819a454a2d81bc29b53
20260716133000_content_pins=708a23af792605fb8a897fe1b54d2b729913057cae2232acd97ef25b8d3fd07c
20260716223000_forum_anonymous=cc5be42357a50fda55e1aab40cad038c9c172662abf4c7d7be82bea016d989a9
20260716230000_forum_post_images=c5ef3763f6a4698140c0ec90bf577a70c84fe3860c750e15a0993413e9ae697b
20260716234000_remove_content_references=91696bc4d42ccb1a23a517931ff20671b8fac075d84770c6a67a393e98d24859
20260716235500_content_visibility=09d43853710ae67826812d17a6507639442a7af6157bfc32ec6e2cc61f7d8a60
20260717005000_remove_forum_archiving=0db4abe41ef2a5c8a4a27612909aceacb594a331b63dbd98ebfcc9a2f67c155a
20260717014500_user_profiles=7c81df65598d6cfa9f22bb055bc24ad65f9abbfe48a6751a8687549823d1b9a5
20260718114803_ai_call_quota=a40a3cba6ef843b396360cf5185348df05dc2ecfefb8755e06d235734a6a0f4c
20260718153326_exercise_set_decouple=82700cab91dba6cb042e74cf894a7b6f92e9511032146c62ff74590d7e2d0f0f
20260719120000_add_ai_conversation_pin=4628e32ca4e869c1e8aeaf4efaf76981dd79ae0dbac6d69ebaae452b0a8c6618
20260719121000_add_file_import_warnings=825cca07ee9e0fb990eee711a70811628d77b70fa5a527ec9d038f9dfd55b005
20260719122000_add_question_required=d50162875cd4ffe8cbc40783ecad8af8f2e8f3cb0e034f774774d47cf2ed8ea2
20260719123000_add_forum_thread_state=e5374df4896986dd004404118cfb97b93d5124423dab08df420e164555e37819
20260719124000_add_forum_related_resources=0637ed04f96b7d29b5c09e1c94f56158fd45a2cdbbb2bf5c751fc1dce6f794fc
20260719125000_add_file_asset_uploader_relation=98fee021c02eaff64d974a6d7138607dccadb77089ac3b1bee7067321fa77a28
20260719130000_add_activity_read_at=6eef4d2c0549707aa2e41613241d86ccc35c12162fff1786858198a9875b5bbf
20260719143000_make_ai_quota_daily=9b0c79682e95eda4676cf5af700b3b58c8cdc597d94cd2b9ce4effe155ae6bb2
20260719150000_add_activity_dismissal=53ac931f1829a26e9b66f99226c81bc775902b99ff923369d81ad1d3ee1a7992
20260723143000_add_server_metric_samples=97d806e5b2474367d111600004b052faa85719a44caa6a9488c7d85a1e333e4d
20260723150000_bilibili_favicon_forum_votes=4f364014248dda3479445ec7a76009c9838450b1ae8b74f1193dff24c9d19116
20260725233000_add_classrooms=04c891e5b7b0a485a751d7ee53a470dcdb50878433c09d7a710a84c6dc2a4970
20260726003000_replace_permission_groups_with_user_tags=e9df7c314cb8587a6ba8486510fd64721e5d519dd25082ffbdf1e48b7dea892c
20260726090000_add_classroom_announcements=247da5eb9dc3fa9abb96a56b37931fcad0c6ea90766bf50a51f8fddbfc2112f2
20260726114500_add_user_document_permissions=3443f04052f17c997ed20e6d67004c907f50fcf6ade089571565dfd488156718
20260726130000_add_user_badges=6a3b201c8791f954d84e26aa9de9f0f2fc53a9a0fc4babf5b2d590ecad79a846
20260727131348_add_storage_backends=14555ec5f8de983d8df6346515561fa9dd364e9ac33773d47e9409369770037f
20260727151013_add_classroom_storage_quota=37c5ca860158ed7f7b12273da65d768247b962a72422ea3e26939e5b354cc643
20260727153517_quota_defaults_and_overrides=c1b33931c54f799901132609cfdd415015a8969ff23f573de979c383442712f3
20260727160000_quota_defaults_data_cleanup=780635ea1b2c013ae801085afb8980aadf82a51ebfef2bb069c2445aefdc12dc
20260727163955_add_file_asset_kind=ceddfac984fa3b74f4884880607f546dece69bb378db71d615b9ef56859c3964
20260728233000_remove_forum_user_state=87ace96f80687ea89d1648048cc4e1db494b8d35f7a942a5196013ee43e91807
20260729072822_add_upload_mode_and_pending_uploads=c2be6425822b350a4f12992baeedd42496eb50d567401c9e74b41b19bf5abf8a
20260729093549_add_oss_internal_endpoint=ada435367f4c6a4c8125815d3f697d8f1140e49c01ccb030a36c9c0a858e4468
20260729112500_add_favicon_variants=dcec3b3a81e60d9cacde2eb527f195a2e3f195736356c0b6dfb565f96ca4c55a
20260729223000_persist_notifications=4e6352bb5f37c79ab80026f3bd038ce810352fedee6cb4c739bcaf68c7914c3a
'

# 旧最终 schema → 新最终 schema 的桥接 SQL（与临时 R2 增量 migration 一致）。
# 不放回 Prisma migration 目录；只在这里执行一次。
BRIDGE_SQL=$(cat <<'SQL'
BEGIN;
ALTER TYPE "PendingUploadKind" ADD VALUE IF NOT EXISTS 'forum_image';
ALTER TYPE "PendingUploadKind" ADD VALUE IF NOT EXISTS 'profile_banner';
ALTER TYPE "StorageBackend" ADD VALUE IF NOT EXISTS 'r2';
ALTER TABLE "PendingUpload" ADD COLUMN IF NOT EXISTS "forumPostId" TEXT;
ALTER TABLE "PendingUpload" ADD COLUMN IF NOT EXISTS "storageBackend" "StorageBackend" NOT NULL DEFAULT 'minio';
CREATE INDEX IF NOT EXISTS "PendingUpload_forumPostId_idx" ON "PendingUpload"("forumPostId");
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'PendingUpload_forumPostId_fkey'
  ) THEN
    ALTER TABLE "PendingUpload" ADD CONSTRAINT "PendingUpload_forumPostId_fkey"
      FOREIGN KEY ("forumPostId") REFERENCES "ForumPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
-- 镜像增量 migration 20260804000000_add_migration_job（双向打包迁移新增）。
-- fresh 部署由 migrate deploy 应用；既有库经这里补齐后，下方必须
-- resolve --applied 该迁移，否则 migrate deploy 会尝试重复建表而失败。
CREATE TYPE "MigrationJobKind" AS ENUM ('export', 'import');
CREATE TYPE "MigrationJobStatus" AS ENUM ('pending', 'running', 'succeeded', 'failed');
CREATE TABLE "MigrationJob" (
    "id" TEXT NOT NULL,
    "kind" "MigrationJobKind" NOT NULL,
    "status" "MigrationJobStatus" NOT NULL DEFAULT 'pending',
    "packageName" TEXT,
    "appVersion" TEXT,
    "manifest" JSONB,
    "phase" TEXT NOT NULL DEFAULT '',
    "progress" JSONB,
    "error" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MigrationJob_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "MigrationJob_createdById_createdAt_idx" ON "MigrationJob"("createdById", "createdAt");
ALTER TABLE "MigrationJob" ADD CONSTRAINT "MigrationJob_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
COMMIT;
SQL
)

# 桥接 SQL 已覆盖、需要显式标记 applied 的增量 migration。fresh 部署时这些迁移
# 由 migrate deploy 应用；既有库的建表/枚举已直接写入 BRIDGE_SQL，过渡时必须
# resolve --applied，否则 migrate deploy 会尝试重复执行。
BRIDGE_COVERED_MIGRATIONS="20260804000000_add_migration_job"

fail() {
  echo "[legacy-baseline-transition] 错误: $*" >&2
  exit 1
}

db_query() {
  # 输出 CSV 行；连接失败时 fail closed。
  "$PSQL" "$DATABASE_URL" -At -F '|' -c "$1" 2>&1 ||
    fail "无法连接数据库（${PSQL}）。请确认 DATABASE_URL 可直连且 psql 已安装。"
}

echo "[legacy-baseline-transition] 模式: $([ "$EXECUTE" = 1 ] && echo 'execute' || echo 'check-only')"
echo "[legacy-baseline-transition] 开始检查既有 migration 历史…"

# 1. 读取 _prisma_migrations（名称、checksum、是否完成），按顺序校验。
MIGRATIONS=$(db_query 'SELECT "migration_name", "checksum", "finished_at" FROM "_prisma_migrations" ORDER BY "started_at";') || exit 1

# 去重与空检查
[ -n "$MIGRATIONS" ] || fail "数据库中没有 _prisma_migrations 记录，或不是既有 LiveBoard 数据库；请使用旧版本确认。"

expected_count=0
# 构建已知名称→checksum 映射
GOLDEN_NAMES=""
GOLDEN_LOOKUP=""
while IFS= read -r line; do
  [ -n "$line" ] || continue
  name="${line%%=*}"
  checksum="${line#*=}"
  GOLDEN_NAMES="$GOLDEN_NAMES
$name"
  GOLDEN_LOOKUP="$GOLDEN_LOOKUP
$name=$checksum"
  expected_count=$((expected_count + 1))
done <<EOF
$GOLDEN_MANIFEST
EOF

seen_names=""
seen_count=0
baseline_present=0
TMP_MIGRATIONS=$(mktemp)
printf '%s\n' "$MIGRATIONS" > "$TMP_MIGRATIONS"
while IFS= read -r row <&3; do
  [ -n "$row" ] || continue
  name="${row%%|*}"
  rest="${row#*|}"
  checksum="${rest%%|*}"
  finished="${rest#*|}"

  if [ "$name" = "$BASELINE" ]; then
    baseline_present=1
    continue
  fi

  # 每个名称只接受一次
  case " $seen_names " in
    *" $name "*) fail "检测到重复的 migration 记录: $name" ;;
  esac
  seen_names="$seen_names $name"

  # 必须在 golden 清单中
  match=$(printf '%s\n' "$GOLDEN_LOOKUP" | grep -c "^$name=" || true)
  if [ "$match" -eq 0 ]; then
    fail "未知 migration: ${name}。存在未记录的 schema 变更或不属于本 LiveBoard 历史，拒绝自动过渡（fail closed）。"
  fi

  # checksum 必须精确匹配
  expected=$(printf '%s\n' "$GOLDEN_LOOKUP" | grep "^$name=" | head -n 1 | cut -d= -f2-)
  if [ "$checksum" != "$expected" ]; then
    fail "migration $name 的 checksum 与已知历史不符（当前=${checksum}，期望=${expected}）。数据库可能被手动修改，拒绝过渡。"
  fi

  # 必须成功完成
  if [ -z "$finished" ] || [ "$finished" = "NULL" ]; then
    fail "migration $name 尚未完成（finished_at 为空），存在失败记录，拒绝过渡。"
  fi

  seen_count=$((seen_count + 1))
done 3< "$TMP_MIGRATIONS"
rm -f "$TMP_MIGRATIONS"

# 2. 名称集合必须精确等于 golden 清单（不多不少），除非 baseline 已存在
if [ "$seen_count" -ne "$expected_count" ]; then
  fail "migration 数量不符：期望 $expected_count 条已知历史，实际 $seen_count 条。请使用旧版本检查数据库。"
fi

echo "[legacy-baseline-transition] 历史校验通过：$seen_count 条旧 migration 全部成功且 checksum 匹配。"

# 3. 检查是否已经过渡（bridge 已应用 或 baseline 已 resolve）。bridge 判断必须
#    同时覆盖 PendingUpload.storageBackend 与 MigrationJob：历史 release 的桥接
#    SQL 只补齐前者，若只按它判断会把"部分应用"误判为已完成，导致增量 migration
#    （MigrationJob）缺失而 diff 失败。
BRIDGE_APPLIED=$(db_query "SELECT COUNT(*) FROM information_schema.columns WHERE table_name = 'PendingUpload' AND column_name = 'storageBackend';") || exit 1
MIGRATION_JOB_PRESENT=$(db_query "SELECT COUNT(*) FROM information_schema.tables WHERE table_name = 'MigrationJob';") || exit 1
ALREADY_RESOLVED=$(db_query "SELECT COUNT(*) FROM _prisma_migrations WHERE migration_name = '$BASELINE' AND finished_at IS NOT NULL;") || exit 1

if [ "$ALREADY_RESOLVED" -gt 0 ]; then
  echo "[legacy-baseline-transition] baseline 已标记完成，重复执行安全，退出。"
  exit 0
fi

# 桥接 SQL 对 PendingUpload 相关语句带 IF NOT EXISTS，MigrationJob 在此状态下
# 必不存在，重复执行安全。
if [ "${BRIDGE_APPLIED:-0}" -gt 0 ] && [ "${MIGRATION_JOB_PRESENT:-0}" -gt 0 ]; then
  echo "[legacy-baseline-transition] 检测到 bridge 已完整应用，将只进行 baseline resolve。"
  NEED_BRIDGE=0
else
  echo "[legacy-baseline-transition] 检测到 bridge 缺失或部分应用，将执行桥接 SQL。"
  NEED_BRIDGE=1
fi

if [ "$EXECUTE" != 1 ]; then
  echo "[legacy-baseline-transition] 检查完成。以下操作将在此数据库执行："
  if [ "$NEED_BRIDGE" = 1 ]; then
    echo "  - 执行桥接 SQL（新增 r2 后端枚举值、forum_image/profile_banner 类型、PendingUpload.storageBackend/forumPostId）"
  else
    echo "  - 跳过桥接 SQL（已应用）"
  fi
  echo "  - prisma migrate resolve --applied $BASELINE"
  echo "  - prisma migrate deploy（确认无 pending）"
  echo "请先用旧版本确认数据库备份完成，再以 --execute 执行。"
  exit 0
fi

if [ "$NEED_BRIDGE" = 1 ]; then
  echo "[legacy-baseline-transition] 执行桥接 SQL…"
  printf '%s\n' "$BRIDGE_SQL" | "$PSQL" "$DATABASE_URL" -v ON_ERROR_STOP=1 -q 2>&1 ||
    fail "桥接 SQL 执行失败，数据库未修改完成，请回滚备份后排查。"
else
  echo "[legacy-baseline-transition] 跳过桥接 SQL（已应用），仅进行 baseline resolve。"
fi

echo "[legacy-baseline-transition] 校验桥接后的实际 schema 与最终 schema 一致…"
"$PRISMA_CMD" migrate diff \
  --from-url "$DATABASE_URL" \
  --to-schema-datamodel prisma/schema.prisma \
  --exit-code >/dev/null ||
  fail "桥接后的数据库仍存在 schema drift，拒绝 resolve baseline。请检查 diff 或从备份恢复。"

echo "[legacy-baseline-transition] 标记 baseline 已应用…"
"$PRISMA_CMD" migrate resolve --applied "$BASELINE" ||
  fail "prisma migrate resolve 失败。"

echo "[legacy-baseline-transition] 标记桥接 SQL 已覆盖的增量迁移已应用…"
for migration in $BRIDGE_COVERED_MIGRATIONS; do
  [ -n "$migration" ] || continue
  already=$(db_query "SELECT COUNT(*) FROM _prisma_migrations WHERE migration_name = '$migration' AND finished_at IS NOT NULL;") || exit 1
  if [ "${already:-0}" -eq 0 ]; then
    echo "[legacy-baseline-transition]   resolve --applied $migration"
    "$PRISMA_CMD" migrate resolve --applied "$migration" ||
      fail "prisma migrate resolve 失败（${migration}）。"
  fi
done

echo "[legacy-baseline-transition] 运行 prisma migrate deploy 确认无 pending…"
"$PRISMA_CMD" migrate deploy ||
  fail "prisma migrate deploy 失败，请检查 schema 一致性。"

echo "[legacy-baseline-transition] 过渡完成：既有自托管数据库已平滑升级到单 baseline 历史。"
