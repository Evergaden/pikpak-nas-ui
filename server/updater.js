import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const exec = promisify(execFile);
const configDir = process.env.CONFIG_DIR || '/config';
const requestFile = path.join(configDir, 'update-request.json');
const statusFile = path.join(configDir, 'update-status.json');
const hostConfigDir = process.env.HOST_CONFIG_DIR;
const hostDownloadDir = process.env.HOST_DOWNLOAD_DIR;
const hostPort = process.env.HOST_PORT || '8088';
const containerName = process.env.APP_CONTAINER || 'pikpak-nas';
const imageName = process.env.APP_IMAGE || 'pikpak-nas-ui';
const dockerNetworkMode = process.env.DOCKER_NETWORK_MODE || 'host';
const dockerDnsServers = String(process.env.DOCKER_DNS_SERVERS || '223.5.5.5,119.29.29.29').split(',').map((value) => value.trim()).filter(Boolean);
const allowedBundle = /^https:\/\/github\.com\/Evergaden\/pikpak-nas-ui\/releases\/download\/v\d+\.\d+\.\d+\/pikpak-nas-images-v\d+\.\d+\.\d+\.tar\.gz$/;
let processing = false;

if (!hostConfigDir || !hostDownloadDir) throw new Error('HOST_CONFIG_DIR and HOST_DOWNLOAD_DIR are required');

const docker = async (args, options = {}) => exec('docker', args, { timeout: 15 * 60 * 1000, maxBuffer: 16 * 1024 * 1024, ...options });
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const download = async (url, timeout = 10 * 60 * 1000) => {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeout), headers: { 'User-Agent': 'PikPak-NAS-Updater' } });
  if (!response.ok) throw new Error(`下载失败：HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
};
const writeStatus = async (state, version, message) => {
  const temporary = `${statusFile}.tmp`;
  await writeFile(temporary, `${JSON.stringify({ state, version, message, updatedAt: new Date().toISOString() }, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, statusFile);
};

const readEnv = async () => {
  const values = [];
  for (const line of (await readFile(path.join(configDir, 'app.env'), 'utf8')).split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const separator = trimmed.indexOf('=');
    const key = trimmed.slice(0, separator);
    const value = trimmed.slice(separator + 1);
    if (/^[A-Z_][A-Z0-9_]*$/.test(key)) values.push(`${key}=${value}`);
  }
  return values;
};

const runApplication = async (version) => {
  const args = ['run', '-d', '--name', containerName, '--restart', 'unless-stopped', '--network', dockerNetworkMode];
  if (dockerNetworkMode === 'host') args.push('-e', `PORT=${hostPort}`);
  else {
    args.push('-p', `${hostPort}:8080`);
    for (const dns of dockerDnsServers) args.push('--dns', dns);
  }
  for (const value of await readEnv()) args.push('-e', value);
  args.push('-e', `APP_VERSION=${version}`, '-v', `${hostConfigDir}:/config`, '-v', `${hostDownloadDir}:/downloads`, `${imageName}:${version}`);
  await docker(args);
};

const rollback = async () => {
  await docker(['rm', '-f', containerName]).catch(() => undefined);
  await docker(['rename', `${containerName}-rollback`, containerName]).catch(() => undefined);
  await docker(['start', containerName]);
};

const processUpdate = async (request) => {
  const version = String(request.version || '');
  const bundleUrl = String(request.imageBundleUrl || '');
  const checksumUrl = String(request.imageBundleChecksumUrl || '');
  if (!/^\d+\.\d+\.\d+$/.test(version) || !allowedBundle.test(bundleUrl) || checksumUrl !== `${bundleUrl}.sha256`) throw new Error('更新请求未通过安全校验');

  const workDir = `/tmp/pikpak-update-${Date.now()}`;
  const archive = path.join(workDir, 'images.tar.gz');
  await mkdir(workDir, { recursive: true });
  try {
    await writeStatus('downloading', version, '正在下载 ARM64 镜像包');
    const checksumText = (await download(checksumUrl, 30000)).toString('utf8');
    const expected = checksumText.trim().split(/\s+/)[0]?.toLowerCase() || '';
    if (!/^[a-f0-9]{64}$/.test(expected)) throw new Error('镜像包校验文件无效');
    const payload = await download(bundleUrl);
    if (createHash('sha256').update(payload).digest('hex') !== expected) throw new Error('安装包 SHA-256 校验失败');
    await writeFile(archive, payload, { mode: 0o600 });

    await writeStatus('building', version, '正在载入新版本镜像');
    await docker(['load', '-i', archive]);

    await writeStatus('installing', version, '正在切换到新版本，页面会短暂断开');
    await docker(['rm', '-f', `${containerName}-rollback`]).catch(() => undefined);
    await docker(['stop', containerName]);
    await docker(['rename', containerName, `${containerName}-rollback`]);
    try {
      await runApplication(version);
      await delay(5000);
      const { stdout } = await docker(['inspect', '-f', '{{.State.Running}}', containerName]);
      if (stdout.trim() !== 'true') throw new Error('新版本容器未能保持运行');
    } catch (error) {
      await rollback();
      throw new Error(`新版本启动失败，已恢复原版本：${error.message}`);
    }
    await docker(['rm', '-f', `${containerName}-rollback`]).catch(() => undefined);
    await writeStatus('done', version, `已更新至 ${version}`);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
};

const tick = async () => {
  if (processing) return;
  let request;
  try { request = JSON.parse(await readFile(requestFile, 'utf8')); }
  catch { return; }
  processing = true;
  await rm(requestFile, { force: true });
  try { await processUpdate(request); }
  catch (error) {
    console.error(error);
    await writeStatus('failed', request.version || '', error.message || '更新失败');
  } finally { processing = false; }
};

console.log('PikPak NAS updater is ready');
setInterval(() => { void tick(); }, 2000);
void tick();
