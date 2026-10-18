﻿﻿﻿﻿'use client';
import { useEffect, useRef } from 'react';
import { io, type Socket } from 'socket.io-client';
import { useAuthStore } from '@/store/auth';
import { useImStore } from '@/store/im';
import { api } from '@/lib/api';

const socketOrigin = process.env.NEXT_PUBLIC_API_URL?.replace('/api/v1', '') || 'http://localhost:3001';

let sharedSocket: Socket | null = null;
let socketRefCount = 0;

function getSocket(token: string): Socket {
  if (!sharedSocket) {
    sharedSocket = io(socketOrigin, {
      auth: { token },
      transports: ['websocket'],
    });
  }
  return sharedSocket;
}

function releaseSocket() {
  socketRefCount--;
  if (socketRefCount <= 0 && sharedSocket) {
    sharedSocket.disconnect();
    sharedSocket = null;
    socketRefCount = 0;
  }
}

export function useImRealtime() {
  const token = useAuthStore((s) => s.token);
  const currentConversationId = useImStore((s) => s.currentConversationId);
  const appendMessage = useImStore((s) => s.appendMessage);
  const updateConversationPreview = useImStore((s) => s.updateConversationPreview);
  const incrementUnread = useImStore((s) => s.incrementUnread);
  const setConversations = useImStore((s) => s.setConversations);
  const currentOrgId = useAuthStore((s) => s.currentOrgId);
  const currentRef = useRef(currentConversationId);
  currentRef.current = currentConversationId;

  useEffect(() => {
    if (!token || !currentOrgId) return;
    const socket = getSocket(token);
    socketRefCount++;

    const onMessageNew = (data: {
      conversationId: string;
      message: {
        id: string;
        senderId: string;
        senderName: string;
        type: 'TEXT' | 'IMAGE' | 'FILE';
        content: string;
        attachment: { id: string; name: string; mimeType: string; size: string } | null;
        createdAt: string;
      };
    }) => {
      const { conversationId, message } = data;
      if (currentRef.current === conversationId) {
        appendMessage(message);
        // 标记已读
        api.post(`/conversations/${conversationId}/read`, { lastReadMessageId: message.id }).catch(() => {});
      } else {
        incrementUnread(conversationId);
      }
      updateConversationPreview(conversationId, message);
    };

    const onConversationUpdated = () => {
      // 刷新会话列表
      api.get('/conversations').then((res) => setConversations(res.data)).catch(() => {});
    };

    socket.on('im:message:new', onMessageNew);
    socket.on('im:conversation:updated', onConversationUpdated);

    return () => {
      socket.off('im:message:new', onMessageNew);
      socket.off('im:conversation:updated', onConversationUpdated);
      releaseSocket();
    };
  }, [token, currentOrgId, appendMessage, incrementUnread, updateConversationPreview, setConversations]);
}

