'use client';
import { useImStore } from '@/store/im';
import { useAuthStore } from '@/store/auth';

interface Props {
  conversation: ReturnType<typeof useImStore.getState>['conversations'][0];
}

export default function ConversationItem({ conversation }: Props) {
  const currentConversationId = useImStore((s) => s.currentConversationId);
  const setCurrentConversationId = useImStore((s) => s.setCurrentConversationId);
  const resetUnread = useImStore((s) => s.resetUnread);
  const apiBase = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1';

  const isActive = currentConversationId === conversation.id;

  const handleClick = () => {
    setCurrentConversationId(conversation.id);
    resetUnread(conversation.id);
    window.history.replaceState(null, '', `?c=${conversation.id}`);
  };

  const preview = conversation.lastMessage
    ? conversation.lastMessage.type === 'TEXT'
      ? conversation.lastMessage.content.slice(0, 60)
      : conversation.lastMessage.type === 'IMAGE'
        ? '[图片]'
        : '[文件]'
    : '开始聊天';

  return (
    <button
      onClick={handleClick}
      className={`w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-slate-50 transition-colors ${
        isActive ? 'bg-slate-100' : ''
      }`}
    >
      <div className="relative">
        <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center text-sm font-semibold text-blue-700">
          {(conversation.title || '群').slice(0, 1)}
        </div>
        {conversation.unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs w-5 h-5 flex items-center justify-center rounded-full">
            {conversation.unreadCount > 99 ? '99+' : conversation.unreadCount}
          </span>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex justify-between items-center">
          <span className="font-medium text-sm text-slate-800 truncate">
            {conversation.title || '未命名会话'}
          </span>
          {conversation.lastMessage && (
            <span className="text-xs text-slate-400">
              {new Date(conversation.lastMessage.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
        </div>
        <div className="text-xs text-slate-500 truncate">{preview}</div>
      </div>
    </button>
  );
}
