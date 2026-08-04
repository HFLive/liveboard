#!/bin/sh

set -eu
umask 077

ACTION=${1:-}
case "$ACTION" in
  install | upgrade) ;;
  *)
    echo "用法：sudo sh deploy.sh <install|upgrade>" >&2
    exit 1
    ;;
esac

SOURCE_BUNDLE_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
STATE_DIR=${LIVEBOARD_STATE_DIR:-/opt/liveboard}
ENV_FILE=${LIVEBOARD_ENV_FILE:-"$STATE_DIR/.env"}
BACKUP_DIR=${BACKUP_DIR:-"$STATE_DIR/backups"}
RELEASES_DIR="$STATE_DIR/releases"
ACTIVE_LINK="$RELEASES_DIR/active"
INSTALL_CONF="$STATE_DIR/install.conf"
BACKUP_RETENTION_OVERRIDE=${BACKUP_RETENTION_COUNT+x}
BACKUP_RETENTION_COUNT=${BACKUP_RETENTION_COUNT:-10}
HEALTH_URL=${HEALTH_URL:-"http://127.0.0.1:4000/health"}
WEB_HEALTH_URL=${WEB_HEALTH_URL:-"http://127.0.0.1:3000"}
NGINX_HEALTH_URL=${NGINX_HEALTH_URL:-"http://127.0.0.1"}
MANAGER_PATH=${LIVEBOARD_MANAGER_PATH:-/usr/local/bin/liveboard}
NGINX_SITE=${LIVEBOARD_NGINX_SITE:-/etc/nginx/sites-available/liveboard}
NGINX_ENABLED=${LIVEBOARD_NGINX_ENABLED:-/etc/nginx/sites-enabled/liveboard}
NGINX_DEFAULT=${LIVEBOARD_NGINX_DEFAULT:-/etc/nginx/sites-enabled/default}
INITIAL_ADMIN_CREDENTIALS_FILE="$STATE_DIR/initial-admin-credentials.txt"
INITIAL_ADMIN_CREATED=false
STAGING_DIR=
LOCK_DIR="$STATE_DIR/.operation-lock"

if [ "$(id -u)" -ne 0 ] && [ "$STATE_DIR" = /opt/liveboard ]; then
  echo "正式安装需要 root 权限，请使用 sudo。" >&2
  exit 1
fi

install_system_dependencies() {
  [ "$ACTION" = install ] || return 0
  [ "$STATE_DIR" = /opt/liveboard ] || return 0
  command -v apt-get >/dev/null 2>&1 || return 0

  missing_base=false
  for command in curl sha256sum gzip od nginx python3 openssl; do
    if ! command -v "$command" >/dev/null 2>&1; then
      missing_base=true
    fi
  done

  if [ "$missing_base" = true ]; then
    echo "安装 Nginx 和基础部署工具..."
    apt-get update
    DEBIAN_FRONTEND=noninteractive apt-get install -y nginx curl ca-certificates tar gzip coreutils python3 openssl
  fi

  if ! command -v docker >/dev/null 2>&1; then
    echo "安装 Ubuntu 仓库中的 Docker 与 Compose..."
    apt-get update
    DEBIAN_FRONTEND=noninteractive apt-get install -y docker.io docker-compose-v2
  elif ! docker compose version >/dev/null 2>&1; then
    echo "检测到已有 Docker，但缺少匹配的 Compose 插件。" >&2
    echo "为避免混装 docker.io 与 docker-ce，请先从现有 Docker 软件源安装 Compose 插件。" >&2
    exit 1
  fi
}

install_system_dependencies

for command in docker curl sha256sum gzip od tar python3 openssl; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "缺少部署依赖：$command" >&2
    exit 1
  fi
done

if [ "$STATE_DIR" = /opt/liveboard ] && command -v systemctl >/dev/null 2>&1; then
  systemctl enable --now docker
fi

case "$(uname -m)" in
  x86_64 | amd64) ;;
  *)
    echo "当前发布包仅支持 Linux AMD64 服务器。" >&2
    exit 1
    ;;
esac

if ! docker compose version >/dev/null 2>&1; then
  echo "缺少 Docker Compose 插件。" >&2
  exit 1
fi

SOURCE_MANIFEST_FILE="$SOURCE_BUNDLE_DIR/manifest.txt"
for file in \
  "$SOURCE_BUNDLE_DIR/docker-compose.yml" \
  "$SOURCE_BUNDLE_DIR/images.tar.gz" \
  "$SOURCE_MANIFEST_FILE" \
  "$SOURCE_BUNDLE_DIR/nginx.conf" \
  "$SOURCE_BUNDLE_DIR/manager.sh" \
  "$SOURCE_BUNDLE_DIR/https-agent.py" \
  "$SOURCE_BUNDLE_DIR/lego" \
  "$SOURCE_BUNDLE_DIR/liveboard-https-agent.service" \
  "$SOURCE_BUNDLE_DIR/liveboard-https-renew.service" \
  "$SOURCE_BUNDLE_DIR/liveboard-https-renew.timer" \
  "$SOURCE_BUNDLE_DIR/legacy-baseline-transition.sh" \
  "$SOURCE_BUNDLE_DIR/SHA256SUMS" \
  "$SOURCE_BUNDLE_DIR/.env.example"; do
  if [ ! -f "$file" ]; then
    echo "发布包不完整，缺少：$file" >&2
    exit 1
  fi
done

echo "校验发布包..."
(
  cd "$SOURCE_BUNDLE_DIR"
  sha256sum -c SHA256SUMS
)

VERSION=$(awk -F= '$1 == "release" { print $2; exit }' "$SOURCE_MANIFEST_FILE")
case "$VERSION" in
  v[0-9]*.[0-9]*.[0-9]*) ;;
  *)
    echo "发布清单中的版本无效：${VERSION:-空}" >&2
    exit 1
    ;;
esac

mkdir -p "$STATE_DIR" "$BACKUP_DIR" "$RELEASES_DIR"
# 数据迁移目录：导出包/导入包/维护模式状态文件。api 容器以 UID 1000 (node)
# 运行，需把该目录属主交给它，否则迁移功能无法写入状态与包文件。
mkdir -p "$STATE_DIR/migration"
# chown 仅 root 可执行（生产 install/upgrade 走 root）；非 root 环境（测试、
# 自定义 STATE_DIR 的开发场景）跳过，目录权限由部署环境自行保证。
if [ "$(id -u)" -eq 0 ]; then
  chown 1000:1000 "$STATE_DIR/migration"
fi
chmod 700 "$STATE_DIR/migration"
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  lock_pid=$(sed -n '1p' "$LOCK_DIR/pid" 2>/dev/null || true)
  if [ -n "$lock_pid" ] && kill -0 "$lock_pid" 2>/dev/null; then
    echo "另一个 LiveBoard 安装、升级或管理操作正在运行（PID $lock_pid）。" >&2
    exit 1
  fi
  rm -f "$LOCK_DIR/pid"
  rmdir "$LOCK_DIR" 2>/dev/null || {
    echo "无法清理失效的操作锁：$LOCK_DIR" >&2
    exit 1
  }
  mkdir "$LOCK_DIR"
fi
printf '%s\n' "$$" >"$LOCK_DIR/pid"
cleanup_deploy() {
  if [ -n "$STAGING_DIR" ] && [ -d "$STAGING_DIR" ]; then
    rm -rf "$STAGING_DIR"
  fi
  rm -f "$LOCK_DIR/pid"
  rmdir "$LOCK_DIR" 2>/dev/null || true
}
trap cleanup_deploy EXIT HUP INT TERM

if [ "$ACTION" = install ] && [ -L "$ACTIVE_LINK" ]; then
  echo "LiveBoard 已经安装。请上传新版本并执行 upgrade。" >&2
  exit 1
fi
if [ "$ACTION" = upgrade ] && [ ! -L "$ACTIVE_LINK" ]; then
  echo "尚未检测到 LiveBoard 安装，请执行 install。" >&2
  exit 1
fi
if [ "$ACTION" = upgrade ] && [ -f "$RELEASES_DIR/current" ]; then
  CURRENT_VERSION=$(sed -n '1p' "$RELEASES_DIR/current")
  if [ "$CURRENT_VERSION" = "$VERSION" ]; then
    echo "当前已经是 ${VERSION}，无需重复升级。"
    exit 0
  fi
fi
if [ "$ACTION" = install ] && command -v nginx >/dev/null 2>&1 && [ -e "$NGINX_SITE" ]; then
  if ! grep -q '^# Managed by LiveBoard$' "$NGINX_SITE"; then
    echo "现有 Nginx 配置不属于 LiveBoard，拒绝覆盖：$NGINX_SITE" >&2
    exit 1
  fi
fi

RELEASE_DIR="$RELEASES_DIR/$VERSION"
case "$RELEASE_DIR" in
  "$RELEASES_DIR"/v*) ;;
  *) echo "拒绝使用无效版本目录：$RELEASE_DIR" >&2; exit 1 ;;
esac

if [ "$SOURCE_BUNDLE_DIR" != "$RELEASE_DIR" ]; then
  STAGING_DIR="$RELEASES_DIR/.staging-$VERSION-$$"
  mkdir "$STAGING_DIR"
  (
    cd "$SOURCE_BUNDLE_DIR"
    tar -cf - .
  ) | (
    cd "$STAGING_DIR"
    tar -xf -
  )
  if [ -e "$RELEASE_DIR" ]; then
    rm -rf "$RELEASE_DIR"
  fi
  mv "$STAGING_DIR" "$RELEASE_DIR"
  STAGING_DIR=
fi

BUNDLE_DIR="$RELEASE_DIR"
COMPOSE_FILE="$BUNDLE_DIR/docker-compose.yml"
IMAGES_FILE="$BUNDLE_DIR/images.tar.gz"
# compose 项目上下文参数：所有 docker compose 调用（包括为 baseline 历史过渡
# 生成的 wrapper 脚本）必须一致，否则从非发布目录运行时 docker compose 找不到
# liveboard 项目。发布路径约定不含空格，可安全按空白拆分。
COMPOSE_BASE_ARGS="--project-name liveboard --project-directory $BUNDLE_DIR --file $COMPOSE_FILE"
MANIFEST_FILE="$BUNDLE_DIR/manifest.txt"
NGINX_FILE="$BUNDLE_DIR/nginx.conf"

if [ ! -f "$ENV_FILE" ]; then
  cp "$BUNDLE_DIR/.env.example" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  echo "已创建生产配置：$ENV_FILE"
fi

ln -sf "$ENV_FILE" "$BUNDLE_DIR/.env"

read_env_value() {
  awk -F= -v key="$1" '$1 == key { sub(/^[^=]*=/, ""); print; exit }' "$ENV_FILE"
}

if [ "$BACKUP_RETENTION_OVERRIDE" != x ]; then
  configured_retention=$(read_env_value BACKUP_RETENTION_COUNT)
  if [ -n "$configured_retention" ]; then
    BACKUP_RETENTION_COUNT=$configured_retention
  fi
fi

case "$BACKUP_RETENTION_COUNT" in
  '' | *[!0-9]* | 0)
    echo "BACKUP_RETENTION_COUNT 必须是正整数。" >&2
    exit 1
    ;;
esac

write_env_value() {
  key=$1
  value=$2
  temporary="$ENV_FILE.tmp"

  awk -F= -v key="$key" -v value="$value" '
    BEGIN { found = 0 }
    $1 == key { print key "=" value; found = 1; next }
    { print }
    END { if (!found) print key "=" value }
  ' "$ENV_FILE" >"$temporary"
  mv "$temporary" "$ENV_FILE"
}

generate_secret() {
  byte_count=$1
  od -An -N "$byte_count" -tx1 /dev/urandom | tr -d ' \n'
}

ensure_generated_secret() {
  key=$1
  byte_count=$2
  value=$(read_env_value "$key")

  case "$value" in
    "" | liveboard | liveboard-admin | replace-with-*)
      write_env_value "$key" "$(generate_secret "$byte_count")"
      echo "已自动生成 ${key}。"
      ;;
  esac
}

ensure_generated_secret POSTGRES_PASSWORD 24
ensure_generated_secret MINIO_ROOT_PASSWORD 24
ensure_generated_secret SESSION_SECRET 32
ensure_generated_secret AI_ENCRYPTION_KEY 32

POSTGRES_PASSWORD=$(read_env_value POSTGRES_PASSWORD)
POSTGRES_USER=$(read_env_value POSTGRES_USER)
POSTGRES_DB=$(read_env_value POSTGRES_DB)
write_env_value NODE_ENV production
if [ -z "$(read_env_value SESSION_COOKIE_SECURE)" ]; then
  write_env_value SESSION_COOKIE_SECURE false
fi
write_env_value DATABASE_URL "postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB}?schema=public"
chmod 600 "$ENV_FILE"

require_secret() {
  key=$1
  minimum_length=$2
  value=$(read_env_value "$key")

  case "$value" in
    "" | liveboard | liveboard-admin | replace-with-*)
      echo "$ENV_FILE 中的 $key 尚未配置为安全值。" >&2
      exit 1
      ;;
  esac

  if [ "${#value}" -lt "$minimum_length" ]; then
    echo "$ENV_FILE 中的 $key 长度不足，至少需要 $minimum_length 个字符。" >&2
    exit 1
  fi
}

require_secret POSTGRES_PASSWORD 16
require_secret MINIO_ROOT_PASSWORD 16
require_secret SESSION_SECRET 32
require_secret AI_ENCRYPTION_KEY 32

if [ "$(read_env_value NODE_ENV)" != "production" ]; then
  echo "$ENV_FILE 中的 NODE_ENV 必须为 production。" >&2
  exit 1
fi

echo "导入离线镜像包..."
gzip -dc "$IMAGES_FILE" | docker load

for image in \
  postgres:16-alpine \
  redis:7-alpine \
  minio/minio:RELEASE.2024-12-18T13-15-44Z \
  "liveboard-api:${VERSION}" \
  "liveboard-web:${VERSION}"; do
  if ! docker image inspect "$image" >/dev/null 2>&1; then
    echo "发布包缺少镜像：$image" >&2
    exit 1
  fi
done

# 迁移数据目录由 deploy 脚本创建并 chown（$STATE_DIR/migration，见下方 mkdir）：
# 这里显式传给 compose，确保挂载路径与脚本创建路径一致——LIVEBOARD_STATE_DIR
# 自定义时不会落到 docker-compose.yml 的 /opt/liveboard/migration 默认值上。
compose() {
  LIVEBOARD_API_IMAGE="liveboard-api:${VERSION}" \
    LIVEBOARD_WEB_IMAGE="liveboard-web:${VERSION}" \
    LIVEBOARD_MIGRATION_HOST_DIR="$STATE_DIR/migration" \
    docker compose $COMPOSE_BASE_ARGS "$@"
}

echo "启动基础设施服务..."
compose up -d --no-build postgres redis minio

echo "等待 PostgreSQL 就绪..."
attempt=0
until compose exec -T postgres sh -c 'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"' >/dev/null 2>&1; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 30 ]; then
    echo "PostgreSQL 未在 60 秒内就绪。" >&2
    compose logs --tail=100 postgres
    exit 1
  fi
  sleep 2
done

TIMESTAMP=$(date +%Y%m%d-%H%M%S)
BACKUP_FILE="$BACKUP_DIR/postgres-$TIMESTAMP.dump"

echo "备份 PostgreSQL 到 $BACKUP_FILE ..."
compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' >"$BACKUP_FILE"

if [ ! -s "$BACKUP_FILE" ]; then
  echo "数据库备份为空，已停止部署。" >&2
  exit 1
fi

find "$BACKUP_DIR" -type f -name 'postgres-*.dump' -print \
  | sort -r \
  | awk -v keep="$BACKUP_RETENTION_COUNT" 'NR > keep' \
  | while IFS= read -r expired_backup; do
      rm -f "$expired_backup"
    done

# 仓库已收口为单 baseline。既有自托管数据库仍保存旧 migration 历史，直接
# 运行 migrate deploy 会重复建表，因此备份完成后、正常 migrate deploy 前
# 先做受控历史过渡（精确校验旧历史 → 桥接 SQL → schema diff → resolve baseline）。
EXISTING_MIGRATIONS=$(compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "SELECT COUNT(*) FROM _prisma_migrations"' 2>/dev/null || echo 0)
if [ "${EXISTING_MIGRATIONS:-0}" -gt 0 ] 2>/dev/null; then
  echo "检测到既有数据库 migration 历史（${EXISTING_MIGRATIONS} 条），执行 baseline 历史过渡…"
  cat > "$RELEASE_DIR/transition-psql.sh" <<'LBWEOF'
#!/bin/sh
db=$(printf '%s' "$DATABASE_URL" | sed -E 's|.*/([^/?]+)(\?.*)?$|\1|')
shift
exec docker compose $LIVEBOARD_COMPOSE_ARGS exec -T postgres sh -c "exec psql -U \"\$POSTGRES_USER\" -d \"$db\" \"\$@\"" psql-wrapper "$@"
LBWEOF
  cat > "$RELEASE_DIR/transition-prisma.sh" <<'LBWEOF'
#!/bin/sh
exec docker compose $LIVEBOARD_COMPOSE_ARGS run --rm --no-deps -e DATABASE_URL="$DATABASE_URL" migrate node node_modules/prisma/build/index.js "$@"
LBWEOF
  chmod +x "$RELEASE_DIR/transition-psql.sh" "$RELEASE_DIR/transition-prisma.sh"
  # wrapper 需要与 compose() 完全相同的项目上下文；此处以环境变量传入，重新生成的
  # wrapper 也能解析到 liveboard 项目，而不是依赖安装器的工作目录。
  if ! DATABASE_URL="postgresql://${POSTGRES_USER:-liveboard}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB:-liveboard}?schema=public" \
    LIVEBOARD_COMPOSE_ARGS="$COMPOSE_BASE_ARGS" \
    LIVEBOARD_API_IMAGE="liveboard-api:${VERSION}" \
    LIVEBOARD_WEB_IMAGE="liveboard-web:${VERSION}" \
    LIVEBOARD_MIGRATION_HOST_DIR="$STATE_DIR/migration" \
    PSQL="$RELEASE_DIR/transition-psql.sh" \
    PRISMA_CMD="$RELEASE_DIR/transition-prisma.sh" \
    sh "$RELEASE_DIR/legacy-baseline-transition.sh" --execute; then
    echo "数据库历史过渡失败，请先检查数据库后重试。" >&2
    exit 1
  fi
fi

echo "执行数据库迁移并更新应用服务..."
compose up -d --no-build --force-recreate migrate api web

echo "等待 API 健康检查..."
attempt=0
until curl --fail --silent --show-error "$HEALTH_URL" >/dev/null 2>&1; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 30 ]; then
    echo "API 未在 60 秒内通过健康检查。" >&2
    compose ps
    compose logs --tail=100 migrate api
    exit 1
  fi
  sleep 2
done

echo "等待 Web 健康检查..."
attempt=0
until curl --fail --silent --show-error "$WEB_HEALTH_URL" >/dev/null 2>&1; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 30 ]; then
    echo "Web 未在 60 秒内通过健康检查。" >&2
    compose ps
    compose logs --tail=100 web
    exit 1
  fi
  sleep 2
done

echo "检查首次生产初始化..."
BOOTSTRAP_OUTPUT=$(compose exec -T api node dist/bootstrap-production.js --machine-readable)
BOOTSTRAP_CREATED=$(printf '%s\n' "$BOOTSTRAP_OUTPUT" | awk -F= '$1 == "LIVEBOARD_BOOTSTRAP_CREATED" { print $2; exit }')

case "$BOOTSTRAP_CREATED" in
  0)
    echo "系统已经初始化，沿用现有管理员账号和密码。"
    ;;
  1)
    INITIAL_ADMIN_USERNAME=$(printf '%s\n' "$BOOTSTRAP_OUTPUT" | awk -F= '$1 == "LIVEBOARD_INITIAL_ADMIN_USERNAME" { sub(/^[^=]*=/, ""); print; exit }')
    INITIAL_ADMIN_PASSWORD=$(printf '%s\n' "$BOOTSTRAP_OUTPUT" | awk -F= '$1 == "LIVEBOARD_INITIAL_ADMIN_PASSWORD" { sub(/^[^=]*=/, ""); print; exit }')

    if [ -z "$INITIAL_ADMIN_USERNAME" ] || [ -z "$INITIAL_ADMIN_PASSWORD" ]; then
      echo "首次管理员已经创建，但未能读取初始化凭据；已停止部署。" >&2
      exit 1
    fi

    {
      echo "LiveBoard 首次管理员凭据"
      echo "账号：${INITIAL_ADMIN_USERNAME}"
      echo "密码：${INITIAL_ADMIN_PASSWORD}"
      echo
      echo "首次登录并修改密码后，请删除本文件："
      echo "rm -f ${INITIAL_ADMIN_CREDENTIALS_FILE}"
    } >"$INITIAL_ADMIN_CREDENTIALS_FILE"
    chmod 600 "$INITIAL_ADMIN_CREDENTIALS_FILE"
    INITIAL_ADMIN_CREATED=true
    echo "首次管理员已经创建，凭据已保存到 ${INITIAL_ADMIN_CREDENTIALS_FILE}。"
    ;;
  *)
    echo "无法识别首次生产初始化结果：$BOOTSTRAP_OUTPUT" >&2
    exit 1
    ;;
esac

install_gateway() {
  if ! command -v nginx >/dev/null 2>&1; then
    echo "未检测到 Nginx，跳过公网入口配置。"
    return
  fi

  mkdir -p "$(dirname "$NGINX_SITE")" "$(dirname "$NGINX_ENABLED")" "$STATE_DIR/gateway"
  if [ -e "$NGINX_SITE" ]; then
    if ! grep -q '^# Managed by LiveBoard$' "$NGINX_SITE"; then
      if [ "$ACTION" = upgrade ]; then
        echo "保留现有 Nginx 配置，不使用发布包模板覆盖：$NGINX_SITE"
      else
        echo "现有 Nginx 配置不属于 LiveBoard，拒绝覆盖：$NGINX_SITE" >&2
        exit 1
      fi
    fi
  else
    cp "$NGINX_FILE" "$NGINX_SITE"
  fi

  if grep -q '^# Managed by LiveBoard$' "$NGINX_SITE"; then
    timeout_update=$(mktemp "$STATE_DIR/gateway/nginx-timeout-update.XXXXXX")
    sed \
      -e 's/proxy_read_timeout 150s;/proxy_read_timeout 480s;/g' \
      -e 's/proxy_send_timeout 150s;/proxy_send_timeout 480s;/g' \
      "$NGINX_SITE" >"$timeout_update"
    if cmp -s "$NGINX_SITE" "$timeout_update"; then
      rm -f "$timeout_update"
    else
      chmod 644 "$timeout_update"
      mv "$timeout_update" "$NGINX_SITE"
      echo "已将 LiveBoard Nginx API 超时迁移为 480 秒。"
    fi
  fi

  if [ -e "$NGINX_DEFAULT" ] || [ -L "$NGINX_DEFAULT" ]; then
    if [ ! -e "$STATE_DIR/gateway/default-site.backup" ]; then
      mv "$NGINX_DEFAULT" "$STATE_DIR/gateway/default-site.backup"
    else
      rm -f "$NGINX_DEFAULT"
    fi
  fi

  ln -sfn "$NGINX_SITE" "$NGINX_ENABLED"
  nginx -t
  if [ "$STATE_DIR" = /opt/liveboard ] && command -v systemctl >/dev/null 2>&1; then
    systemctl enable --now nginx
    systemctl reload nginx
  fi

  attempt=0
  until curl --fail --silent --show-error "$NGINX_HEALTH_URL" >/dev/null 2>&1; do
    attempt=$((attempt + 1))
    if [ "$attempt" -ge 15 ]; then
      echo "Nginx 未在 30 秒内通过健康检查。" >&2
      exit 1
    fi
    sleep 2
  done
}

install_gateway

install_https_agent() {
  mkdir -p "$STATE_DIR/bin" "$STATE_DIR/https" "$STATE_DIR/gateway"
  cp "$BUNDLE_DIR/lego" "$STATE_DIR/bin/lego"
  cp "$BUNDLE_DIR/https-agent.py" "$STATE_DIR/bin/liveboard-https-agent.py"
  chmod 755 "$STATE_DIR/bin/lego" "$STATE_DIR/bin/liveboard-https-agent.py"

  if [ "$STATE_DIR" != /opt/liveboard ] || ! command -v systemctl >/dev/null 2>&1; then
    echo "已安装 HTTPS 助手文件；当前为测试状态目录，跳过 systemd 服务。"
    return
  fi

  mkdir -p /run/liveboard
  chown root:1000 /run/liveboard
  chmod 770 /run/liveboard
  cp "$BUNDLE_DIR/liveboard-https-agent.service" /etc/systemd/system/liveboard-https-agent.service
  cp "$BUNDLE_DIR/liveboard-https-renew.service" /etc/systemd/system/liveboard-https-renew.service
  cp "$BUNDLE_DIR/liveboard-https-renew.timer" /etc/systemd/system/liveboard-https-renew.timer
  systemctl daemon-reload
  systemctl enable liveboard-https-agent.service liveboard-https-renew.timer
  systemctl restart liveboard-https-agent.service
  systemctl start liveboard-https-renew.timer

  attempt=0
  until [ -S /run/liveboard/https-agent.sock ]; do
    attempt=$((attempt + 1))
    if [ "$attempt" -ge 10 ]; then
      echo "HTTPS 助手未能创建通信 Socket。" >&2
      systemctl status liveboard-https-agent.service --no-pager >&2 || true
      exit 1
    fi
    sleep 1
  done
  systemctl is-active --quiet liveboard-https-agent.service
  systemctl is-active --quiet liveboard-https-renew.timer
}

install_https_agent

mkdir -p "$(dirname "$MANAGER_PATH")"
cp "$BUNDLE_DIR/manager.sh" "$MANAGER_PATH"
chmod 755 "$MANAGER_PATH"

printf '%s\n' "$VERSION" >"$RELEASES_DIR/current"
ln -sfn "$BUNDLE_DIR" "$ACTIVE_LINK"

INSTALLED_AT=$(awk -F= '$1 == "INSTALLED_AT" { sub(/^[^=]*=/, ""); print; exit }' "$INSTALL_CONF" 2>/dev/null || true)
[ -n "$INSTALLED_AT" ] || INSTALLED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
ACCESS_MODE=$(awk -F= '$1 == "ACCESS_MODE" { sub(/^[^=]*=/, ""); print; exit }' "$INSTALL_CONF" 2>/dev/null || true)
[ -n "$ACCESS_MODE" ] || ACCESS_MODE=http-ip
HTTPS_DOMAIN=$(awk -F= '$1 == "HTTPS_DOMAIN" { sub(/^[^=]*=/, ""); print; exit }' "$INSTALL_CONF" 2>/dev/null || true)
HTTP_PRIMARY_HOST=$(awk -F= '$1 == "HTTP_PRIMARY_HOST" { sub(/^[^=]*=/, ""); print; exit }' "$INSTALL_CONF" 2>/dev/null || true)
HTTP_ALLOWED_HOSTS=$(awk -F= '$1 == "HTTP_ALLOWED_HOSTS" { sub(/^[^=]*=/, ""); print; exit }' "$INSTALL_CONF" 2>/dev/null || true)
{
  echo "CURRENT_VERSION=$VERSION"
  echo "ACCESS_MODE=$ACCESS_MODE"
  if [ -n "$HTTPS_DOMAIN" ]; then
    echo "HTTPS_DOMAIN=$HTTPS_DOMAIN"
  fi
  if [ -n "$HTTP_PRIMARY_HOST" ]; then
    echo "HTTP_PRIMARY_HOST=$HTTP_PRIMARY_HOST"
  fi
  if [ -n "$HTTP_ALLOWED_HOSTS" ]; then
    echo "HTTP_ALLOWED_HOSTS=$HTTP_ALLOWED_HOSTS"
  fi
  echo "INSTALLED_AT=$INSTALLED_AT"
  echo "UPDATED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
} >"$INSTALL_CONF.tmp"
mv "$INSTALL_CONF.tmp" "$INSTALL_CONF"
chmod 600 "$INSTALL_CONF"

compose ps
echo "发布部署完成：$VERSION"
echo "数据库备份：$BACKUP_FILE"
echo "发布清单：$MANIFEST_FILE"
echo "管理命令：liveboard status"

if [ "$INITIAL_ADMIN_CREATED" = true ]; then
  echo
  echo "============================================================"
  echo "首次管理员凭据（请立即保存）"
  echo "============================================================"
  cat "$INITIAL_ADMIN_CREDENTIALS_FILE"
  echo "============================================================"
fi
