'use client';
import { Fragment, useEffect, useState, useCallback } from 'react';
import PageHeader from '@/components/PageHeader';
import {
  Card, Button, Modal, Input, Field, Empty, InlineError,
} from '@/components/ui';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';

function fmtSize(big: string) {
  const n = Number(big);
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export default function FilesGlobalPage() {
  const hasPerm = useAuthStore((s) => s.hasPerm);
  const [list, setList] = useState<any[]>([]);
  const [shareFor, setShareFor] = useState<any | null>(null);
  const [shareUrl, setShareUrl] = useState('');
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const { data } = await api.get('/files');
    setList(data);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const download = async (f: any) => {
    const res = await api.get(`/files/${f.id}/download`, { responseType: 'blob' });
    const url = URL.createObjectURL(res.data);
    const a = document.createElement('a');
    a.href = url;
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
      <PageHeader title="文件" description="组织全部交付文件，上传入口在项目详情页" />

      {list.length === 0 ? (
        <Empty text="暂无文件" />
      ) : (
        <Card>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-500 border-b border-slate-100">
                <th className="px-4 py-3 font-medium">文件名</th>
                <th className="px-4 py-3 font-medium">所属项目</th>
                <th className="px-4 py-3 font-medium">版本</th>
                <th className="px-4 py-3 font-medium">大小</th>
                <th className="px-4 py-3 font-medium">上传人</th>
                <th className="px-4 py-3 font-medium text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {list.map((f) => (
                <Fragment key={f.id}>
                  <tr className="border-b border-slate-50 last:border-0 hover:bg-slate-50">
                    <td className="px-4 py-3 text-slate-700">{f.name}</td>
                    <td className="px-4 py-3 text-slate-500">{f.project?.name ?? '-'}</td>
                    <td className="px-4 py-3 text-slate-500">v{f.version}</td>
                    <td className="px-4 py-3 text-slate-500">{fmtSize(f.size)}</td>
                    <td className="px-4 py-3 text-slate-500">{f.uploadedBy?.name ?? '-'}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-1.5">
                        <Button size="sm" variant="secondary" onClick={() => download(f)}>
                          下载
                        </Button>
                        {hasPerm('file:share') ? (
                          <Button
                            size="sm"
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
                    </td>
                  </tr>
                </Fragment>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <Modal open={!!shareFor} onClose={() => setShareFor(null)} title={`共享「${shareFor?.name ?? ''}」`}>
        <div className="space-y-4">
          <p className="text-sm text-slate-500">生成 7 天有效的访客链接，无需登录即可下载。</p>
          <InlineError message={error} />
          {shareUrl ? (
            <Field label="共享链接">
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
