'use client';
import { useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';

export interface PresenceUserInfo {
  userId: string;
  name: string;
  color: string;
}

/** Socket 服务地址：取 API origin（去掉 /api/v1 前缀） */
function socketOrigin(): string {
  const base = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1';
  return base.replace(/\/api\/v1\/?$/, '');
}

/**
 * 项目实时协作：加入项目房间，维护在线 presence，并在任务被他人变更时回调刷新。
 * 断线自动重连（socket.io 内置退避），重连后需重新 open 房间。
 */
export function useProjectRealtime(
  organizationId: string | null,
  projectId: string,
  onTaskChange?: () => void | Promise<void>,
) {
  const [presence, setPresence] = useState<PresenceUserInfo[]>([]);
  const [connected, setConnected] = useState(false);
  const changeRef = useRef(onTaskChange);
  changeRef.current = onTaskChange;

  useEffect(() => {
    if (!organizationId || !projectId) return;
    const token = localStorage.getItem('access_token');
    if (!token) return;

    const socket: Socket = io(socketOrigin(), {
      auth: { token },
      transports: ['websocket'],
    });

    const openRoom = () => {
      socket.emit('project:open', { organizationId, projectId }, () => {
        // join 完成后主动拉一次 presence，避免错过 open 的副作用广播
        socket.emit('presence:request');
      });
    };
    const triggerChange = () => changeRef.current?.();

    socket.on('connect', () => {
      setConnected(true);
      openRoom();
    });
    socket.on('disconnect', () => setConnected(false));
    socket.on('presence:update', (p: { users: PresenceUserInfo[] }) =>
      setPresence(p.users ?? []),
    );
    socket.on('task:created', triggerChange);
    socket.on('task:updated', triggerChange);
    socket.on('task:deleted', triggerChange);

    return () => {
      socket.emit('project:close');
      socket.removeAllListeners();
      socket.disconnect();
    };
    // 仅在房间切换时重建连接
  }, [organizationId, projectId]);

  return { presence, connected };
}
