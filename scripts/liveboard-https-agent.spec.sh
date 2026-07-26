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
challenge=
while [ "$#" -gt 0 ]; do
  case "$1" in
    --path) lego_path=$2; shift 2 ;;
    --domains) domain=$2; shift 2 ;;
    --http) challenge=http-01; shift ;;
    --tls) challenge=tls-alpn-01; shift ;;
    run | renew) action=$1; shift ;;
    *) shift ;;
  esac
done
[ -n "$lego_path" ] && [ -n "$domain" ] && [ -n "$action" ] && [ -n "$challenge" ]
printf '%s %s %s\n' "$action" "$domain" "$challenge" >>"$LIVEBOARD_TEST_LEGO_LOG"
if [ "$challenge" = http-01 ] &&
  [ "${LIVEBOARD_TEST_HTTP_ISSUANCE_FAILURE:-0}" = 1 ]; then
  echo "mock HTTP issuance failed" >&2
  exit 1
fi
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
LEGO_LOG="$TEST_DIR/lego.log"
export LIVEBOARD_TEST_LEGO_LOG="$LEGO_LOG"
export LIVEBOARD_SKIP_TLS_PORT_CHECK=1

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
grep -q '^    proxy_read_timeout 480s;$' "$NGINX_SITE"
grep -q '^    proxy_send_timeout 480s;$' "$NGINX_SITE"
test -f "$STATE_DIR/https/lego/certificates/board.example.com.crt"
test -f "$STATE_DIR/https/lego/certificates/board.example.com.key"
grep -q '^run board.example.com http-01$' "$LEGO_LOG"
grep -q '"challengeType": "http-01"' "$STATE_DIR/https/config.json"

env $AGENT_ENV \
  LIVEBOARD_STATE_DIR="$STATE_DIR" \
  LIVEBOARD_NGINX_SITE="$NGINX_SITE" \
  LIVEBOARD_LEGO_BIN="$LEGO_BIN" \
  python3 "$ROOT_DIR/scripts/liveboard-https-agent.py" status \
  >"$TEST_DIR/status.json"
grep -q '"expiresAt": "' "$TEST_DIR/status.json"

chmod -x "$LEGO_BIN"
env $AGENT_ENV \
  LIVEBOARD_STATE_DIR="$STATE_DIR" \
  LIVEBOARD_NGINX_SITE="$NGINX_SITE" \
  LIVEBOARD_LEGO_BIN="$LEGO_BIN" \
  python3 "$ROOT_DIR/scripts/liveboard-https-agent.py" status \
  >"$TEST_DIR/unavailable.json"
grep -q '"available": false' "$TEST_DIR/unavailable.json"
chmod +x "$LEGO_BIN"

env $AGENT_ENV \
  LIVEBOARD_STATE_DIR="$STATE_DIR" \
  LIVEBOARD_NGINX_SITE="$NGINX_SITE" \
  LIVEBOARD_LEGO_BIN="$LEGO_BIN" \
  LIVEBOARD_TEST_PUBLIC_CHALLENGE_FAILURE=1 \
  LIVEBOARD_SKIP_RUNTIME_RECREATE=1 \
  python3 "$ROOT_DIR/scripts/liveboard-https-agent.py" enable \
    --domain board.example.com \
    --email admin@example.com \
    >"$TEST_DIR/enable-tls.json"
grep -q '"enabled": true' "$TEST_DIR/enable-tls.json"
grep -q '"challengeType": "tls-alpn-01"' "$TEST_DIR/enable-tls.json"
grep -q '^run board.example.com tls-alpn-01$' "$LEGO_LOG"

env $AGENT_ENV \
  LIVEBOARD_STATE_DIR="$STATE_DIR" \
  LIVEBOARD_NGINX_SITE="$NGINX_SITE" \
  LIVEBOARD_LEGO_BIN="$LEGO_BIN" \
  LIVEBOARD_SKIP_PUBLIC_CHALLENGE_CHECK=1 \
  LIVEBOARD_TEST_HTTP_ISSUANCE_FAILURE=1 \
  LIVEBOARD_SKIP_RUNTIME_RECREATE=1 \
  python3 "$ROOT_DIR/scripts/liveboard-https-agent.py" enable \
    --domain board.example.com \
    --email admin@example.com \
    >"$TEST_DIR/enable-http-issuance-fallback.json"
grep -q '"challengeType": "tls-alpn-01"' "$TEST_DIR/enable-http-issuance-fallback.json"
test "$(grep -c '^run board.example.com http-01$' "$LEGO_LOG")" -eq 2
test "$(grep -c '^run board.example.com tls-alpn-01$' "$LEGO_LOG")" -eq 2

env $AGENT_ENV \
  LIVEBOARD_STATE_DIR="$STATE_DIR" \
  LIVEBOARD_NGINX_SITE="$NGINX_SITE" \
  LIVEBOARD_LEGO_BIN="$LEGO_BIN" \
  python3 "$ROOT_DIR/scripts/liveboard-https-agent.py" renew \
  >"$TEST_DIR/renew.json"
grep -q '"lastRenewalCheckAt": "' "$TEST_DIR/renew.json"
grep -q '^renew board.example.com tls-alpn-01$' "$LEGO_LOG"
grep -q '^  listen 443 ssl;$' "$NGINX_SITE"

ORIGINAL_NGINX=$(cksum "$NGINX_SITE")
ORIGINAL_ENV=$(cksum "$ENV_FILE")
ORIGINAL_INSTALL_CONF=$(cksum "$STATE_DIR/install.conf")
ORIGINAL_CERTIFICATE=$(cksum "$STATE_DIR/https/lego/certificates/board.example.com.crt")
ORIGINAL_KEY=$(cksum "$STATE_DIR/https/lego/certificates/board.example.com.key")
cat >"$LEGO_BIN" <<'EOF'
#!/bin/sh
set -eu
lego_path=
domain=
while [ "$#" -gt 0 ]; do
  case "$1" in
    --path) lego_path=$2; shift 2 ;;
    --domains) domain=$2; shift 2 ;;
    *) shift ;;
  esac
done
mkdir -p "$lego_path/certificates"
printf '%s\n' broken >"$lego_path/certificates/$domain.crt"
printf '%s\n' broken >"$lego_path/certificates/$domain.key"
echo "mock issuance failed" >&2
exit 1
EOF
chmod +x "$LEGO_BIN"
if env $AGENT_ENV \
  LIVEBOARD_STATE_DIR="$STATE_DIR" \
  LIVEBOARD_NGINX_SITE="$NGINX_SITE" \
  LIVEBOARD_LEGO_BIN="$LEGO_BIN" \
  LIVEBOARD_ACME_CHALLENGE=tls-alpn-01 \
  LIVEBOARD_SKIP_RUNTIME_RECREATE=1 \
  python3 "$ROOT_DIR/scripts/liveboard-https-agent.py" enable \
    --domain board.example.com \
    --email admin@example.com \
    >"$TEST_DIR/rollback.log" 2>&1; then
  echo "证书签发失败时不应报告 HTTPS 启用成功。" >&2
  exit 1
fi
test "$ORIGINAL_NGINX" = "$(cksum "$NGINX_SITE")"
test "$ORIGINAL_ENV" = "$(cksum "$ENV_FILE")"
test "$ORIGINAL_INSTALL_CONF" = "$(cksum "$STATE_DIR/install.conf")"
test "$ORIGINAL_CERTIFICATE" = "$(cksum "$STATE_DIR/https/lego/certificates/board.example.com.crt")"
test "$ORIGINAL_KEY" = "$(cksum "$STATE_DIR/https/lego/certificates/board.example.com.key")"
grep -q 'mock issuance failed' "$STATE_DIR/https/last-error.txt"

if env $AGENT_ENV \
  LIVEBOARD_STATE_DIR="$STATE_DIR" \
  LIVEBOARD_NGINX_SITE="$NGINX_SITE" \
  LIVEBOARD_LEGO_BIN="$LEGO_BIN" \
  python3 "$ROOT_DIR/scripts/liveboard-https-agent.py" renew \
    >"$TEST_DIR/renew-rollback.log" 2>&1; then
  echo "证书续期失败时不应报告成功。" >&2
  exit 1
fi
test "$ORIGINAL_NGINX" = "$(cksum "$NGINX_SITE")"
test "$ORIGINAL_CERTIFICATE" = "$(cksum "$STATE_DIR/https/lego/certificates/board.example.com.crt")"
test "$ORIGINAL_KEY" = "$(cksum "$STATE_DIR/https/lego/certificates/board.example.com.key")"
grep -q '自动续期失败.*mock issuance failed' "$STATE_DIR/https/last-error.txt"

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
