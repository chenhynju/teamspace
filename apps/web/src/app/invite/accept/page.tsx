'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Card, Button, Badge } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';

const STATUS_TONE: Record<string, any> = {
  PENDING: 'blue',
  ACCEPTED: 'green',
  REVOKED: 'red',
  EXPIRED: 'amber',
};
const STATUS_LABEL: Record<string, string> = {
  PENDING: '待接受',
  ACCEPTED: '已接受',
  REVOKED: '已撤销',
  EXPIRED: '已过期',
};

export default function InviteAcceptPage() {
  const [token, setToken] = useState('');
  const [preview, setPreview] = useState<any>(null);
  const [loadError, setLoadError] = useState('');
  const [acceptError, setAcceptError] = useState('');
  const [done, setDone] = useState<{ organizationId: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const isLoggedIn = !!useAuthStore((s) => s.token);
  const setCurrentOrg = useAuthStore((s) => s.setCurrentOrg);

  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('token') ?? '';
    setToken(t);
    if (!t) return;
    api
      .get('/invitations/preview', { params: { token: t } })
      .then((r) => setPreview(r.data))
      .catch((e) => setLoadError(e.response?.data?.message ?? '邀请无效'));
  }, []);

  const accept = async () => {
    setBusy(true);
    setAcceptError('');
    try {
      const { data } = await api.post('/invitations/accept', { token });
      await setCurrentOrg(data.organizationId);
      setDone({ organizationId: data.organizationId });
    } catch (e: any) {
      setAcceptError(e.response?.data?.message ?? '接受失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
      <Card className="w-full max-w-md p-8">
        <h1 className="text-xl font-bold text-slate-800 mb-1">加入组织</h1>
        <p className="text-sm text-slate-500 mb-6">TeamSpace 邀请</p>

        {loadError ? (
          <div className="bg-red-50 text-red-600 text-sm p-3 rounded">{loadError}</div>
        ) : null}

        {preview ? (
          <div className="space-y-3 text-sm">
            <Row label="组织" value={preview.organization.name} />
            <Row label="授予角色" value={preview.role.name} />
            <Row label="受邀邮箱" value={preview.email} />
            <div className="flex justify-between items-center">
              <span className="text-slate-400">邀请状态</span>
              <Badge tone={STATUS_TONE[preview.status]}>{STATUS_LABEL[preview.status]}</Badge>
            </div>

            {!isLoggedIn && preview.status === 'PENDING' ? (
              <div className="bg-amber-50 text-amber-700 text-xs p-3 rounded">
                请先
                <Link href={`/login?next=${encodeURIComponent(window.location.href)}`} className="underline mx-1">
                  登录
                </Link>
                受邀邮箱账号后再接受。
              </div>
            ) : null}

            {acceptError ? (
              <div className="bg-red-50 text-red-600 text-xs p-3 rounded">{acceptError}</div>
            ) : null}

            {done ? (
              <div className="space-y-3">
                <div className="bg-emerald-50 text-emerald-700 text-sm p-3 rounded">
                  已成功加入 {preview.organization.name}
                </div>
                <Link href="/dashboard">
                  <Button className="w-full">进入工作空间</Button>
                </Link>
              </div>
            ) : (
              <Button
                className="w-full"
                disabled={busy || preview.status !== 'PENDING' || !isLoggedIn}
                onClick={accept}
              >
                {busy ? '处理中…' : '接受邀请'}
              </Button>
            )}
          </div>
        ) : !loadError ? (
          <p className="text-sm text-slate-400">正在加载邀请…</p>
        ) : null}
      </Card>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-slate-400">{label}</span>
      <span className="text-slate-700">{value}</span>
    </div>
  );
}
