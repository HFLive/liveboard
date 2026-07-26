#!/bin/sh

set -eu

PAYLOAD_SHA256="__PAYLOAD_SHA256__"

usage() {
  cat <<'EOF'
用法：
  sudo sh liveboard-<version>-linux-amd64.run install
  sudo sh liveboard-<version>-linux-amd64.run upgrade

install 用于首次安装或卸载后的重新安装。
upgrade 用于保留数据升级已有安装。
EOF
}

ACTION=${1:-}
case "$ACTION" in
  install | upgrade) ;;
  -h | --help | help | '') usage; exit 0 ;;
  *) echo "无法识别的操作：$ACTION" >&2; usage >&2; exit 1 ;;
esac

SELF=$0
PAYLOAD_LINE=$(awk '/^__LIVEBOARD_PAYLOAD_BELOW__$/ { print NR + 1; exit }' "$SELF")
[ -n "$PAYLOAD_LINE" ] || {
  echo "安装包损坏：找不到内嵌数据。" >&2
  exit 1
}

TEMP_DIR=$(mktemp -d)
PAYLOAD_FILE="$TEMP_DIR/payload.tar.gz"
trap 'rm -rf "$TEMP_DIR"' EXIT HUP INT TERM

tail -n +"$PAYLOAD_LINE" "$SELF" >"$PAYLOAD_FILE"
ACTUAL_SHA256=$(sha256sum "$PAYLOAD_FILE" | awk '{ print $1 }')
if [ "$ACTUAL_SHA256" != "$PAYLOAD_SHA256" ]; then
  echo "安装包校验失败，文件可能未上传完整或已被修改。" >&2
  exit 1
fi

tar -xzf "$PAYLOAD_FILE" -C "$TEMP_DIR"
BUNDLE_DIR=$(find "$TEMP_DIR" -mindepth 1 -maxdepth 1 -type d -name 'liveboard-*-linux-amd64' -print | head -n 1)
[ -n "$BUNDLE_DIR" ] || {
  echo "安装包损坏：找不到 LiveBoard 发布目录。" >&2
  exit 1
}

sh "$BUNDLE_DIR/deploy.sh" "$ACTION"
exit $?

__LIVEBOARD_PAYLOAD_BELOW__
