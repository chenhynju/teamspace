'use client';
import { useState, useRef } from 'react';
import { api } from '@/lib/api';
import { useImStore } from '@/store/im';
import { useAuthStore } from '@/store/auth';

export default function MessageComposer({ conversationId }: { conversationId: string }) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const inFlight = useRef(false);
  const [error, setError] = useState('');
  const appendMessage = useImStore((s) => s.appendMessage);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  const sendText = async () => {
    if (!text.trim() || inFlight.current) return;
    inFlight.current = true;
    const content = text.trim();
    const organizationId = useAuthStore.getState().currentOrgId;
    setError('');
    setSending(true);
    try {
      const res = await api.post(`/conversations/${conversationId}/messages`, {
        type: 'TEXT',
        content,
      });
      if (useAuthStore.getState().currentOrgId === organizationId) appendMessage(res.data, conversationId);
      setText(current => current.trim() === content ? '' : current);
    } catch (e) {
      console.error('send failed', e);
      setError('发送失败，请重试');
    } finally {
      setSending(false);
      inFlight.current = false;
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && e.nativeEvent.keyCode !== 229) {
      e.preventDefault();
      sendText();
    }
  };

  const uploadAndSend = async (file: File, type: 'IMAGE' | 'FILE') => {
    if (inFlight.current) return;
    inFlight.current = true;
    const organizationId = useAuthStore.getState().currentOrgId;
    setError('');
    setSending(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const attRes = await api.post(`/conversations/${conversationId}/attachments`, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      if (useAuthStore.getState().currentOrgId !== organizationId) return;
      const msgRes = await api.post(`/conversations/${conversationId}/messages`, {
        type,
        content: file.name,
        attachmentId: attRes.data.id,
      });
      if (useAuthStore.getState().currentOrgId === organizationId) appendMessage(msgRes.data, conversationId);
    } catch (e) {
      console.error('upload failed', e);
      setError('附件发送失败，请重试');
    } finally {
      setSending(false);
      inFlight.current = false;
    }
  };

  return (
    <div className="p-3 border-t border-slate-200 bg-white">
      {error && <p role="alert" className="text-sm text-red-600 mb-2">{error}</p>}
      <div className="flex items-center gap-2 mb-2">
        <button
          disabled={sending}
          onClick={() => imageInputRef.current?.click()}
          className="text-sm text-slate-500 hover:text-blue-600"
        >
          🖼️ 图片
        </button>
        <button
          disabled={sending}
          onClick={() => fileInputRef.current?.click()}
          className="text-sm text-slate-500 hover:text-blue-600"
        >
          📎 文件
        </button>
      </div>
      <div className="flex gap-2">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="输入消息..."
          className="flex-1 min-h-[40px] max-h-[120px] px-3 py-2 border border-slate-200 rounded-lg text-sm resize-none focus:outline-none focus:ring-1 focus:ring-blue-500"
          rows={1}
        />
        <button
          onClick={sendText}
          disabled={sending || !text.trim()}
          className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          发送
        </button>
      </div>
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) uploadAndSend(f, 'IMAGE');
          e.target.value = '';
        }}
      />
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) uploadAndSend(f, 'FILE');
          e.target.value = '';
        }}
      />
    </div>
  );
}

