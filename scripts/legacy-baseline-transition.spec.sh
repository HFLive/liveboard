#!/bin/sh
#
# legacy-baseline-transition.sh 的回归测试。
#
# 用 mock psql / prisma 覆盖：
#   - 正常过渡（check-only 与 --execute）
#   - 未知历史（出现不在 golden 清单中的 migration）
#   - 失败 migration（finished_at 为空）
#   - checksum 不符
#   - 数量不符（视为 schema drift / 历史不完整）
#   - 重复执行（baseline 已 resolve 后安全退出）
#   - 数据库不可达
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
SCRIPT="$ROOT_DIR/scripts/legacy-baseline-transition.sh"
TEST_DIR=$(mktemp -d)
cleanup() {
  status=$?
  if [ "$status" -ne 0 ]; then
    for log in "$TEST_DIR"/*.log; do
      if [ -f "$log" ]; then
        echo "---- $(basename "$log") ----" >&2
        sed -n '1,200p' "$log" >&2
      fi
    done
  fi
  rm -rf "$TEST_DIR"
  exit "$status"
}
trap cleanup EXIT

BIN_DIR="$TEST_DIR/bin"
mkdir -p "$BIN_DIR"
export PATH="$BIN_DIR:$PATH"
export DATABASE_URL="postgresql://liveboard:pass@localhost:5432/liveboard?schema=public"

# 从脚本提取 golden manifest 名称→checksum，构造 _prisma_migrations 的 CSV 行。
MANIFEST_FILE="$TEST_DIR/manifest.txt"
awk '/^GOLDEN_MANIFEST=.*/{in_manifest=1; next} in_manifest && /^'\''$/{exit} in_manifest && /^[0-9]+_/ {print}' "$SCRIPT" > "$MANIFEST_FILE"

MIGRATIONS_FILE="$TEST_DIR/migrations.csv"
: > "$MIGRATIONS_FILE"
while IFS= read -r line; do
  [ -n "$line" ] || continue
  name="${line%%=*}"
  checksum="${line#*=}"
  printf '%s|%s|2026-07-29 00:00:00\n' "$name" "$checksum" >> "$MIGRATIONS_FILE"
done < "$MANIFEST_FILE"

export MOCK_MIGRATIONS_FILE="$MIGRATIONS_FILE"
export MOCK_BRIDGE_APPLIED="0"
export MOCK_BASELINE_RESOLVED="0"
export MOCK_PSQL_FAIL="0"
export MOCK_PRISMA_DIFF_FAIL="0"
export MOCK_MIGRATION_JOB_PRESENT="0"

# mock psql：根据 -c 查询返回固定数据
cat > "$BIN_DIR/psql" <<'MOCK'
#!/bin/sh
query=""
prev=""
for arg in "$@"; do
  if [ "$prev" = "-c" ]; then
    query="$arg"
  fi
  prev="$arg"
done
if [ "${MOCK_PSQL_FAIL:-0}" = "1" ]; then
  echo "mock psql: 无法连接" >&2
  exit 1
fi
case "$query" in
  *'FROM "_prisma_migrations"'*)
    cat "$MOCK_MIGRATIONS_FILE"
    ;;
  *"information_schema.columns"*"storageBackend"*)
    echo "$MOCK_BRIDGE_APPLIED"
    ;;
  *"WHERE migration_name = '00000000000000_baseline_v1'"*)
    echo "$MOCK_BASELINE_RESOLVED"
    ;;
  *"WHERE migration_name = '20260804000000_add_migration_job'"*)
    echo "${MOCK_BRIDGE_MIGRATION_RESOLVED:-0}"
    ;;
  *"FROM information_schema.tables"*"MigrationJob"*)
    echo "${MOCK_MIGRATION_JOB_PRESENT:-0}"
    ;;
  *)
    echo ""
    ;;
esac
exit 0
MOCK

# mock prisma：记录 resolve/deploy 调用并成功
cat > "$BIN_DIR/prisma" <<'MOCK'
#!/bin/sh
echo "mock prisma: $*" >> "$MOCK_PRISMA_LOG"
case " $* " in
  *" migrate diff "*)
    [ "${MOCK_PRISMA_DIFF_FAIL:-0}" = "1" ] && exit 2
    ;;
esac
exit 0
MOCK

PRISMA_LOG="$TEST_DIR/prisma.log"
export MOCK_PRISMA_LOG="$PRISMA_LOG"
chmod +x "$BIN_DIR/psql" "$BIN_DIR/prisma"

pass() { echo "ok - $1"; }
fail_test() { echo "FAIL - $1"; exit 1; }

# 1. 正常 check-only：不写库，无 resolve
"$SCRIPT" > "$TEST_DIR/check.log" 2>&1 || fail_test "check-only 应当成功退出"
grep -q "历史校验通过" "$TEST_DIR/check.log" || fail_test "check-only 应输出历史校验通过"
[ ! -f "$PRISMA_LOG" ] || fail_test "check-only 不应调用 prisma"

# 2. 正常 --execute：先 bridge，再 resolve，再 deploy
"$SCRIPT" --execute > "$TEST_DIR/exec.log" 2>&1 || fail_test "execute 应当成功退出"
grep -q "执行桥接 SQL" "$TEST_DIR/exec.log" || fail_test "execute 应执行桥接 SQL"
grep -q "migrate diff --from-url" "$PRISMA_LOG" || fail_test "execute 应校验 schema drift"
grep -q "migrate resolve --applied 00000000000000_baseline_v1" "$PRISMA_LOG" || fail_test "execute 应 resolve baseline"
grep -q "migrate resolve --applied 20260804000000_add_migration_job" "$PRISMA_LOG" || fail_test "execute 应标记桥接覆盖的增量迁移已应用"
grep -q "migrate deploy" "$PRISMA_LOG" || fail_test "execute 应运行 migrate deploy"
grep -q "过渡完成" "$TEST_DIR/exec.log" || fail_test "execute 应报告过渡完成"

# 3. 重复执行：baseline 已 resolve 后安全退出，不重复执行 bridge
MOCK_BASELINE_RESOLVED=1
"$SCRIPT" --execute > "$TEST_DIR/repeat.log" 2>&1 || fail_test "重复执行应当成功退出"
grep -q "baseline 已标记完成" "$TEST_DIR/repeat.log" || fail_test "重复执行应提示已过渡"
MOCK_BASELINE_RESOLVED=0

# 4. 未知历史：插入一条未知 migration → fail closed
cp "$MIGRATIONS_FILE" "$TEST_DIR/migrations-unknown.csv"
printf '20269999999999_mystery|aaaaaaaabbbbbbbbccccccccddddddddeeeeeeeeffffffffffffff\n' >> "$TEST_DIR/migrations-unknown.csv"
MOCK_MIGRATIONS_FILE="$TEST_DIR/migrations-unknown.csv"
: > "$PRISMA_LOG"
if "$SCRIPT" --execute > "$TEST_DIR/unknown.log" 2>&1; then
  fail_test "未知历史应拒绝执行"
fi
grep -q "未知 migration" "$TEST_DIR/unknown.log" || fail_test "未知历史应报告未知 migration"
[ ! -s "$PRISMA_LOG" ] || fail_test "未知历史不应调用 prisma"
MOCK_MIGRATIONS_FILE="$MIGRATIONS_FILE"

# 5. 失败 migration：finished_at 为空 → fail closed
cp "$MIGRATIONS_FILE" "$TEST_DIR/migrations-failed.csv"
sed -i '' 's/^20260712130736_initial|.*/20260712130736_initial|862116419305c1df947d83cdea1f16657870c64357270678a1bb5a64a5e03139|NULL/' "$TEST_DIR/migrations-failed.csv" 2>/dev/null || \
  sed -i 's/^20260712130736_initial|.*/20260712130736_initial|862116419305c1df947d83cdea1f16657870c64357270678a1bb5a64a5e03139|NULL/' "$TEST_DIR/migrations-failed.csv"
MOCK_MIGRATIONS_FILE="$TEST_DIR/migrations-failed.csv"
: > "$PRISMA_LOG"
if "$SCRIPT" --execute > "$TEST_DIR/failed.log" 2>&1; then
  fail_test "失败 migration 应拒绝执行"
fi
grep -q "尚未完成" "$TEST_DIR/failed.log" || fail_test "失败 migration 应报告未完成"
[ ! -s "$PRISMA_LOG" ] || fail_test "失败 migration 不应调用 prisma"
MOCK_MIGRATIONS_FILE="$MIGRATIONS_FILE"

# 6. checksum 不符 → fail closed
cp "$MIGRATIONS_FILE" "$TEST_DIR/migrations-checksum.csv"
sed -i '' 's/^20260712130736_initial|.*/20260712130736_initial|0000000000000000000000000000000000000000000000000000000000000000|2026-07-29 00:00:00/' "$TEST_DIR/migrations-checksum.csv" 2>/dev/null || \
  sed -i 's/^20260712130736_initial|.*/20260712130736_initial|0000000000000000000000000000000000000000000000000000000000000000|2026-07-29 00:00:00/' "$TEST_DIR/migrations-checksum.csv"
MOCK_MIGRATIONS_FILE="$TEST_DIR/migrations-checksum.csv"
: > "$PRISMA_LOG"
if "$SCRIPT" --execute > "$TEST_DIR/checksum.log" 2>&1; then
  fail_test "checksum 不符应拒绝执行"
fi
grep -q "checksum" "$TEST_DIR/checksum.log" || fail_test "checksum 不符应报告"
[ ! -s "$PRISMA_LOG" ] || fail_test "checksum 不符不应调用 prisma"
MOCK_MIGRATIONS_FILE="$MIGRATIONS_FILE"

# 7. 数量不符（历史不完整 → drift）→ fail closed
head -n 40 "$MIGRATIONS_FILE" > "$TEST_DIR/migrations-short.csv"
MOCK_MIGRATIONS_FILE="$TEST_DIR/migrations-short.csv"
: > "$PRISMA_LOG"
if "$SCRIPT" --execute > "$TEST_DIR/drift.log" 2>&1; then
  fail_test "数量不符应拒绝执行"
fi
grep -q "数量不符" "$TEST_DIR/drift.log" || fail_test "数量不符应报告"
[ ! -s "$PRISMA_LOG" ] || fail_test "数量不符不应调用 prisma"
MOCK_MIGRATIONS_FILE="$MIGRATIONS_FILE"

# 8. 数据库不可达 → fail closed
MOCK_PSQL_FAIL=1
if "$SCRIPT" > "$TEST_DIR/unreachable.log" 2>&1; then
  fail_test "数据库不可达应失败"
fi
grep -q "无法连接数据库" "$TEST_DIR/unreachable.log" || fail_test "数据库不可达应报告连接错误"
MOCK_PSQL_FAIL=0

# 9. bridge 后仍有真实 schema drift → 禁止 resolve
MOCK_PRISMA_DIFF_FAIL=1
: > "$PRISMA_LOG"
if "$SCRIPT" --execute > "$TEST_DIR/schema-drift.log" 2>&1; then
  fail_test "实际 schema drift 应拒绝 resolve"
fi
grep -q "schema drift" "$TEST_DIR/schema-drift.log" || fail_test "schema drift 应报告原因"
if grep -q "migrate resolve" "$PRISMA_LOG"; then
  fail_test "schema drift 时不应 resolve baseline"
fi
MOCK_PRISMA_DIFF_FAIL=0

# 10. bridge 已完整应用但 baseline 未 resolve → 跳过 bridge 只 resolve
MOCK_BRIDGE_APPLIED=1
MOCK_MIGRATION_JOB_PRESENT=1
: > "$PRISMA_LOG"
"$SCRIPT" --execute > "$TEST_DIR/rebridge.log" 2>&1 || fail_test "bridge 已应用时 execute 应成功"
grep -q "跳过桥接 SQL" "$TEST_DIR/rebridge.log" || fail_test "应跳过已应用的 bridge"
grep -q "migrate resolve" "$PRISMA_LOG" || fail_test "仍应 resolve baseline"
MOCK_BRIDGE_APPLIED=0
MOCK_MIGRATION_JOB_PRESENT=0

# 11. bridge 部分应用（PendingUpload 已补齐、MigrationJob 缺失）→ 仍执行桥接 SQL
MOCK_BRIDGE_APPLIED=1
MOCK_MIGRATION_JOB_PRESENT=0
: > "$PRISMA_LOG"
"$SCRIPT" --execute > "$TEST_DIR/partial-bridge.log" 2>&1 || fail_test "部分应用时 execute 应成功"
grep -q "执行桥接 SQL" "$TEST_DIR/partial-bridge.log" || fail_test "部分应用时应重新执行桥接 SQL"
grep -q "migrate resolve --applied 20260804000000_add_migration_job" "$PRISMA_LOG" || fail_test "部分应用时应 resolve 增量迁移"
MOCK_BRIDGE_APPLIED=0
MOCK_MIGRATION_JOB_PRESENT=0

echo "all legacy-baseline-transition tests passed"
