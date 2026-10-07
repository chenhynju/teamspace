'use client';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { api } from '@/lib/api';
import Link from 'next/link';

const schema = z.object({ email: z.string().email() });

export default function ForgotPasswordPage() {
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const form = useForm({ resolver: zodResolver(schema) });

  const onSubmit = form.handleSubmit(async (d) => {
    setLoading(true);
    setError('');
    try {
      await api.post('/auth/forgot-password', d);
      setSent(true);
    } catch (e: any) {
      setError(e.response?.data?.message || '发送失败，请稍后再试');
    } finally {
      setLoading(false);
    }
  });

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-lg p-8">
        <h1 className="text-2xl font-bold text-center mb-2">重置密码</h1>
        <p className="text-center text-slate-500 mb-6 text-sm">
          输入注册邮箱，我们将发送重置链接
        </p>

        {error && <div className="bg-red-50 text-red-600 text-sm p-3 rounded mb-4">{error}</div>}

        {sent ? (
          <div className="text-center">
            <div className="bg-green-50 text-green-700 text-sm p-4 rounded mb-4">
              如果该邮箱已注册，重置邮件很快就会送达。<br />
              链接有效期为 1 小时，请检查收件箱或垃圾邮件。
            </div>
            <Link href="/login" className="text-sm text-blue-600 hover:underline">
              返回登录
            </Link>
          </div>
        ) : (
          <>
            <form onSubmit={onSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">邮箱</label>
                <input
                  {...form.register('email')}
                  type="email"
                  className="w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full bg-blue-600 text-white py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {loading ? '发送中...' : '发送重置链接'}
              </button>
            </form>
            <p className="text-center text-sm text-slate-500 mt-4">
              想起密码了？<Link href="/login" className="text-blue-600">返回登录</Link>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
