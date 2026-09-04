#!/bin/sh
set -eu

VERSION="v0.1.0"
ARCHIVE="pikpak-nas-ui-v0.1.0.zip"
URL="https://github.com/Evergaden/pikpak-nas-ui/releases/download/$VERSION/$ARCHIVE"
EXPECTED_SHA256="348fe155c01fae4919ad01f000f4160e759c5ffa003048efbcB07eda5036b1c6"
TEMP_DIR=$(mktemp -d)
trap 'rm -rf "$TEMP_DIR"' EXIT INT TERM

echo "正在下载 PikPak 落盘助手 $VERSION ..."
if command -v curl >/dev/null 2>&1; then
  curl -fL "$URL" -o "$TEMP_DIR/$ARCHIVE"
elif command -v wget >/dev/null 2>&1; then
  wget -O "$TEMP_DIR/$ARCHIVE" "$URL"
else
  echo "系统中没有 curl 或 wget，无法下载安装包。" >&2
  exit 1
fi

ACTUAL_SHA256=""
if command -v sha256sum >/dev/null 2>&1; then
  ACTUAL_SHA256=$(sha256sum "$TEMP_DIR/$ARCHIVE" | awk '{print $1}')
elif command -v busybox >/dev/null 2>&1; then
  ACTUAL_SHA256=$(busybox sha256sum "$TEMP_DIR/$ARCHIVE" | awk '{print $1}')
fi

if [ -z "$ACTUAL_SHA256" ]; then
  echo "系统中没有 SHA-256 校验工具，已停止安装。" >&2
  exit 1
fi
if [ "$(printf '%s' "$ACTUAL_SHA256" | tr 'A-F' 'a-f')" != "$(printf '%s' "$EXPECTED_SHA256" | tr 'A-F' 'a-f')" ]; then
  echo "安装包校验失败，已停止安装。" >&2
  exit 1
fi

mkdir -p "$TEMP_DIR/app"
if command -v unzip >/dev/null 2>&1; then
  unzip -q "$TEMP_DIR/$ARCHIVE" -d "$TEMP_DIR/app"
elif command -v busybox >/dev/null 2>&1; then
  busybox unzip -q "$TEMP_DIR/$ARCHIVE" -d "$TEMP_DIR/app"
else
  echo "系统中没有 unzip，无法解压安装包。" >&2
  exit 1
fi

cd "$TEMP_DIR/app"
chmod +x install-xiaomi-nas.sh
./install-xiaomi-nas.sh
