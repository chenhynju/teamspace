'use client';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useAuthStore } from '@/store/auth';
import { useImStore } from '@/store/im';
import { useImRealtime } from '@/lib/use-im-realtime';
import { api } from '@/lib/api';
import ConversationList from '@/components/im/ConversationList';
import ChatWindow from '@/components/im/ChatWindow';
import NewConversationModal from '@/components/im/NewConversationModal';

export default function ImPage() {
  const searchParams = useSearchParams();
  const currentOrgId = useAuthStore((s) => s.currentOrgId);
  const { setConversations, setCurrentConversationId } = useImStore();
  const [showNewModal, setShowNewModal] = useState(false);

  useImRealtime();

  useEffect(() => {
    const c = searchParams.get('c');
    if (c) setCurrentConversationId(c);
  }, [searchParams, setCurrentConversationId]);

  useEffect(() => {
    if (!currentOrgId) return;
    api.get('/conversations').then((res) => setConversations(res.data)).catch(() => setConversations([]));
  }, [currentOrgId, setConversations]);

  if (!currentOrgId) return null;

  return (
    <div className="flex h-full">
      <div className="w-80 border-r border-slate-200 bg-white">
        <div className="flex items-center justify-between p-4 border-b border-slate-200">
          <h1 className="text-lg font-semibold text-slate-800">消息</h1>
          <button
            onClick={() => setShowNewModal(true)}
            className="text-sm text-blue-600 hover:text-blue-700"
          >
            发起聊天
          </button>
        </div>
        <ConversationList />
      </div>
      <div className="flex-1 flex flex-col">
        <ChatWindow />
      </div>
      {showNewModal && <NewConversationModal onClose={() => setShowNewModal(false)} />}
    </div>
  );
}

