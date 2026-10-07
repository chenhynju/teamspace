'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/auth';

export default function OAuthCallbackPage() {
  const router = useRouter();
  const setToken = useAuthStore((s) => s.setToken);
  const loadProfile = useAuthStore((s) => s.loadProfile);

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get('token');
    if (token) {
      setToken(token);
      loadProfile().then(() => router.push('/dashboard'));
    } else {
      router.push('/login');
    }
  }, [setToken, loadProfile, router]);

  return (
    <div className="min-h-screen flex items-center justify-center">
      <p className="text-slate-500">登录中...</p>
    </div>
  );
}
