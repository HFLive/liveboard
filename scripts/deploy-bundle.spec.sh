#!/bin/sh

set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
TEST_DIR=$(mktemp -d)
trap 'rm -rf "$TEST_DIR"' EXIT

BUNDLE_DIR="$TEST_DIR/liveboard-v-test-linux-amd64"
STATE_DIR="$TEST_DIR/state"
BIN_DIR="$TEST_DIR/bin"
MOCK_DOCKER_STATE="$TEST_DIR/docker-state"
export MOCK_DOCKER_STATE

mkdir -p "$BUNDLE_DIR" "$BIN_DIR"
cp "$ROOT_DIR/scripts/deploy-bundle.sh" "$BUNDLE_DIR/deploy.sh"
cp "$ROOT_DIR/.env.production.example" "$BUNDLE_DIR/.env.example"

for file in docker-compose.yml images.tar.gz nginx.conf SHA256SUMS; do
  : >"$BUNDLE_DIR/$file"
done

printf '%s\n' 'release=v-test' >"$BUNDLE_DIR/manifest.txt"

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
exit 0
EOF

cat >"$BIN_DIR/gzip" <<'EOF'
#!/bin/sh
printf '%s\n' 'mock-image-data'
EOF

cat >"$BIN_DIR/od" <<'EOF'
#!/bin/sh
printf '%s\n' '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
EOF

cat >"$BIN_DIR/uname" <<'EOF'
#!/bin/sh
printf '%s\n' 'x86_64'
EOF

chmod +x "$BIN_DIR/docker" "$BIN_DIR/curl" "$BIN_DIR/sha256sum" "$BIN_DIR/gzip" "$BIN_DIR/od" "$BIN_DIR/uname"

PATH="$BIN_DIR:$PATH" LIVEBOARD_STATE_DIR="$STATE_DIR" sh "$BUNDLE_DIR/deploy.sh" >"$TEST_DIR/first-run.log"

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

for index in 01 02 03 04 05 06 07 08 09 10 11; do
  printf '%s\n' old >"$STATE_DIR/backups/postgres-20000101-0000${index}.dump"
done

PATH="$BIN_DIR:$PATH" LIVEBOARD_STATE_DIR="$STATE_DIR" sh "$BUNDLE_DIR/deploy.sh" >"$TEST_DIR/second-run.log"

AFTER=$(cksum "$CREDENTIALS_FILE")
test "$BEFORE" = "$AFTER"
ENV_AFTER=$(cksum "$ENV_FILE")
test "$ENV_BEFORE" = "$ENV_AFTER"
grep -q '沿用现有管理员账号和密码' "$TEST_DIR/second-run.log"
test "$(find "$STATE_DIR/backups" -type f -name 'postgres-*.dump' | wc -l | tr -d ' ')" = "10"
if grep -q '^密码：test-random-password$' "$TEST_DIR/second-run.log"; then
  echo "重复部署不应再次显示首次管理员密码。" >&2
  exit 1
fi

printf '%s\n' 'deploy-bundle credential checks passed'
