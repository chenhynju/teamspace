'use client';
import { useEffect, useState, useCallback } from 'react';
import PageHeader from '@/components/PageHeader';
import {
  Card, Button, Modal, Input, Field, Empty, InlineError, Badge,
} from '@/components/ui';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { Plus, Pencil, Trash2 } from 'lucide-react';

type ConfigRow = {
  id: string;
  name: string;
  key: string;
  value: string;
  configType: 'YES' | 'NO';
  remark: string | null;
};

const emptyForm = { name: '', key: '', value: '', configType: 'NO', remark: '' };

export default function ConfigManagePage() {
  const hasPerm = useAuthStore((s) => s.hasPerm);
  const [rows, setRows] = useState<ConfigRow[]>([]);
  const [keyword, setKeyword] = useState('');
  const [loading, setLoading] = useState(true);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<ConfigRow | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    const { data } = await api.get('/configs');
    setRows(data);
    setLoading(false);
    return data as ConfigRow[];
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm);
    setError(null);
    setModalOpen(true);
  };

  const openEdit = (c: ConfigRow) => {
    setEditing(c);
    setForm({ name: c.name, key: c.key, value: c.value, configType: c.configType, remark: c.remark ?? '' });
    setError(null);
    setModalOpen(true);
  };

  const save = async () => {
    if (!form.name.trim() || !form.key.trim() || !form.value.trim()) {
      setError('请填写参数名称、键名和键值');
      return;
    }
    setSaving(true);
    setError(null);
    const payload = {
      name: form.name.trim(),
      key: form.key.trim(),
      value: form.value.trim(),
      remark: form.remark || null,
    };
    try {
      if (editing) await api.patch(`/configs/${editing.id}`, payload);
      else await api.post('/configs', payload);
      setModalOpen(false);
      await refresh();
    } catch (e: any) {
      setError(e.response?.data?.message ?? '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (c: ConfigRow) => {
    if (!confirm(`确认删除参数「${c.name}」？`)) return;
    try {
      await api.delete(`/configs/${c.id}`);
      await refresh();
    } catch (e: any) {
      alert(e.response?.data?.message ?? '删除失败');
    }
  };

  const filtered = rows.filter(
    (c) => !keyword || c.name.includes(keyword) || c.key.includes(keyword),
  );

  return (
    <div>
      <PageHeader title="参数设置" description="运营可调的系统参数，避免把易变配置硬编码进代码">
        {hasPerm('config:add') && <Button onClick={openCreate}><Plus className="w-4 h-4" /> 新增参数</Button>}
      </PageHeader>

      <Card className="p-4 mb-4">
        <Input
          placeholder="搜索参数名称 / 键名"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          className="w-64"
        />
      </Card>

      <Card className="overflow-hidden">
        {loading || !rows.length ? (
          <div className="p-4"><Empty text={loading ? '加载中...' : '暂无参数'} /></div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="bg-slate-50 text-left text-xs text-slate-500">
                <th className="py-2 px-4 font-medium">参数名称</th>
                <th className="py-2 px-4 font-medium">参数键名</th>
                <th className="py-2 px-4 font-medium">参数键值</th>
                <th className="py-2 px-4 font-medium">系统内置</th>
                <th className="py-2 px-4 font-medium">备注</th>
                <th className="py-2 px-4 font-medium text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr key={c.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                  <td className="py-2.5 px-4 text-sm text-slate-800 whitespace-nowrap">{c.name}</td>
                  <td className="py-2.5 px-4 text-xs font-mono text-blue-700 whitespace-nowrap">{c.key}</td>
                  <td className="py-2.5 px-4 text-xs text-slate-600 max-w-[240px] truncate" title={c.value}>{c.value}</td>
                  <td className="py-2.5 px-4">
                    {c.configType === 'YES' ? <Badge tone="blue">是</Badge> : <Badge tone="slate">否</Badge>}
                  </td>
                  <td className="py-2.5 px-4 text-xs text-slate-500 max-w-[160px] truncate">{c.remark ?? '-'}</td>
                  <td className="py-2.5 px-4 text-right whitespace-nowrap">
                    <div className="inline-flex gap-1">
                      {hasPerm('config:edit') && (
                        <Button size="sm" variant="ghost" onClick={() => openEdit(c)}>
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                      )}
                      {hasPerm('config:remove') && (
                        <Button size="sm" variant="ghost" onClick={() => remove(c)}>
                          <Trash2 className="w-3.5 h-3.5 text-red-500" />
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? '编辑参数' : '新增参数'}>
        <div className="space-y-4">
          <Field label="参数名称">
            <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          </Field>
          <Field label="参数键名" hint="字母开头，仅含字母/数字/下划线/点；编辑时不可修改">
            <Input
              value={form.key}
              onChange={(e) => setForm((f) => ({ ...f, key: e.target.value }))}
              disabled={!!editing}
              className="font-mono"
            />
          </Field>
          <Field label="参数键值">
            <Input value={form.value} onChange={(e) => setForm((f) => ({ ...f, value: e.target.value }))} />
          </Field>
          <Field label="备注">
            <Input value={form.remark} onChange={(e) => setForm((f) => ({ ...f, remark: e.target.value }))} />
          </Field>
          <InlineError message={error} />
          <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
            <Button variant="secondary" onClick={() => setModalOpen(false)}>取消</Button>
            <Button onClick={save} disabled={saving}>{saving ? '保存中...' : '保存'}</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
