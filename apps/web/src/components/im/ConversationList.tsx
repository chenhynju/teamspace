'use client';
import { useImStore } from '@/store/im';
import ConversationItem from './ConversationItem';

export default function ConversationList() {
  const conversations = useImStore((s) => s.conversations);

  if (conversations.length === 0) {
    return <div className="p-6 text-sm text-slate-400 text-center">暂无会话</div>;
  }

  return (
    <div className="overflow-y-auto">
      {conversations.map((conv) => (
        <ConversationItem key={conv.id} conversation={conv} />
      ))}
    </div>
  );
}
