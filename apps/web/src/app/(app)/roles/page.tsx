'use client';
import { useEffect, useState, useCallback } from 'react';
import PageHeader from '@/components/PageHeader';
import {
  Card, Button, Badge, Modal, Input, Select, Field, Empty, InlineError,
} from '@/components/ui';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';

const DS_OPTIONS = [
  { value: 'ALL', label: '全部数据' },
  { value: 'CUSTOM', label: '自定义' },
  { value: 'DEPT', label: '本部门' },
  { value: 'DEPT_AND_CHILD', label: '本部门及以下' },
  { value: 'SELF', label: '仅本人' },
];

function flattenTree(nodes: any[], depth = 0): Array<{ node: any; depth: number }> {
  const out: Array<{ node: any; depth: number }> = [];
  for (const n of nodes) {
    out.push({ node: n, depth });
    if (n.children?.length) out.push(...flattenTree(n.children, depth + 1));
  }
  return out;
}

export default function RolesPage() {
  const hasPerm = useAuthStore((s) => s.hasPerm);
  const [list, setList] = useState<any[]>([]);
  const [flatMenus, setFlatMenus] = useState<{ node: any; depth: number }[]>([]);
  const [flatDepts, setFlatDepts] = useState<{ node: any; depth: number }[]>([]);

  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<any | null>(null);
  const [permTarget, setPermTarget] = useState<any | null>(null);

  const [form, setForm] = useState({ name: '', key: '', dataScope: 'SELF', sort: 10 });
  const [menuIds, setMenuIds] = useState<string[]>([]);
  const [deptIds, setDeptIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const { data } = await api.get('/roles');
    setList(data);
  }, []);

  useEffect(() => {
    refresh();
    api
      .get('/menus/tree')
      .then((r) => setFlatMenus(flattenTree(r.data)))
      .catch(() => setFlatMenus([]));
    api
      .get('/depts/tree')
      .then((r) => setFlatDepts(flattenTree(r.data)))
      .catch(() => setFlatDepts([]));
  }, [refresh]);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post('/roles', form);
      setCreateOpen(false);
      await refresh();
    } catch (e: any) {
      setError(e.response?.data?.message ?? '创建失败');
    } finally {
      setBusy(false);
    }
  };

  const saveEdit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.patch(`/roles/${editTarget.id}`, {
        name: form.name,
        dataScope: form.dataScope,
        sort: form.sort,
      });
      setEditTarget(null);
      await refresh();
    } catch (e: any) {
      setError(e.response?.data?.message ?? '保存失败');
    } finally {
      setBusy(false);
    }
  };

  const openPerm = async (r: any) => {
    setPermTarget(r);
    setError(null);
    const { data } = await api.get(`/roles/${r.id}`);
    setMenuIds(data.menuIds);
    setDeptIds(data.deptIds);
  };

  const savePerms = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.put(`/roles/${permTarget.id}/menus`, { menuIds });
      if (permTarget.dataScope === 'CUSTOM') {
        await api.put(`/roles/${permTarget.id}/depts`, { deptIds });
      }
      setPermTarget(null);
      await refresh();
    } catch (e: any) {
      setError(e.response?.data?.message ?? '授权失败');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (r: any) => {
    if (!confirm(`确认删除角色「${r.name}」？`)) return;
    try {
      await api.delete(`/roles/${r.id}`);
      await refresh();
    } catch (e: any) {
      alert(e.response?.data?.message ?? '删除失败');
    }
  };

  const toggleId = (id: string, arr: string[], setArr: (v: string[]) => void) => {
    setArr(arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id]);
  };

  return (
    <div className="p-6">
      <PageHeader title="角色权限" description="自定义角色：功能权限（菜单/按钮）+ 数据权限（可见范围）">
        {hasPerm('role:add') ? (
          <Button
            onClick={() => {
              setForm({ name: '', key: '', dataScope: 'SELF', sort: 10 });
              setError(null);
              setCreateOpen(true);
            }}
          >
            新建角色
          </Button>
        ) : null}
      </PageHeader>

      {list.length === 0 ? (
        <Empty text="暂无角色" />
      ) : (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {list.map((r) => (
            <Card key={r.id} className="p-4">
              <div className="flex items-center gap-2">
                <h3 className="font-medium text-slate-800">{r.name}</h3>
                {r.key === 'OWNER' ? <Badge tone="violet">保留</Badge> : null}
              </div>
              <div className="text-xs text-slate-400 mt-1">
                {r.key} · {DS_OPTIONS.find((d) => d.value === r.dataScope)?.label}
              </div>
              <div className="text-xs text-slate-500 mt-2">
                {r._count.memberships} 名成员 · {r._count.menus} 项授权
              </div>
              <div className="flex gap-2 mt-4">
                {hasPerm('role:edit') && r.key !== 'OWNER' ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      setForm({
                        name: r.name,
                        key: r.key,
                        dataScope: r.dataScope,
                        sort: r.sort,
                      });
                      setError(null);
                      setEditTarget(r);
                    }}
                  >
                    编辑
                  </Button>
                ) : null}
                {hasPerm('role:assign-menu') ? (
                  <Button size="sm" onClick={() => openPerm(r)}>
                    菜单授权
                  </Button>
                ) : null}
                {hasPerm('role:remove') && r.key !== 'OWNER' ? (
                  <Button size="sm" variant="danger" onClick={() => remove(r)}>
                    删除
                  </Button>
                ) : null}
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* 新建角色 */}
      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="新建角色">
        <div className="space-y-4">
          <Field label="角色名称">
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label="角色标识（大写字母，如 AUDITOR）">
            <Input value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value })} />
          </Field>
          <Field label="数据权限">
            <Select
              value={form.dataScope}
              onChange={(e) => setForm({ ...form, dataScope: e.target.value })}
            >
              {DS_OPTIONS.map((d) => (
                <option key={d.value} value={d.value}>{d.label}</option>
              ))}
            </Select>
          </Field>
          <InlineError message={error} />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setCreateOpen(false)}>
              取消
            </Button>
            <Button onClick={create} disabled={busy || !form.name || !form.key}>
              {busy ? '创建中…' : '创建'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* 编辑角色 */}
      <Modal open={!!editTarget} onClose={() => setEditTarget(null)} title="编辑角色">
        <div className="space-y-4">
          <Field label="角色名称">
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label="数据权限（改为自定义后请配置部门）">
            <Select
              value={form.dataScope}
              onChange={(e) => setForm({ ...form, dataScope: e.target.value })}
            >
              {DS_OPTIONS.map((d) => (
                <option key={d.value} value={d.value}>{d.label}</option>
              ))}
            </Select>
          </Field>
          <InlineError message={error} />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setEditTarget(null)}>
              取消
            </Button>
            <Button onClick={saveEdit} disabled={busy}>
              {busy ? '保存中…' : '保存'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* 菜单授权 */}
      <Modal
        open={!!permTarget}
        onClose={() => setPermTarget(null)}
        title={`菜单授权 · ${permTarget?.name ?? ''}`}
        wide
      >
        <div className="space-y-4">
          <div className="max-h-72 overflow-y-auto border border-slate-200 rounded-lg p-3 space-y-1">
            {flatMenus.map(({ node, depth }) => (
              <label
                key={node.id}
                className="flex items-center gap-2 text-sm text-slate-700 hover:bg-slate-50 rounded px-1"
                style={{ marginLeft: depth * 16 }}
              >
                <input
                  type="checkbox"
                  checked={menuIds.includes(node.id)}
                  onChange={() => toggleId(node.id, menuIds, setMenuIds)}
                />
                <span className={node.type === 'BUTTON' ? 'text-slate-500' : ''}>
                  {node.name}
                </span>
                {node.perms ? <span className="text-xs text-slate-400">[{node.perms}]</span> : null}
              </label>
            ))}
          </div>

          {permTarget?.dataScope === 'CUSTOM' ? (
            <div>
              <span className="text-xs font-medium text-slate-600">自定义数据范围部门</span>
              <div className="mt-2 max-h-40 overflow-y-auto border border-slate-200 rounded-lg p-3 space-y-1">
                {flatDepts.map(({ node, depth }) => (
                  <label
                    key={node.id}
                    className="flex items-center gap-2 text-sm text-slate-700"
                    style={{ marginLeft: depth * 16 }}
                  >
                    <input
                      type="checkbox"
                      checked={deptIds.includes(node.id)}
                      onChange={() => toggleId(node.id, deptIds, setDeptIds)}
                    />
                    {node.name}
                  </label>
                ))}
              </div>
            </div>
          ) : null}

          <InlineError message={error} />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setPermTarget(null)}>
              取消
            </Button>
            <Button onClick={savePerms} disabled={busy}>
              {busy ? '保存中…' : '保存授权'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
