import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  Req,
  Res,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Request, Response } from 'express';
import { mkdirSync, writeFileSync, createReadStream, statSync } from 'fs';
import * as path from 'path';
import { nanoid } from 'nanoid';
import { PrismaService } from '../../prisma/prisma.service';
import { OrgContextGuard } from '../../common/guards/org-context.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CurrentOrg, OrgContext } from '../../common/decorators/current-org.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuditService, BusinessType } from '../audit/audit.service';
import { RealtimeEventsService } from '../realtime/realtime-events.service';
import { CreateDirectDto, CreateGroupDto, AddMembersDto, SendMessageDto, MarkReadDto } from './dto/im.dto';

const UPLOAD_ROOT = path.resolve(process.cwd(), '.uploads');
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

@Controller('conversations')
export class ImController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeEventsService,
  ) {}

  /* ==================== 会话 ==================== */

  /** 我所在的会话列表（含未读数与最后一条消息） */
  @Get()
  @UseGuards(OrgContextGuard, PermissionsGuard)
  @RequirePermissions('im:view')
  async list(@CurrentOrg() org: OrgContext, @CurrentUser() me: { id: string }) {
    return this.prisma.withOrgUser(org.organizationId, me.id, async (tx) => {
      const memberships = await tx.conversationMember.findMany({
        where: { organizationId: org.organizationId, userId: me.id, status: 'ACTIVE' },
        include: { conversation: true },
        orderBy: { conversation: { lastMessageAt: 'desc' } },
      });

      const results: any[] = [];
      for (const m of memberships) {
        const conv = m.conversation;
        const peer = conv.type === 'DIRECT'
          ? await tx.conversationMember.findFirst({
              where: { conversationId: conv.id, userId: { not: me.id }, status: 'ACTIVE' },
              select: { user: { select: { id: true, name: true, avatarUrl: true } } },
            })
          : null;

        // 未读：lastReadMessageId 对应消息之后、非本人发送的消息数
        let lastReadAt: Date | null = null;
        if (m.lastReadMessageId) {
          const lastReadMsg = await tx.message.findFirst({
            where: { id: m.lastReadMessageId, conversationId: conv.id },
            select: { createdAt: true },
          });
          lastReadAt = lastReadMsg?.createdAt ?? null;
        }
        const unread = await tx.message.count({
          where: {
            conversationId: conv.id,
            senderId: { not: me.id },
            createdAt: { gt: lastReadAt ?? new Date(0) },
          },
        });
        const lastMsg = await tx.message.findFirst({
          where: { conversationId: conv.id },
          orderBy: { createdAt: 'desc' },
          select: { id: true, type: true, content: true, senderId: true, createdAt: true },
        });

        results.push({
          id: conv.id,
          type: conv.type,
          title: conv.type === 'DIRECT' ? peer?.user?.name : conv.title,
          avatarUrl: conv.type === 'DIRECT' ? peer?.user?.avatarUrl : null,
          peerUserId: conv.type === 'DIRECT' ? peer?.user?.id : null,
          lastMessage: lastMsg,
          unreadCount: unread,
          myRole: m.role,
        });
      }
      return results;
    });
  }

  /** 创建或复用私聊 */
  @Post('direct')
  @UseGuards(OrgContextGuard, PermissionsGuard)
  @RequirePermissions('im:use')
  async createDirect(
    @CurrentOrg() org: OrgContext,
    @CurrentUser() me: { id: string },
    @Body() dto: CreateDirectDto,
    @Req() req: Request,
  ) {
    if (dto.userId === me.id) throw new BadRequestException({ code: 'SELF_CHAT', message: '不能与自己私聊' });

    return this.prisma.withOrgUser(org.organizationId, me.id, async (tx) => {
      // 校验对方是组织成员
      const peerMs = await tx.membership.findFirst({
        where: { organizationId: org.organizationId, userId: dto.userId, status: 'ACTIVE' },
      });
      if (!peerMs) throw new NotFoundException({ code: 'NOT_MEMBER', message: '对方不是组织成员' });

      const ids = [me.id, dto.userId].sort();
      const directKey = `${org.organizationId}:${ids[0]}:${ids[1]}`;

      let conv = await tx.conversation.findUnique({ where: { organizationId_directKey: { organizationId: org.organizationId, directKey } } });

      if (!conv) {
        conv = await tx.conversation.create({
          data: {
            organizationId: org.organizationId,
            type: 'DIRECT',
            directKey,
            createdById: me.id,
            members: {
              createMany: {
                data: ids.map((uid) => ({ organizationId: org.organizationId, userId: uid, role: 'MEMBER' as const, status: 'ACTIVE' as const })),
              },
            },
          },
        });
        await this.audit.record(tx, {
          organizationId: org.organizationId,
          actorId: me.id,
          title: 'IM',
          businessType: BusinessType.INSERT,
          action: 'im:direct:create',
          resourceType: 'Conversation',
          resourceId: conv.id,
          after: { type: 'DIRECT', peerId: dto.userId },
          traceId: req.traceId,
          ip: req.ip,
          requestMethod: 'POST',
        });
      }

      return { id: conv.id };
    });
  }

  /** 创建群聊 */
  @Post('group')
  @UseGuards(OrgContextGuard, PermissionsGuard)
  @RequirePermissions('im:group:create')
  async createGroup(
    @CurrentOrg() org: OrgContext,
    @CurrentUser() me: { id: string },
    @Body() dto: CreateGroupDto,
    @Req() req: Request,
  ) {
    if (!dto.memberIds.length) throw new BadRequestException({ code: 'MEMBERS_EMPTY', message: '至少拉一个成员' });
    const allIds = Array.from(new Set([me.id, ...dto.memberIds]));

    return this.prisma.withOrgUser(org.organizationId, me.id, async (tx) => {
      const validMembers = await tx.membership.findMany({
        where: { organizationId: org.organizationId, userId: { in: allIds }, status: 'ACTIVE' },
        select: { userId: true },
      });
      const validIds = validMembers.map((m) => m.userId);
      if (validIds.length < allIds.length) throw new BadRequestException({ code: 'INVALID_MEMBERS', message: '部分成员不在组织中' });

      const conv = await tx.conversation.create({
        data: {
          organizationId: org.organizationId,
          type: 'GROUP',
          title: dto.title,
          createdById: me.id,
          members: {
            createMany: {
              data: allIds.map((uid) => ({
                organizationId: org.organizationId,
                userId: uid,
                role: uid === me.id ? 'OWNER' : ('MEMBER' as const),
                status: 'ACTIVE' as const,
              })),
            },
          },
        },
      });

      await this.audit.record(tx, {
        organizationId: org.organizationId,
        actorId: me.id,
        title: 'IM',
        businessType: BusinessType.INSERT,
        action: 'im:group:create',
        resourceType: 'Conversation',
        resourceId: conv.id,
        after: { type: 'GROUP', title: dto.title, memberIds: allIds },
        traceId: req.traceId,
        ip: req.ip,
        requestMethod: 'POST',
      });

      this.realtime.emitToUsers(allIds, 'im:conversation:updated', {
        conversationId: conv.id,
        lastMessageAt: conv.createdAt,
        lastMessagePreview: '创建了群聊',
      });

      return { id: conv.id };
    });
  }

  /** 会话详情（含成员列表） */
  @Get(':id')
  @UseGuards(OrgContextGuard, PermissionsGuard)
  @RequirePermissions('im:view')
  async detail(@Param('id') id: string, @CurrentOrg() org: OrgContext, @CurrentUser() me: { id: string }) {
    return this.prisma.withOrgUser(org.organizationId, me.id, async (tx) => {
      const myMs = await tx.conversationMember.findFirst({
        where: { conversationId: id, userId: me.id, status: 'ACTIVE' },
      });
      if (!myMs) throw new ForbiddenException({ code: 'NOT_MEMBER', message: '不是该会话成员' });

      const conv = await tx.conversation.findFirst({
        where: { id, organizationId: org.organizationId },
        include: {
          members: {
            where: { status: 'ACTIVE' },
            select: { userId: true, role: true, user: { select: { name: true, avatarUrl: true } } },
          },
        },
      });
      if (!conv) throw new NotFoundException({ code: 'NOT_FOUND', message: '会话不存在' });
      return conv;
    });
  }

  /** 加成员（仅群聊） */
  @Post(':id/members')
  @UseGuards(OrgContextGuard, PermissionsGuard)
  @RequirePermissions('im:use')
  async addMembers(
    @Param('id') id: string,
    @CurrentOrg() org: OrgContext,
    @CurrentUser() me: { id: string },
    @Body() dto: AddMembersDto,
    @Req() req: Request,
  ) {
    return this.prisma.withOrgUser(org.organizationId, me.id, async (tx) => {
      const myMs = await tx.conversationMember.findFirst({
        where: { conversationId: id, userId: me.id, status: 'ACTIVE' },
      });
      if (!myMs) throw new ForbiddenException({ code: 'NOT_MEMBER', message: '不是该会话成员' });
      const conv = await tx.conversation.findFirst({ where: { id, organizationId: org.organizationId } });
      if (!conv) throw new NotFoundException({ code: 'NOT_FOUND', message: '会话不存在' });
      if (conv.type === 'DIRECT') throw new BadRequestException({ code: 'DIRECT_NO_ADD', message: '私聊不能加人' });

      const validMembers = await tx.membership.findMany({
        where: { organizationId: org.organizationId, userId: { in: dto.userIds }, status: 'ACTIVE' },
        select: { userId: true },
      });
      const existing = await tx.conversationMember.findMany({
        where: { conversationId: id, userId: { in: validMembers.map((m) => m.userId) } },
        select: { userId: true, status: true },
      });

      for (const m of validMembers) {
        const ex = existing.find((e) => e.userId === m.userId);
        if (ex) {
          if (ex.status === 'LEFT') await tx.conversationMember.updateMany({
            where: { conversationId: id, userId: m.userId },
            data: { status: 'ACTIVE', role: 'MEMBER' },
          });
        } else {
          await tx.conversationMember.create({
            data: { organizationId: org.organizationId, conversationId: id, userId: m.userId, role: 'MEMBER', status: 'ACTIVE' },
          });
        }
      }

      const allMembers = await tx.conversationMember.findMany({
        where: { conversationId: id, status: 'ACTIVE' },
        select: { userId: true },
      });
      this.realtime.emitToUsers(
        allMembers.map((m) => m.userId),
        'im:member:joined',
        { conversationId: id, userIds: validMembers.map((m) => m.userId) },
      );

      await this.audit.record(tx, {
        organizationId: org.organizationId,
        actorId: me.id,
        title: 'IM',
        businessType: BusinessType.INSERT,
        action: 'im:member:add',
        resourceType: 'Conversation',
        resourceId: id,
        after: { addedUserIds: validMembers.map((m) => m.userId) },
        traceId: req.traceId,
        ip: req.ip,
        requestMethod: 'POST',
      });

      return { ok: true };
    });
  }

  /** 移除成员或自己退出（仅群聊） */
  @Delete(':id/members/:userId')
  @UseGuards(OrgContextGuard, PermissionsGuard)
  @RequirePermissions('im:use')
  async removeMember(
    @Param('id') id: string,
    @Param('userId') userId: string,
    @CurrentOrg() org: OrgContext,
    @CurrentUser() me: { id: string },
    @Req() req: Request,
  ) {
    return this.prisma.withOrgUser(org.organizationId, me.id, async (tx) => {
      const myMs = await tx.conversationMember.findFirst({
        where: { conversationId: id, userId: me.id, status: 'ACTIVE' },
      });
      if (!myMs) throw new ForbiddenException({ code: 'NOT_MEMBER', message: '不是该会话成员' });
      const conv = await tx.conversation.findFirst({ where: { id, organizationId: org.organizationId } });
      if (!conv) throw new NotFoundException({ code: 'NOT_FOUND', message: '会话不存在' });
      if (conv.type === 'DIRECT') throw new BadRequestException({ code: 'DIRECT_NO_REMOVE', message: '私聊不能移除成员' });
      // 只能自己退出，或 OWNER 移除他人
      if (userId !== me.id && myMs.role !== 'OWNER') throw new ForbiddenException({ code: 'NO_PERMISSION', message: '无权移除该成员' });

      await tx.conversationMember.updateMany({
        where: { conversationId: id, userId },
        data: { status: 'LEFT' },
      });

      const remaining = await tx.conversationMember.findMany({
        where: { conversationId: id, status: 'ACTIVE' },
        select: { userId: true },
      });
      this.realtime.emitToUsers(
        remaining.map((m) => m.userId).concat(userId),
        'im:member:left',
        { conversationId: id, userId },
      );

      await this.audit.record(tx, {
        organizationId: org.organizationId,
        actorId: me.id,
        title: 'IM',
        businessType: BusinessType.DELETE,
        action: 'im:member:remove',
        resourceType: 'Conversation',
        resourceId: id,
        after: { removedUserId: userId },
        traceId: req.traceId,
        ip: req.ip,
        requestMethod: 'DELETE',
      });

      return { ok: true };
    });
  }

  /** 标记已读 */
  @Post(':id/read')
  @UseGuards(OrgContextGuard, PermissionsGuard)
  @RequirePermissions('im:use')
  async markRead(
    @Param('id') id: string,
    @CurrentOrg() org: OrgContext,
    @CurrentUser() me: { id: string },
    @Body() dto: MarkReadDto,
  ) {
    return this.prisma.withOrgUser(org.organizationId, me.id, async (tx) => {
      await tx.conversationMember.updateMany({
        where: { conversationId: id, userId: me.id, status: 'ACTIVE' },
        data: { lastReadMessageId: dto.lastReadMessageId },
      });
      return { ok: true };
    });
  }

  /* ==================== 消息 ==================== */

  /** 历史消息（倒序分页） */
  @Get(':id/messages')
  @UseGuards(OrgContextGuard, PermissionsGuard)
  @RequirePermissions('im:view')
  async messages(
    @Param('id') id: string,
    @CurrentOrg() org: OrgContext,
    @CurrentUser() me: { id: string },
    @Query('beforeId') beforeId?: string,
    @Query('limit') limit?: string,
  ) {
    const take = Math.min(parseInt(limit ?? '50', 10) || 50, 100);
    return this.prisma.withOrgUser(org.organizationId, me.id, async (tx) => {
      const myMs = await tx.conversationMember.findFirst({
        where: { conversationId: id, userId: me.id, status: 'ACTIVE' },
      });
      if (!myMs) throw new ForbiddenException({ code: 'NOT_MEMBER', message: '不是该会话成员' });

      const messages = await tx.message.findMany({
        where: {
          conversationId: id,
          ...(beforeId ? { id: { lt: beforeId } } : {}),
        },
        include: { sender: { select: { id: true, name: true, avatarUrl: true } }, attachment: true },
        orderBy: { createdAt: 'desc' },
        take,
      });
      return messages.reverse().map((m) => ({
        ...m,
        attachment: m.attachment ? { ...m.attachment, size: m.attachment.size.toString() } : null,
      }));
    });
  }

  /** 发送消息 */
  @Post(':id/messages')
  @UseGuards(OrgContextGuard, PermissionsGuard)
  @RequirePermissions('im:use')
  async sendMessage(
    @Param('id') id: string,
    @CurrentOrg() org: OrgContext,
    @CurrentUser() me: { id: string; name: string },
    @Body() dto: SendMessageDto,
    @Req() req: Request,
  ) {
    return this.prisma.withOrgUser(org.organizationId, me.id, async (tx) => {
      const myMs = await tx.conversationMember.findFirst({
        where: { conversationId: id, userId: me.id, status: 'ACTIVE' },
      });
      if (!myMs) throw new ForbiddenException({ code: 'NOT_MEMBER', message: '不是该会话成员' });

      const msg = await tx.message.create({
        data: {
          organizationId: org.organizationId,
          conversationId: id,
          senderId: me.id,
          type: dto.type,
          content: dto.content,
          attachmentId: dto.attachmentId ?? null,
        },
        include: { attachment: true },
      });

      await tx.conversation.update({
        where: { id },
        data: { lastMessageAt: msg.createdAt },
      });

      await this.audit.record(tx, {
        organizationId: org.organizationId,
        actorId: me.id,
        title: 'IM',
        businessType: BusinessType.INSERT,
        action: 'im:message:send',
        resourceType: 'Message',
        resourceId: msg.id,
        after: { type: dto.type, content: dto.content },
        traceId: req.traceId,
        ip: req.ip,
        requestMethod: 'POST',
      });

      const members = await tx.conversationMember.findMany({
        where: { conversationId: id, status: 'ACTIVE' },
        select: { userId: true },
      });

      const payload = {
        conversationId: id,
        message: {
          id: msg.id,
          senderId: me.id,
          senderName: me.name,
          type: dto.type,
          content: dto.content,
          attachment: msg.attachment ? { id: msg.attachment.id, name: msg.attachment.name, mimeType: msg.attachment.mimeType, size: msg.attachment.size.toString() } : null,
          createdAt: msg.createdAt,
        },
      };
      this.realtime.emitToUsers(members.map((m) => m.userId), 'im:message:new', payload);

      return payload.message;
    });
  }

  /* ==================== 附件 ==================== */

  /** 上传附件到会话 */
  @Post(':id/attachments')
  @UseGuards(OrgContextGuard, PermissionsGuard)
  @RequirePermissions('im:attachment:upload')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES } }))
  async uploadAttachment(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @CurrentOrg() org: OrgContext,
    @CurrentUser() me: { id: string },
    @Req() req: Request,
  ) {
    if (!file) throw new BadRequestException({ code: 'FILE_REQUIRED', message: '缺少上传文件' });

    return this.prisma.withOrgUser(org.organizationId, me.id, async (tx) => {
      const myMs = await tx.conversationMember.findFirst({
        where: { conversationId: id, userId: me.id, status: 'ACTIVE' },
      });
      if (!myMs) throw new ForbiddenException({ code: 'NOT_MEMBER', message: '不是该会话成员' });

      const objectKey = `${org.organizationId}/chat/${id}/${nanoid(16)}`;
      const absPath = path.join(UPLOAD_ROOT, objectKey);
      mkdirSync(path.dirname(absPath), { recursive: true });
      writeFileSync(absPath, file.buffer);

      const saved = await tx.messageAttachment.create({
        data: {
          organizationId: org.organizationId,
          conversationId: id,
          uploaderId: me.id,
          name: file.originalname,
          objectKey,
          size: BigInt(file.size),
          mimeType: file.mimetype || 'application/octet-stream',
        },
      });

      await this.audit.record(tx, {
        organizationId: org.organizationId,
        actorId: me.id,
        title: 'IM',
        businessType: BusinessType.INSERT,
        action: 'im:attachment:upload',
        resourceType: 'MessageAttachment',
        resourceId: saved.id,
        after: { name: saved.name, size: saved.size.toString() },
        traceId: req.traceId,
        ip: req.ip,
        requestMethod: 'POST',
      });

      return { id: saved.id, name: saved.name, size: saved.size.toString(), mimeType: saved.mimeType };
    });
  }
}

@Controller('messages/attachments')
export class MessageAttachmentController {
  constructor(private readonly prisma: PrismaService) {}

  @Get(':id/download')
  @UseGuards(OrgContextGuard, PermissionsGuard)
  @RequirePermissions('im:view')
  async download(
    @Param('id') id: string,
    @CurrentOrg() org: OrgContext,
    @CurrentUser() me: { id: string },
    @Res() res: Response,
  ) {
    return this.prisma.withOrgUser(org.organizationId, me.id, async (tx) => {
      const att = await tx.messageAttachment.findFirst({
        where: { id, organizationId: org.organizationId },
      });
      if (!att) throw new NotFoundException({ code: 'NOT_FOUND', message: '附件不存在' });

      const myMs = await tx.conversationMember.findFirst({
        where: { conversationId: att.conversationId, userId: me.id, status: 'ACTIVE' },
      });
      if (!myMs) throw new ForbiddenException({ code: 'NOT_MEMBER', message: '无权下载' });

      const absPath = path.join(UPLOAD_ROOT, att.objectKey);
      const stat = statSync(absPath);
      res.setHeader('Content-Length', stat.size);
      res.setHeader('Content-Type', att.mimeType);
      res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(att.name)}"`);
      createReadStream(absPath).pipe(res);
    });
  }
}
