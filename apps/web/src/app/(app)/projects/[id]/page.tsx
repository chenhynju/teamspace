'use client';
import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import PageHeader from '@/components/PageHeader';
import {
  Card, Button, Badge, Input, Select, Field, Empty, Modal, InlineError,
} from '@/components/ui';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { useProjectRealtime } from '@/lib/use-realtime';

const STATUS_LABEL: Record<string, string> = {
  DRAFT: '草稿',
  ACTIVE: '进行中',
  DELIVERED: '已交付',
  ARCHIVED: '已归档',
};
const STATUS_TONE: Record<string, any> = {
  DRAFT: 'slate',
  ACTIVE: 'blue',
  DELIVERED: 'green',
  ARCHIVED: 'amber',
};
const TASK_LABEL: Record<string, string> = {
  TODO: '待办',
  IN_PROGRESS: '进行中',
  DONE: '已完成',
};
const TASK_NEXT: Record<string, string> = {
  TODO: 'IN_PROGRESS',
  IN_PROGRESS: 'DONE',
  DONE: 'TODO',
};

export default function ProjectDetail({ params }: { params: { id: string } }) {
  const hasPerm = useAuthStore((s) => s.hasPerm);
  const currentOrgId = useAuthStore((s) => s.currentOrgId);
  const [project, setProject] = useState<any>(null);
  const [members, setMembers] = useState<any[]>([]);
  const [taskTitle, setTaskTitle] = useState('');
  const [taskAssignee, setTaskAssignee] = useState('');
  const [shareFor, setShareFor] = useState<any | null>(null);
  const [shareUrl, setShareUrl] = useState('');
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const { data } = await api.get(`/projects/${params.id}`);
      setProject(data);
      setError(null);
    } catch (e: any) {
      setError(e.response?.data?.message || '项目加载失败');
    }
  }, [params.id]);

  // 实时协作：在线 presence + 他人改动任务时自动刷新
  const { presence, connected } = useProjectRealtime(currentOrgId, params.id, refresh);

  useEffect(() => {
    refresh();
    api
      .get('/members')
      .then((r) => setMembers(r.data))
      .catch(() => setMembers([]));
  }, [refresh]);

  if (!project) {
    if (error) {
      return <div className="p-8 text-sm text-red-500">{error}</div>;
    }
    return <div className="p-8 text-sm text-slate-400">加载中…</div>;
  }

  const addTask = async () => {
    if (!taskTitle.trim()) return;
    try {
      await api.post('/tasks', {
        projectId: project.id,
        title: taskTitle,
        assigneeId: taskAssignee || undefined,
      });
      setTaskTitle('');
      await refresh();
    } catch (e: any) {
      alert(e.response?.data?.message ?? '创建失败');
    }
  };

  const cycleTask = async (t: any) => {
    await api.patch(`/tasks/${t.id}`, { status: TASK_NEXT[t.status] });
    await refresh();
  };

  const upload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const fd = new FormData();
    fd.append('file', f);
    fd.append('projectId', project.id);
    try {
      await api.post('/files/upload', fd);
      await refresh();
    } catch (e: any) {
      alert(e.response?.data?.message ?? '上传失败');
    } finally {
      e.target.value = '';
    }
  };

  const download = async (fileId: string) => {
    const res = await api.get(`/files/${fileId}/download`, { responseType: 'blob' });
    const url = URL.createObjectURL(res.data);
    const a = document.createElement('a');
    a.href = url;
    a.download = '';
    a.click();
    URL.revokeObjectURL(url);
  };

  const createShare = async () => {
    setError(null);
    try {
      const { data } = await api.post(`/files/${shareFor.id}/share`, { ttlDays: 7 });
      setShareUrl(data.url);
    } catch (e: any) {
      setError(e.response?.data?.message ?? '共享失败');
    }
  };

  return (
    <div className="p-6">
      <PageHeader title={project.name}>
        <PresenceBar presence={presence} connected={connected} />
        <Link href="/projects">
          <Button variant="secondary">返回列表</Button>
        </Link>
      </PageHeader>

      <div className="grid lg:grid-cols-3 gap-4">
        {/* 左：信息 + 文件 */}
        <div className="space-y-4 lg:col-span-1">
          <Card className="p-5 space-y-3 text-sm">
            <div className="flex items-center gap-2">
              <Badge tone={STATUS_TONE[project.status]}>{STATUS_LABEL[project.status]}</Badge>
            </div>
            <Info label="工作区" value={project.workspace.name} />
            <Info label="负责人" value={project.owner.name} />
            <p className="text-slate-500">{project.description || '（无描述）'}</p>
          </Card>

          <Card className="p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-slate-700">交付文件</h2>
              {hasPerm('file:manage') ? (
                <label className="text-xs text-blue-600 cursor-pointer hover:underline">
                  上传文件
                  <input type="file" className="hidden" onChange={upload} />
                </label>
              ) : null}
            </div>
            {project.files.length === 0 ? (
              <p className="text-xs text-slate-400">暂无文件</p>
            ) : (
              <div className="space-y-2">
                {project.files.map((f: any) => (
                  <div key={f.id} className="flex items-center justify-between text-sm">
                    <span className="text-slate-700 truncate">
                      {f.name}
                      <span className="text-xs text-slate-400 ml-1">v{f.version}</span>
                    </span>
                    <div className="flex gap-1 shrink-0">
                      <Button size="sm" variant="ghost" onClick={() => download(f.id)}>
                        下载
                      </Button>
                      {hasPerm('file:share') ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setShareFor(f);
                            setShareUrl('');
                            setError(null);
                          }}
                        >
                          共享
                        </Button>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        {/* 右：任务 */}
        <Card className="p-5 lg:col-span-2">
          <h2 className="text-sm font-semibold text-slate-700 mb-4">任务看板</h2>
          {hasPerm('task:manage') ? (
            <div className="flex gap-2 mb-4">
              <Input
                placeholder="新增任务标题，回车创建"
                value={taskTitle}
                onChange={(e) => setTaskTitle(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addTask()}
                className="flex-1"
              />
              <Select value={taskAssignee} onChange={(e) => setTaskAssignee(e.target.value)} className="w-36">
                <option value="">不指派</option>
                {members.map((m) => (
                  <option key={m.id} value={m.userId}>{m.user.name}</option>
                ))}
              </Select>
              <Button onClick={addTask}>添加</Button>
            </div>
          ) : null}

          {project.tasks.length === 0 ? (
            <Empty text="暂无任务" />
          ) : (
            <div className="divide-y divide-slate-100">
              {project.tasks.map((t: any) => (
                <div key={t.id} className="flex items-center justify-between py-3">
                  <div className="flex items-center gap-3">
                    <span className={`text-sm ${t.status === 'DONE' ? 'line-through text-slate-400' : 'text-slate-700'}`}>
                      {t.title}
                    </span>
                    {t.assignee ? (
                      <span className="text-xs text-slate-400">@{t.assignee.name}</span>
                    ) : null}
                  </div>
                  {hasPerm('task:manage') ? (
                    <Button size="sm" variant="secondary" onClick={() => cycleTask(t)}>
                      {TASK_LABEL[t.status]}
                    </Button>
                  ) : (
                    <Badge>{TASK_LABEL[t.status]}</Badge>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <Modal
        open={!!shareFor}
        onClose={() => setShareFor(null)}
        title={`共享「${shareFor?.name ?? ''}」`}
      >
        <div className="space-y-4">
          <p className="text-sm text-slate-500">将生成一个有效期 7 天的访客链接，无需登录即可下载。</p>
          <InlineError message={error} />
          {shareUrl ? (
            <Field label="共享链接（复制发送）">
              <Input readOnly value={shareUrl} onFocus={(e) => e.target.select()} />
            </Field>
          ) : null}
          <div className="flex justify-end">
            <Button onClick={createShare}>生成共享链接</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

/** 在线成员条：连接状态点 + 重叠头像（首字）+ 人数 */
function PresenceBar({
  presence,
  connected,
}: {
  presence: { userId: string; name: string; color: string }[];
  connected: boolean;
}) {
  return (
    <div className="flex items-center gap-2 mr-2">
      <span
        className={`w-2 h-2 rounded-full ${connected ? 'bg-green-500' : 'bg-slate-300'}`}
        title={connected ? '实时连接中' : '实时未连接'}
      />
      <div className="flex -space-x-2">
        {presence.map((u) => (
          <span
            key={u.userId}
            title={u.name}
            className="w-7 h-7 rounded-full text-white text-xs flex items-center justify-center ring-2 ring-white"
            style={{ background: u.color }}
          >
            {u.name.slice(0, 1)}
          </span>
        ))}
      </div>
      <span className="text-xs text-slate-500">{presence.length} 人在线</span>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-slate-400">{label}</span>
      <span className="text-slate-700">{value}</span>
    </div>
  );
}
