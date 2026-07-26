#!/bin/sh

set -eu

if [ "$#" -ne 3 ]; then
  echo "用法：$0 <模板> <发布目录> <输出文件>" >&2
  exit 1
fi

TEMPLATE=$1
BUNDLE_DIR=$2
OUTPUT=$3
TEMP_DIR=$(mktemp -d)
PAYLOAD="$TEMP_DIR/payload.tar.gz"
HEADER="$TEMP_DIR/header.sh"
trap 'rm -rf "$TEMP_DIR"' EXIT HUP INT TERM

[ -f "$TEMPLATE" ] || {
  echo "缺少自解压模板：$TEMPLATE" >&2
  exit 1
}
[ -d "$BUNDLE_DIR" ] || {
  echo "缺少发布目录：$BUNDLE_DIR" >&2
  exit 1
}

tar -C "$(dirname "$BUNDLE_DIR")" -cf - "$(basename "$BUNDLE_DIR")" | gzip -1 >"$PAYLOAD"
PAYLOAD_SHA256=$(sha256sum "$PAYLOAD" | awk '{ print $1 }')

sed "s/__PAYLOAD_SHA256__/$PAYLOAD_SHA256/" "$TEMPLATE" >"$HEADER"
cat "$HEADER" "$PAYLOAD" >"$OUTPUT"
chmod +x "$OUTPUT"

echo "已生成自解压发布包：$OUTPUT"
