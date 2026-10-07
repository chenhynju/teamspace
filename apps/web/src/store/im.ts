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
  setMessages: (msgs: Message[]) => void;
  appendMessage: (msg: Message) => void;
  updateConversationPreview: (conversationId: string, lastMessage: Message) => void;
  incrementUnread: (conversationId: string) => void;
  resetUnread: (conversationId: string) => void;
}

export const useImStore = create<ImState>((set) => ({
  conversations: [],
  currentConversationId: null,
  messages: [],
  setConversations: (conversations) => set({ conversations }),
  setCurrentConversationId: (currentConversationId) => set({ currentConversationId }),
  setMessages: (messages) => set({ messages }),
  appendMessage: (msg) => set((s) => ({ messages: [...s.messages, msg] })),
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
