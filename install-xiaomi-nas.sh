#!/bin/sh
set -eu

DOCKER=/data/docker/docker
DATA_ROOT=${DATA_ROOT:-/nas/pool0/u862870309/data}
APP_ROOT="$DATA_ROOT/Docker/pikpak-nas"
DOWNLOAD_ROOT="$DATA_ROOT/PikPakDownloads"

if [ ! -x "$DOCKER" ]; then
  echo "找不到 Docker：$DOCKER" >&2
  exit 1
fi
if [ ! -d "$DATA_ROOT" ]; then
  echo "数据目录不存在：$DATA_ROOT" >&2
  exit 1
fi

mkdir -p "$APP_ROOT/config" "$DOWNLOAD_ROOT"
OWNER=$(stat -c '%u' "$DATA_ROOT")
GROUP=$(stat -c '%g' "$DATA_ROOT")
PASSWORD=${APP_PASSWORD:-$(head -c 12 /dev/urandom | od -An -tx1 | tr -d ' \n')}

"$DOCKER" build -t pikpak-nas-ui:local .
"$DOCKER" rm -f pikpak-nas >/dev/null 2>&1 || true
"$DOCKER" run -d \
  --name pikpak-nas \
  --restart unless-stopped \
  -p 8088:8080 \
  -e APP_USER=admin \
  -e "APP_PASSWORD=$PASSWORD" \
  -e "DOWNLOAD_UID=$OWNER" \
  -e "DOWNLOAD_GID=$GROUP" \
  -e MAX_CONCURRENT=2 \
  -e TZ=Asia/Shanghai \
  -v "$APP_ROOT/config:/config" \
  -v "$DOWNLOAD_ROOT:/downloads" \
  pikpak-nas-ui:local

echo
echo "安装完成"
echo "访问地址：http://NAS_IP:8088"
echo "用户名：admin"
echo "密码：$PASSWORD"
echo "下载目录：$DOWNLOAD_ROOT"
