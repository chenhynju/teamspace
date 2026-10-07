'use client';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

export default function LoginPage() {
  const router = useRouter();
  const setToken = useAuthStore((s) => s.setToken);
  const loadProfile = useAuthStore((s) => s.loadProfile);
  const [error, setError] = useState('');
  const [unverifiedEmail, setUnverifiedEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [oauthProviders, setOauthProviders] = useState<{ google: boolean; github: boolean }>({ google: false, github: false });
  const form = useForm({ resolver: zodResolver(schema) });

  useEffect(() => {
    api
      .get('/auth/oauth/providers')
      .then(({ data }) => setOauthProviders({ google: !!data.google, github: !!data.github }))
      .catch(() => {});
  }, []);

  const onSubmit = form.handleSubmit(async (d) => {
    setLoading(true);
    setError('');
    setUnverifiedEmail('');
    try {
      const { data } = await api.post('/auth/login', d);
      setToken(data.accessToken);
      await loadProfile();
      router.push('/dashboard');
    } catch (e: any) {
      setError(e.response?.data?.message || '登录失败');
      if (e.response?.data?.code === 'EMAIL_NOT_VERIFIED') {
        setUnverifiedEmail(d.email);
      }
    } finally {
      setLoading(false);
    }
  });

  const resendFromLogin = async () => {
    try {
      await api.post('/auth/resend-verification', { email: unverifiedEmail });
      router.push(`/check-email?email=${encodeURIComponent(unverifiedEmail)}`);
    } catch (e: any) {
      setError(e.response?.data?.message || '发送失败，请稍后再试');
    }
  };

  const oauth = async (provider: 'google' | 'github') => {
    const { data } = await api.get(`/auth/oauth/${provider}/url`);
    window.location.href = data.url;
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-lg p-8">
        <h1 className="text-2xl font-bold text-center mb-2">TeamSpace</h1>
        <p className="text-center text-slate-500 mb-6">企业项目协作云</p>

        {error && <div className="bg-red-50 text-red-600 text-sm p-3 rounded mb-4">{error}</div>}
        {unverifiedEmail && (
          <button
            onClick={resendFromLogin}
            className="w-full mb-4 bg-amber-50 text-amber-700 border border-amber-200 text-xs p-3 rounded hover:bg-amber-100"
          >
            重新发送验证邮件（{unverifiedEmail}）
          </button>
        )}

        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">邮箱</label>
            <input {...form.register('email')} type="email" className="w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-sm font-medium">密码</label>
              <Link href="/forgot-password" className="text-xs text-blue-600 hover:underline">
                忘记密码？
              </Link>
            </div>
            <input {...form.register('password')} type="password" className="w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <button type="submit" disabled={loading} className="w-full bg-blue-600 text-white py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50">
            {loading ? '登录中...' : '登录'}
          </button>
        </form>

        {(oauthProviders.google || oauthProviders.github) && (
          <div className="mt-4 flex gap-2">
            {oauthProviders.google && (
              <button onClick={() => oauth('google')} className="flex-1 border py-2 rounded-lg hover:bg-slate-50 text-sm">Google</button>
            )}
            {oauthProviders.github && (
              <button onClick={() => oauth('github')} className="flex-1 border py-2 rounded-lg hover:bg-slate-50 text-sm">GitHub</button>
            )}
          </div>
        )}

        <p className="text-center text-sm text-slate-500 mt-4">
          还没有账号？<Link href="/register" className="text-blue-600">注册</Link>
        </p>
      </div>
    </div>
  );
}
