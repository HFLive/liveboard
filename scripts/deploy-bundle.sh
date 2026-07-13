#!/bin/sh

set -eu
umask 077

BUNDLE_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
STATE_DIR=${LIVEBOARD_STATE_DIR:-/opt/liveboard}
ENV_FILE=${LIVEBOARD_ENV_FILE:-"$STATE_DIR/.env"}
BACKUP_DIR=${BACKUP_DIR:-"$STATE_DIR/backups"}
HEALTH_URL=${HEALTH_URL:-"http://127.0.0.1:4000/health"}
COMPOSE_FILE="$BUNDLE_DIR/docker-compose.yml"
IMAGES_FILE="$BUNDLE_DIR/images.tar.gz"
MANIFEST_FILE="$BUNDLE_DIR/manifest.txt"
NGINX_FILE="$BUNDLE_DIR/nginx.conf"

for command in docker curl sha256sum gzip od; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "缺少部署依赖：$command" >&2
    exit 1
  fi
done

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

for file in "$COMPOSE_FILE" "$IMAGES_FILE" "$MANIFEST_FILE" "$NGINX_FILE" "$BUNDLE_DIR/SHA256SUMS" "$BUNDLE_DIR/.env.example"; do
  if [ ! -f "$file" ]; then
    echo "发布包不完整，缺少：$file" >&2
    exit 1
  fi
done

mkdir -p "$STATE_DIR" "$BACKUP_DIR" "$STATE_DIR/releases"

if [ ! -f "$ENV_FILE" ]; then
  cp "$BUNDLE_DIR/.env.example" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  echo "已创建生产配置：$ENV_FILE"
fi

ln -sf "$ENV_FILE" "$BUNDLE_DIR/.env"

read_env_value() {
  awk -F= -v key="$1" '$1 == key { sub(/^[^=]*=/, ""); print; exit }' "$ENV_FILE"
}

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

POSTGRES_PASSWORD=$(read_env_value POSTGRES_PASSWORD)
POSTGRES_USER=$(read_env_value POSTGRES_USER)
POSTGRES_DB=$(read_env_value POSTGRES_DB)
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

if [ "$(read_env_value NODE_ENV)" != "production" ]; then
  echo "$ENV_FILE 中的 NODE_ENV 必须为 production。" >&2
  exit 1
fi

echo "校验发布包..."
(
  cd "$BUNDLE_DIR"
  sha256sum -c SHA256SUMS
)

echo "导入离线镜像包..."
gzip -dc "$IMAGES_FILE" | docker load

for image in \
  postgres:16-alpine \
  redis:7-alpine \
  minio/minio:RELEASE.2024-12-18T13-15-44Z \
  liveboard-api:local \
  liveboard-web:local; do
  if ! docker image inspect "$image" >/dev/null 2>&1; then
    echo "发布包缺少镜像：$image" >&2
    exit 1
  fi
done

compose() {
  docker compose \
    --project-name liveboard \
    --project-directory "$BUNDLE_DIR" \
    --file "$COMPOSE_FILE" \
    "$@"
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

VERSION=$(awk -F= '$1 == "release" { print $2; exit }' "$MANIFEST_FILE")
if [ -z "$VERSION" ]; then
  VERSION=unknown
fi

printf '%s\n' "$VERSION" >"$STATE_DIR/releases/current"
ln -sfn "$BUNDLE_DIR" "$STATE_DIR/releases/active"
compose ps
echo "发布部署完成：$VERSION"
echo "数据库备份：$BACKUP_FILE"
echo "发布清单：$MANIFEST_FILE"
echo "首次安装还需执行：docker compose --project-name liveboard --project-directory $STATE_DIR/releases/active --file $STATE_DIR/releases/active/docker-compose.yml exec api node prisma/seed.cjs"
