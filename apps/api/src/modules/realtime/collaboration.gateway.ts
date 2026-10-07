import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  WebSocketGateway,
  WebSocketServer,
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Server, Socket } from 'socket.io';
import { PrismaService } from '../../prisma/prisma.service';
import { RealtimeEventsService } from './realtime-events.service';

interface PresenceUser {
  userId: string;
  name: string;
  color: string;
}

interface JoinedRoom {
  organizationId: string;
  projectId: string;
}

interface SocketData {
  user: { id: string; name: string; email: string };
  joined: JoinedRoom[];
}

type CollabSocket = Socket<any, any, any, SocketData>;

function colorFor(userId: string): string {
  let h = 0;
  for (let i = 0; i < userId.length; i++) h = (h * 31 + userId.charCodeAt(i)) % 360;
  return `hsl(${h}, 65%, 45%)`;
}

/**
 * 协作网关。
 * 房间 = 租户边界：org:{orgId}（组织级广播）、org:{orgId}:project:{projectId}（项目房间）。
 * 安全：握手必须携带有效 JWT；join 前服务端反查 ACTIVE membership；
 * 每 30 秒复校成员状态，停用/移除即强制离开房间（与 AT04 的每请求反查同理）。
 */
@WebSocketGateway({
  cors: { origin: true, credentials: true },
})
export class CollaborationGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(CollaborationGateway.name);
  private readonly jwt: JwtService;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly events: RealtimeEventsService,
  ) {
    this.jwt = new JwtService({
      secret: config.get<string>('JWT_SECRET') ?? 'dev-secret',
    });
  }

  afterInit() {
    this.events.bindServer(this.server);
    setInterval(() => this.revalidateSockets().catch(() => undefined), 30_000);
  }

  /* ---------------- 连接 / 断开 ---------------- */

  /**
   * 鉴权并初始化 client.data。幂等：handleConnection 与消息处理器都可能调用。
   * 不把鉴权只放在 handleConnection：后者是异步的，客户端可能在其完成前
   * 就发出 project:open，因此消息处理器必须能独立完成鉴权。
   */
  private async authenticate(client: CollabSocket) {
    if (client.data.user) return client.data.user;
    const raw =
      (client.handshake.auth?.token as string | undefined) ??
      (client.handshake.query?.token as string | undefined);
    if (!raw) return null;

    let userId = '';
    try {
      const payload = await this.jwt.verifyAsync(raw);
      userId = payload.sub as string;
    } catch {
      return null;
    }

    // 以 JWT 中的 sub 建立用户上下文，反查账号仍然存在且未停用
    const user = await this.prisma.withUser(userId, (tx) =>
      tx.user.findFirst({
        where: { id: userId, status: 'NORMAL' },
        select: { id: true, name: true, email: true },
      }),
    );
    if (!user) return null;

    client.data.user = { id: user.id, name: user.name, email: user.email };
    if (!client.data.joined) client.data.joined = [];
    return client.data.user;
  }

  async handleConnection(client: CollabSocket) {
    const user = await this.authenticate(client);
    if (!user) {
      client.disconnect(true);
      return;
    }
    // IM 推送走用户房间：鉴权成功即加入，无需客户端额外消息
    client.join(RealtimeEventsService.userRoom(user.id));
  }

  async handleDisconnect(client: CollabSocket) {
    if (!client.data.user) return;
    const rooms = [...(client.data.joined ?? [])];
    client.data.joined = [];
    for (const r of rooms) {
      client.leave(RealtimeEventsService.projectRoom(r.organizationId, r.projectId));
      client.leave(RealtimeEventsService.orgRoom(r.organizationId));
      await this.broadcastPresence(r.organizationId, r.projectId);
    }
  }

  /* ---------------- 房间管理 ---------------- */

  @SubscribeMessage('project:open')
  async openProject(
    @ConnectedSocket() client: CollabSocket,
    @MessageBody() body: { organizationId: string; projectId: string },
  ) {
    // 消息可能先于 handleConnection 的异步鉴权到达：就地补做鉴权
    const user = await this.authenticate(client);
    if (!user) {
      client.disconnect(true);
      return { ok: false, code: 'UNAUTHORIZED' };
    }
    if (!body?.organizationId || !body?.projectId) return { ok: false };

    const allowed = await this.prisma.withUser(user.id, (tx) =>
      tx.membership.findFirst({
        where: { organizationId: body.organizationId, status: 'ACTIVE' },
      }),
    );
    if (!allowed) return { ok: false, code: 'NOT_MEMBER' };

    // 离开此前的项目房间（每个连接一次只看一个项目）
    for (const r of client.data.joined) {
      client.leave(RealtimeEventsService.projectRoom(r.organizationId, r.projectId));
      client.leave(RealtimeEventsService.orgRoom(r.organizationId));
    }
    client.data.joined = [body];
    client.join(RealtimeEventsService.orgRoom(body.organizationId));
    client.join(RealtimeEventsService.projectRoom(body.organizationId, body.projectId));

    await this.broadcastPresence(body.organizationId, body.projectId);
    return { ok: true };
  }

  @SubscribeMessage('presence:request')
  async requestPresence(@ConnectedSocket() client: CollabSocket) {
    const r = client.data.joined?.[0];
    if (r) await this.broadcastPresence(r.organizationId, r.projectId);
    return { ok: true };
  }

  @SubscribeMessage('project:close')
  async closeProject(@ConnectedSocket() client: CollabSocket) {
    for (const r of client.data.joined) {
      client.leave(RealtimeEventsService.projectRoom(r.organizationId, r.projectId));
      client.leave(RealtimeEventsService.orgRoom(r.organizationId));
      await this.broadcastPresence(r.organizationId, r.projectId);
    }
    client.data.joined = [];
    return { ok: true };
  }

  /* ---------------- 光标 / presence ---------------- */

  @SubscribeMessage('cursor:update')
  cursorUpdate(
    @ConnectedSocket() client: CollabSocket,
    @MessageBody() body: { x: number; y: number },
  ) {
    const r = client.data.joined?.[0];
    if (!r || !Number.isFinite(body?.x)) return;
    client
      .to(RealtimeEventsService.projectRoom(r.organizationId, r.projectId))
      .emit('cursor:updated', {
        userId: client.data.user.id,
        name: client.data.user.name,
        color: colorFor(client.data.user.id),
        x: body.x,
        y: body.y,
      });
  }

  /* ---------------- 内部方法 ---------------- */

  /** 向项目房间推送当前在线成员列表（跨节点聚合） */
  private async broadcastPresence(organizationId: string, projectId: string) {
    const room = RealtimeEventsService.projectRoom(organizationId, projectId);
    const sockets = await this.server.in(room).fetchSockets();
    const users = new Map<string, PresenceUser>();
    for (const s of sockets) {
      const u = (s.data as SocketData).user;
      if (u) users.set(u.id, { userId: u.id, name: u.name, color: colorFor(u.id) });
    }
    this.server.to(room).emit('presence:update', { users: [...users.values()] });
  }

  /** 周期性复校：成员关系失效则强制离开房间并通知房间其余成员 */
  private async revalidateSockets() {
    const sockets = await this.server.fetchSockets();
    for (const s of sockets as unknown as CollabSocket[]) {
      const data = s.data as SocketData;
      if (!data.user) continue;
      for (const r of data.joined) {
        const ms = await this.prisma.withUser(data.user.id, (tx) =>
          tx.membership.findFirst({
            where: { organizationId: r.organizationId, status: 'ACTIVE' },
          }),
        );
        if (!ms) {
          s.leave(RealtimeEventsService.projectRoom(r.organizationId, r.projectId));
          s.leave(RealtimeEventsService.orgRoom(r.organizationId));
          data.joined = data.joined.filter(
            (x) => !(x.organizationId === r.organizationId && x.projectId === r.projectId),
          );
          s.emit('membership:revoked', { organizationId: r.organizationId });
          await this.broadcastPresence(r.organizationId, r.projectId);
        }
      }
    }
  }
}
