#!/bin/sh
set -eu

DOCKER=/data/docker/docker
DATA_ROOT=${DATA_ROOT:-/nas/pool0/u862870309/data}
APP_ROOT="$DATA_ROOT/Docker/pikpak-nas"
DOWNLOAD_ROOT="$DATA_ROOT/PikPakDownloads"
CONFIG_ROOT="$APP_ROOT/config"
ENV_FILE="$CONFIG_ROOT/app.env"
VERSION="0.2.3"
IMAGE_ARCHIVE="pikpak-nas-images-v$VERSION.tar.gz"
IMAGE_URL="https://github.com/Evergaden/pikpak-nas-ui/releases/download/v$VERSION/$IMAGE_ARCHIVE"

if [ ! -x "$DOCKER" ]; then
  echo "找不到 Docker：$DOCKER" >&2
  exit 1
fi
if [ ! -d "$DATA_ROOT" ]; then
  echo "数据目录不存在：$DATA_ROOT" >&2
  exit 1
fi
if [ ! -S /var/run/docker.sock ]; then
  echo "找不到 Docker 控制接口：/var/run/docker.sock" >&2
  exit 1
fi

mkdir -p "$CONFIG_ROOT" "$DOWNLOAD_ROOT"
OWNER=$(stat -c '%u' "$DATA_ROOT")
GROUP=$(stat -c '%g' "$DATA_ROOT")
EXISTING_PASSWORD=$($DOCKER inspect -f '{{range .Config.Env}}{{println .}}{{end}}' pikpak-nas 2>/dev/null | sed -n 's/^APP_PASSWORD=//p' | head -n 1 || true)
PASSWORD=${APP_PASSWORD:-${EXISTING_PASSWORD:-$(head -c 12 /dev/urandom | od -An -tx1 | tr -d ' \n')}}

umask 077
cat > "$ENV_FILE" <<EOF
APP_USER=admin
APP_PASSWORD=$PASSWORD
DOWNLOAD_UID=$OWNER
DOWNLOAD_GID=$GROUP
MAX_CONCURRENT=2
TZ=Asia/Shanghai
EOF

TEMP_DIR=$(mktemp -d)
trap 'rm -rf "$TEMP_DIR"' EXIT INT TERM
echo "正在下载 ARM64 Docker 镜像包…"
if command -v curl >/dev/null 2>&1; then
  curl -fL "$IMAGE_URL" -o "$TEMP_DIR/$IMAGE_ARCHIVE"
  curl -fL "$IMAGE_URL.sha256" -o "$TEMP_DIR/$IMAGE_ARCHIVE.sha256"
else
  wget -O "$TEMP_DIR/$IMAGE_ARCHIVE" "$IMAGE_URL"
  wget -O "$TEMP_DIR/$IMAGE_ARCHIVE.sha256" "$IMAGE_URL.sha256"
fi
EXPECTED=$(awk '{print $1}' "$TEMP_DIR/$IMAGE_ARCHIVE.sha256" | tr 'A-F' 'a-f')
if command -v sha256sum >/dev/null 2>&1; then
  ACTUAL=$(sha256sum "$TEMP_DIR/$IMAGE_ARCHIVE" | awk '{print $1}' | tr 'A-F' 'a-f')
elif command -v busybox >/dev/null 2>&1; then
  ACTUAL=$(busybox sha256sum "$TEMP_DIR/$IMAGE_ARCHIVE" | awk '{print $1}' | tr 'A-F' 'a-f')
else
  echo "系统中没有 SHA-256 校验工具，已停止安装。" >&2
  exit 1
fi
if [ -z "$EXPECTED" ] || [ "$EXPECTED" != "$ACTUAL" ]; then
  echo "Docker 镜像包校验失败，已停止安装。" >&2
  exit 1
fi
"$DOCKER" load -i "$TEMP_DIR/$IMAGE_ARCHIVE"
"$DOCKER" rm -f pikpak-nas >/dev/null 2>&1 || true
"$DOCKER" run -d \
  --name pikpak-nas \
  --restart unless-stopped \
  -p 8088:8080 \
  --dns 223.5.5.5 \
  --dns 119.29.29.29 \
  --env-file "$ENV_FILE" \
  -e "APP_VERSION=$VERSION" \
  -v "$CONFIG_ROOT:/config" \
  -v "$DOWNLOAD_ROOT:/downloads" \
  "pikpak-nas-ui:$VERSION"

"$DOCKER" rm -f pikpak-nas-updater >/dev/null 2>&1 || true
"$DOCKER" run -d \
  --name pikpak-nas-updater \
  --restart unless-stopped \
  --dns 223.5.5.5 \
  --dns 119.29.29.29 \
  -e "HOST_CONFIG_DIR=$CONFIG_ROOT" \
  -e "HOST_DOWNLOAD_DIR=$DOWNLOAD_ROOT" \
  -e HOST_PORT=8088 \
  -e APP_CONTAINER=pikpak-nas \
  -e APP_IMAGE=pikpak-nas-ui \
  -e DOCKER_DNS_SERVERS=223.5.5.5,119.29.29.29 \
  -v "$CONFIG_ROOT:/config" \
  -v /var/run/docker.sock:/var/run/docker.sock \
  "pikpak-nas-updater:$VERSION"

echo
echo "安装完成"
echo "访问地址：http://NAS_IP:8088"
echo "用户名：admin"
echo "密码：$PASSWORD"
echo "下载目录：$DOWNLOAD_ROOT"
echo "以后可在网页右上角直接检查并安装更新"
