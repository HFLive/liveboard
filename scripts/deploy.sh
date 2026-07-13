#!/bin/sh

set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT_DIR"

BACKUP_DIR=${BACKUP_DIR:-"$ROOT_DIR/backups"}
HEALTH_URL=${HEALTH_URL:-"http://127.0.0.1:4000/health"}
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
BACKUP_FILE="$BACKUP_DIR/postgres-$TIMESTAMP.dump"

for command in docker git curl; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "缺少部署依赖：$command" >&2
    exit 1
  fi
done

if [ ! -f .env ]; then
  echo "缺少生产环境配置文件：.env" >&2
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

if [ -n "$(git status --porcelain)" ]; then
  echo "工作区存在未提交改动，已停止部署。" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"

echo "启动 PostgreSQL 并等待就绪..."
docker compose up -d postgres

attempt=0
until docker compose exec -T postgres sh -c 'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"' >/dev/null 2>&1; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 30 ]; then
    echo "PostgreSQL 未在 60 秒内就绪。" >&2
    exit 1
  fi
  sleep 2
done

echo "备份 PostgreSQL 到 $BACKUP_FILE ..."
docker compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' >"$BACKUP_FILE"

if [ ! -s "$BACKUP_FILE" ]; then
  echo "数据库备份为空，已停止部署。" >&2
  exit 1
fi

echo "拉取最新代码..."
git pull --ff-only

echo "构建生产镜像..."
docker compose build api web

echo "执行数据库迁移并启动服务..."
docker compose up -d --no-build

echo "等待 API 健康检查..."
attempt=0
until curl --fail --silent --show-error "$HEALTH_URL" >/dev/null 2>&1; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 30 ]; then
    echo "API 未在 60 秒内通过健康检查。" >&2
    docker compose ps
    docker compose logs --tail=100 migrate api
    exit 1
  fi
  sleep 2
done

docker compose ps
echo "部署完成。数据库备份：$BACKUP_FILE"
