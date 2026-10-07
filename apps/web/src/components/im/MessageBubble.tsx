'use client';
import { useAuthStore } from '@/store/auth';
import type { Message } from '@/store/im';

const apiBase = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1').replace('/api/v1', '');

export default function MessageBubble({ message }: { message: Message }) {
  const me = useAuthStore((s) => s.user);
  const isMe = message.senderId === me?.id;

  return (
    <div className={`flex gap-2 mb-3 ${isMe ? 'flex-row-reverse' : ''}`}>
      <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center text-xs font-semibold text-slate-600 shrink-0">
        {(message.senderName || 'U').slice(0, 1)}
      </div>
      <div className={`max-w-[70%] ${isMe ? 'items-end' : 'items-start'} flex flex-col`}>
        {!isMe && (
          <span className="text-xs text-slate-500 mb-1">{message.senderName || '未知用户'}</span>
        )}
        <div
          className={`px-3 py-2 rounded-lg text-sm ${
            isMe ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-800'
          }`}
        >
          {message.type === 'TEXT' && <div className="whitespace-pre-wrap">{message.content}</div>}
          {message.type === 'IMAGE' && message.attachment && (
            <img
              src={`${apiBase}/messages/attachments/${message.attachment.id}/download`}
              alt={message.attachment.name}
              className="max-w-[240px] max-h-[240px] rounded"
            />
          )}
          {message.type === 'FILE' && message.attachment && (
            <a
              href={`${apiBase}/messages/attachments/${message.attachment.id}/download`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 underline"
            >
              <span>📎</span>
              <span className="truncate max-w-[200px]">{message.attachment.name}</span>
            </a>
          )}
        </div>
        <span className="text-[10px] text-slate-400 mt-0.5">
          {new Date(message.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>
    </div>
  );
}
