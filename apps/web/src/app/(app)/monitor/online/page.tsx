'use client';
import { useEffect, useState, useCallback, useRef } from 'react';
import PageHeader from '@/components/PageHeader';
import { Card, Button, Empty, Badge } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { RefreshCw, LogOut, Wifi } from 'lucide-react';

type OnlineData = {
  totalConnections: number;
  totalUsers: number;
  users: Array<{ userId: string; name: string; email: string; connectionCount: number }>;
  connections: Array<{ socketId: string; userId: string; name: string; email: string }>;
};

export default function OnlineUsersPage() {
  const hasPerm = useAuthStore((s) => s.hasPerm);
  const [data, setData] = useState<OnlineData | null>(null);
  const [loading, setLoading] = useState(true);
  const timerRef = useRef<ReturnType<typeof setInterval>>();

  const load = useCallback(async () => {
    const { data: res } = await api.get('/monitor/online');
    setData(res);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    timerRef.current = setInterval(load, 10_000);
    return () => clearInterval(timerRef.current);
  }, [load]);

  const forceLogout = async (socketId: string) => {
    if (!confirm('强制下线该连接？用户需重新连接。')) return;
    await api.delete(`/monitor/online/${socketId}`);
    load();
  };

  return (
    <div>
      <PageHeader title="在线用户" description="当前通过 WebSocket 接入的实时连接；集群部署时跨节点聚合">
        <Button variant="secondary" onClick={load}>
          <RefreshCw className="w-4 h-4 mr-1.5" />刷新
        </Button>
      </PageHeader>

      <div className="grid grid-cols-2 gap-4 mb-4">
        <Card className="p-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center">
              <Wifi className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <div className="text-2xl font-semibold text-slate-900">{data?.totalUsers ?? '-'}</div>
              <div className="text-xs text-slate-500">在线用户</div>
            </div>
          </div>
        </Card>
        <Card className="p-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-emerald-50 flex items-center justify-center">
              <RefreshCw className="w-5 h-5 text-emerald-600" />
            </div>
            <div>
              <div className="text-2xl font-semibold text-slate-900">{data?.totalConnections ?? '-'}</div>
              <div className="text-xs text-slate-500">活动连接（含多端）</div>
            </div>
          </div>
        </Card>
      </div>

      <Card className="overflow-hidden">
        {loading || !data ? (
          <div className="p-4"><Empty text="加载中..." /></div>
        ) : !data.users.length ? (
          <div className="p-4"><Empty text="当前没有在线用户" /></div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="bg-slate-50 text-left text-xs text-slate-500">
                <th className="py-2 px-4 font-medium">用户</th>
                <th className="py-2 px-4 font-medium w-28">连接数</th>
                <th className="py-2 px-4 font-medium">连接详情</th>
                <th className="py-2 px-4 font-medium text-right w-24">操作</th>
              </tr>
            </thead>
            <tbody>
              {data.users.map((u) => {
                const conns = data.connections.filter((c) => c.userId === u.userId);
                return (
                  <tr key={u.userId} className="border-b border-slate-100 last:border-0 hover:bg-slate-50 align-top">
                    <td className="py-2.5 px-4">
                      <div className="text-sm text-slate-800">{u.name}</div>
                      <div className="text-xs text-slate-500">{u.email}</div>
                    </td>
                    <td className="py-2.5 px-4">
                      <Badge tone="blue">{u.connectionCount}</Badge>
                    </td>
                    <td className="py-2.5 px-4">
                      <div className="flex flex-col gap-1">
                        {conns.map((c) => (
                          <code key={c.socketId} className="text-[11px] text-slate-500 font-mono">{c.socketId}</code>
                        ))}
                      </div>
                    </td>
                    <td className="py-2.5 px-4 text-right">
                      {hasPerm('monitor:online:force-logout') && conns.map((c) => (
                        <Button
                          key={c.socketId}
                          size="sm"
                          variant="ghost"
                          title={`强制下线 ${c.socketId}`}
                          onClick={() => forceLogout(c.socketId)}
                        >
                          <LogOut className="w-3.5 h-3.5 text-red-500" />
                        </Button>
                      ))}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
