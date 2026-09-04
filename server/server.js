import http from 'node:http';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile, rename, stat, unlink } from 'node:fs/promises';
import { createReadStream, existsSync } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const exec = promisify(execFile);
const port = Number(process.env.PORT || 8080);
const configDir = process.env.CONFIG_DIR || '/config';
const downloadDir = process.env.DOWNLOAD_DIR || '/downloads';
const configFile = path.join(configDir, 'rclone.conf');
const webDir = process.env.WEB_DIR || fileURLToPath(new URL('./web/', import.meta.url));
const appPassword = process.env.APP_PASSWORD || '';
const appUser = process.env.APP_USER || 'admin';
const maxConcurrent = Math.max(1, Math.min(4, Number(process.env.MAX_CONCURRENT || 2)));
const downloadUid = Number(process.env.DOWNLOAD_UID || -1);
const downloadGid = Number(process.env.DOWNLOAD_GID || -1);
const jobs = new Map();
const queue = [];
let running = 0;

await mkdir(configDir, { recursive: true });
await mkdir(downloadDir, { recursive: true });
if (!appPassword) {
  console.error('APP_PASSWORD is required');
  process.exit(1);
}

const send = (res, status, body, type = 'application/json; charset=utf-8') => {
  const payload = type.startsWith('application/json') ? JSON.stringify(body) : body;
  res.writeHead(status, { 'Content-Type': type, 'Content-Length': Buffer.byteLength(payload), 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY' });
  res.end(payload);
};

const readJson = async (req) => {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1024 * 1024) throw new Error('请求内容过大');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
};

const safeEqual = (a, b) => {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
};

const authorized = (req) => {
  const value = req.headers.authorization || '';
  if (!value.startsWith('Basic ')) return false;
  const [user = '', password = ''] = Buffer.from(value.slice(6), 'base64').toString().split(':');
  return safeEqual(user, appUser) && safeEqual(password, appPassword);
};

const runRclone = async (args, options = {}) => exec('rclone', ['--config', configFile, ...args], { timeout: 120000, maxBuffer: 16 * 1024 * 1024, ...options });

const obscurePassword = (password) => new Promise((resolve, reject) => {
  const child = spawn('rclone', ['obscure', '-'], { stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.on('error', reject);
  child.on('close', (code) => code === 0 ? resolve(stdout.trim()) : reject(new Error(stderr.trim() || `rclone 退出码 ${code}`)));
  child.stdin.end(String(password));
});

const cleanRemote = (value = '') => {
  const cleaned = String(value).replaceAll('\\', '/').replace(/^\/+|\/+$/g, '');
  if (cleaned.includes('\0') || cleaned.split('/').includes('..') || cleaned.startsWith('-')) throw new Error('无效的云盘路径');
  return cleaned;
};

const remote = (value = '') => `pikpak:${cleanRemote(value) ? `/${cleanRemote(value)}` : ''}`;

const publicJob = (job) => ({ id: job.id, source: job.source, name: job.name, status: job.status, bytes: job.bytes, totalBytes: job.totalBytes, speed: job.speed, error: job.error || '' });

const configure = async ({ url, username, password }) => {
  const parsed = new URL(String(url));
  if (parsed.protocol !== 'https:') throw new Error('WebDAV 地址必须使用 HTTPS');
  if (!username || !password || /[\r\n]/.test(username)) throw new Error('请填写有效的用户名和密码');
  const obscured = await obscurePassword(password);
  const content = `[pikpak]\ntype = webdav\nurl = ${parsed.toString()}\nvendor = other\nuser = ${username}\npass = ${obscured}\n`;
  const temp = `${configFile}.tmp`;
  await writeFile(temp, content, { mode: 0o600 });
  try {
    await exec('rclone', ['--config', temp, 'lsd', 'pikpak:', '--max-depth', '1'], { timeout: 120000, maxBuffer: 16 * 1024 * 1024 });
  } catch (error) {
    await unlink(temp).catch(() => undefined);
    throw new Error(`连接测试失败：${error.stderr?.trim() || error.message}`);
  }
  await rename(temp, configFile);
};

const queueJob = async (source) => {
  source = cleanRemote(source);
  if (!source) throw new Error('不能下载云盘根目录');
  const id = `${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
  const job = { id, source, name: path.posix.basename(source), status: 'queued', bytes: 0, totalBytes: 0, speed: 0, error: '', process: null };
  jobs.set(id, job);
  queue.push(job);
  pump();
  return publicJob(job);
};

const updateStats = (job, line) => {
  try {
    const value = JSON.parse(line);
    const stats = value.stats || value;
    if (Number.isFinite(stats.bytes)) job.bytes = stats.bytes;
    if (Number.isFinite(stats.totalBytes)) job.totalBytes = stats.totalBytes;
    if (Number.isFinite(stats.speed)) job.speed = stats.speed;
  } catch { /* rclone also emits non-JSON lines */ }
};

const chownTree = async (target) => {
  if (downloadUid < 0 || downloadGid < 0) return;
  await new Promise((resolve) => {
    const child = spawn('chown', ['-R', `${downloadUid}:${downloadGid}`, target]);
    child.on('close', resolve);
    child.on('error', resolve);
  });
};

const startJob = async (job) => {
  running += 1;
  job.status = 'running';
  const target = path.join(downloadDir, job.name);
  let isDir = true;
  try {
    const { stdout } = await runRclone(['lsjson', remote(job.source), '--stat']);
    isDir = Boolean(JSON.parse(stdout).IsDir);
  } catch { /* copy will report the real error */ }
  const args = ['--config', configFile, isDir ? 'copy' : 'copyto', remote(job.source), target, '--stats', '1s', '--stats-one-line-json', '--use-json-log', '--transfers', '2', '--checkers', '4', '--retries', '5'];
  const child = spawn('rclone', args);
  job.process = child;
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  for (const stream of [child.stdout, child.stderr]) {
    let pending = '';
    stream.on('data', (chunk) => {
      stderr = `${stderr}${chunk}`.slice(-4000);
      pending += chunk;
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() || '';
      lines.forEach((line) => updateStats(job, line));
    });
  }
  child.on('error', (error) => { job.error = error.message; });
  child.on('close', async (code, signal) => {
    job.process = null;
    if (job.status === 'cancelled' || signal) job.status = 'cancelled';
    else if (code === 0) {
      job.status = 'done';
      if (job.totalBytes && !job.bytes) job.bytes = job.totalBytes;
      await chownTree(target);
    } else {
      job.status = 'failed';
      job.error = job.error || stderr.trim().split(/\r?\n/).slice(-2).join(' ') || `rclone 退出码 ${code}`;
    }
    running -= 1;
    pump();
  });
};

function pump() {
  while (running < maxConcurrent && queue.length) void startJob(queue.shift());
}

const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json; charset=utf-8', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };

const serveStatic = async (req, res, pathname) => {
  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  let target = path.resolve(webDir, relative);
  if (!target.startsWith(path.resolve(webDir))) return send(res, 403, 'Forbidden', 'text/plain');
  if (!existsSync(target)) target = path.join(webDir, 'index.html');
  try {
    const info = await stat(target);
    if (info.isDirectory()) target = path.join(target, 'index.html');
    res.writeHead(200, { 'Content-Type': mime[path.extname(target)] || 'application/octet-stream', 'Cache-Control': target.endsWith('index.html') ? 'no-cache' : 'public, max-age=31536000, immutable', 'X-Frame-Options': 'DENY' });
    createReadStream(target).pipe(res);
  } catch { send(res, 404, 'Not found', 'text/plain'); }
};

const server = http.createServer(async (req, res) => {
  try {
    if (req.url === '/healthz') return send(res, 200, { ok: true });
    if (!authorized(req)) {
      res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="PikPak NAS"', 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('需要登录');
    }
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (url.pathname === '/api/status' && req.method === 'GET') {
      let version = '不可用';
      try { version = (await exec('rclone', ['version'], { timeout: 5000 })).stdout.split('\n')[0].replace('rclone ', ''); } catch {}
      return send(res, 200, { configured: existsSync(configFile), destination: downloadDir, rcloneVersion: version, jobs: [...jobs.values()].slice(-50).reverse().map(publicJob) });
    }
    if (url.pathname === '/api/config' && req.method === 'POST') {
      await configure(await readJson(req));
      return send(res, 200, { ok: true });
    }
    if (url.pathname === '/api/files' && req.method === 'GET') {
      if (!existsSync(configFile)) return send(res, 409, '请先配置 PikPak', 'text/plain; charset=utf-8');
      const { stdout } = await runRclone(['lsjson', remote(url.searchParams.get('path') || ''), '--max-depth', '1']);
      const items = JSON.parse(stdout).sort((a, b) => Number(b.IsDir) - Number(a.IsDir) || a.Name.localeCompare(b.Name, 'zh-CN'));
      return send(res, 200, { items });
    }
    if (url.pathname === '/api/jobs' && req.method === 'POST') {
      const { paths } = await readJson(req);
      if (!Array.isArray(paths) || !paths.length || paths.length > 100) return send(res, 400, '请选择 1–100 个项目', 'text/plain; charset=utf-8');
      const created = await Promise.all(paths.map(queueJob));
      return send(res, 201, { jobs: created });
    }
    if (url.pathname.startsWith('/api/jobs/') && req.method === 'DELETE') {
      const id = decodeURIComponent(url.pathname.slice('/api/jobs/'.length));
      const job = jobs.get(id);
      if (!job) return send(res, 404, '任务不存在', 'text/plain; charset=utf-8');
      if (job.status === 'queued') {
        const index = queue.indexOf(job);
        if (index >= 0) queue.splice(index, 1);
        job.status = 'cancelled';
      } else if (job.status === 'running') {
        job.status = 'cancelled';
        job.process?.kill('SIGTERM');
      }
      return send(res, 200, { ok: true });
    }
    if (url.pathname.startsWith('/api/')) return send(res, 404, '接口不存在', 'text/plain; charset=utf-8');
    return serveStatic(req, res, url.pathname);
  } catch (error) {
    console.error(error);
    return send(res, 500, error.stderr?.trim() || error.message || '服务器错误', 'text/plain; charset=utf-8');
  }
});

server.listen(port, '0.0.0.0', () => console.log(`PikPak NAS UI listening on :${port}`));
