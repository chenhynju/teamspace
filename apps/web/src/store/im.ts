'use client';
import { create } from 'zustand';

export interface ConversationItem {
  id: string;
  type: 'DIRECT' | 'GROUP';
  title?: string | null;
  avatarUrl?: string | null;
  peerUserId?: string | null;
  lastMessage?: { id: string; type: string; content: string; senderId: string; createdAt: string } | null;
  unreadCount: number;
  myRole: 'OWNER' | 'MEMBER';
}

export interface Message {
  id: string;
  senderId: string;
  senderName?: string;
  sender?: { id: string; name: string; avatarUrl: string | null } | null;
  type: 'TEXT' | 'IMAGE' | 'FILE';
  content: string;
  attachment?: { id: string; name: string; mimeType: string; size: string } | null;
  createdAt: string;
}

interface ImState {
  conversations: ConversationItem[];
  currentConversationId: string | null;
  messages: Message[];
  setConversations: (convs: ConversationItem[]) => void;
  setCurrentConversationId: (id: string | null) => void;
  setMessages: (msgs: Message[], conversationId?: string) => void;
  appendMessage: (msg: Message, conversationId?: string) => void;
  updateConversationPreview: (conversationId: string, lastMessage: Message) => void;
  incrementUnread: (conversationId: string) => void;
  resetUnread: (conversationId: string) => void;
}

export const useImStore = create<ImState>((set) => ({
  conversations: [],
  currentConversationId: null,
  messages: [],
  setConversations: (conversations) => set({ conversations }),
  setCurrentConversationId: (currentConversationId) => set((s) =>
    s.currentConversationId === currentConversationId ? s : { currentConversationId, messages: [] }),
  setMessages: (messages, conversationId) => set((s) => {
    if (conversationId && s.currentConversationId !== conversationId) return s;
    // History may finish after a live event; retain messages already received.
    const rows = conversationId ? [...messages, ...s.messages] : messages;
    return { messages: Array.from(new Map(rows.map(m => [m.id, m])).values())
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)) };
  }),
  appendMessage: (msg, conversationId) => set((s) => {
    if (conversationId && s.currentConversationId !== conversationId) return s;
    if (s.messages.some(m => m.id === msg.id)) return s;
    return { messages: [...s.messages, msg] };
  }),
  updateConversationPreview: (conversationId, lastMessage) =>
    set((s) => ({
      conversations: s.conversations.map((c) =>
        c.id === conversationId ? { ...c, lastMessage, unreadCount: c.unreadCount } : c,
      ),
    })),
  incrementUnread: (conversationId) =>
    set((s) => ({
      conversations: s.conversations.map((c) =>
        c.id === conversationId ? { ...c, unreadCount: c.unreadCount + 1 } : c,
      ),
    })),
  resetUnread: (conversationId) =>
    set((s) => ({
      conversations: s.conversations.map((c) =>
        c.id === conversationId ? { ...c, unreadCount: 0 } : c,
      ),
    })),
}));
