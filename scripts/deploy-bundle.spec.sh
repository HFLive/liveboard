#!/bin/sh

set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
REAL_SHA256SUM=$(command -v sha256sum)
REAL_GZIP=$(command -v gzip)
export REAL_SHA256SUM
TEST_DIR=$(mktemp -d)
cleanup() {
  status=$?
  if [ "$status" -ne 0 ]; then
    for log in "$TEST_DIR"/*.log; do
      if [ -f "$log" ]; then
        echo "---- $(basename "$log") ----" >&2
        sed -n '1,240p' "$log" >&2
      fi
    done
  fi
  rm -rf "$TEST_DIR"
  exit "$status"
}
trap cleanup EXIT

BUNDLE_DIR="$TEST_DIR/liveboard-v1.0.0-linux-amd64"
STATE_DIR="$TEST_DIR/state"
BIN_DIR="$TEST_DIR/bin"
MANAGER_PATH="$TEST_DIR/liveboard"
MOCK_DOCKER_STATE="$TEST_DIR/docker-state"
NGINX_SITE="$TEST_DIR/nginx/sites-available/liveboard"
NGINX_ENABLED="$TEST_DIR/nginx/sites-enabled/liveboard"
NGINX_DEFAULT="$TEST_DIR/nginx/sites-enabled/default"
TRANSITION_PRISMA_LOG="$TEST_DIR/transition-prisma.log"
# 从过渡脚本提取 golden manifest，构造 _prisma_migrations 的 mock 输出
TRANSITION_MANIFEST_FILE="$TEST_DIR/transition-manifest.txt"
awk '/^GOLDEN_MANIFEST=.*/{in_manifest=1; next} in_manifest && /^'\''$/{exit} in_manifest && /^[0-9]+_/ {print}' \
  "$ROOT_DIR/scripts/legacy-baseline-transition.sh" > "$TRANSITION_MANIFEST_FILE"
MOCK_MIGRATIONS_FILE="$TEST_DIR/mock-migrations.csv"
: > "$MOCK_MIGRATIONS_FILE"
while IFS= read -r line; do
  [ -n "$line" ] || continue
  name="${line%%=*}"
  checksum="${line#*=}"
  printf '%s|%s|2026-07-29 00:00:00\n' "$name" "$checksum" >> "$MOCK_MIGRATIONS_FILE"
done < "$TRANSITION_MANIFEST_FILE"
export MOCK_DOCKER_STATE
export MOCK_MIGRATION_COUNT=0
export MOCK_BRIDGE_APPLIED=0
export MOCK_BASELINE_RESOLVED=0
export MOCK_MIGRATIONS_FILE="$MOCK_MIGRATIONS_FILE"
export MOCK_TRANSITION_PRISMA_LOG="$TRANSITION_PRISMA_LOG"
export LIVEBOARD_NGINX_SITE="$NGINX_SITE"
export LIVEBOARD_NGINX_ENABLED="$NGINX_ENABLED"
export LIVEBOARD_NGINX_DEFAULT="$NGINX_DEFAULT"

mkdir -p "$BUNDLE_DIR" "$BIN_DIR" "$(dirname "$NGINX_DEFAULT")"
: >"$NGINX_DEFAULT"
cp "$ROOT_DIR/scripts/deploy-bundle.sh" "$BUNDLE_DIR/deploy.sh"
cp "$ROOT_DIR/scripts/liveboard-https-agent.py" "$BUNDLE_DIR/https-agent.py"
cp "$ROOT_DIR/scripts/liveboard-manager.sh" "$BUNDLE_DIR/manager.sh"
cp "$ROOT_DIR/.env.production.example" "$BUNDLE_DIR/.env.example"
cp "$ROOT_DIR/infra/systemd/liveboard-https-agent.service" "$BUNDLE_DIR/liveboard-https-agent.service"
cp "$ROOT_DIR/infra/systemd/liveboard-https-renew.service" "$BUNDLE_DIR/liveboard-https-renew.service"
cp "$ROOT_DIR/infra/systemd/liveboard-https-renew.timer" "$BUNDLE_DIR/liveboard-https-renew.timer"
cp "$ROOT_DIR/scripts/legacy-baseline-transition.sh" "$BUNDLE_DIR/legacy-baseline-transition.sh"
grep -q 'TLS_ALPN_CHALLENGE = "tls-alpn-01"' "$BUNDLE_DIR/https-agent.py"
grep -q 'arguments.append("--tls")' "$BUNDLE_DIR/https-agent.py"
grep -q 'renew_days = "3" if subject_type == IP_SUBJECT else "30"' "$BUNDLE_DIR/https-agent.py"
grep -q '\["--profile", SHORTLIVED_PROFILE\]' "$BUNDLE_DIR/https-agent.py"
grep -q 'renew --scheduled' "$BUNDLE_DIR/liveboard-https-renew.service"
grep -q 'restore_file(certificate, original_certificate)' "$BUNDLE_DIR/https-agent.py"
grep -q -- '-/run/nginx.pid' "$BUNDLE_DIR/liveboard-https-agent.service"
grep -q -- '-/run/nginx.pid' "$BUNDLE_DIR/liveboard-https-renew.service"
grep -q -- '-/var/log/nginx' "$BUNDLE_DIR/liveboard-https-agent.service"
grep -q -- '-/var/log/nginx' "$BUNDLE_DIR/liveboard-https-renew.service"
grep -q -- '-/var/lib/nginx' "$BUNDLE_DIR/liveboard-https-agent.service"
grep -q -- '-/var/lib/nginx' "$BUNDLE_DIR/liveboard-https-renew.service"

for file in docker-compose.yml SHA256SUMS; do
  : >"$BUNDLE_DIR/$file"
done

cat >"$BUNDLE_DIR/lego" <<'EOF'
#!/bin/sh
exit 0
EOF
chmod +x "$BUNDLE_DIR/lego"

printf '%s\n' 'mock-image-data' | "$REAL_GZIP" -c >"$BUNDLE_DIR/images.tar.gz"
printf '%s\n' \
  '# Managed by LiveBoard' \
  'proxy_read_timeout 150s;' \
  'proxy_send_timeout 150s;' \
  >"$BUNDLE_DIR/nginx.conf"
printf '%s\n' 'release=v1.0.0' >"$BUNDLE_DIR/manifest.txt"

cat >"$BIN_DIR/docker" <<'EOF'
#!/bin/sh
case " $* " in
  *" compose version "* | *" image inspect "* | *" load "*)
    exit 0
    ;;
  *" exec -T postgres "*" pg_dump "*)
    printf '%s\n' 'mock-postgres-backup'
    ;;
  *" exec -T postgres "*" pg_isready "*)
    exit 0
    ;;
  *" information_schema.columns "*" storageBackend "*)
    printf '%s\n' "${MOCK_BRIDGE_APPLIED:-0}"
    ;;
  *" WHERE migration_name = '00000000000000_baseline_v1'"*)
    printf '%s\n' "${MOCK_BASELINE_RESOLVED:-0}"
    ;;
  *" exec -T postgres "*"migration_name"*"checksum"*)
    cat "$MOCK_MIGRATIONS_FILE"
    ;;
  *" exec -T postgres "*"SELECT COUNT(*) FROM _prisma_migrations"*)
    printf '%s\n' "${MOCK_MIGRATION_COUNT:-0}"
    ;;
  *" run --rm --no-deps "*" migrate node "*)
    printf '%s\n' "mock prisma: $*" >>"$MOCK_TRANSITION_PRISMA_LOG"
    exit 0
    ;;
  *" exec -T api node dist/bootstrap-production.js --machine-readable "*)
    if [ -f "$MOCK_DOCKER_STATE" ]; then
      printf '%s\n' 'LIVEBOARD_BOOTSTRAP_CREATED=0'
    else
      : >"$MOCK_DOCKER_STATE"
      printf '%s\n' \
        'LIVEBOARD_BOOTSTRAP_CREATED=1' \
        'LIVEBOARD_INITIAL_ADMIN_USERNAME=admin' \
        'LIVEBOARD_INITIAL_ADMIN_PASSWORD=test-random-password'
    fi
    ;;
  *)
    exit 0
    ;;
esac
EOF

cat >"$BIN_DIR/curl" <<'EOF'
#!/bin/sh
exit 0
EOF

cat >"$BIN_DIR/sha256sum" <<'EOF'
#!/bin/sh
if [ "${1:-}" = -c ]; then
  exit 0
fi
exec "$REAL_SHA256SUM" "$@"
EOF

cat >"$BIN_DIR/od" <<'EOF'
#!/bin/sh
printf '%s\n' '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
EOF

cat >"$BIN_DIR/uname" <<'EOF'
#!/bin/sh
printf '%s\n' 'x86_64'
EOF

cat >"$BIN_DIR/nginx" <<'EOF'
#!/bin/sh
exit 0
EOF

chmod +x "$BIN_DIR/docker" "$BIN_DIR/curl" "$BIN_DIR/sha256sum" "$BIN_DIR/od" "$BIN_DIR/uname" "$BIN_DIR/nginx"

PATH="$BIN_DIR:$PATH" \
  LIVEBOARD_STATE_DIR="$STATE_DIR" \
  LIVEBOARD_MANAGER_PATH="$MANAGER_PATH" \
  sh "$BUNDLE_DIR/deploy.sh" install >"$TEST_DIR/first-run.log" 2>&1

ENV_FILE="$STATE_DIR/.env"
test -f "$ENV_FILE"
grep -q '^AI_ENCRYPTION_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef$' "$ENV_FILE"
grep -q '^TRUST_PROXY_HOPS=1$' "$ENV_FILE"
grep -q '^BACKUP_RETENTION_COUNT=10$' "$ENV_FILE"
ENV_BEFORE=$(cksum "$ENV_FILE")

CREDENTIALS_FILE="$STATE_DIR/initial-admin-credentials.txt"
test -f "$CREDENTIALS_FILE"
grep -q '^账号：admin$' "$CREDENTIALS_FILE"
grep -q '^密码：test-random-password$' "$CREDENTIALS_FILE"
grep -q '首次管理员凭据（请立即保存）' "$TEST_DIR/first-run.log"
grep -q '^密码：test-random-password$' "$TEST_DIR/first-run.log"

if stat -c '%a' "$CREDENTIALS_FILE" >/dev/null 2>&1; then
  MODE=$(stat -c '%a' "$CREDENTIALS_FILE")
else
  MODE=$(stat -f '%Lp' "$CREDENTIALS_FILE")
fi
test "$MODE" = "600"
BEFORE=$(cksum "$CREDENTIALS_FILE")
test -x "$MANAGER_PATH"
test -x "$STATE_DIR/bin/lego"
test -x "$STATE_DIR/bin/liveboard-https-agent.py"
test "$(cat "$STATE_DIR/releases/current")" = "v1.0.0"
test "$(readlink "$STATE_DIR/releases/active")" = "$STATE_DIR/releases/v1.0.0"
grep -q '^CURRENT_VERSION=v1.0.0$' "$STATE_DIR/install.conf"
grep -q '^ACCESS_MODE=http-ip$' "$STATE_DIR/install.conf"
test -L "$NGINX_ENABLED"
test "$(readlink "$NGINX_ENABLED")" = "$NGINX_SITE"
test -f "$STATE_DIR/gateway/default-site.backup"
grep -q '^proxy_read_timeout 480s;$' "$NGINX_SITE"
grep -q '^proxy_send_timeout 480s;$' "$NGINX_SITE"

for index in 01 02 03 04 05 06 07 08 09 10 11; do
  printf '%s\n' old >"$STATE_DIR/backups/postgres-20000101-0000${index}.dump"
done

printf '%s\n' \
  'CURRENT_VERSION=v1.0.0' \
  'ACCESS_MODE=https-domain' \
  'HTTPS_DOMAIN=board.example.com' \
  'HTTP_PRIMARY_HOST=8.166.143.156' \
  'HTTP_ALLOWED_HOSTS=8.166.143.156,board.example.com' \
  'INSTALLED_AT=2026-07-26T00:00:00Z' \
  >"$STATE_DIR/install.conf"
printf '%s\n' 'release=v1.0.1' >"$BUNDLE_DIR/manifest.txt"
PATH="$BIN_DIR:$PATH" \
  LIVEBOARD_STATE_DIR="$STATE_DIR" \
  LIVEBOARD_MANAGER_PATH="$MANAGER_PATH" \
  sh "$BUNDLE_DIR/deploy.sh" upgrade >"$TEST_DIR/second-run.log" 2>&1

AFTER=$(cksum "$CREDENTIALS_FILE")
test "$BEFORE" = "$AFTER"
ENV_AFTER=$(cksum "$ENV_FILE")
test "$ENV_BEFORE" = "$ENV_AFTER"
grep -q '沿用现有管理员账号和密码' "$TEST_DIR/second-run.log"
test "$(find "$STATE_DIR/backups" -type f -name 'postgres-*.dump' | wc -l | tr -d ' ')" = "10"
test "$(cat "$STATE_DIR/releases/current")" = "v1.0.1"
test "$(readlink "$STATE_DIR/releases/active")" = "$STATE_DIR/releases/v1.0.1"
grep -q '^CURRENT_VERSION=v1.0.1$' "$STATE_DIR/install.conf"
grep -q '^ACCESS_MODE=https-domain$' "$STATE_DIR/install.conf"
grep -q '^HTTPS_DOMAIN=board.example.com$' "$STATE_DIR/install.conf"
grep -q '^HTTP_PRIMARY_HOST=8.166.143.156$' "$STATE_DIR/install.conf"
grep -q '^HTTP_ALLOWED_HOSTS=8.166.143.156,board.example.com$' \
  "$STATE_DIR/install.conf"
if grep -q '^密码：test-random-password$' "$TEST_DIR/second-run.log"; then
  echo "重复部署不应再次显示首次管理员密码。" >&2
  exit 1
fi

PATH="$BIN_DIR:$PATH" LIVEBOARD_STATE_DIR="$STATE_DIR" "$MANAGER_PATH" status >"$TEST_DIR/status.log"
grep -q '当前版本：v1.0.1' "$TEST_DIR/status.log"

PATH="$BIN_DIR:$PATH" LIVEBOARD_STATE_DIR="$STATE_DIR" "$MANAGER_PATH" clean --keep 1 --dry-run >"$TEST_DIR/clean.log"
grep -q "$STATE_DIR/releases/v1.0.0" "$TEST_DIR/clean.log"
test -d "$STATE_DIR/releases/v1.0.0"

PATH="$BIN_DIR:$PATH" LIVEBOARD_STATE_DIR="$STATE_DIR" "$MANAGER_PATH" clean --keep 1 --yes >/dev/null
test ! -e "$STATE_DIR/releases/v1.0.0"
test -e "$STATE_DIR/releases/v1.0.1"

PATH="$BIN_DIR:$PATH" LIVEBOARD_STATE_DIR="$STATE_DIR" "$MANAGER_PATH" uninstall --yes >"$TEST_DIR/uninstall.log"
test ! -e "$STATE_DIR/releases/active"
test -f "$ENV_FILE"
test -d "$STATE_DIR/backups"
test ! -e "$NGINX_ENABLED"
test -f "$NGINX_DEFAULT"
grep -q '业务数据和配置仍保留' "$TEST_DIR/uninstall.log"

RUN_FILE="$TEST_DIR/liveboard-v1.0.1-linux-amd64.run"
sh "$ROOT_DIR/scripts/build-self-extracting-release.sh" \
  "$ROOT_DIR/scripts/liveboard-self-extract.sh" \
  "$BUNDLE_DIR" \
  "$RUN_FILE" >/dev/null
test -x "$RUN_FILE"
sh "$RUN_FILE" --help | grep -q 'install'

TAMPERED_RUN_FILE="$TEST_DIR/liveboard-v1.0.1-tampered.run"
cp "$RUN_FILE" "$TAMPERED_RUN_FILE"
printf '%s\n' tampered >>"$TAMPERED_RUN_FILE"
if sh "$TAMPERED_RUN_FILE" install >"$TEST_DIR/tampered.log" 2>&1; then
  echo "被修改的自解压安装包不应通过校验。" >&2
  exit 1
fi
grep -q '安装包校验失败' "$TEST_DIR/tampered.log"

SECOND_STATE_DIR="$TEST_DIR/second-state"
SECOND_MANAGER_PATH="$TEST_DIR/second-liveboard"
rm -f "$MOCK_DOCKER_STATE"
PATH="$BIN_DIR:$PATH" \
  LIVEBOARD_STATE_DIR="$SECOND_STATE_DIR" \
  LIVEBOARD_MANAGER_PATH="$SECOND_MANAGER_PATH" \
  sh "$RUN_FILE" install >"$TEST_DIR/self-extract-install.log" 2>&1
test "$(cat "$SECOND_STATE_DIR/releases/current")" = "v1.0.1"
test -x "$SECOND_MANAGER_PATH"
test -L "$NGINX_ENABLED"

# 既有数据库历史（41 条）→ 升级必须触发受控 baseline 历史过渡
MOCK_MIGRATION_COUNT=41
MOCK_BRIDGE_APPLIED=0
MOCK_BASELINE_RESOLVED=0
: >"$TRANSITION_PRISMA_LOG"
printf '%s\n' 'release=v1.0.2' >"$BUNDLE_DIR/manifest.txt"
PATH="$BIN_DIR:$PATH" \
  LIVEBOARD_STATE_DIR="$SECOND_STATE_DIR" \
  LIVEBOARD_MANAGER_PATH="$SECOND_MANAGER_PATH" \
  sh "$BUNDLE_DIR/deploy.sh" upgrade >"$TEST_DIR/transition-run.log" 2>&1
grep -q '检测到既有数据库 migration 历史' "$TEST_DIR/transition-run.log"
test -s "$TRANSITION_PRISMA_LOG"
grep -q 'migrate resolve --applied 00000000000000_baseline_v1' "$TRANSITION_PRISMA_LOG"
if grep -q '数据库历史过渡失败' "$TEST_DIR/transition-run.log"; then
  echo "升级不应报告数据库历史过渡失败。" >&2
  exit 1
fi
MOCK_MIGRATION_COUNT=0

printf '%s\n' 'deploy bundle and manager checks passed'
