'use client';
import { useEffect, useState, useCallback, useRef } from 'react';
import PageHeader from '@/components/PageHeader';
import { Card, Button, Empty } from '@/components/ui';
import { api } from '@/lib/api';
import { RefreshCw } from 'lucide-react';

type CacheInfo =
  | { enabled: false; reason: string }
  | {
      enabled: true;
      info: Record<string, string>;
      dbsize: number;
    };

export default function CacheMonitorPage() {
  const [data, setData] = useState<CacheInfo | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval>>();

  const load = useCallback(async () => {
    const { data: res } = await api.get('/monitor/cache');
    setData(res);
  }, []);

  useEffect(() => {
    load();
    timerRef.current = setInterval(load, 5000);
    return () => clearInterval(timerRef.current);
  }, [load]);

  return (
    <div>
      <PageHeader title="缓存监控" description="Redis 服务器状态、内存与命中率；未配置时系统自动以单节点模式运行">
        <Button variant="secondary" onClick={load}>
          <RefreshCw className="w-4 h-4 mr-1.5" />刷新
        </Button>
      </PageHeader>

      {!data ? (
        <div className="text-sm text-slate-500">加载中...</div>
      ) : !data.enabled ? (
        <Card className="p-6">
          <Empty text={data.reason} />
        </Card>
      ) : (
        <CacheDetails info={data.info} dbsize={data.dbsize} />
      )}
    </div>
  );
}

function CacheDetails({ info, dbsize }: { info: Record<string, string>; dbsize: number }) {
  const hits = Number(info.keyspace_hits ?? 0);
  const misses = Number(info.keyspace_misses ?? 0);
  const hitRate = hits + misses > 0 ? ((hits / (hits + misses)) * 100).toFixed(1) : '—';
  const uptimeSec = Number(info.uptime_in_seconds ?? 0);

  // keyspace 行：db0:keys=10,expires=2,avg_ttl=...
  const keyspace = Object.entries(info).filter(([k]) => k.startsWith('db'));

  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
        <Stat label="Redis 版本" value={info.redis_version ?? '-'} />
        <Stat label="运行模式" value={info.redis_mode ?? '-'} hint={info.os ?? ''} />
        <Stat label="已连接客户端" value={info.connected_clients ?? '-'} />
        <Stat label="键总数" value={String(dbsize)} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="p-5">
          <h3 className="text-sm font-semibold text-slate-800 mb-3">内存</h3>
          <dl className="space-y-2 text-sm">
            <Row k="已用内存" v={formatBytes(Number(info.used_memory ?? 0))} />
            <Row k="内存峰值" v={formatBytes(Number(info.used_memory_peak ?? 0))} />
            <Row k="系统视角占用" v={formatBytes(Number(info.used_memory_rss ?? 0))} />
            <Row k="最大内存限制" v={info.maxmemory && info.maxmemory !== '0' ? formatBytes(Number(info.maxmemory)) : '未限制'} />
            <Row k="淘汰策略" v={info.maxmemory_policy ?? '-'} />
          </dl>
        </Card>

        <Card className="p-5">
          <h3 className="text-sm font-semibold text-slate-800 mb-3">统计</h3>
          <dl className="space-y-2 text-sm">
            <Row k="缓存命中率" v={hitRate === '—' ? '—' : `${hitRate}%`} />
            <Row k="命中 / 未命中" v={`${hits} / ${misses}`} />
            <Row k="运行时长" v={formatUptime(uptimeSec)} />
            <Row k="过期键（累计）" v={info.expired_keys ?? '-'} />
            <Row k="淘汰键（累计）" v={info.evicted_keys ?? '-'} />
          </dl>
        </Card>
      </div>

      {keyspace.length > 0 && (
        <Card className="p-5 mt-4">
          <h3 className="text-sm font-semibold text-slate-800 mb-3">键空间 (Keyspace)</h3>
          <div className="flex flex-wrap gap-2">
            {keyspace.map(([db, detail]) => (
              <div key={db} className="rounded-lg border border-slate-200 px-3 py-2">
                <div className="text-xs font-semibold text-slate-700">{db}</div>
                <code className="text-[11px] text-slate-500">{detail}</code>
              </div>
            ))}
          </div>
        </Card>
      )}
    </>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card className="p-5">
      <div className="text-2xl font-semibold text-slate-900">{value}</div>
      <div className="text-xs text-slate-500 mt-1">{label}</div>
      {hint && <div className="text-[11px] text-slate-400 mt-0.5 truncate">{hint}</div>}
    </Card>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-slate-500 whitespace-nowrap">{k}</dt>
      <dd className="text-slate-800 font-mono text-xs">{v}</dd>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (!bytes) return '0 B';
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
