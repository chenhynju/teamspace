'use client';
import { useEffect, useState, useCallback } from 'react';
import PageHeader from '@/components/PageHeader';
import { Card, Button, Empty, Badge } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { Play } from 'lucide-react';

type JobRow = {
  name: string;
  running: boolean;
  nextExecution: string | null;
  lastExecution: string | null;
};

/** 仅这些任务允许在页面手动触发，与后端白名单一致 */
const FRIENDLY_NAMES: Record<string, string> = {
  BillingLifecycleService_scheduledRun: '订阅生命周期扫描',
  BillingLifecycleService_scheduledRun_1: '订阅生命周期扫描',
};

export default function JobsPage() {
  const hasPerm = useAuthStore((s) => s.hasPerm);
  const [jobs, setJobs] = useState<JobRow[] | null>(null);
  const [firing, setFiring] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data } = await api.get('/monitor/jobs');
    setJobs(data);
  }, []);

  useEffect(() => { load(); }, [load]);

  const run = async (name: string) => {
    setFiring(name);
    try {
      const { data } = await api.post(`/monitor/jobs/${encodeURIComponent(name)}/run`);
      if (data.code === 'NOT_ALLOWED') {
        alert('该任务不允许手动触发');
      }
      load();
    } finally {
      setFiring(null);
    }
  };

  return (
    <div>
      <PageHeader title="定时任务" description="应用内注册的 Cron 任务调度一览；仅支持执行白名单任务，不提供在线新增" />

      <Card className="overflow-hidden">
        {!jobs ? (
          <div className="p-4"><Empty text="加载中..." /></div>
        ) : !jobs.length ? (
          <div className="p-4"><Empty text="当前没有注册定时任务" /></div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="bg-slate-50 text-left text-xs text-slate-500">
                <th className="py-2 px-4 font-medium">任务</th>
                <th className="py-2 px-4 font-medium w-24">状态</th>
                <th className="py-2 px-4 font-medium w-52">下次执行</th>
                <th className="py-2 px-4 font-medium w-52">上次手动执行</th>
                <th className="py-2 px-4 font-medium text-right w-24">操作</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((j) => (
                <tr key={j.name} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                  <td className="py-2.5 px-4">
                    <div className="text-sm text-slate-800">{FRIENDLY_NAMES[j.name] ?? j.name}</div>
                    <code className="text-[11px] text-slate-400 font-mono">{j.name}</code>
                  </td>
                  <td className="py-2.5 px-4">
                    <Badge tone="green">运行中</Badge>
                  </td>
                  <td className="py-2.5 px-4 text-xs text-slate-500">
                    {j.nextExecution ? new Date(j.nextExecution).toLocaleString('zh-CN') : '—'}
                  </td>
                  <td className="py-2.5 px-4 text-xs text-slate-500">
                    {j.lastExecution ? new Date(j.lastExecution).toLocaleString('zh-CN') : '—'}
                  </td>
                  <td className="py-2.5 px-4 text-right">
                    {hasPerm('monitor:job:run') && (
                      <Button size="sm" variant="secondary" disabled={firing === j.name} onClick={() => run(j.name)}>
                        <Play className="w-3.5 h-3.5 mr-1" />
                        {firing === j.name ? '执行中' : '执行一次'}
                      </Button>
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
