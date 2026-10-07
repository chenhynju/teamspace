'use client';
import { Fragment, useEffect, useState, useCallback } from 'react';
import PageHeader from '@/components/PageHeader';
import { Card, Button, Badge, Select } from '@/components/ui';
import { api } from '@/lib/api';

const RESOURCE_TYPES = [
  'Workspace',
  'Membership',
  'Project',
  'File',
  'FileShare',
  'Invitation',
  'Plan',
  'Organization',
];

const BT_LABEL: Record<number, string> = {
  0: '其它',
  1: '新增',
  2: '修改',
  3: '删除',
  4: '授权',
  5: '状态',
};
const BT_TONE: Record<number, any> = {
  0: 'slate',
  1: 'green',
  2: 'blue',
  3: 'red',
  4: 'violet',
  5: 'amber',
};

export default function AuditPage() {
  const [data, setData] = useState<{ total: number; items: any[] }>({ total: 0, items: [] });
  const [resourceType, setResourceType] = useState('');
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<string | null>(null);

  const pageSize = 20;

  const refresh = useCallback(async () => {
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (resourceType) params.set('resourceType', resourceType);
    const { data } = await api.get(`/audit?${params.toString()}`);
    setData(data);
  }, [page, resourceType]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <div className="p-6">
      <PageHeader title="审计日志" description="记录操作人、资源、前后差异与 trace_id，敏感字段已脱敏" />

      <div className="flex gap-3 mb-4">
        <Select value={resourceType} onChange={(e) => { setResourceType(e.target.value); setPage(1); }} className="w-48">
          <option value="">全部资源类型</option>
          {RESOURCE_TYPES.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </Select>
      </div>

      <Card>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-slate-500 border-b border-slate-100">
              <th className="px-4 py-3 font-medium">时间</th>
              <th className="px-4 py-3 font-medium">操作人</th>
              <th className="px-4 py-3 font-medium">类型</th>
              <th className="px-4 py-3 font-medium">动作</th>
              <th className="px-4 py-3 font-medium">资源</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {data.items.map((log) => (
              <Fragment key={log.id}>
                <tr className="border-b border-slate-50 hover:bg-slate-50">
                  <td className="px-4 py-3 text-slate-500 text-xs whitespace-nowrap">
                    {new Date(log.createdAt).toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-slate-700">{log.actor?.name ?? '-'}</td>
                  <td className="px-4 py-3">
                    <Badge tone={BT_TONE[log.businessType]}>{BT_LABEL[log.businessType]}</Badge>
                  </td>
                  <td className="px-4 py-3 text-slate-600 text-xs">{log.action}</td>
                  <td className="px-4 py-3 text-slate-500 text-xs">
                    {log.resourceType}
                    {log.resourceId ? ` : ${log.resourceId.slice(-6)}` : ''}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setExpanded(expanded === log.id ? null : log.id)}
                    >
                      详情
                    </Button>
                  </td>
                </tr>
                {expanded === log.id ? (
                  <tr className="bg-slate-50">
                    <td colSpan={6} className="px-4 py-4">
                      <div className="grid md:grid-cols-2 gap-3">
                        <DiffBox title="变更前" value={log.beforeValue} />
                        <DiffBox title="变更后" value={log.afterValue} />
                      </div>
                      <div className="mt-2 text-xs text-slate-400">
                        trace_id: {log.traceId}
                        {log.ip ? ` · ip: ${log.ip}` : ''}
                        {log.requestMethod ? ` · ${log.requestMethod}` : ''}
                      </div>
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            ))}
          </tbody>
        </table>
      </Card>

      <div className="flex items-center justify-between mt-4">
        <span className="text-xs text-slate-400">共 {data.total} 条</span>
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            上一页
          </Button>
          <span className="text-sm text-slate-500 px-2">{page}</span>
          <Button
            size="sm"
            variant="secondary"
            disabled={page * pageSize >= data.total}
            onClick={() => setPage(page + 1)}
          >
            下一页
          </Button>
        </div>
      </div>
    </div>
  );
}

function DiffBox({ title, value }: { title: string; value: any }) {
  return (
    <div>
      <div className="text-xs font-medium text-slate-500 mb-1">{title}</div>
      <pre className="bg-white border border-slate-200 rounded-lg p-3 text-xs text-slate-700 overflow-x-auto max-h-48">
        {value ? JSON.stringify(value, null, 2) : '（无记录）'}
      </pre>
    </div>
  );
}
