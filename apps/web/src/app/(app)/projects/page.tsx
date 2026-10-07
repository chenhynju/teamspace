'use client';
import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import PageHeader from '@/components/PageHeader';
import {
  Card, Button, Badge, Modal, Input, Textarea, Field, Select, Empty, InlineError,
} from '@/components/ui';
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

export default function ProjectsPage() {
  const hasPerm = useAuthStore((s) => s.hasPerm);
  const [list, setList] = useState<any[]>([]);
  const [workspaces, setWorkspaces] = useState<any[]>([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [wsFilter, setWsFilter] = useState('');
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: '', description: '', workspaceId: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const params = new URLSearchParams();
    if (statusFilter) params.set('status', statusFilter);
    if (wsFilter) params.set('workspaceId', wsFilter);
    const { data } = await api.get(`/projects?${params.toString()}`);
    setList(data);
  }, [statusFilter, wsFilter]);

  useEffect(() => {
    api.get('/workspaces').then((r) => setWorkspaces(r.data));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post('/projects', form);
      setOpen(false);
      setForm({ name: '', description: '', workspaceId: form.workspaceId });
      await refresh();
    } catch (e: any) {
      setError(e.response?.data?.message ?? '创建失败');
    } finally {
      setBusy(false);
    }
  };

  const transition = async (p: any, action: 'activate' | 'deliver' | 'archive') => {
    try {
      await api.post(`/projects/${p.id}/${action}`);
      await refresh();
    } catch (e: any) {
      alert(e.response?.data?.message ?? '操作失败');
    }
  };

  const remove = async (p: any) => {
    if (!confirm(`确认删除草稿「${p.name}」？`)) return;
    try {
      await api.delete(`/projects/${p.id}`);
      await refresh();
    } catch (e: any) {
      alert(e.response?.data?.message ?? '删除失败');
    }
  };

  return (
    <div className="p-6">
      <PageHeader title="项目" description="管理项目全生命周期：草稿 → 进行中 → 已交付">
        {hasPerm('project:add') ? (
          <Button
            onClick={() => {
              setForm({
                name: '',
                description: '',
                workspaceId: workspaces[0]?.id ?? '',
              });
              setError(null);
              setOpen(true);
            }}
          >
            新建项目
          </Button>
        ) : null}
      </PageHeader>

      <div className="flex gap-3 mb-4">
        <Select value={wsFilter} onChange={(e) => setWsFilter(e.target.value)} className="w-48">
          <option value="">全部工作区</option>
          {workspaces.map((w) => (
            <option key={w.id} value={w.id}>{w.name}</option>
          ))}
        </Select>
        <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="w-40">
          <option value="">全部状态</option>
          <option value="DRAFT">草稿</option>
          <option value="ACTIVE">进行中</option>
          <option value="DELIVERED">已交付</option>
          <option value="ARCHIVED">已归档</option>
        </Select>
      </div>

      {list.length === 0 ? (
        <Empty text="没有符合条件的项目" />
      ) : (
        <Card>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-500 border-b border-slate-100">
                <th className="px-4 py-3 font-medium">项目</th>
                <th className="px-4 py-3 font-medium">工作区</th>
                <th className="px-4 py-3 font-medium">负责人</th>
                <th className="px-4 py-3 font-medium">任务/文件</th>
                <th className="px-4 py-3 font-medium">状态</th>
                <th className="px-4 py-3 font-medium text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {list.map((p) => (
                <tr key={p.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <Link href={`/projects/${p.id}`} className="text-blue-600 hover:underline font-medium">
                      {p.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{p.workspace.name}</td>
                  <td className="px-4 py-3 text-slate-600">{p.owner.name}</td>
                  <td className="px-4 py-3 text-slate-500">
                    {p._count.tasks} / {p._count.files}
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={STATUS_TONE[p.status]}>{STATUS_LABEL[p.status]}</Badge>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1.5">
                      {p.status === 'DRAFT' && hasPerm('project:edit') ? (
                        <>
                          <Button size="sm" variant="success" onClick={() => transition(p, 'activate')}>
                            启动
                          </Button>
                          {hasPerm('project:remove') ? (
                            <Button size="sm" variant="danger" onClick={() => remove(p)}>
                              删除
                            </Button>
                          ) : null}
                        </>
                      ) : null}
                      {p.status === 'ACTIVE' && hasPerm('project:deliver') ? (
                        <Button size="sm" variant="success" onClick={() => transition(p, 'deliver')}>
                          交付
                        </Button>
                      ) : null}
                      {(p.status === 'ACTIVE' || p.status === 'DELIVERED') && hasPerm('project:edit') ? (
                        <Button size="sm" variant="secondary" onClick={() => transition(p, 'archive')}>
                          归档
                        </Button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="新建项目">
        <div className="space-y-4">
          <Field label="所属工作区">
            <Select
              value={form.workspaceId}
              onChange={(e) => setForm({ ...form, workspaceId: e.target.value })}
            >
              {workspaces.map((w) => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="项目名称">
            <Input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              maxLength={64}
            />
          </Field>
          <Field label="描述">
            <Textarea
              rows={3}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </Field>
          <InlineError message={error} />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button
              onClick={create}
              disabled={busy || !form.name.trim() || !form.workspaceId}
            >
              {busy ? '创建中…' : '创建（草稿）'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
