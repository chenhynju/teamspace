'use client';
import { useEffect, useState, useMemo, useCallback } from 'react';
import PageHeader from '@/components/PageHeader';
import {
  Card, Button, Modal, Input, Select, Field, Empty, InlineError, Badge, Textarea,
} from '@/components/ui';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import {
  ChevronRight, ChevronDown, Pencil, Trash2, Plus, FolderTree,
} from 'lucide-react';

type MenuRow = {
  id: string;
  parentId: string | null;
  name: string;
  type: 'DIR' | 'MENU' | 'BUTTON';
  orderNum: number;
  path: string | null;
  component: string | null;
  perms: string | null;
  icon: string | null;
  visible: 'SHOW' | 'HIDE';
  status: 'NORMAL' | 'DISABLED';
  isFrame: boolean;
  isCache: boolean;
};

const emptyForm = {
  parentId: '',
  name: '',
  type: 'MENU' as MenuRow['type'],
  orderNum: 0,
  path: '',
  component: '',
  perms: '',
  icon: '',
  visible: 'SHOW' as MenuRow['visible'],
  status: 'NORMAL' as MenuRow['status'],
  isFrame: false,
  isCache: false,
};

const TYPE_TONE: Record<string, any> = { DIR: 'violet', MENU: 'blue', BUTTON: 'slate' };
const TYPE_LABEL: Record<string, string> = { DIR: '目录', MENU: '菜单', BUTTON: '按钮' };

export default function MenuManagePage() {
  const hasPerm = useAuthStore((s) => s.hasPerm);
  const [rows, setRows] = useState<MenuRow[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [keyword, setKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<MenuRow | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const { data } = await api.get('/menus');
    setRows(data);
    return data as MenuRow[];
  }, []);

  useEffect(() => {
    refresh().then((data) => {
      setExpanded(new Set(data.map((m) => m.id)));
      setLoading(false);
    });
  }, [refresh]);

  const childrenMap = useMemo(() => {
    const map = new Map<string | null, MenuRow[]>();
    for (const r of rows) {
      const key = r.parentId;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(r);
    }
    for (const list of map.values()) list.sort((a, b) => a.orderNum - b.orderNum);
    return map;
  }, [rows]);

  // 过滤：命中行 + 其全部祖先
  const visibleSet = useMemo(() => {
    if (!keyword && !statusFilter) return null;
    const hit = new Set<string>();
    const byId = new Map(rows.map((r) => [r.id, r]));
    for (const r of rows) {
      const kwOk = !keyword || r.name.includes(keyword) || (r.perms ?? '').includes(keyword);
      const stOk = !statusFilter || r.status === statusFilter;
      if (kwOk && stOk) {
        let cur: MenuRow | undefined = r;
        while (cur && !hit.has(cur.id)) {
          hit.add(cur.id);
          cur = cur.parentId ? byId.get(cur.parentId) : undefined;
        }
      }
    }
    return hit;
  }, [rows, keyword, statusFilter]);

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const expandAll = () => setExpanded(new Set(rows.map((r) => r.id)));
  const collapseAll = () => setExpanded(new Set());

  const openCreate = (parent?: MenuRow) => {
    setEditing(null);
    setForm({ ...emptyForm, parentId: parent?.id ?? '' });
    setFormError(null);
    setModalOpen(true);
  };

  const openEdit = (m: MenuRow) => {
    setEditing(m);
    setForm({
      parentId: m.parentId ?? '',
      name: m.name,
      type: m.type,
      orderNum: m.orderNum,
      path: m.path ?? '',
      component: m.component ?? '',
      perms: m.perms ?? '',
      icon: m.icon && m.icon !== '#' ? m.icon : '',
      visible: m.visible,
      status: m.status,
      isFrame: m.isFrame,
      isCache: m.isCache,
    });
    setFormError(null);
    setModalOpen(true);
  };

  const save = async () => {
    if (!form.name.trim()) {
      setFormError('请填写菜单名称');
      return;
    }
    if (form.type !== 'BUTTON' && !form.path.trim()) {
      setFormError('目录/菜单需要填写路由地址');
      return;
    }
    if (form.type !== 'BUTTON' && !form.icon.trim()) {
      setFormError('请填写图标名称（lucide 图标，如 Settings）');
      return;
    }
    setSaving(true);
    setFormError(null);
    const payload = {
      parentId: form.parentId || null,
      name: form.name.trim(),
      type: form.type,
      orderNum: Number(form.orderNum) || 0,
      path: form.type === 'BUTTON' ? null : form.path.trim(),
      component: form.type === 'MENU' ? form.component.trim() || null : null,
      perms: form.perms.trim() || null,
      icon: form.type === 'BUTTON' ? '#' : form.icon.trim(),
      visible: form.visible,
      status: form.status,
      isFrame: form.isFrame,
      isCache: form.isCache,
    };
    try {
      if (editing) await api.patch(`/menus/${editing.id}`, payload);
      else await api.post('/menus', payload);
      setModalOpen(false);
      await refresh();
    } catch (e: any) {
      setFormError(e.response?.data?.message ?? '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (m: MenuRow) => {
    if (!confirm(`确认删除菜单「${m.name}」？`)) return;
    try {
      await api.delete(`/menus/${m.id}`);
      await refresh();
    } catch (e: any) {
      alert(e.response?.data?.message ?? '删除失败');
    }
  };

  // 上级菜单选项（树；编辑时排除自身及后代）
  const parentOptions = useMemo(() => {
    const excluded = new Set<string>();
    if (editing) {
      excluded.add(editing.id);
      let frontier = [editing.id];
      while (frontier.length) {
        const next: string[] = [];
        for (const id of frontier) {
          for (const c of childrenMap.get(id) ?? []) {
            if (!excluded.has(c.id)) { excluded.add(c.id); next.push(c.id); }
          }
        }
        frontier = next;
      }
    }
    const out: Array<{ id: string; name: string; depth: number }> = [];
    const walk = (list: MenuRow[], depth: number) => {
      for (const m of list) {
        if (excluded.has(m.id)) continue;
        if (m.type !== 'BUTTON') out.push({ id: m.id, name: `${'　'.repeat(depth)}${m.name}`, depth });
        walk(childrenMap.get(m.id) ?? [], depth + 1);
      }
    };
    walk(childrenMap.get(null) ?? [], 0);
    return out;
  }, [childrenMap, editing]);

  const renderRows = (list: MenuRow[], depth: number): React.ReactNode => {
    const out: React.ReactNode[] = [];
    for (const m of list) {
      if (visibleSet && !visibleSet.has(m.id)) continue;
      const kids = childrenMap.get(m.id) ?? [];
      const isOpen = expanded.has(m.id);
      out.push(
        <tr key={m.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
          <td className="py-2.5 pl-4 pr-2">
            <div className="flex items-center gap-1.5" style={{ paddingLeft: depth * 20 }}>
              {kids.length ? (
                <button onClick={() => toggle(m.id)} className="text-slate-400 hover:text-slate-700">
                  {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                </button>
              ) : (
                <span className="w-4" />
              )}
              <span className="text-sm text-slate-800">{m.name}</span>
            </div>
          </td>
          <td className="py-2.5 px-2"><Badge tone={TYPE_TONE[m.type]}>{TYPE_LABEL[m.type]}</Badge></td>
          <td className="py-2.5 px-2 text-xs text-slate-500 font-mono">{m.perms ?? '-'}</td>
          <td className="py-2.5 px-2 text-xs text-slate-500">{m.type === 'BUTTON' ? '-' : (m.path ?? '-')}</td>
          <td className="py-2.5 px-2 text-xs text-slate-500">{m.component ?? '-'}</td>
          <td className="py-2.5 px-2 text-xs text-slate-500">{m.orderNum}</td>
          <td className="py-2.5 px-2">
            {m.status === 'NORMAL'
              ? <Badge tone="green">正常</Badge>
              : <Badge tone="red">停用</Badge>}
          </td>
          <td className="py-2.5 px-2 text-right whitespace-nowrap">
            <div className="inline-flex items-center gap-1">
              {hasPerm('menu:add') && (
                <Button size="sm" variant="ghost" onClick={() => openCreate(m)} title="新增下级">
                  <Plus className="w-3.5 h-3.5" />
                </Button>
              )}
              {hasPerm('menu:edit') && (
                <Button size="sm" variant="ghost" onClick={() => openEdit(m)} title="编辑">
                  <Pencil className="w-3.5 h-3.5" />
                </Button>
              )}
              {hasPerm('menu:remove') && (
                <Button size="sm" variant="ghost" onClick={() => remove(m)} title="删除">
                  <Trash2 className="w-3.5 h-3.5 text-red-500" />
                </Button>
              )}
            </div>
          </td>
        </tr>,
      );
      if (isOpen || visibleSet) out.push(renderRows(kids, depth + 1));
    }
    return out;
  };

  return (
    <div>
      <PageHeader title="菜单管理" description="维护系统菜单、操作权限与按钮标识，修改后角色授权即时生效">
        {hasPerm('menu:add') && <Button onClick={() => openCreate()}><Plus className="w-4 h-4" /> 新增菜单</Button>}
      </PageHeader>

      <Card className="p-4 mb-4">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            placeholder="搜索菜单名称 / 权限标识"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            className="w-64"
          />
          <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="w-32">
            <option value="">全部状态</option>
            <option value="NORMAL">正常</option>
            <option value="DISABLED">停用</option>
          </Select>
          <Button variant="secondary" size="sm" onClick={expandAll}>展开全部</Button>
          <Button variant="secondary" size="sm" onClick={collapseAll}>收起全部</Button>
        </div>
      </Card>

      <Card className="overflow-hidden">
        {loading || !rows.length ? (
          <div className="p-4"><Empty text={loading ? '加载中...' : '暂无菜单'} /></div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="bg-slate-50 text-left text-xs text-slate-500">
                <th className="py-2 pl-4 pr-2 font-medium">菜单名称</th>
                <th className="py-2 px-2 font-medium">类型</th>
                <th className="py-2 px-2 font-medium">权限标识</th>
                <th className="py-2 px-2 font-medium">路由地址</th>
                <th className="py-2 px-2 font-medium">组件路径</th>
                <th className="py-2 px-2 font-medium">排序</th>
                <th className="py-2 px-2 font-medium">状态</th>
                <th className="py-2 px-2 font-medium text-right">操作</th>
              </tr>
            </thead>
            <tbody>{renderRows(childrenMap.get(null) ?? [], 0)}</tbody>
          </table>
        )}
      </Card>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? '编辑菜单' : '新增菜单'}
        wide
      >
        <div className="space-y-4">
          <Field label="菜单类型">
            <div className="flex gap-2">
              {(['DIR', 'MENU', 'BUTTON'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, type: t }))}
                  className={`flex-1 rounded-lg border px-3 py-2 text-sm transition-colors ${
                    form.type === t
                      ? 'border-blue-500 bg-blue-50 text-blue-700'
                      : 'border-slate-300 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {TYPE_LABEL[t]}
                </button>
              ))}
            </div>
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label="菜单名称">
              <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="如：项目管理" />
            </Field>
            <Field label="上级菜单">
              <Select value={form.parentId} onChange={(e) => setForm((f) => ({ ...f, parentId: e.target.value }))}>
                <option value="">顶层菜单</option>
                {parentOptions.map((o) => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </Select>
            </Field>

            {form.type !== 'BUTTON' && (
              <>
                <Field label="路由地址">
                  <Input value={form.path} onChange={(e) => setForm((f) => ({ ...f, path: e.target.value }))} placeholder="如：/projects" />
                </Field>
                <Field label="图标（lucide 名称）">
                  <Input value={form.icon} onChange={(e) => setForm((f) => ({ ...f, icon: e.target.value }))} placeholder="如：FolderKanban" />
                </Field>
              </>
            )}

            <Field label={form.type === 'BUTTON' ? '权限标识（必填）' : '权限标识'}>
              <Input value={form.perms} onChange={(e) => setForm((f) => ({ ...f, perms: e.target.value }))} placeholder="如：project:list" className="font-mono" />
            </Field>
            <Field label="显示排序">
              <Input type="number" value={form.orderNum} onChange={(e) => setForm((f) => ({ ...f, orderNum: Number(e.target.value) }))} />
            </Field>

            {form.type === 'MENU' && (
              <Field label="前端组件路径" hint="app 目录下相对路径，如 projects/page">
                <Input value={form.component} onChange={(e) => setForm((f) => ({ ...f, component: e.target.value }))} />
              </Field>
            )}
          </div>

          {form.type !== 'BUTTON' && (
            <div className="flex flex-wrap gap-6">
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={form.visible === 'SHOW'} onChange={(e) => setForm((f) => ({ ...f, visible: e.target.checked ? 'SHOW' : 'HIDE' }))} />
                侧边栏可见
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={form.status === 'NORMAL'} onChange={(e) => setForm((f) => ({ ...f, status: e.target.checked ? 'NORMAL' : 'DISABLED' }))} />
                启用
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={form.isFrame} onChange={(e) => setForm((f) => ({ ...f, isFrame: e.target.checked }))} />
                外链
              </label>
              {form.type === 'MENU' && (
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input type="checkbox" checked={form.isCache} onChange={(e) => setForm((f) => ({ ...f, isCache: e.target.checked }))} />
                  页面缓存
                </label>
              )}
            </div>
          )}

          <InlineError message={formError} />

          <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
            <Button variant="secondary" onClick={() => setModalOpen(false)}>取消</Button>
            <Button onClick={save} disabled={saving}>{saving ? '保存中...' : '保存'}</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
