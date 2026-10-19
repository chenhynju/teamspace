'use client';
import { useCallback, useEffect, useState } from 'react';
import PageHeader from '@/components/PageHeader';
import { Button, Card, Field, Input, Select, InlineError } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';

export default function GroupsPage() {
  const orgId = useAuthStore(s => s.currentOrgId);
  const [groups, setGroups] = useState<any[]>([]);
  const [members, setMembers] = useState<any[]>([]);
  const [projects, setProjects] = useState<any[]>([]);
  const [selected, setSelected] = useState('');
  const [name, setName] = useState('');
  const [kind, setKind] = useState('TEAM');
  const [membershipId, setMembershipId] = useState('');
  const [role, setRole] = useState('MEMBER');
  const [projectId, setProjectId] = useState('');
  const [access, setAccess] = useState('READ');
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    const [g, m, p] = await Promise.all([api.get('/groups'), api.get('/members').catch(() => ({ data: [] })), api.get('/projects')]);
    setGroups(g.data); setMembers(Array.isArray(m.data) ? m.data : m.data.items ?? []); setProjects(p.data);
  }, []);
  useEffect(() => { setSelected(''); setGroups([]); refresh().catch(e => setError(e.response?.data?.message ?? '加载失败')); }, [orgId, refresh]);
  const run = async (fn: () => Promise<unknown>) => { setError(null); try { await fn(); await refresh(); } catch (e: any) { setError(e.response?.data?.message ?? '操作失败'); } };
  const current = groups.find(g => g.id === selected);
  return <div className="p-6 space-y-5">
    <PageHeader title="协作单元" description="跨部门组建团队或客户交付组。成员可加入多个单元，资源按需授权。" />
    <InlineError message={error} />
    <Card className="p-4 flex gap-3 items-end flex-wrap">
      <Field label="单元名称"><Input value={name} onChange={e => setName(e.target.value)} /></Field>
      <Field label="用途"><Select value={kind} onChange={e => setKind(e.target.value)}><option value="TEAM">团队</option><option value="DEPARTMENT">部门</option><option value="CLIENT">客户交付组</option><option value="COMMUNITY">兴趣社区</option></Select></Field>
      <Button disabled={!name.trim()} onClick={() => run(async () => { const r = await api.post('/groups', { name, kind }); setSelected(r.data.id); setName(''); })}>创建协作单元</Button>
    </Card>
    <div className="grid md:grid-cols-3 gap-4"><Card className="p-3 space-y-2">{groups.map(g => <button key={g.id} onClick={() => setSelected(g.id)} className={`block w-full text-left p-3 rounded ${selected === g.id ? 'bg-blue-50' : 'bg-slate-50'}`}>{g.name} <span className="text-xs">{g.archivedAt ? '已归档' : `${g.members.length} 人 · ${g.grants.length} 项授权`}</span></button>)}</Card>
    {current && <Card className="md:col-span-2 p-5 space-y-5"><h2 className="font-semibold">{current.name}</h2>
      {!current.archivedAt && <>
        <div className="flex gap-2 flex-wrap"><Field label="组织成员"><Select value={membershipId} onChange={e => setMembershipId(e.target.value)}><option value="">选择成员</option>{members.map(m => <option key={m.id} value={m.id}>{m.user?.name ?? m.name}</option>)}</Select></Field><Field label="单元角色"><Select value={role} onChange={e => setRole(e.target.value)}><option value="MEMBER">成员</option><option value="MANAGER">负责人</option></Select></Field><Button disabled={!membershipId} onClick={() => run(() => api.post(`/groups/${selected}/members`, { membershipId, role }))}>保存成员</Button></div>
        <ul>{current.members.map((m: any) => <li key={m.id} className="flex justify-between py-2">{m.membership.user.name} · {m.role === 'MANAGER' ? '负责人' : '成员'}<Button variant="ghost" onClick={() => run(() => api.delete(`/groups/${selected}/members/${m.membershipId}`))}>移除</Button></li>)}</ul>
        <div className="flex gap-2 flex-wrap"><Field label="项目资源"><Select value={projectId} onChange={e => setProjectId(e.target.value)}><option value="">选择项目</option>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field><Field label="访问级别"><Select value={access} onChange={e => setAccess(e.target.value)}><option value="READ">查看</option><option value="WRITE">协作编辑</option><option value="MANAGE">资源管理</option></Select></Field><Button disabled={!projectId} onClick={() => run(() => api.post(`/groups/${selected}/grants`, { projectId, access }))}>授权项目</Button></div>
        <p className="text-sm text-slate-500">项目设为“仅授权单元可见”后，其他普通成员无法访问。组织管理员和项目负责人保留管理权。</p>
        {projects.map(p => <div key={p.id} className="flex items-center justify-between gap-2"><span>{p.name}</span><Select aria-label={`${p.name} 可见性`} value={p.visibility} onChange={e => run(() => api.patch(`/groups/resources/projects/${p.id}`, { visibility: e.target.value }))}><option value="ORGANIZATION">组织成员可见</option><option value="RESTRICTED">仅授权单元可见</option></Select></div>)}
        <ul>{current.grants.map((g: any) => <li key={g.id} className="flex justify-between py-2">{projects.find(p => p.id === g.projectId)?.name ?? g.projectId} · {g.access}<Button variant="ghost" onClick={() => run(() => api.delete(`/groups/${selected}/grants/${g.projectId}`))}>撤销授权</Button></li>)}</ul>
        <Button variant="danger" onClick={() => { if (confirm(`归档「${current.name}」会使其资源授权失效，确认继续？`)) run(() => api.post(`/groups/${selected}/archive`)); }}>归档单元</Button>
      </>}
    </Card>}</div>
  </div>;
}
