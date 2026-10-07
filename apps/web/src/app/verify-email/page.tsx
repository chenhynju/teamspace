'use client';
import { Suspense, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';

function VerifyInner() {
  const params = useSearchParams();
  const router = useRouter();
  const token = params.get('token') ?? '';
  const setToken = useAuthStore((s) => s.setToken);
  const loadProfile = useAuthStore((s) => s.loadProfile);

  const [state, setState] = useState<'verifying' | 'success' | 'error'>('verifying');
  const [message, setMessage] = useState('');
  const [code, setCode] = useState('');
  const [email, setEmail] = useState('');
  const [resendNotice, setResendNotice] = useState('');
  const called = useRef(false);

  useEffect(() => {
    if (called.current) return;
    called.current = true;
    if (!token) {
      setState('error');
      setCode('TOKEN_INVALID');
      setMessage('验证链接缺少 token，请重新获取验证邮件');
      return;
    }
    (async () => {
      try {
        const { data } = await api.post('/auth/verify-email', { token });
        setToken(data.accessToken);
        await loadProfile();
        setState('success');
        setTimeout(() => router.push('/dashboard'), 600);
      } catch (e: any) {
        setState('error');
        setCode(e.response?.data?.code ?? '');
        setMessage(e.response?.data?.message ?? '验证失败，请稍后再试');
      }
    })();
  }, [token, setToken, loadProfile, router]);

  const resend = async () => {
    setResendNotice('');
    if (!email) {
      setResendNotice('请输入注册时使用的邮箱');
      return;
    }
    try {
      await api.post('/auth/resend-verification', { email });
      router.push(`/check-email?email=${encodeURIComponent(email)}`);
    } catch (e: any) {
      setResendNotice(e.response?.data?.message || '发送失败，请稍后再试');
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-lg p-8 text-center">
        {state === 'verifying' && (
          <>
            <div className="mx-auto mb-4 w-12 h-12 rounded-full bg-blue-50 flex items-center justify-center text-2xl animate-pulse">
              ⏳
            </div>
            <h1 className="text-xl font-bold mb-2">正在验证邮箱…</h1>
            <p className="text-slate-500 text-sm">请稍候</p>
          </>
        )}

        {state === 'success' && (
          <>
            <div className="mx-auto mb-4 w-12 h-12 rounded-full bg-green-50 flex items-center justify-center text-2xl">
              ✅
            </div>
            <h1 className="text-xl font-bold mb-2">邮箱验证成功</h1>
            <p className="text-slate-500 text-sm">即将进入工作台…</p>
          </>
        )}

        {state === 'error' && (
          <>
            <div className="mx-auto mb-4 w-12 h-12 rounded-full bg-red-50 flex items-center justify-center text-2xl">
              ⚠️
            </div>
            <h1 className="text-xl font-bold mb-2">验证未完成</h1>
            <p className="text-slate-500 text-sm mb-6">{message}</p>

            {(code === 'TOKEN_EXPIRED' || code === 'TOKEN_INVALID') && (
              <div className="space-y-3 text-left">
                <label className="block text-xs text-slate-500">输入注册邮箱，重新获取验证邮件</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com"
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                {resendNotice && (
                  <div className="text-xs text-red-600">{resendNotice}</div>
                )}
                <button
                  onClick={resend}
                  className="w-full bg-blue-600 text-white py-2 rounded-lg hover:bg-blue-700 text-sm"
                >
                  重新发送验证邮件
                </button>
              </div>
            )}

            <p className="text-sm text-slate-500 mt-6">
              <Link href="/login" className="text-blue-600">返回登录</Link>
            </p>
          </>
        )}
      </div>
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense>
      <VerifyInner />
    </Suspense>
  );
}
