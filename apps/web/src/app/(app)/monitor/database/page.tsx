'use client';
import { useEffect, useState, useCallback, useRef } from 'react';
import PageHeader from '@/components/PageHeader';
import { Card, Button, Empty, Badge } from '@/components/ui';
import { api } from '@/lib/api';
import { RefreshCw } from 'lucide-react';

type DbInfo = {
  maxConnections: number | null;
  totalConnections: number;
  stateBreakdown: Array<{ state: string; n: number }>;
  activities: Array<{
    pid: number;
    usename: string;
    application_name: string;
    client_addr: string | null;
    state: string;
    query: string | null;
    seconds: number | null;
  }>;
};

const STATE_TONE: Record<string, 'green' | 'blue' | 'amber' | 'red' | 'slate'> = {
  active: 'green',
  idle: 'slate',
  'idle in transaction': 'amber',
};

function formatDuration(seconds: number | null): string {
  if (seconds === null) return '—';
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m ${seconds % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

export default function DatabaseMonitorPage() {
  const [data, setData] = useState<DbInfo | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval>>();

  const load = useCallback(async () => {
    const { data: res } = await api.get('/monitor/database');
    setData(res);
  }, []);

  useEffect(() => {
    load();
    timerRef.current = setInterval(load, 5000);
    return () => clearInterval(timerRef.current);
  }, [load]);

  if (!data) return <div className="text-sm text-slate-500">加载中...</div>;

  const usagePercent = data.maxConnections
    ? Math.round((data.totalConnections / data.maxConnections) * 1000) / 10
    : 0;

  return (
    <div>
      <PageHeader title="数据库会话" description="PostgreSQL 连接池使用情况与活动会话（5 秒刷新）">
        <Button variant="secondary" onClick={load}>
          <RefreshCw className="w-4 h-4 mr-1.5" />刷新
        </Button>
      </PageHeader>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
        <Card className="p-5 lg:col-span-2">
          <div className="flex items-baseline justify-between mb-2">
            <span className="text-xs font-medium text-slate-500">连接数 / 上限</span>
            <span className="text-lg font-semibold text-slate-900">
              {data.totalConnections} / {data.maxConnections ?? '—'}
            </span>
          </div>
          <div className="w-full h-2 rounded-full bg-slate-100 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-700 ${usagePercent >= 90 ? 'bg-red-500' : usagePercent >= 75 ? 'bg-amber-500' : 'bg-blue-500'}`}
              style={{ width: `${Math.min(usagePercent, 100)}%` }}
            />
          </div>
          <div className="mt-2 text-[11px] text-slate-400">{usagePercent}% 已用</div>
        </Card>

        <Card className="p-5">
          <h3 className="text-xs font-medium text-slate-500 mb-3">状态分布</h3>
          <div className="flex flex-wrap gap-2">
            {data.stateBreakdown.map((s) => (
              <span key={s.state} className="inline-flex items-center gap-1.5">
                <Badge tone={STATE_TONE[s.state] ?? 'blue'}>{s.state}</Badge>
                <span className="text-sm font-semibold text-slate-700">{s.n}</span>
              </span>
            ))}
          </div>
        </Card>
      </div>

      <Card className="overflow-hidden">
        {!data.activities.length ? (
          <div className="p-4"><Empty text="没有其他活动会话" /></div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="bg-slate-50 text-left text-xs text-slate-500">
                <th className="py-2 px-4 font-medium w-20">PID</th>
                <th className="py-2 px-4 font-medium w-32">用户</th>
                <th className="py-2 px-4 font-medium w-36">应用 / 来源</th>
                <th className="py-2 px-4 font-medium w-28">状态</th>
                <th className="py-2 px-4 font-medium w-24">持续</th>
                <th className="py-2 px-4 font-medium">查询</th>
              </tr>
            </thead>
            <tbody>
              {data.activities.map((a) => (
                <tr key={a.pid} className="border-b border-slate-100 last:border-0 hover:bg-slate-50 align-top">
                  <td className="py-2.5 px-4 text-xs font-mono text-slate-600">{a.pid}</td>
                  <td className="py-2.5 px-4 text-xs text-slate-700">{a.usename}</td>
                  <td className="py-2.5 px-4">
                    <div className="text-xs text-slate-700">{a.application_name || '-'}</div>
                    <div className="text-[11px] text-slate-400 font-mono">{a.client_addr ?? '本地'}</div>
                  </td>
                  <td className="py-2.5 px-4">
                    <Badge tone={STATE_TONE[a.state] ?? 'blue'}>{a.state}</Badge>
                  </td>
                  <td className="py-2.5 px-4 text-xs text-slate-500 whitespace-nowrap">{formatDuration(a.seconds)}</td>
                  <td className="py-2.5 px-4">
                    {a.query ? (
                      <code className="text-[11px] text-slate-600 font-mono whitespace-pre-wrap break-all">{a.query}</code>
                    ) : (
                      <span className="text-xs text-slate-300">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
