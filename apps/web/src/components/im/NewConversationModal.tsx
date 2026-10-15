'use client';
import { useEffect, useState } from 'react';
import { useAuthStore } from '@/store/auth';
import { api } from '@/lib/api';
import { useRouter } from 'next/navigation';

interface Member {
  id: string;
  name: string;
  email: string;
  avatarUrl?: string | null;
}

export default function NewConversationModal({ onClose }: { onClose: () => void }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [groupTitle, setGroupTitle] = useState('');
  const [mode, setMode] = useState<'direct' | 'group'>('direct');
  const currentOrgId = useAuthStore((s) => s.currentOrgId);
  const router = useRouter();

  useEffect(() => {
    if (!currentOrgId) return;
    api.get('/members')
      .then((res) => {
        // /members 返回成员关系行 { id, user: { id, name, email, avatarUrl }, ... }，需展平
        const rows: any[] = Array.isArray(res.data) ? res.data : (res.data?.list ?? []);
        setMembers(
          rows.map((r) => {
            const u = r.user ?? r;
            return {
              id: u.id,
              name: u.name ?? u.email ?? '未知用户',
              email: u.email ?? '',
              avatarUrl: u.avatarUrl ?? null,
            };
          }),
        );
      })
      .catch(() => setMembers([]));
  }, [currentOrgId]);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const create = async () => {
    if (mode === 'direct') {
      if (selectedIds.length !== 1) return;
      const res = await api.post('/conversations/direct', { userId: selectedIds[0] });
      router.push(`/im?c=${res.data.id}`);
    } else {
      if (selectedIds.length < 1 || !groupTitle.trim()) return;
      const res = await api.post('/conversations/group', { title: groupTitle.trim(), memberIds: selectedIds });
      router.push(`/im?c=${res.data.id}`);
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-lg w-[420px] max-h-[80vh] flex flex-col">
        <div className="px-4 py-3 border-b border-slate-200 flex justify-between items-center">
          <h3 className="font-semibold text-slate-800">发起聊天</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">✕</button>
        </div>
        <div className="flex border-b border-slate-200">
          <button
            className={`flex-1 py-2 text-sm ${mode === 'direct' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-slate-500'}`}
            onClick={() => setMode('direct')}
          >
            私聊
          </button>
          <button
            className={`flex-1 py-2 text-sm ${mode === 'group' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-slate-500'}`}
            onClick={() => setMode('group')}
          >
            群聊
          </button>
        </div>
        {mode === 'group' && (
          <div className="px-4 py-2 border-b border-slate-200">
            <input
              value={groupTitle}
              onChange={(e) => setGroupTitle(e.target.value)}
              placeholder="群名称"
              className="w-full px-3 py-1.5 border border-slate-200 rounded text-sm"
            />
          </div>
        )}
        <div className="flex-1 overflow-y-auto p-2">
          {members.map((m) => (
            <label
              key={m.id}
              className="flex items-center gap-3 px-3 py-2 rounded hover:bg-slate-50 cursor-pointer"
            >
              <input
                type="checkbox"
                checked={selectedIds.includes(m.id)}
                onChange={() => toggleSelect(m.id)}
                className="accent-blue-600"
              />
              <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center text-xs font-semibold text-slate-600">
                {(m.name || '?').slice(0, 1)}
              </div>
              <div>
                <div className="text-sm font-medium text-slate-800">{m.name}</div>
                <div className="text-xs text-slate-400">{m.email}</div>
              </div>
            </label>
          ))}
        </div>
        <div className="px-4 py-3 border-t border-slate-200 flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100 rounded">取消</button>
          <button
            onClick={create}
            disabled={mode === 'direct' ? selectedIds.length !== 1 : (selectedIds.length < 1 || !groupTitle.trim())}
            className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
          >
            创建
          </button>
        </div>
      </div>
    </div>
  );
}

