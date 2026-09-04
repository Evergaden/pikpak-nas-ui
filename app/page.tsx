'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, ChevronLeft, Cloud, Download, File, Folder, HardDrive, Loader2, RefreshCw, Settings2, ShieldCheck, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';

type RemoteItem = { Path: string; Name: string; Size: number; ModTime: string; IsDir: boolean };
type Job = { id: string; source: string; name: string; status: 'queued' | 'running' | 'done' | 'failed' | 'cancelled'; bytes: number; totalBytes: number; speed: number; error?: string };
type Status = { configured: boolean; destination: string; rcloneVersion: string; jobs: Job[] };

const formatBytes = (value: number) => {
  if (!value) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exponent = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  return `${(value / 1024 ** exponent).toFixed(exponent > 1 ? 1 : 0)} ${units[exponent]}`;
};

async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  if (!response.ok) throw new Error((await response.text()) || `请求失败：${response.status}`);
  return response.json() as Promise<T>;
}

export default function Home() {
  const [status, setStatus] = useState<Status | null>(null);
  const [items, setItems] = useState<RemoteItem[]>([]);
  const [path, setPath] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [showSettings, setShowSettings] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ url: 'https://dav.mypikpak.com', username: '', password: '' });

  const loadStatus = useCallback(async () => {
    try {
      const next = await api<Status>('/api/status');
      setStatus(next);
      if (!next.configured) setShowSettings(true);
    } catch {
      setStatus({ configured: false, destination: '/downloads', rcloneVersion: '等待容器连接', jobs: [] });
      setShowSettings(true);
    }
  }, []);

  const loadFiles = useCallback(async (nextPath: string) => {
    setLoading(true);
    setError('');
    try {
      const next = await api<{ items: RemoteItem[] }>(`/api/files?path=${encodeURIComponent(nextPath)}`);
      setItems(next.items);
      setPath(nextPath);
      setSelected([]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法读取 PikPak 文件');
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void Promise.resolve().then(loadStatus).finally(() => setLoading(false));
    const timer = window.setInterval(() => { void loadStatus(); }, 2000);
    return () => window.clearInterval(timer);
  }, [loadStatus]);

  useEffect(() => {
    if (status?.configured) void Promise.resolve().then(() => loadFiles(''));
  }, [status?.configured, loadFiles]);

  const activeJobs = useMemo(() => status?.jobs.filter((job) => job.status === 'running' || job.status === 'queued') ?? [], [status]);

  const saveConfig = async (event: { preventDefault: () => void }) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      await api('/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      setForm((current) => ({ ...current, password: '' }));
      setShowSettings(false);
      await loadStatus();
      await loadFiles('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const startDownloads = async () => {
    if (!selected.length) return;
    setError('');
    try {
      await api('/api/jobs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ paths: selected }) });
      setSelected([]);
      await loadStatus();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '创建下载任务失败');
    }
  };

  const cancelJob = async (id: string) => {
    await fetch(`/api/jobs/${encodeURIComponent(id)}`, { method: 'DELETE' });
    await loadStatus();
  };

  useEffect(() => {
    type ToolContext = { registerTool: (tool: unknown, options?: { signal?: AbortSignal }) => void | Promise<void> };
    const context = (document as Document & { modelContext?: ToolContext }).modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    void Promise.resolve(context.registerTool({
      name: 'queue_pikpak_download',
      title: '添加 PikPak 下载任务',
      description: '把一个或多个 PikPak 云盘路径加入 NAS 本地下载队列。',
      inputSchema: {
        type: 'object',
        properties: { paths: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 100 } },
        required: ['paths'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      async execute(input: unknown) {
        const paths = (input as { paths?: unknown })?.paths;
        if (!Array.isArray(paths) || !paths.length || paths.some((entry) => typeof entry !== 'string')) throw new Error('paths 必须是非空字符串数组');
        const result = await api<{ jobs: Job[] }>('/api/jobs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ paths }) });
        await loadStatus();
        return { queued: result.jobs.length, jobIds: result.jobs.map((job) => job.id) };
      },
    }, { signal: lifecycle.signal })).catch(() => undefined);
    return () => lifecycle.abort();
  }, [loadStatus]);

  const parentPath = path.split('/').slice(0, -1).join('/');

  return (
    <main className="min-h-screen bg-[#071014] text-[#e7f1f3]">
      <header className="border-b border-white/8 bg-[#09161b]/92 backdrop-blur">
        <div className="mx-auto flex max-w-[1500px] items-center justify-between px-4 py-4 sm:px-7">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-xl border border-cyan-300/20 bg-cyan-300/10 text-cyan-300"><Cloud className="h-5 w-5" /></div>
            <div><h1 className="text-base font-semibold tracking-tight">PikPak 落盘助手</h1><p className="text-xs text-slate-400">小米 NAS · 本地运行</p></div>
          </div>
          <div className="flex items-center gap-2">
            <Badge className="border-emerald-400/20 bg-emerald-400/10 text-emerald-300"><ShieldCheck className="mr-1 h-3.5 w-3.5" />仅局域网</Badge>
            <Button variant="ghost" size="icon" onClick={() => setShowSettings(true)} aria-label="连接设置"><Settings2 className="h-5 w-5" /></Button>
          </div>
        </div>
      </header>

      <section className="mx-auto grid max-w-[1500px] gap-5 px-4 py-5 sm:px-7 lg:grid-cols-[minmax(0,1fr)_390px]">
        <div className="min-w-0 space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <Metric icon={<Cloud />} label="PikPak" value={status?.configured ? '已连接' : '等待配置'} tone="cyan" />
            <Metric icon={<Download />} label="进行中" value={`${activeJobs.length} 个任务`} tone="orange" />
            <Metric icon={<HardDrive />} label="保存至" value={status?.destination ?? '/downloads'} tone="slate" />
          </div>

          <Card className="overflow-hidden border-white/8 bg-[#0c1a20] text-inherit shadow-2xl shadow-black/10">
            <div className="flex min-h-16 flex-wrap items-center justify-between gap-3 border-b border-white/8 px-4 py-3">
              <div className="flex min-w-0 items-center gap-2">
                <Button variant="ghost" size="icon" disabled={!path} onClick={() => loadFiles(parentPath)} aria-label="返回上一级"><ChevronLeft className="h-5 w-5" /></Button>
                <div className="min-w-0"><p className="text-xs text-slate-500">云盘路径</p><p className="truncate text-sm font-medium">PikPak / {path || '全部文件'}</p></div>
              </div>
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={() => loadFiles(path)} disabled={!status?.configured}><RefreshCw className="mr-2 h-4 w-4" />刷新</Button>
                <Button size="sm" onClick={startDownloads} disabled={!selected.length} className="bg-[#ff6b35] text-white hover:bg-[#ff7d50]"><Download className="mr-2 h-4 w-4" />下载所选 {selected.length ? `(${selected.length})` : ''}</Button>
              </div>
            </div>

            <div className="min-h-[520px]">
              {!status?.configured ? <EmptyState title="连接你的 PikPak" body="填写官方 WebDAV 凭据后，即可浏览并下载到 NAS。" action={() => setShowSettings(true)} />
                : loading ? <div className="grid min-h-[420px] place-items-center text-slate-400"><Loader2 className="h-6 w-6 animate-spin" /></div>
                : error && !items.length ? <EmptyState title="暂时无法读取文件" body={error} action={() => loadFiles(path)} actionLabel="重试" />
                : !items.length ? <EmptyState title="这个文件夹是空的" body="返回上一级，或者刷新后再试。" />
                : <div className="divide-y divide-white/[0.06]">{items.map((item) => {
                    const remotePath = path ? `${path}/${item.Name}` : item.Name;
                    const checked = selected.includes(remotePath);
                    return <div key={item.Path || remotePath} className="group grid grid-cols-[38px_minmax(0,1fr)_100px] items-center gap-3 px-4 py-3 hover:bg-white/[0.035] sm:grid-cols-[38px_minmax(0,1fr)_110px_150px]">
                      <input aria-label={`选择 ${item.Name}`} type="checkbox" checked={checked} onChange={() => setSelected((current) => checked ? current.filter((entry) => entry !== remotePath) : [...current, remotePath])} className="h-4 w-4 accent-[#ff6b35]" />
                      <button className="flex min-w-0 items-center gap-3 text-left" onClick={() => item.IsDir && loadFiles(remotePath)}>
                        <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${item.IsDir ? 'bg-cyan-300/10 text-cyan-300' : 'bg-white/5 text-slate-400'}`}>{item.IsDir ? <Folder className="h-[18px] w-[18px]" /> : <File className="h-[18px] w-[18px]" />}</span>
                        <span className="truncate text-sm font-medium">{item.Name}</span>
                      </button>
                      <span className="text-right text-xs text-slate-400">{item.IsDir ? '文件夹' : formatBytes(item.Size)}</span>
                      <span className="hidden text-right text-xs text-slate-500 sm:block">{item.ModTime ? new Date(item.ModTime).toLocaleString('zh-CN') : '—'}</span>
                    </div>;
                  })}</div>}
            </div>
          </Card>
        </div>

        <aside className="space-y-4">
          <Card className="border-white/8 bg-[#0c1a20] p-4 text-inherit">
            <div className="mb-4 flex items-center justify-between"><div><h2 className="font-semibold">下载队列</h2><p className="text-xs text-slate-500">最多同时下载 2 个任务</p></div><Badge variant="outline" className="border-white/10 text-slate-400">{status?.jobs.length ?? 0}</Badge></div>
            <div className="space-y-3">
              {!status?.jobs.length ? <div className="rounded-xl border border-dashed border-white/10 px-4 py-12 text-center"><Download className="mx-auto mb-3 h-6 w-6 text-slate-600" /><p className="text-sm text-slate-400">还没有下载任务</p></div>
                : status.jobs.map((job) => {
                    const percent = job.totalBytes ? Math.min(100, (job.bytes / job.totalBytes) * 100) : job.status === 'done' ? 100 : 0;
                    return <div key={job.id} className="rounded-xl border border-white/[0.07] bg-black/10 p-3.5">
                      <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate text-sm font-medium">{job.name}</p><p className="mt-1 text-xs text-slate-500">{job.status === 'running' ? `${formatBytes(job.speed)}/s` : job.status}</p></div>{job.status === 'running' || job.status === 'queued' ? <Button variant="ghost" size="icon-sm" onClick={() => cancelJob(job.id)} aria-label="取消任务"><X className="h-4 w-4" /></Button> : job.status === 'done' ? <CheckCircle2 className="h-4 w-4 text-emerald-400" /> : null}</div>
                      <Progress value={percent} className="mt-3 h-1.5 bg-white/5 [&_[data-slot=progress-indicator]]:bg-[#ff6b35]" />
                      <div className="mt-2 flex justify-between text-[11px] text-slate-500"><span>{formatBytes(job.bytes)}</span><span>{percent.toFixed(0)}%</span></div>
                      {job.error ? <p className="mt-2 text-xs text-red-300">{job.error}</p> : null}
                    </div>;
                  })}
            </div>
          </Card>
          <p className="px-1 text-xs leading-5 text-slate-500">rclone {status?.rcloneVersion} · 凭据只保存在 NAS 的配置卷内。</p>
        </aside>
      </section>

      {showSettings ? <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4 backdrop-blur-sm">
        <Card className="w-full max-w-md border-white/10 bg-[#102128] p-5 text-inherit shadow-2xl">
          <div className="mb-5 flex items-start justify-between gap-4"><div><h2 className="text-lg font-semibold">连接 PikPak</h2><p className="mt-1 text-sm text-slate-400">使用 PikPak 专用 WebDAV 凭据，不是主账号密码。</p></div>{status?.configured ? <Button variant="ghost" size="icon-sm" onClick={() => setShowSettings(false)}><X className="h-4 w-4" /></Button> : null}</div>
          <form className="space-y-4" onSubmit={saveConfig}>
            <div className="space-y-2"><Label htmlFor="url">WebDAV 地址</Label><Input id="url" value={form.url} onChange={(event) => setForm({ ...form, url: event.target.value })} required className="border-white/10 bg-black/20" /></div>
            <div className="space-y-2"><Label htmlFor="username">WebDAV 用户名</Label><Input id="username" value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} required autoComplete="username" className="border-white/10 bg-black/20" /></div>
            <div className="space-y-2"><Label htmlFor="password">WebDAV 密码</Label><Input id="password" type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} required autoComplete="current-password" className="border-white/10 bg-black/20" /></div>
            {error ? <p className="rounded-lg bg-red-400/10 px-3 py-2 text-sm text-red-300">{error}</p> : null}
            <Button type="submit" disabled={saving} className="w-full bg-[#ff6b35] text-white hover:bg-[#ff7d50]">{saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}保存并测试连接</Button>
          </form>
        </Card>
      </div> : null}
    </main>
  );
}

function Metric({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: string; tone: 'cyan' | 'orange' | 'slate' }) {
  const tones = { cyan: 'bg-cyan-300/10 text-cyan-300', orange: 'bg-orange-400/10 text-orange-300', slate: 'bg-white/5 text-slate-400' };
  return <Card className="flex items-center gap-3 border-white/8 bg-[#0c1a20] p-4 text-inherit"><span className={`grid h-9 w-9 place-items-center rounded-lg [&>svg]:h-4 [&>svg]:w-4 ${tones[tone]}`}>{icon}</span><span className="min-w-0"><span className="block text-xs text-slate-500">{label}</span><span className="block truncate text-sm font-semibold">{value}</span></span></Card>;
}

function EmptyState({ title, body, action, actionLabel = '开始配置' }: { title: string; body: string; action?: () => void; actionLabel?: string }) {
  return <div className="grid min-h-[460px] place-items-center px-5 text-center"><div><div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-2xl bg-cyan-300/10 text-cyan-300"><Cloud className="h-6 w-6" /></div><h3 className="font-semibold">{title}</h3><p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-slate-400">{body}</p>{action ? <Button onClick={action} className="mt-5 bg-[#ff6b35] text-white hover:bg-[#ff7d50]">{actionLabel}</Button> : null}</div></div>;
}
