#!/bin/sh

set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
TEST_DIR=$(mktemp -d)
cleanup() {
  status=$?
  rm -rf "$TEST_DIR"
  exit "$status"
}
trap cleanup EXIT HUP INT TERM

STATE_DIR="$TEST_DIR/state"
BIN_DIR="$TEST_DIR/bin"
NGINX_SITE="$TEST_DIR/nginx/liveboard"
ENV_FILE="$STATE_DIR/.env"
LEGO_BIN="$STATE_DIR/bin/lego"
REAL_OPENSSL=$(command -v openssl)
export REAL_OPENSSL

mkdir -p "$BIN_DIR" "$STATE_DIR/bin" "$(dirname "$NGINX_SITE")"
printf '%s\n' '# Managed by LiveBoard' >"$NGINX_SITE"
printf '%s\n' \
  'SESSION_COOKIE_SECURE=false' \
  'WEB_ORIGIN=http://localhost:3000' \
  >"$ENV_FILE"

for command in nginx systemctl curl docker; do
  cat >"$BIN_DIR/$command" <<'EOF'
#!/bin/sh
exit 0
EOF
  chmod +x "$BIN_DIR/$command"
done

cat >"$LEGO_BIN" <<'EOF'
#!/bin/sh
set -eu
lego_path=
domain=
action=
while [ "$#" -gt 0 ]; do
  case "$1" in
    --path) lego_path=$2; shift 2 ;;
    --domains) domain=$2; shift 2 ;;
    run | renew) action=$1; shift ;;
    *) shift ;;
  esac
done
[ -n "$lego_path" ] && [ -n "$domain" ] && [ -n "$action" ]
mkdir -p "$lego_path/certificates"
"$REAL_OPENSSL" req -x509 -newkey rsa:2048 -nodes \
  -keyout "$lego_path/certificates/$domain.key" \
  -out "$lego_path/certificates/$domain.crt" \
  -days 90 \
  -subj "/CN=$domain" \
  >/dev/null 2>&1
EOF
chmod +x "$LEGO_BIN"

AGENT_ENV="PATH=$BIN_DIR:$PATH"

env $AGENT_ENV \
  LIVEBOARD_STATE_DIR="$STATE_DIR" \
  LIVEBOARD_NGINX_SITE="$NGINX_SITE" \
  LIVEBOARD_LEGO_BIN="$LEGO_BIN" \
  LIVEBOARD_SKIP_PUBLIC_CHALLENGE_CHECK=1 \
  LIVEBOARD_SKIP_RUNTIME_RECREATE=1 \
  python3 "$ROOT_DIR/scripts/liveboard-https-agent.py" enable \
    --domain board.example.com \
    --email admin@example.com \
    >"$TEST_DIR/enable.json"

grep -q '"enabled": true' "$TEST_DIR/enable.json"
grep -q '"domain": "board.example.com"' "$TEST_DIR/enable.json"
grep -q '^SESSION_COOKIE_SECURE=true$' "$ENV_FILE"
grep -q '^WEB_ORIGIN=https://board.example.com$' "$ENV_FILE"
grep -q '^ACCESS_MODE=https-domain$' "$STATE_DIR/install.conf"
grep -q '^HTTPS_DOMAIN=board.example.com$' "$STATE_DIR/install.conf"
grep -q '^  listen 443 ssl;$' "$NGINX_SITE"
test -f "$STATE_DIR/https/lego/certificates/board.example.com.crt"
test -f "$STATE_DIR/https/lego/certificates/board.example.com.key"

env $AGENT_ENV \
  LIVEBOARD_STATE_DIR="$STATE_DIR" \
  LIVEBOARD_NGINX_SITE="$NGINX_SITE" \
  LIVEBOARD_LEGO_BIN="$LEGO_BIN" \
  python3 "$ROOT_DIR/scripts/liveboard-https-agent.py" status \
  >"$TEST_DIR/status.json"
grep -q '"expiresAt": "' "$TEST_DIR/status.json"

env $AGENT_ENV \
  LIVEBOARD_STATE_DIR="$STATE_DIR" \
  LIVEBOARD_NGINX_SITE="$NGINX_SITE" \
  LIVEBOARD_LEGO_BIN="$LEGO_BIN" \
  python3 "$ROOT_DIR/scripts/liveboard-https-agent.py" renew \
  >"$TEST_DIR/renew.json"
grep -q '"lastRenewalCheckAt": "' "$TEST_DIR/renew.json"

ORIGINAL_NGINX=$(cksum "$NGINX_SITE")
ORIGINAL_ENV=$(cksum "$ENV_FILE")
ORIGINAL_INSTALL_CONF=$(cksum "$STATE_DIR/install.conf")
cat >"$LEGO_BIN" <<'EOF'
#!/bin/sh
echo "mock issuance failed" >&2
exit 1
EOF
chmod +x "$LEGO_BIN"
if env $AGENT_ENV \
  LIVEBOARD_STATE_DIR="$STATE_DIR" \
  LIVEBOARD_NGINX_SITE="$NGINX_SITE" \
  LIVEBOARD_LEGO_BIN="$LEGO_BIN" \
  LIVEBOARD_SKIP_PUBLIC_CHALLENGE_CHECK=1 \
  LIVEBOARD_SKIP_RUNTIME_RECREATE=1 \
  python3 "$ROOT_DIR/scripts/liveboard-https-agent.py" enable \
    --domain second.example.com \
    --email admin@example.com \
    >"$TEST_DIR/rollback.log" 2>&1; then
  echo "证书签发失败时不应报告 HTTPS 启用成功。" >&2
  exit 1
fi
test "$ORIGINAL_NGINX" = "$(cksum "$NGINX_SITE")"
test "$ORIGINAL_ENV" = "$(cksum "$ENV_FILE")"
test "$ORIGINAL_INSTALL_CONF" = "$(cksum "$STATE_DIR/install.conf")"
grep -q 'mock issuance failed' "$STATE_DIR/https/last-error.txt"

if env $AGENT_ENV \
  LIVEBOARD_STATE_DIR="$STATE_DIR" \
  LIVEBOARD_NGINX_SITE="$NGINX_SITE" \
  LIVEBOARD_LEGO_BIN="$LEGO_BIN" \
  python3 "$ROOT_DIR/scripts/liveboard-https-agent.py" enable \
    --domain invalid_domain \
    --email admin@example.com \
    >"$TEST_DIR/invalid.log" 2>&1; then
  echo "无效域名不应通过 HTTPS 助手校验。" >&2
  exit 1
fi
grep -q '请输入有效的完整域名' "$TEST_DIR/invalid.log"

printf '%s\n' 'https agent checks passed'
