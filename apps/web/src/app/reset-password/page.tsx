'use client';
import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';

const schema = z
  .object({
    password: z.string().min(8, '密码至少 8 位'),
    confirm: z.string(),
  })
  .refine((d) => d.password === d.confirm, {
    message: '两次输入的密码不一致',
    path: ['confirm'],
  });

function ResetInner() {
  const params = useSearchParams();
  const router = useRouter();
  const token = params.get('token') ?? '';
  const setToken = useAuthStore((s) => s.setToken);
  const loadProfile = useAuthStore((s) => s.loadProfile);

  const [error, setError] = useState('');
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const form = useForm({ resolver: zodResolver(schema) });

  const onSubmit = form.handleSubmit(async (d) => {
    if (!token) {
      setCode('TOKEN_INVALID');
      setError('重置链接缺少 token，请重新获取重置邮件');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const { data } = await api.post('/auth/reset-password', {
        token,
        password: d.password,
      });
      setToken(data.accessToken);
      await loadProfile();
      router.push('/dashboard');
    } catch (e: any) {
      setCode(e.response?.data?.code ?? '');
      setError(e.response?.data?.message ?? '重置失败，请稍后再试');
    } finally {
      setLoading(false);
    }
  });

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-lg p-8">
        <h1 className="text-2xl font-bold text-center mb-2">设置新密码</h1>
        <p className="text-center text-slate-500 mb-6 text-sm">请输入你的新密码</p>

        {error && <div className="bg-red-50 text-red-600 text-sm p-3 rounded mb-4">{error}</div>}

        {(code === 'TOKEN_EXPIRED' || code === 'TOKEN_INVALID') && (
          <div className="text-center mb-4">
            <Link href="/forgot-password" className="text-sm text-blue-600 hover:underline">
              重新获取重置链接
            </Link>
          </div>
        )}

        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">新密码（至少 8 位）</label>
            <input
              {...form.register('password')}
              type="password"
              className="w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {form.formState.errors.password && (
              <p className="text-xs text-red-600 mt-1">{String(form.formState.errors.password.message)}</p>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">确认新密码</label>
            <input
              {...form.register('confirm')}
              type="password"
              className="w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {form.formState.errors.confirm && (
              <p className="text-xs text-red-600 mt-1">{String(form.formState.errors.confirm.message)}</p>
            )}
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 text-white py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? '提交中...' : '重置密码并登录'}
          </button>
        </form>

        <p className="text-center text-sm text-slate-500 mt-4">
          <Link href="/login" className="text-blue-600">返回登录</Link>
        </p>
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetInner />
    </Suspense>
  );
}
