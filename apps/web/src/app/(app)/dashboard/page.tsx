'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import PageHeader from '@/components/PageHeader';
import { Card, Badge } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';

const STATUS_TONE: Record<string, any> = {
  DRAFT: 'slate',
  ACTIVE: 'blue',
  DELIVERED: 'green',
  ARCHIVED: 'amber',
};

const STATUS_LABEL: Record<string, string> = {
  DRAFT: '草稿',
  ACTIVE: '进行中',
  DELIVERED: '已交付',
  ARCHIVED: '已归档',
};

export default function DashboardPage() {
  const user = useAuthStore((s) => s.user);
  const [org, setOrg] = useState<any>(null);
  const [projects, setProjects] = useState<any[]>([]);

  useEffect(() => {
    Promise.all([
      api.get('/organizations/current'),
      api.get('/projects').catch(() => ({ data: [] })),
    ]).then(([o, p]) => {
      setOrg(o.data);
      setProjects(p.data);
    });
  }, []);

  const aiTotal = org?.entitlement?.aiCreditsTotal ?? 0;
  const aiUsed = org?.entitlement?.aiCreditsUsed ?? 0;
  const aiPct = aiTotal ? Math.round((aiUsed / aiTotal) * 100) : 0;

  const stats = [
    { label: '进行中项目', value: projects.filter((p) => p.status === 'ACTIVE').length },
    { label: '组织成员', value: org?._count?.memberships ?? 0 },
    { label: '工作区', value: org?._count?.workspaces ?? 0 },
    { label: '已交付项目', value: projects.filter((p) => p.status === 'DELIVERED').length },
  ];

  return (
    <div className="p-6">
      <PageHeader
        title={`你好，${user?.name ?? ''}`}
        description={`${org?.name ?? ''} · 当前套餐 ${org?.plan?.name ?? '-'}`}
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {stats.map((s) => (
          <Card key={s.label} className="p-4">
            <div className="text-2xl font-semibold text-slate-800">{s.value}</div>
            <div className="text-xs text-slate-500 mt-1">{s.label}</div>
          </Card>
        ))}
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <Card className="p-5 lg:col-span-2">
          <h2 className="text-sm font-semibold text-slate-700 mb-4">最近项目</h2>
          {projects.length === 0 ? (
            <p className="text-sm text-slate-400">暂无项目</p>
          ) : (
            <div className="divide-y divide-slate-100">
              {projects.slice(0, 6).map((p) => (
                <Link
                  key={p.id}
                  href={`/projects/${p.id}`}
                  className="flex items-center justify-between py-2.5 hover:bg-slate-50 -mx-2 px-2 rounded"
                >
                  <span className="text-sm text-slate-700">{p.name}</span>
                  <Badge tone={STATUS_TONE[p.status]}>{STATUS_LABEL[p.status]}</Badge>
                </Link>
              ))}
            </div>
          )}
        </Card>

        <Card className="p-5">
          <h2 className="text-sm font-semibold text-slate-700 mb-4">AI 助手额度</h2>
          <div className="text-xs text-slate-500 mb-2">
            已用 {aiUsed.toLocaleString()} / {aiTotal.toLocaleString()} tokens（{aiPct}%）
          </div>
          <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
            <div className="h-full bg-blue-500" style={{ width: `${Math.min(aiPct, 100)}%` }} />
          </div>
          <div className="mt-4 space-y-1 text-xs text-slate-500">
            <div>项目上限：{org?.entitlement?.maxProjects ?? '-'}</div>
            <div>存储空间：{org?.entitlement?.storageGb ?? '-'} GB</div>
          </div>
        </Card>
      </div>
    </div>
  );
}
