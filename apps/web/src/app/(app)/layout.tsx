'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/auth';
import Sidebar from '@/components/Sidebar';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const token = useAuthStore((s) => s.token);
  const loadProfile = useAuthStore((s) => s.loadProfile);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!token) {
      router.push('/login');
      return;
    }
    let active = true;
    loadProfile()
      .then(() => active && setReady(true))
      .catch(() => router.push('/login'));
    return () => {
      active = false;
    };
    // 仅在进入受保护区时加载一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  if (!token) return null;

  return (
    <div className="flex min-h-screen bg-slate-50">
      <Sidebar />
      <main className="flex-1 overflow-auto">
        {ready ? children : <div className="p-8 text-slate-400 text-sm">加载中…</div>}
      </main>
    </div>
  );
}
