# PikPak 落盘助手

为小米智能存储制作的本地 Web 下载界面。可通过 PikPak 官方 WebDAV 或 rclone 原生 PikPak 后端浏览云盘，并将所选文件或目录下载到 NAS。

## 功能

- PikPak WebDAV 凭据配置与连通性测试
- PikPak 账号登录（原生 rclone）与连通性测试
- 云盘目录浏览与多选下载
- 最多两个并发任务、实时速度与进度
- 取消、失败提示、重复下载续传
- 在管理界面检查并一键安装新版本，失败自动恢复原版本
- HTTP Basic 登录保护
- ARM64 Docker 支持

## 小米 NAS 安装

SSH 登录 NAS 后，可直接在线安装：

```sh
curl -fsSL https://raw.githubusercontent.com/Evergaden/pikpak-nas-ui/main/install-online.sh | sh
```

在线安装器会下载固定版本的 Release ZIP，并在 SHA-256 校验通过后执行安装。

也可以手动将整个目录上传并解压到 NAS，在目录中执行：

```sh
chmod +x install-xiaomi-nas.sh
./install-xiaomi-nas.sh
```

安装器会创建配置目录和下载目录、识别原数据目录 UID/GID、生成随机管理密码，并启动端口 `8088`。

浏览器访问 `http://NAS_IP:8088`，用户名为 `admin`，密码以安装器最后输出为准。进入界面后可选择：

- `WebDAV`：填写 PikPak 在“设置 → Access & Integrations → WebDAV”生成的专用地址、用户名和密码。
- `账号登录（原生）`：填写 PikPak 主账号（邮箱或手机号）和主账号密码，不需要 WebDAV 地址。

## 安全说明

- 默认是 HTTP，仅适合可信局域网，不应直接映射到公网。
- 配置文件中的 WebDAV 或主账号密码由 rclone 混淆保存；这不是强加密，应保护配置目录。账号登录模式直接使用 rclone 的 PikPak 后端，建议只在可信网络使用，必要时使用专用账号。
- 容器只挂载自己的配置目录和指定下载目录，不挂载 Docker Socket 或 NAS 根目录。
- 独立更新助手会挂载 Docker Socket，但不开放网络端口；主网页容器仍然无法直接控制 Docker。
- 如果凭据泄露，请在 PikPak 的 Connected Apps 中立即撤销。
