#!/bin/sh

set -eu
umask 077

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT_DIR"

VERSION=${1:-}
REPOSITORY=${LIVEBOARD_GITHUB_REPOSITORY:-HFLive/liveboard}
RELEASE_ROOT=${RELEASE_DIR:-"$ROOT_DIR/releases"}
BACKUP_DIR=${BACKUP_DIR:-"$ROOT_DIR/backups"}
HEALTH_URL=${HEALTH_URL:-"http://127.0.0.1:4000/health"}

case "$VERSION" in
  "" | *[!A-Za-z0-9._-]*)
    echo "用法：sh scripts/deploy-release.sh v1.2.3" >&2
    exit 1
    ;;
esac

case "$VERSION" in
  v*) ;;
  *)
    echo "发布版本必须使用 v 开头，例如 v1.2.3。" >&2
    exit 1
    ;;
esac

for command in docker curl sha256sum gzip tar; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "缺少部署依赖：$command" >&2
    exit 1
  fi
done

case "$(uname -m)" in
  x86_64 | amd64) ;;
  *)
    echo "当前 Release 仅支持 Linux AMD64 服务器。" >&2
    exit 1
    ;;
esac

if ! docker compose version >/dev/null 2>&1; then
  echo "缺少 Docker Compose 插件。" >&2
  exit 1
fi

BUNDLE_ASSET="liveboard-${VERSION}-linux-amd64.tar.gz"
ASSET="liveboard-${VERSION}-linux-amd64-images.tar.gz"
COMPOSE_ASSET="liveboard-${VERSION}-compose.yml"
MANIFEST_ASSET="liveboard-${VERSION}-manifest.txt"
RELEASE_URL=${LIVEBOARD_RELEASE_BASE_URL:-"https://github.com/${REPOSITORY}/releases/download/${VERSION}"}
VERSION_DIR="$RELEASE_ROOT/$VERSION"
COMPOSE_FILE="$VERSION_DIR/$COMPOSE_ASSET"

mkdir -p "$VERSION_DIR" "$BACKUP_DIR"

download_asset() {
  name=$1
  destination="$VERSION_DIR/$name"
  temporary="$destination.part"

  rm -f "$temporary"
  echo "下载 $name ..."
  if ! curl \
    --fail \
    --location \
    --retry 5 \
    --retry-all-errors \
    --connect-timeout 20 \
    --output "$temporary" \
    "$RELEASE_URL/$name"; then
    rm -f "$temporary"
    return 1
  fi
  mv "$temporary" "$destination"
}

if download_asset "$BUNDLE_ASSET"; then
  echo "解压单文件发布包..."
  tar -xzf "$VERSION_DIR/$BUNDLE_ASSET" -C "$VERSION_DIR"
  BUNDLE_DIR="$VERSION_DIR/liveboard-${VERSION}-linux-amd64"

  if [ ! -f "$BUNDLE_DIR/deploy.sh" ]; then
    echo "发布包结构不正确，缺少：$BUNDLE_DIR/deploy.sh" >&2
    exit 1
  fi

  LIVEBOARD_STATE_DIR="$ROOT_DIR" \
    LIVEBOARD_ENV_FILE="$ROOT_DIR/.env" \
    BACKUP_DIR="$BACKUP_DIR" \
    HEALTH_URL="$HEALTH_URL" \
    sh "$BUNDLE_DIR/deploy.sh"
  exit 0
fi

echo "未找到单文件发布包，按 v0.1.0 兼容格式继续部署..."

if [ ! -f .env ]; then
  echo "v0.1.0 兼容部署需要生产环境配置文件：.env" >&2
  exit 1
fi

read_env_value() {
  awk -F= -v key="$1" '$1 == key { sub(/^[^=]*=/, ""); print; exit }' .env
}

require_secret() {
  key=$1
  minimum_length=$2
  value=$(read_env_value "$key")

  case "$value" in
    "" | liveboard | liveboard-admin | replace-with-*)
      echo ".env 中的 $key 尚未配置为安全值。" >&2
      exit 1
      ;;
  esac

  if [ "${#value}" -lt "$minimum_length" ]; then
    echo ".env 中的 $key 长度不足，至少需要 $minimum_length 个字符。" >&2
    exit 1
  fi
}

require_secret POSTGRES_PASSWORD 16
require_secret MINIO_ROOT_PASSWORD 16
require_secret SESSION_SECRET 32

download_asset SHA256SUMS
download_asset "$ASSET"
download_asset "$COMPOSE_ASSET"
download_asset "$MANIFEST_ASSET"

echo "校验发布文件..."
(
  cd "$VERSION_DIR"
  sha256sum -c SHA256SUMS
)

echo "导入离线镜像包..."
gzip -dc "$VERSION_DIR/$ASSET" | docker load

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
    --project-directory "$ROOT_DIR" \
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

printf '%s\n' "$VERSION" >"$RELEASE_ROOT/current"
compose ps
echo "发布部署完成：$VERSION"
echo "数据库备份：$BACKUP_FILE"
echo "发布清单：$VERSION_DIR/$MANIFEST_ASSET"
