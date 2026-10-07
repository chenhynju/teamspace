import { Injectable } from '@nestjs/common';
import type { Server } from 'socket.io';

/**
 * 服务端实时事件出口：业务模块（projects/tasks/billing）通过它向房间广播，
 * 不直接依赖网关；API 未启动 WebSocket 时（如测试）调用静默降级为 no-op。
 */
@Injectable()
export class RealtimeEventsService {
  private server?: Server;

  bindServer(server: Server) {
    this.server = server;
  }

  static orgRoom(organizationId: string) {
    return `org:${organizationId}`;
  }

  static projectRoom(organizationId: string, projectId: string) {
    return `org:${organizationId}:project:${projectId}`;
  }

  static userRoom(userId: string) {
    return `user:${userId}`;
  }

  static conversationRoom(organizationId: string, conversationId: string) {
    return `org:${organizationId}:im:${conversationId}`;
  }

  emitToOrg(organizationId: string, event: string, payload: unknown) {
    this.server?.to(RealtimeEventsService.orgRoom(organizationId)).emit(event, payload);
  }

  emitToProject(organizationId: string, projectId: string, event: string, payload: unknown) {
    this.server
      ?.to(RealtimeEventsService.projectRoom(organizationId, projectId))
      .emit(event, payload);
  }

  emitToUser(userId: string, event: string, payload: unknown) {
    this.server?.to(RealtimeEventsService.userRoom(userId)).emit(event, payload);
  }

  emitToUsers(userIds: string[], event: string, payload: unknown) {
    if (!this.server) return;
    for (const userId of userIds) {
      this.server.to(RealtimeEventsService.userRoom(userId)).emit(event, payload);
    }
  }

  /** 当前全部连接（有 Redis adapter 时跨节点聚合）；在线用户监控用 */
  async fetchSockets(): Promise<SocketLike[]> {
    if (!this.server) return [];
    return this.server.fetchSockets() as unknown as Promise<SocketLike[]>;
  }
}

export interface SocketLike {
  id: string;
  data: { user?: { id: string; name: string; email: string } };
  disconnect(close?: boolean): void;
}
