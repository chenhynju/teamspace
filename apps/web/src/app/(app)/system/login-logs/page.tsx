'use client';
import { useEffect, useState, useCallback } from 'react';
import PageHeader from '@/components/PageHeader';
import {
  Card, Button, Input, Select, Field, Empty, Badge,
} from '@/components/ui';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { Trash2, ChevronLeft, ChevronRight } from 'lucide-react';

type LoginLogRow = {
  id: string;
  userId: string | null;
  username: string;
  ip: string | null;
  browser: string | null;
  os: string | null;
  status: number;
  msg: string | null;
  createdAt: string;
};

type PageData = { items: LoginLogRow[]; total: number; page: number; pageSize: number };

export default function LoginLogsPage() {
  const hasPerm = useAuthStore((s) => s.hasPerm);
  const [data, setData] = useState<PageData | null>(null);
  const [loading, setLoading] = useState(true);

  const [username, setUsername] = useState('');
  const [ip, setIp] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);

  const PAGE_SIZE = 20;

  const load = useCallback(async (p = 1) => {
    const { data: res } = await api.get('/login-logs', {
      params: { username, ip, status, page: p, pageSize: PAGE_SIZE },
    });
    setData(res);
    setLoading(false);
  }, [username, ip, status]);

  useEffect(() => { load(1); }, [load]);

  const search = () => {
    setPage(1);
    load(1);
  };

  const changePage = (p: number) => {
    setPage(p);
    load(p);
  };

  const remove = async (id: string) => {
    if (!confirm('确认删除该条登录日志？')) return;
    await api.delete(`/login-logs/${id}`);
    load(page);
  };

  const clearAll = async () => {
    if (!confirm('确认清空全部登录日志？此操作不可恢复')) return;
    await api.post('/login-logs/clear');
    load(1);
  };

  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 0;

  return (
    <div>
      <PageHeader title="登录日志" description="登录、注册、邮箱验证、密码重置等认证事件的审计线索">
        {hasPerm('logininfor:remove') && (
          <Button variant="danger" onClick={clearAll}>清空日志</Button>
        )}
      </PageHeader>

      <Card className="p-4 mb-4">
        <div className="flex flex-wrap items-end gap-2">
          <Field label="账号">
            <Input value={username} onChange={(e) => setUsername(e.target.value)} className="w-48" placeholder="邮箱" />
          </Field>
          <Field label="IP">
            <Input value={ip} onChange={(e) => setIp(e.target.value)} className="w-40" />
          </Field>
          <Field label="状态">
            <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-32">
              <option value="">全部</option>
              <option value="0">成功</option>
              <option value="1">失败</option>
            </Select>
          </Field>
          <Button onClick={search}>搜索</Button>
        </div>
      </Card>

      <Card className="overflow-hidden">
        {loading || !data ? (
          <div className="p-4"><Empty text="加载中..." /></div>
        ) : !data.items.length ? (
          <div className="p-4"><Empty text="暂无登录日志" /></div>
        ) : (
          <>
            <table className="w-full">
              <thead>
                <tr className="bg-slate-50 text-left text-xs text-slate-500">
                  <th className="py-2 px-4 font-medium">账号</th>
                  <th className="py-2 px-4 font-medium">IP</th>
                  <th className="py-2 px-4 font-medium w-32">结果</th>
                  <th className="py-2 px-4 font-medium">事件</th>
                  <th className="py-2 px-4 font-medium w-44">时间</th>
                  <th className="py-2 px-4 font-medium text-right w-20">操作</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((l) => (
                  <tr key={l.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                    <td className="py-2.5 px-4 text-sm text-slate-800 whitespace-nowrap">{l.username}</td>
                    <td className="py-2.5 px-4 text-xs text-slate-500 font-mono">{l.ip ?? '-'}</td>
                    <td className="py-2.5 px-4">
                      {l.status === 0 ? <Badge tone="green">成功</Badge> : <Badge tone="red">失败</Badge>}
                    </td>
                    <td className="py-2.5 px-4 text-xs text-slate-500">{l.msg ?? '-'}</td>
                    <td className="py-2.5 px-4 text-xs text-slate-500 whitespace-nowrap">
                      {new Date(l.createdAt).toLocaleString('zh-CN')}
                    </td>
                    <td className="py-2.5 px-4 text-right">
                      {hasPerm('logininfor:remove') && (
                        <Button size="sm" variant="ghost" onClick={() => remove(l.id)} title="删除">
                          <Trash2 className="w-3.5 h-3.5 text-red-500" />
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {totalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100">
                <span className="text-xs text-slate-500">共 {data.total} 条，第 {page}/{totalPages} 页</span>
                <div className="flex gap-1">
                  <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => changePage(page - 1)}>
                    <ChevronLeft className="w-3.5 h-3.5" />
                  </Button>
                  <Button size="sm" variant="secondary" disabled={page >= totalPages} onClick={() => changePage(page + 1)}>
                    <ChevronRight className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </Card>
    </div>
  );
}
