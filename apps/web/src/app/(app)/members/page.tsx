'use client';
import { useEffect, useState, useCallback } from 'react';
import PageHeader from '@/components/PageHeader';
import {
  Card, Button, Badge, Modal, Select, Empty, InlineError,
} from '@/components/ui';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';

const STATUS_TONE: Record<string, any> = {
  ACTIVE: 'green',
  SUSPENDED: 'amber',
  REMOVED: 'red',
};
const STATUS_LABEL: Record<string, string> = {
  ACTIVE: '正常',
  SUSPENDED: '已停用',
  REMOVED: '已移除',
};

export default function MembersPage() {
  const hasPerm = useAuthStore((s) => s.hasPerm);
  const [list, setList] = useState<any[]>([]);
  const [depts, setDepts] = useState<any[]>([]);
  const [roles, setRoles] = useState<any[]>([]);
  const [posts, setPosts] = useState<any[]>([]);
  const [target, setTarget] = useState<any | null>(null);
  const [deptId, setDeptId] = useState('');
  const [roleIds, setRoleIds] = useState<string[]>([]);
  const [postIds, setPostIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const { data } = await api.get('/members');
    setList(data);
  }, []);

  useEffect(() => {
    refresh();
    api
      .get('/depts/tree')
      .then((r) => setDepts(r.data))
      .catch(() => setDepts([]));
    api
      .get('/roles')
      .then((r) => setRoles(r.data))
      .catch(() => setRoles([]));
    api
      .get('/posts')
      .then((r) => setPosts(r.data))
      .catch(() => setPosts([]));
  }, [refresh]);

  const openEdit = (m: any) => {
    setTarget(m);
    setDeptId(m.deptId ?? '');
    setRoleIds(m.roles.map((r: any) => r.roleId));
    setPostIds(m.posts.map((p: any) => p.postId));
    setError(null);
  };

  const toggle = (id: string, arr: string[], setArr: (v: string[]) => void) => {
    setArr(arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id]);
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.patch(`/members/${target.id}`, { deptId: deptId || null });
      await api.post(`/members/${target.id}/roles`, { roleIds });
      await api.post(`/members/${target.id}/posts`, { postIds });
      setTarget(null);
      await refresh();
    } catch (e: any) {
      setError(e.response?.data?.message ?? '保存失败');
    } finally {
      setBusy(false);
    }
  };

  const act = async (m: any, action: 'suspend' | 'reactivate' | 'remove') => {
    if (action === 'remove' && !confirm(`确认移除成员「${m.user.name}」？`)) return;
    try {
      if (action === 'remove') {
        await api.delete(`/members/${m.id}`);
      } else {
        await api.post(`/members/${m.id}/${action}`);
      }
      await refresh();
    } catch (e: any) {
      alert(e.response?.data?.message ?? '操作失败');
    }
  };

  return (
    <div className="p-6">
      <PageHeader title="成员" description="成员列表按角色数据权限过滤" />

      {list.length === 0 ? (
        <Empty text="暂无成员" />
      ) : (
        <Card>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-500 border-b border-slate-100">
                <th className="px-4 py-3 font-medium">成员</th>
                <th className="px-4 py-3 font-medium">部门</th>
                <th className="px-4 py-3 font-medium">角色</th>
                <th className="px-4 py-3 font-medium">岗位</th>
                <th className="px-4 py-3 font-medium">状态</th>
                <th className="px-4 py-3 font-medium text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {list.map((m) => (
                <tr key={m.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-800">{m.user.name}</div>
                    <div className="text-xs text-slate-400">{m.user.email}</div>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{m.dept?.name ?? '-'}</td>
                  <td className="px-4 py-3 space-x-1">
                    {m.roles.map((r: any) => (
                      <Badge key={r.roleId} tone={r.role.key === 'OWNER' ? 'violet' : 'blue'}>
                        {r.role.name}
                      </Badge>
                    ))}
                  </td>
                  <td className="px-4 py-3 text-slate-500 text-xs">
                    {m.posts.map((p: any) => p.post.name).join('、') || '-'}
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={STATUS_TONE[m.status]}>{STATUS_LABEL[m.status]}</Badge>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1.5">
                      {m.status === 'ACTIVE' ? (
                        <>
                          {hasPerm('member:edit') || hasPerm('member:assign-role') ? (
                            <Button size="sm" variant="secondary" onClick={() => openEdit(m)}>
                              编辑
                            </Button>
                          ) : null}
                          {hasPerm('member:remove') && m.status === 'ACTIVE' ? (
                            <>
                              <Button size="sm" variant="secondary" onClick={() => act(m, 'suspend')}>
                                停用
                              </Button>
                              <Button size="sm" variant="danger" onClick={() => act(m, 'remove')}>
                                移除
                              </Button>
                            </>
                          ) : null}
                        </>
                      ) : m.status === 'SUSPENDED' && hasPerm('member:remove') ? (
                        <Button size="sm" variant="success" onClick={() => act(m, 'reactivate')}>
                          恢复
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

      <Modal open={!!target} onClose={() => setTarget(null)} title={`编辑成员 · ${target?.user?.name ?? ''}`} wide>
        <div className="space-y-4">
          <div>
            <span className="text-xs font-medium text-slate-600">所属部门</span>
            <Select value={deptId} onChange={(e) => setDeptId(e.target.value)} className="mt-1">
              <option value="">（未分配）</option>
              {depts.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </Select>
          </div>

          <div>
            <span className="text-xs font-medium text-slate-600">角色（可多选）</span>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {roles.map((r) => (
                <label key={r.id} className="flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={roleIds.includes(r.id)}
                    onChange={() => toggle(r.id, roleIds, setRoleIds)}
                  />
                  {r.name}
                </label>
              ))}
            </div>
          </div>

          <div>
            <span className="text-xs font-medium text-slate-600">岗位（可多选）</span>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {posts.map((p) => (
                <label key={p.id} className="flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={postIds.includes(p.id)}
                    onChange={() => toggle(p.id, postIds, setPostIds)}
                  />
                  {p.name}
                </label>
              ))}
            </div>
          </div>

          <InlineError message={error} />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setTarget(null)}>
              取消
            </Button>
            <Button onClick={save} disabled={busy || roleIds.length === 0}>
              {busy ? '保存中…' : '保存'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
