﻿'use client';
import { useEffect, useRef } from 'react';
import { useImStore } from '@/store/im';
import { useAuthStore } from '@/store/auth';
import { api } from '@/lib/api';
import MessageBubble from './MessageBubble';
import MessageComposer from './MessageComposer';

export default function ChatWindow() {
  const currentConversationId = useImStore((s) => s.currentConversationId);
  const messages = useImStore((s) => s.messages);
  const setMessages = useImStore((s) => s.setMessages);
  const conversations = useImStore((s) => s.conversations);
  const currentOrgId = useAuthStore((s) => s.currentOrgId);
  const bottomRef = useRef<HTMLDivElement>(null);

  const conv = conversations.find((c) => c.id === currentConversationId);

  useEffect(() => {
    if (!currentConversationId || !currentOrgId) return;
    api.get(`/conversations/${currentConversationId}/messages?limit=50`)
      .then((res) => setMessages(res.data))
      .catch(() => setMessages([]));
  }, [currentConversationId, currentOrgId, setMessages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  if (!conv) {
    return (
      <div className="flex-1 flex items-center justify-center text-slate-400 text-sm">
        选择一个会话开始聊天
      </div>
    );
  }

  return (
    <>
      <div className="px-4 py-3 border-b border-slate-200 bg-white">
        <h2 className="font-semibold text-slate-800">{conv.title || '未命名会话'}</h2>
      </div>
      <div className="flex-1 overflow-y-auto p-4 bg-slate-50">
        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}
        <div ref={bottomRef} />
      </div>
      <MessageComposer conversationId={conv.id} />
    </>
  );
}

