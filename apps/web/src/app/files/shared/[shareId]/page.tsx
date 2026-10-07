'use client';
import { useEffect, useState } from 'react';
import { Card, Button } from '@/components/ui';
import { api } from '@/lib/api';

type State =
  | { phase: 'loading' }
  | { phase: 'ready'; blobUrl: string; filename: string; contentType: string }
  | { phase: 'expired'; message: string }
  | { phase: 'invalid'; message: string }
  | { phase: 'login-required'; message: string };

export default function SharedFilePage({ params }: { params: { shareId: string } }) {
  const [state, setState] = useState<State>({ phase: 'loading' });

  useEffect(() => {
    let blobUrl: string | null = null;
    (async () => {
      try {
        const res = await api.get(`/files/shared/${params.shareId}/download`, {
          responseType: 'blob',
        });
        const filename =
          decodeURIComponent(
            (res.headers['content-disposition'] ?? '')
              .split('filename=')[1]
              ?.replace(/"/g, '') ?? '',
          ) || `shared-${params.shareId}`;
        blobUrl = URL.createObjectURL(res.data);
        setState({
          phase: 'ready',
          blobUrl,
          filename,
          contentType: String(res.headers['content-type'] ?? 'application/octet-stream'),
        });
      } catch (e: any) {
        // 错误体也是 blob，解析 JSON
        const raw = e.response?.data instanceof Blob ? await e.response.data.text() : '';
        let message = raw;
        try {
          message = JSON.parse(raw).message ?? raw;
        } catch {
          /* keep raw */
        }
        const status = e.response?.status;
        if (status === 410) setState({ phase: 'expired', message });
        else if (status === 401 || status === 403)
          setState({ phase: 'login-required', message });
        else setState({ phase: 'invalid', message: message || '共享链接无效' });
      }
    })();
    return () => {
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [params.shareId]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
      <Card className="w-full max-w-md p-8 text-center">
        {state.phase === 'loading' ? (
          <p className="text-sm text-slate-400">正在定位共享文件…</p>
        ) : null}

        {state.phase === 'ready' ? (
          <div className="space-y-4">
            <div className="w-12 h-12 mx-auto rounded-full bg-blue-50 flex items-center justify-center text-blue-600">
              ↓
            </div>
            <h1 className="text-lg font-semibold text-slate-800 break-all">{state.filename}</h1>
            <p className="text-xs text-slate-400">访客下载 · {state.contentType}</p>
            <a href={state.blobUrl} download={state.filename}>
              <Button className="w-full">下载文件</Button>
            </a>
          </div>
        ) : null}

        {state.phase === 'expired' ? (
          <ErrorBox
            title="共享已失效"
            message={state.message}
          />
        ) : null}

        {state.phase === 'login-required' ? (
          <ErrorBox
            title="需要指定账号"
            message={state.message || '该文件仅指定用户可下载，请先登录对应账号'}
          />
        ) : null}

        {state.phase === 'invalid' ? (
          <ErrorBox title="链接无效" message={state.message} />
        ) : null}
      </Card>
    </div>
  );
}

function ErrorBox({ title, message }: { title: string; message: string }) {
  return (
    <div className="space-y-2">
      <h1 className="text-lg font-semibold text-slate-800">{title}</h1>
      <p className="text-sm text-slate-500">{message}</p>
    </div>
  );
}
