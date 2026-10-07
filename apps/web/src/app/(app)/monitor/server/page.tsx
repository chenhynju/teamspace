'use client';
import { useEffect, useState, useCallback, useRef } from 'react';
import PageHeader from '@/components/PageHeader';
import { Card, Button } from '@/components/ui';
import { api } from '@/lib/api';
import { RefreshCw } from 'lucide-react';

type ServerInfo = {
  host: {
    hostname: string;
    platform: string;
    arch: string;
    osUptimeSeconds: number;
    loadAverage: number[];
  };
  cpu: { model: string; cores: number; usedPercent: number };
  memory: { total: number; free: number; usedPercent: number };
  disk: { path: string; total: number; free: number; usedPercent: number } | null;
  node: {
    version: string;
    pid: number;
    uptimeSeconds: number;
    rss: number;
    heapTotal: number;
    heapUsed: number;
    external: number;
    arrayBuffers: number;
    heapUsedPercent: number;
    eventLoopDelayMs: { mean: number; max: number; p99: number };
  };
};

function formatBytes(bytes: number): string {
  if (!bytes || bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let i = -1;
  do {
    value /= 1024;
    i += 1;
  } while (value >= 1024 && i < units.length - 1);
  return `${value.toFixed(1)} ${units[i]}`;
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d) return `${d}天 ${h}小时`;
  if (h) return `${h}小时 ${m}分`;
  return `${m}分钟`;
}

function Meter({ percent, tone = 'blue' }: { percent: number; tone?: 'blue' | 'amber' | 'red' }) {
  const color = percent >= 90 ? 'bg-red-500' : percent >= 75 ? 'bg-amber-500' : tone === 'blue' ? 'bg-blue-500' : 'bg-emerald-500';
  return (
    <div className="w-full h-2 rounded-full bg-slate-100 overflow-hidden">
      <div className={`h-full rounded-full transition-all duration-700 ${color}`} style={{ width: `${Math.min(percent, 100)}%` }} />
    </div>
  );
}

function MetricCard({
  label, value, sub, percent,
}: {
  label: string; value: string; sub?: string; percent: number;
}) {
  return (
    <Card className="p-5">
      <div className="flex items-baseline justify-between mb-2">
        <span className="text-xs font-medium text-slate-500">{label}</span>
        <span className="text-lg font-semibold text-slate-900">{value}</span>
      </div>
      <Meter percent={percent} />
      {sub && <div className="mt-2 text-[11px] text-slate-400">{sub}</div>}
    </Card>
  );
}

export default function ServerMonitorPage() {
  const [data, setData] = useState<ServerInfo | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval>>();

  const load = useCallback(async () => {
    const { data: res } = await api.get('/monitor/server');
    setData(res);
  }, []);

  useEffect(() => {
    load();
    timerRef.current = setInterval(load, 5000);
    return () => clearInterval(timerRef.current);
  }, [load]);

  if (!data) return <div className="text-sm text-slate-500">加载中...</div>;

  return (
    <div>
      <PageHeader title="服务监控" description="宿主机与 Node 运行时的实时资源指标（5 秒刷新）">
        <Button variant="secondary" onClick={load}>
          <RefreshCw className="w-4 h-4 mr-1.5" />刷新
        </Button>
      </PageHeader>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
        <MetricCard
          label="CPU 使用率"
          value={`${data.cpu.usedPercent}%`}
          sub={`${data.cpu.cores} 核 · ${data.cpu.model}`}
          percent={data.cpu.usedPercent}
        />
        <MetricCard
          label="内存使用率"
          value={`${data.memory.usedPercent}%`}
          sub={`${formatBytes(data.memory.total - data.memory.free)} / ${formatBytes(data.memory.total)}`}
          percent={data.memory.usedPercent}
        />
        {data.disk && (
          <MetricCard
            label="磁盘使用率"
            value={`${data.disk.usedPercent}%`}
            sub={`${formatBytes(data.disk.total - data.disk.free)} / ${formatBytes(data.disk.total)}`}
            percent={data.disk.usedPercent}
          />
        )}
        <MetricCard
          label="Node 堆内存"
          value={`${data.node.heapUsedPercent}%`}
          sub={`${formatBytes(data.node.heapUsed)} / ${formatBytes(data.node.heapTotal)}`}
          percent={data.node.heapUsedPercent}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="p-5">
          <h3 className="text-sm font-semibold text-slate-800 mb-3">主机信息</h3>
          <dl className="space-y-2 text-sm">
            <InfoRow k="主机名" v={data.host.hostname} />
            <InfoRow k="系统" v={`${data.host.platform} (${data.host.arch})`} />
            <InfoRow k="系统运行时长" v={formatUptime(data.host.osUptimeSeconds)} />
            <InfoRow k="平均负载" v={data.host.loadAverage.map((n) => n.toFixed(2)).join(' · ') || 'N/A (Windows)'} />
          </dl>
        </Card>

        <Card className="p-5">
          <h3 className="text-sm font-semibold text-slate-800 mb-3">Node.js 运行时</h3>
          <dl className="space-y-2 text-sm">
            <InfoRow k="版本 / PID" v={`${data.node.version} · ${data.node.pid}`} />
            <InfoRow k="进程运行时长" v={formatUptime(data.node.uptimeSeconds)} />
            <InfoRow k="RSS 常驻内存" v={formatBytes(data.node.rss)} />
            <InfoRow k="External / ArrayBuffers" v={`${formatBytes(data.node.external)} / ${formatBytes(data.node.arrayBuffers)}`} />
            <InfoRow
              k="事件循环延迟 (mean/p99/max)"
              v={`${data.node.eventLoopDelayMs.mean} / ${data.node.eventLoopDelayMs.p99} / ${data.node.eventLoopDelayMs.max} ms`}
            />
          </dl>
        </Card>
      </div>
    </div>
  );
}

function InfoRow({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-slate-500 whitespace-nowrap">{k}</dt>
      <dd className="text-slate-800 text-right font-mono text-xs truncate">{v}</dd>
    </div>
  );
}
