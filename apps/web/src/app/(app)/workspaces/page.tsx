'use client';
import { useEffect, useState, useCallback } from 'react';
import PageHeader from '@/components/PageHeader';
import {
  Card, Button, Modal, Input, Textarea, Field, Empty, InlineError,
} from '@/components/ui';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';

interface Workspace {
  id: string;
  name: string;
  description: string | null;
  _count: { projects: number };
}

export default function WorkspacesPage() {
  const hasPerm = useAuthStore((s) => s.hasPerm);
  const [list, setList] = useState<Workspace[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Workspace | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const { data } = await api.get('/workspaces');
    setList(data);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const openCreate = () => {
    setEditing(null);
    setName('');
    setDescription('');
    setError(null);
    setOpen(true);
  };

  const openEdit = (w: Workspace) => {
    setEditing(w);
    setName(w.name);
    setDescription(w.description ?? '');
    setError(null);
    setOpen(true);
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      if (editing) {
        await api.patch(`/workspaces/${editing.id}`, { name, description });
      } else {
        await api.post('/workspaces', { name, description });
      }
      setOpen(false);
      await refresh();
    } catch (e: any) {
      setError(e.response?.data?.message ?? '保存失败');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (w: Workspace) => {
    if (!confirm(`确认删除工作区「${w.name}」？`)) return;
    try {
      await api.delete(`/workspaces/${w.id}`);
      await refresh();
    } catch (e: any) {
      alert(e.response?.data?.message ?? '删除失败');
    }
  };

  return (
    <div className="p-6">
      <PageHeader title="工作区" description="工作区用于分组管理项目">
        {hasPerm('workspace:add') ? <Button onClick={openCreate}>新建工作区</Button> : null}
      </PageHeader>

      {list.length === 0 ? (
        <Empty text="还没有工作区" />
      ) : (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {list.map((w) => (
            <Card key={w.id} className="p-4">
              <div className="flex items-start justify-between">
                <h3 className="font-medium text-slate-800">{w.name}</h3>
                <span className="text-xs text-slate-400">{w._count.projects} 个项目</span>
              </div>
              <p className="text-sm text-slate-500 mt-2 min-h-[20px]">{w.description}</p>
              <div className="flex gap-2 mt-4">
                {hasPerm('workspace:edit') ? (
                  <Button size="sm" variant="secondary" onClick={() => openEdit(w)}>
                    编辑
                  </Button>
                ) : null}
                {hasPerm('workspace:remove') ? (
                  <Button size="sm" variant="danger" onClick={() => remove(w)}>
                    删除
                  </Button>
                ) : null}
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title={editing ? '编辑工作区' : '新建工作区'}>
        <div className="space-y-4">
          <Field label="名称">
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={64} />
          </Field>
          <Field label="描述">
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              maxLength={255}
            />
          </Field>
          <InlineError message={error} />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button onClick={save} disabled={busy || !name.trim()}>
              {busy ? '保存中…' : '保存'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
