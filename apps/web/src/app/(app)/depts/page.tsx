'use client';
import { useEffect, useState, useCallback } from 'react';
import PageHeader from '@/components/PageHeader';
import {
  Card, Button, Modal, Input, Select, Field, Empty, InlineError, Badge,
} from '@/components/ui';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';

function flattenTree(nodes: any[], depth = 0): Array<{ node: any; depth: number }> {
  const out: Array<{ node: any; depth: number }> = [];
  for (const n of nodes) {
    out.push({ node: n, depth });
    if (n.children?.length) out.push(...flattenTree(n.children, depth + 1));
  }
  return out;
}

export default function DeptsPostsPage() {
  const hasPerm = useAuthStore((s) => s.hasPerm);
  const [tab, setTab] = useState<'dept' | 'post'>('dept');

  const [deptTree, setDeptTree] = useState<any[]>([]);
  const [posts, setPosts] = useState<any[]>([]);

  const [deptTarget, setDeptTarget] = useState<any | null>(null);
  const [deptCreating, setDeptCreating] = useState(false);
  const [deptForm, setDeptForm] = useState({ name: '', parentId: '', orderNum: 0 });

  const [postTarget, setPostTarget] = useState<any | null>(null);
  const [postCreating, setPostCreating] = useState(false);
  const [postForm, setPostForm] = useState({ name: '', code: '', sort: 0, remark: '' });

  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refreshDepts = useCallback(async () => {
    const { data } = await api.get('/depts/tree');
    setDeptTree(data);
  }, []);

  const refreshPosts = useCallback(async () => {
    const { data } = await api.get('/posts');
    setPosts(data);
  }, []);

  useEffect(() => {
    refreshDepts();
    refreshPosts();
  }, [refreshDepts, refreshPosts]);

  const flatDepts = flattenTree(deptTree);

  const saveDept = async () => {
    setBusy(true);
    setError(null);
    try {
      const payload = {
        name: deptForm.name,
        parentId: deptForm.parentId || null,
        orderNum: deptForm.orderNum,
      };
      if (deptTarget) {
        await api.patch(`/depts/${deptTarget.id}`, payload);
      } else {
        await api.post('/depts', payload);
      }
      setDeptTarget(null);
      setDeptCreating(false);
      await refreshDepts();
    } catch (e: any) {
      setError(e.response?.data?.message ?? '保存失败');
    } finally {
      setBusy(false);
    }
  };

  const deleteDept = async (d: any) => {
    if (!confirm(`确认删除部门「${d.name}」？`)) return;
    try {
      await api.delete(`/depts/${d.id}`);
      await refreshDepts();
    } catch (e: any) {
      alert(e.response?.data?.message ?? '删除失败');
    }
  };

  const savePost = async () => {
    setBusy(true);
    setError(null);
    try {
      if (postTarget) {
        await api.patch(`/posts/${postTarget.id}`, postForm);
      } else {
        await api.post('/posts', postForm);
      }
      setPostTarget(null);
      setPostCreating(false);
      await refreshPosts();
    } catch (e: any) {
      setError(e.response?.data?.message ?? '保存失败');
    } finally {
      setBusy(false);
    }
  };

  const deletePost = async (p: any) => {
    if (!confirm(`确认删除岗位「${p.name}」？`)) return;
    try {
      await api.delete(`/posts/${p.id}`);
      await refreshPosts();
    } catch (e: any) {
      alert(e.response?.data?.message ?? '删除失败');
    }
  };

  return (
    <div className="p-6">
      <PageHeader title="部门与岗位" description="部门用于层级与数据权限，岗位用于定义职责">
        <div className="flex bg-slate-100 rounded-lg p-1">
          {(['dept', 'post'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-3 py-1.5 text-sm rounded-md ${tab === t ? 'bg-white shadow text-slate-800' : 'text-slate-500'}`}
            >
              {t === 'dept' ? '部门' : '岗位'}
            </button>
          ))}
        </div>
      </PageHeader>

      {tab === 'dept' ? (
        <>
          <div className="flex justify-end mb-3">
            {hasPerm('dept:manage') ? (
              <Button
                onClick={() => {
                  setDeptCreating(true);
                  setDeptTarget(null);
                  setDeptForm({ name: '', parentId: '', orderNum: 0 });
                  setError(null);
                }}
              >
                新增部门
              </Button>
            ) : null}
          </div>
          {flatDepts.length === 0 ? (
            <Empty text="暂无部门" />
          ) : (
            <Card>
              <div className="divide-y divide-slate-100">
                {flatDepts.map(({ node, depth }) => (
                  <div key={node.id} className="flex items-center justify-between px-4 py-3">
                    <span className="text-sm text-slate-700" style={{ marginLeft: depth * 20 }}>
                      {node.name}
                      {node.children?.length ? (
                        <Badge className="ml-2">{node.children.length}</Badge>
                      ) : null}
                    </span>
                    {hasPerm('dept:manage') && node.parentId !== null ? (
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => {
                            setDeptTarget(node);
                            setDeptCreating(false);
                            setDeptForm({
                              name: node.name,
                              parentId: node.parentId ?? '',
                              orderNum: node.orderNum,
                            });
                            setError(null);
                          }}
                        >
                          编辑
                        </Button>
                        <Button size="sm" variant="danger" onClick={() => deleteDept(node)}>
                          删除
                        </Button>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </Card>
          )}
        </>
      ) : (
        <>
          <div className="flex justify-end mb-3">
            {hasPerm('post:manage') ? (
              <Button
                onClick={() => {
                  setPostCreating(true);
                  setPostTarget(null);
                  setPostForm({ name: '', code: '', sort: 0, remark: '' });
                  setError(null);
                }}
              >
                新增岗位
              </Button>
            ) : null}
          </div>
          {posts.length === 0 ? (
            <Empty text="暂无岗位" />
          ) : (
            <Card>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-slate-500 border-b border-slate-100">
                    <th className="px-4 py-3 font-medium">岗位名称</th>
                    <th className="px-4 py-3 font-medium">编码</th>
                    <th className="px-4 py-3 font-medium">排序</th>
                    <th className="px-4 py-3 font-medium text-right">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {posts.map((p) => (
                    <tr key={p.id} className="border-b border-slate-50 last:border-0">
                      <td className="px-4 py-3 text-slate-700">{p.name}</td>
                      <td className="px-4 py-3 text-slate-500">{p.code}</td>
                      <td className="px-4 py-3 text-slate-500">{p.sort}</td>
                      <td className="px-4 py-3 text-right">
                        {hasPerm('post:manage') ? (
                          <div className="flex justify-end gap-2">
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => {
                                setPostTarget(p);
                                setPostCreating(false);
                                setPostForm({
                                  name: p.name,
                                  code: p.code,
                                  sort: p.sort,
                                  remark: p.remark ?? '',
                                });
                                setError(null);
                              }}
                            >
                              编辑
                            </Button>
                            <Button size="sm" variant="danger" onClick={() => deletePost(p)}>
                              删除
                            </Button>
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
        </>
      )}

      {/* 部门表单 */}
      <Modal
        open={deptCreating || !!deptTarget}
        onClose={() => {
          setDeptCreating(false);
          setDeptTarget(null);
        }}
        title={deptTarget ? '编辑部门' : '新增部门'}
      >
        <div className="space-y-4">
          <Field label="部门名称">
            <Input
              value={deptForm.name}
              onChange={(e) => setDeptForm({ ...deptForm, name: e.target.value })}
            />
          </Field>
          <Field label="上级部门">
            <Select
              value={deptForm.parentId}
              onChange={(e) => setDeptForm({ ...deptForm, parentId: e.target.value })}
            >
              <option value="">（顶级部门）</option>
              {flatDepts
                .filter(({ node }) => node.id !== deptTarget?.id)
                .map(({ node }) => (
                  <option key={node.id} value={node.id}>{node.name}</option>
                ))}
            </Select>
          </Field>
          <Field label="显示排序">
            <Input
              type="number"
              value={deptForm.orderNum}
              onChange={(e) => setDeptForm({ ...deptForm, orderNum: Number(e.target.value) })}
            />
          </Field>
          <InlineError message={error} />
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                setDeptCreating(false);
                setDeptTarget(null);
              }}
            >
              取消
            </Button>
            <Button onClick={saveDept} disabled={busy || !deptForm.name}>
              {busy ? '保存中…' : '保存'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* 岗位表单 */}
      <Modal
        open={postCreating || !!postTarget}
        onClose={() => {
          setPostCreating(false);
          setPostTarget(null);
        }}
        title={postTarget ? '编辑岗位' : '新增岗位'}
      >
        <div className="space-y-4">
          <Field label="岗位名称">
            <Input
              value={postForm.name}
              onChange={(e) => setPostForm({ ...postForm, name: e.target.value })}
            />
          </Field>
          <Field label="岗位编码">
            <Input
              value={postForm.code}
              onChange={(e) => setPostForm({ ...postForm, code: e.target.value })}
              disabled={!!postTarget}
            />
          </Field>
          <Field label="排序">
            <Input
              type="number"
              value={postForm.sort}
              onChange={(e) => setPostForm({ ...postForm, sort: Number(e.target.value) })}
            />
          </Field>
          <InlineError message={error} />
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                setPostCreating(false);
                setPostTarget(null);
              }}
            >
              取消
            </Button>
            <Button onClick={savePost} disabled={busy || !postForm.name || !postForm.code}>
              {busy ? '保存中…' : '保存'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
