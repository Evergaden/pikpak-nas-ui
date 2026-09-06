#!/bin/sh
set -eu

VERSION="v0.2.5"
ARCHIVE="pikpak-nas-ui-v0.2.5.zip"
URL="https://github.com/Evergaden/pikpak-nas-ui/releases/download/$VERSION/$ARCHIVE"
EXPECTED_SHA256="cb14fec91d11c2457f33b3283080b90405aec0e5b41f538454109f95b7c58777"
TEMP_DIR=$(mktemp -d)
trap 'rm -rf "$TEMP_DIR"' EXIT INT TERM

echo "正在下载 PikPak 落盘助手 $VERSION ..."
if command -v curl >/dev/null 2>&1; then
  ATTEMPT=1
  until curl --http1.1 -fL --connect-timeout 15 --max-time 120 --speed-limit 1 --speed-time 30 "$URL" -o "$TEMP_DIR/$ARCHIVE"; do
    if [ "$ATTEMPT" -ge 3 ]; then
      echo "GitHub 安装包下载连续失败，请检查 NAS 到 GitHub 的网络连接。" >&2
      exit 1
    fi
    ATTEMPT=$((ATTEMPT + 1))
    echo "下载中断，5 秒后进行第 $ATTEMPT 次尝试…"
    sleep 5
  done
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

INSTALLER=$(find "$TEMP_DIR/app" -type f -name install-xiaomi-nas.sh | head -n 1)
if [ -z "$INSTALLER" ]; then
  echo "安装包中找不到 install-xiaomi-nas.sh。" >&2
  exit 1
fi
INSTALL_DIR=$(dirname "$INSTALLER")
cd "$INSTALL_DIR"
tr -d '\r' < install-xiaomi-nas.sh > install-xiaomi-nas.sh.lf
mv install-xiaomi-nas.sh.lf install-xiaomi-nas.sh
chmod +x install-xiaomi-nas.sh
./install-xiaomi-nas.sh
