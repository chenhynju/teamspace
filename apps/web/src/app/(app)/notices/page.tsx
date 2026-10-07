'use client';
import { useEffect, useState, useCallback } from 'react';
import PageHeader from '@/components/PageHeader';
import {
  Card, Button, Modal, Input, Select, Field, Empty, InlineError, Badge, Textarea,
} from '@/components/ui';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { Plus, Pencil, Trash2, Eye } from 'lucide-react';

type NoticeRow = {
  id: string;
  title: string;
  type: 'NOTICE' | 'ANNOUNCEMENT';
  content: string;
  status: 'NORMAL' | 'DISABLED';
  readByMe: boolean;
  createdAt: string;
};

const emptyForm = { title: '', type: 'NOTICE' as NoticeRow['type'], content: '', status: 'NORMAL' as NoticeRow['status'] };

export default function NoticesPage() {
  const hasPerm = useAuthStore((s) => s.hasPerm);
  const [rows, setRows] = useState<NoticeRow[]>([]);
  const [keyword, setKeyword] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [loading, setLoading] = useState(true);

  const [detail, setDetail] = useState<NoticeRow | null>(null);

  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<NoticeRow | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    const { data } = await api.get('/notices');
    setRows(data);
    setLoading(false);
    return data as NoticeRow[];
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const openDetail = async (n: NoticeRow) => {
    setDetail(n);
    if (!n.readByMe) {
      await api.post(`/notices/${n.id}/read`);
      setRows((prev) => prev.map((x) => (x.id === n.id ? { ...x, readByMe: true } : x)));
      setDetail({ ...n, readByMe: true });
    }
  };

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm);
    setFormError(null);
    setEditOpen(true);
  };

  const openEdit = (n: NoticeRow) => {
    setEditing(n);
    setForm({ title: n.title, type: n.type, content: n.content, status: n.status });
    setFormError(null);
    setEditOpen(true);
  };

  const save = async () => {
    if (!form.title.trim() || !form.content.trim()) {
      setFormError('请填写标题和正文');
      return;
    }
    setSaving(true);
    setFormError(null);
    const payload = {
      title: form.title.trim(),
      type: form.type,
      content: form.content,
      status: form.status,
    };
    try {
      if (editing) await api.patch(`/notices/${editing.id}`, payload);
      else await api.post('/notices', payload);
      setEditOpen(false);
      await refresh();
    } catch (e: any) {
      setFormError(e.response?.data?.message ?? '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (n: NoticeRow) => {
    if (!confirm(`确认删除公告「${n.title}」？`)) return;
    try {
      await api.delete(`/notices/${n.id}`);
      await refresh();
    } catch (e: any) {
      alert(e.response?.data?.message ?? '删除失败');
    }
  };

  const filtered = rows.filter((n) => {
    const kwOk = !keyword || n.title.includes(keyword);
    const typeOk = !typeFilter || n.type === typeFilter;
    return kwOk && typeOk;
  });

  return (
    <div>
      <PageHeader title="通知公告" description="组织内向全体成员发布通知与公告，未读会在列表中标记">
        {hasPerm('notice:add') && <Button onClick={openCreate}><Plus className="w-4 h-4" /> 发布公告</Button>}
      </PageHeader>

      <Card className="p-4 mb-4">
        <div className="flex flex-wrap gap-2">
          <Input
            placeholder="搜索公告标题"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            className="w-64"
          />
          <Select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="w-32">
            <option value="">全部类型</option>
            <option value="NOTICE">通知</option>
            <option value="ANNOUNCEMENT">公告</option>
          </Select>
        </div>
      </Card>

      <Card className="overflow-hidden">
        {loading || !rows.length ? (
          <div className="p-4"><Empty text={loading ? '加载中...' : '暂无通知公告'} /></div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="bg-slate-50 text-left text-xs text-slate-500">
                <th className="py-2 px-4 font-medium w-20">类型</th>
                <th className="py-2 px-4 font-medium">标题</th>
                <th className="py-2 px-4 font-medium w-20">状态</th>
                <th className="py-2 px-4 font-medium w-20">已读</th>
                <th className="py-2 px-4 font-medium w-44">发布时间</th>
                <th className="py-2 px-4 font-medium text-right w-32">操作</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((n) => (
                <tr key={n.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50 cursor-pointer" onClick={() => openDetail(n)}>
                  <td className="py-2.5 px-4">
                    {n.type === 'NOTICE'
                      ? <Badge tone="blue">通知</Badge>
                      : <Badge tone="violet">公告</Badge>}
                  </td>
                  <td className="py-2.5 px-4 text-sm text-slate-800">
                    {n.title}
                    {n.status === 'DISABLED' && <span className="ml-2 text-xs text-slate-400">（草稿）</span>}
                  </td>
                  <td className="py-2.5 px-4">
                    {n.status === 'NORMAL' ? <Badge tone="green">正常</Badge> : <Badge tone="slate">停用</Badge>}
                  </td>
                  <td className="py-2.5 px-4">
                    {n.readByMe ? <span className="text-xs text-slate-400">已读</span> : <Badge tone="amber">未读</Badge>}
                  </td>
                  <td className="py-2.5 px-4 text-xs text-slate-500 whitespace-nowrap">
                    {new Date(n.createdAt).toLocaleString('zh-CN')}
                  </td>
                  <td className="py-2.5 px-4 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                    <div className="inline-flex gap-1">
                      <Button size="sm" variant="ghost" onClick={() => openDetail(n)} title="查看">
                        <Eye className="w-3.5 h-3.5" />
                      </Button>
                      {hasPerm('notice:edit') && (
                        <Button size="sm" variant="ghost" onClick={() => openEdit(n)} title="编辑">
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                      )}
                      {hasPerm('notice:remove') && (
                        <Button size="sm" variant="ghost" onClick={() => remove(n)} title="删除">
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

      {/* 详情弹窗 */}
      <Modal open={!!detail} onClose={() => setDetail(null)} title={detail?.title ?? ''} wide>
        {detail && (
          <div className="space-y-4">
            <div className="flex items-center gap-3 text-xs text-slate-500">
              {detail.type === 'NOTICE' ? <Badge tone="blue">通知</Badge> : <Badge tone="violet">公告</Badge>}
              <span>{new Date(detail.createdAt).toLocaleString('zh-CN')}</span>
            </div>
            <div className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap border-t border-slate-100 pt-4">
              {detail.content}
            </div>
          </div>
        )}
      </Modal>

      {/* 编辑弹窗 */}
      <Modal open={editOpen} onClose={() => setEditOpen(false)} title={editing ? '编辑公告' : '发布公告'} wide>
        <div className="space-y-4">
          <div className="grid grid-cols-[1fr_140px] gap-4">
            <Field label="标题">
              <Input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
            </Field>
            <Field label="类型">
              <Select value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as NoticeRow['type'] }))}>
                <option value="NOTICE">通知</option>
                <option value="ANNOUNCEMENT">公告</option>
              </Select>
            </Field>
          </div>
          <Field label="正文">
            <Textarea
              rows={10}
              value={form.content}
              onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))}
              placeholder="支持纯文本，换行保留"
            />
          </Field>
          <Field label="状态" hint="停用状态为草稿，成员不可见">
            <Select value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as NoticeRow['status'] }))}>
              <option value="NORMAL">正常发布</option>
              <option value="DISABLED">停用（草稿）</option>
            </Select>
          </Field>
          <InlineError message={formError} />
          <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
            <Button variant="secondary" onClick={() => setEditOpen(false)}>取消</Button>
            <Button onClick={save} disabled={saving}>{saving ? '保存中...' : '保存'}</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
