#!/bin/sh

set -eu

STATE_DIR=${LIVEBOARD_STATE_DIR:-/opt/liveboard}
RELEASES_DIR="$STATE_DIR/releases"
ACTIVE_LINK="$RELEASES_DIR/active"
ENV_FILE=${LIVEBOARD_ENV_FILE:-"$STATE_DIR/.env"}
NGINX_SITE=${LIVEBOARD_NGINX_SITE:-/etc/nginx/sites-available/liveboard}
NGINX_ENABLED=${LIVEBOARD_NGINX_ENABLED:-/etc/nginx/sites-enabled/liveboard}
NGINX_DEFAULT=${LIVEBOARD_NGINX_DEFAULT:-/etc/nginx/sites-enabled/default}
LOCK_DIR="$STATE_DIR/.operation-lock"
LOCK_HELD=false

usage() {
  cat <<'EOF'
用法：liveboard <命令> [参数]

  status                 查看当前版本和服务状态
  version                显示当前版本
  logs [服务名...]       查看最近 200 行日志
  start                  启动全部服务
  stop                   停止服务但保留容器和数据
  restart                重启全部服务
  doctor                 检查安装、服务、端口和备份状态
  clean [选项]           清理旧版本文件和对应应用镜像
  uninstall [--yes]      卸载应用，保留配置、备份和数据卷

clean 选项：
  --keep N               保留最近 N 个版本，默认 2
  --packages             同时清理 /opt 中的旧 .run 安装包
  --dry-run              只显示将被删除的内容
  --yes                  跳过交互确认
EOF
}

die() {
  echo "错误：$*" >&2
  exit 1
}

require_root() {
  if [ "$(id -u)" -ne 0 ] && [ "$STATE_DIR" = /opt/liveboard ]; then
    die "该命令需要 root 权限，请使用 sudo。"
  fi
}

release_lock() {
  if [ "$LOCK_HELD" = true ]; then
    rm -f "$LOCK_DIR/pid"
    rmdir "$LOCK_DIR" 2>/dev/null || true
    LOCK_HELD=false
  fi
}

acquire_lock() {
  mkdir -p "$STATE_DIR"
  if ! mkdir "$LOCK_DIR" 2>/dev/null; then
    lock_pid=$(sed -n '1p' "$LOCK_DIR/pid" 2>/dev/null || true)
    if [ -n "$lock_pid" ] && kill -0 "$lock_pid" 2>/dev/null; then
      die "另一个 LiveBoard 安装、升级或管理操作正在运行（PID $lock_pid）。"
    fi
    rm -f "$LOCK_DIR/pid"
    rmdir "$LOCK_DIR" 2>/dev/null || die "无法清理失效的操作锁：$LOCK_DIR"
    mkdir "$LOCK_DIR"
  fi
  printf '%s\n' "$$" >"$LOCK_DIR/pid"
  LOCK_HELD=true
  trap release_lock EXIT HUP INT TERM
}

active_release() {
  [ -L "$ACTIVE_LINK" ] || die "LiveBoard 尚未安装或当前版本链接不存在。"
  ACTIVE_DIR=$(readlink "$ACTIVE_LINK") || die "无法读取当前版本链接：$ACTIVE_LINK"
  case "$ACTIVE_DIR" in
    /*) ;;
    *) ACTIVE_DIR="$RELEASES_DIR/$ACTIVE_DIR" ;;
  esac
  case "$ACTIVE_DIR" in
    "$RELEASES_DIR"/*) ;;
    *) die "当前版本目录不在受管范围内：$ACTIVE_DIR" ;;
  esac
  [ -d "$ACTIVE_DIR" ] || die "当前版本链接已经失效：$ACTIVE_LINK"
  [ -f "$ACTIVE_DIR/docker-compose.yml" ] || die "当前版本缺少 docker-compose.yml。"
  printf '%s\n' "$ACTIVE_DIR"
}

release_version() {
  release_dir=$1
  version=$(awk -F= '$1 == "release" { print $2; exit }' "$release_dir/manifest.txt" 2>/dev/null || true)
  [ -n "$version" ] || version=$(basename "$release_dir")
  printf '%s\n' "$version"
}

compose_for() {
  release_dir=$1
  shift
  version=$(release_version "$release_dir")
  LIVEBOARD_API_IMAGE="liveboard-api:${version}" \
    LIVEBOARD_WEB_IMAGE="liveboard-web:${version}" \
    docker compose \
      --project-name liveboard \
      --project-directory "$release_dir" \
      --file "$release_dir/docker-compose.yml" \
      "$@"
}

reload_nginx_if_available() {
  if command -v nginx >/dev/null 2>&1 && command -v systemctl >/dev/null 2>&1; then
    nginx -t
    systemctl reload nginx
  fi
}

confirm() {
  prompt=$1
  assume_yes=$2
  if [ "$assume_yes" = true ]; then
    return
  fi
  printf '%s [y/N] ' "$prompt"
  IFS= read -r answer
  case "$answer" in
    y | Y | yes | YES) ;;
    *) echo "操作已取消。"; exit 0 ;;
  esac
}

command_status() {
  release_dir=$(active_release)
  echo "当前版本：$(release_version "$release_dir")"
  echo "版本目录：$release_dir"
  compose_for "$release_dir" ps
}

command_version() {
  release_dir=$(active_release)
  release_version "$release_dir"
}

command_logs() {
  release_dir=$(active_release)
  shift
  compose_for "$release_dir" logs --tail=200 "$@"
}

command_start() {
  require_root
  acquire_lock
  release_dir=$(active_release)
  compose_for "$release_dir" up -d --no-build
  compose_for "$release_dir" ps
}

command_stop() {
  require_root
  acquire_lock
  release_dir=$(active_release)
  compose_for "$release_dir" stop
  compose_for "$release_dir" ps
}

command_restart() {
  require_root
  acquire_lock
  release_dir=$(active_release)
  compose_for "$release_dir" restart
  compose_for "$release_dir" ps
}

command_doctor() {
  failed=false

  echo "LiveBoard 安装检查"
  if release_dir=$(active_release 2>/dev/null); then
    echo "  [正常] 当前版本：$(release_version "$release_dir")"
  else
    echo "  [失败] 当前版本链接不存在或无效"
    failed=true
    release_dir=
  fi

  if [ -f "$ENV_FILE" ]; then
    mode=$(stat -c '%a' "$ENV_FILE" 2>/dev/null || stat -f '%Lp' "$ENV_FILE" 2>/dev/null || true)
    if [ "$mode" = 600 ]; then
      echo "  [正常] 生产配置权限：600"
    else
      echo "  [警告] 生产配置权限应为 600，当前为：${mode:-未知}"
    fi
  else
    echo "  [失败] 缺少生产配置：$ENV_FILE"
    failed=true
  fi

  for command in docker curl; do
    if command -v "$command" >/dev/null 2>&1; then
      echo "  [正常] 已安装 $command"
    else
      echo "  [失败] 缺少 $command"
      failed=true
    fi
  done

  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    echo "  [正常] Docker Compose 可用"
  else
    echo "  [失败] Docker Compose 不可用"
    failed=true
  fi

  if [ -n "${release_dir:-}" ]; then
    if compose_for "$release_dir" ps >/dev/null 2>&1; then
      echo "  [正常] Compose 项目可读取"
    else
      echo "  [失败] Compose 项目不可读取"
      failed=true
    fi
  fi

  for check in \
    "API|http://127.0.0.1:4000/health" \
    "Web|http://127.0.0.1:3000" \
    "Nginx|http://127.0.0.1"; do
    name=${check%%|*}
    url=${check#*|}
    if command -v curl >/dev/null 2>&1 && curl --fail --silent --show-error --max-time 5 "$url" >/dev/null 2>&1; then
      echo "  [正常] $name 健康"
    else
      echo "  [失败] $name 无法访问：$url"
      failed=true
    fi
  done

  latest_backup=$(find "$STATE_DIR/backups" -type f -name 'postgres-*.dump' -print 2>/dev/null | sort -r | head -n 1 || true)
  if [ -n "$latest_backup" ]; then
    echo "  [正常] 最近数据库备份：$latest_backup"
  else
    echo "  [警告] 尚未找到数据库备份"
  fi

  if [ -f "$STATE_DIR/initial-admin-credentials.txt" ]; then
    echo "  [提醒] 首次凭据文件仍存在；修改密码后应删除它。"
  fi

  if [ "$failed" = true ]; then
    exit 1
  fi
}

command_clean() {
  require_root
  acquire_lock
  keep=2
  include_packages=false
  dry_run=false
  assume_yes=false
  shift

  while [ "$#" -gt 0 ]; do
    case "$1" in
      --keep)
        [ "$#" -ge 2 ] || die "--keep 需要一个正整数。"
        keep=$2
        shift 2
        ;;
      --packages) include_packages=true; shift ;;
      --dry-run) dry_run=true; shift ;;
      --yes) assume_yes=true; shift ;;
      *) die "无法识别的 clean 参数：$1" ;;
    esac
  done

  case "$keep" in
    '' | *[!0-9]* | 0) die "--keep 必须是正整数。" ;;
  esac

  active_dir=$(active_release)
  targets=$(mktemp)
  package_targets=$(mktemp)
  release_inventory=$(mktemp)
  cleanup_clean() {
    rm -f "$targets" "$package_targets" "$release_inventory"
    release_lock
  }
  trap cleanup_clean EXIT HUP INT TERM

  find "$RELEASES_DIR" -mindepth 1 -maxdepth 1 -type d -print |
    while IFS= read -r release_dir; do
      modified=$(stat -c '%Y' "$release_dir" 2>/dev/null || stat -f '%m' "$release_dir" 2>/dev/null || printf '0')
      printf '%s|%s\n' "$modified" "$release_dir"
    done |
    sort -t '|' -k1,1nr -k2,2r >"$release_inventory"

  count=0
  while IFS='|' read -r _modified release_dir; do
      case "$release_dir" in
        "$RELEASES_DIR"/.staging-*) printf '%s\n' "$release_dir" ;;
        *)
          count=$((count + 1))
          if [ "$release_dir" != "$active_dir" ] && [ "$count" -gt "$keep" ]; then
            printf '%s\n' "$release_dir"
          fi
          ;;
      esac
    done <"$release_inventory" >"$targets"

  if [ "$include_packages" = true ]; then
    current_version=$(release_version "$active_dir")
    find /opt -maxdepth 1 -type f \
      \( -name 'liveboard-v*-linux-amd64.run' -o -name 'liveboard-v*-linux-amd64.tar.gz' \) \
      -print 2>/dev/null |
      while IFS= read -r package; do
        case "$(basename "$package")" in
          *"$current_version"*) ;;
          *) printf '%s\n' "$package" ;;
        esac
      done >"$package_targets"
  fi

  if [ ! -s "$targets" ] && [ ! -s "$package_targets" ]; then
    echo "没有可清理的旧版本文件。"
    exit 0
  fi

  echo "将清理以下 LiveBoard 文件："
  sed 's/^/  /' "$targets"
  sed 's/^/  /' "$package_targets"

  if [ "$dry_run" = true ]; then
    echo "这是预览，没有删除任何内容。"
    exit 0
  fi

  confirm "确认删除以上旧版本文件？" "$assume_yes"

  while IFS= read -r release_dir; do
    [ -n "$release_dir" ] || continue
    case "$release_dir" in
      "$RELEASES_DIR"/*)
        version=$(release_version "$release_dir")
        rm -rf -- "$release_dir"
        docker image rm "liveboard-api:${version}" "liveboard-web:${version}" >/dev/null 2>&1 || true
        ;;
      *) die "拒绝删除受管目录之外的路径：$release_dir" ;;
    esac
  done <"$targets"

  while IFS= read -r package; do
    [ -n "$package" ] || continue
    case "$package" in
      /opt/liveboard-v*-linux-amd64.run | /opt/liveboard-v*-linux-amd64.tar.gz)
        rm -f -- "$package"
        ;;
      *) die "拒绝删除不匹配的安装包：$package" ;;
    esac
  done <"$package_targets"

  echo "旧版本清理完成。当前版本和数据卷均已保留。"
}

command_uninstall() {
  require_root
  acquire_lock
  assume_yes=false
  shift
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --yes) assume_yes=true ;;
      *) die "无法识别的 uninstall 参数：$1" ;;
    esac
    shift
  done

  release_dir=$(active_release)
  echo "卸载将停止并删除 LiveBoard 容器、应用镜像和版本文件。"
  echo "以下内容会保留："
  echo "  $ENV_FILE"
  echo "  $STATE_DIR/backups"
  echo "  Docker 命名卷 liveboard_postgres-data、liveboard_redis-data、liveboard_minio-data"
  confirm "确认执行可恢复卸载？" "$assume_yes"

  compose_for "$release_dir" down --remove-orphans

  if [ -L "$NGINX_ENABLED" ]; then
    target=$(readlink "$NGINX_ENABLED" || true)
    if [ "$target" = "$NGINX_SITE" ]; then
      rm -f -- "$NGINX_ENABLED"
      reload_nginx_if_available
    fi
  fi
  if [ -e "$STATE_DIR/gateway/default-site.backup" ] && [ ! -e "$NGINX_DEFAULT" ]; then
    mv "$STATE_DIR/gateway/default-site.backup" "$NGINX_DEFAULT"
    reload_nginx_if_available
  fi

  find "$RELEASES_DIR" -mindepth 1 -maxdepth 1 -type d -print |
    while IFS= read -r old_release; do
      case "$old_release" in
        "$RELEASES_DIR"/*)
          version=$(release_version "$old_release")
          rm -rf -- "$old_release"
          docker image rm "liveboard-api:${version}" "liveboard-web:${version}" >/dev/null 2>&1 || true
          ;;
      esac
    done
  rm -f -- "$ACTIVE_LINK" "$RELEASES_DIR/current"

  echo "LiveBoard 应用已卸载，业务数据和配置仍保留在 ${STATE_DIR}。"
  echo "上传新的 .run 包并执行 install，即可重新接入原有数据。"
}

COMMAND=${1:-}
case "$COMMAND" in
  status) command_status ;;
  version) command_version ;;
  logs) command_logs "$@" ;;
  start) command_start ;;
  stop) command_stop ;;
  restart) command_restart ;;
  doctor) command_doctor ;;
  clean) command_clean "$@" ;;
  uninstall) command_uninstall "$@" ;;
  -h | --help | help | '') usage ;;
  *) die "未知命令：${COMMAND}。使用 liveboard help 查看帮助。" ;;
esac
