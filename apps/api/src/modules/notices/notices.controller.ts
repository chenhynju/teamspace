import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Req,
  NotFoundException,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  IsString,
  MinLength,
  MaxLength,
  IsOptional,
  IsEnum,
} from 'class-validator';
import { CommonStatus, NoticeType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { OrgContextGuard } from '../../common/guards/org-context.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CurrentOrg, OrgContext } from '../../common/decorators/current-org.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuditService, BusinessType } from '../audit/audit.service';

class NoticeDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  title: string;

  @IsEnum(NoticeType)
  type: NoticeType;

  @IsString()
  @MinLength(1)
  @MaxLength(10000)
  content: string;

  @IsOptional()
  @IsEnum(CommonStatus)
  status?: CommonStatus;
}

/**
 * 通知公告（组织隔离）：组织内向全体成员发布通知/公告。
 * 列表附加 readByMe；未读数供顶栏角标；标记已读幂等。
 */
@Controller('notices')
@UseGuards(OrgContextGuard, PermissionsGuard)
export class NoticesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  list(
    @CurrentOrg() org: OrgContext,
    @CurrentUser() me: { id: string },
    @Query('title') title?: string,
    @Query('type') type?: NoticeType,
  ) {
    return this.prisma.withOrgUser(org.organizationId, me.id, async (tx) => {
      const notices = await tx.notice.findMany({
        where: {
          organizationId: org.organizationId,
          ...(title ? { title: { contains: title } } : {}),
          ...(type ? { type } : {}),
        },
        orderBy: { createdAt: 'desc' },
      });
      const reads = await tx.noticeRead.findMany({
        where: { userId: me.id, noticeId: { in: notices.map((n) => n.id) } },
        select: { noticeId: true },
      });
      const readSet = new Set(reads.map((r) => r.noticeId));
      return notices.map((n) => ({ ...n, readByMe: readSet.has(n.id) }));
    });
  }

  @Get('unread-count')
  unreadCount(
    @CurrentOrg() org: OrgContext,
    @CurrentUser() me: { id: string },
  ) {
    return this.prisma.withOrgUser(org.organizationId, me.id, async (tx) => {
      const read = await tx.noticeRead.findMany({
        where: { userId: me.id },
        select: { noticeId: true },
      });
      const readIds = read.map((r) => r.noticeId);
      const count = await tx.notice.count({
        where: {
          organizationId: org.organizationId,
          status: CommonStatus.NORMAL,
          id: { notIn: readIds },
        },
      });
      return { count };
    });
  }

  @Get(':id')
  detail(
    @Param('id') id: string,
    @CurrentOrg() org: OrgContext,
    @CurrentUser() me: { id: string },
  ) {
    return this.prisma.withOrgUser(org.organizationId, me.id, async (tx) => {
      const notice = await tx.notice.findFirst({
        where: { id, organizationId: org.organizationId },
      });
      if (!notice) throw new NotFoundException({ code: 'NOT_FOUND', message: '公告不存在' });
      const read = await tx.noticeRead.findFirst({ where: { noticeId: id, userId: me.id } });
      return { ...notice, readByMe: !!read };
    });
  }

  @Post()
  @RequirePermissions('notice:add')
  create(
    @Body() dto: NoticeDto,
    @CurrentOrg() org: OrgContext,
    @CurrentUser() me: { id: string },
    @Req() req: Request,
  ) {
    return this.prisma.withOrgUser(org.organizationId, me.id, async (tx) => {
      const notice = await tx.notice.create({
        data: {
          organizationId: org.organizationId,
          title: dto.title,
          type: dto.type,
          content: dto.content,
          status: dto.status ?? CommonStatus.NORMAL,
        },
      });
      // 发布者自己算已读
      await tx.noticeRead.create({ data: { noticeId: notice.id, userId: me.id } });
      await this.audit.record(tx, {
        organizationId: org.organizationId,
        actorId: me.id,
        title: '通知公告',
        businessType: BusinessType.INSERT,
        action: 'notice:add',
        resourceType: 'Notice',
        resourceId: notice.id,
        after: { title: notice.title, type: notice.type },
        traceId: req.traceId,
        ip: req.ip,
        requestMethod: 'POST',
      });
      return notice;
    });
  }

  @Patch(':id')
  @RequirePermissions('notice:edit')
  update(
    @Param('id') id: string,
    @Body() dto: Partial<NoticeDto>,
    @CurrentOrg() org: OrgContext,
    @CurrentUser() me: { id: string },
    @Req() req: Request,
  ) {
    return this.prisma.withOrgUser(org.organizationId, me.id, async (tx) => {
      const existing = await tx.notice.findFirst({
        where: { id, organizationId: org.organizationId },
      });
      if (!existing) throw new NotFoundException({ code: 'NOT_FOUND', message: '公告不存在' });

      const notice = await tx.notice.update({
        where: { id },
        data: {
          title: dto.title,
          type: dto.type,
          content: dto.content,
          status: dto.status,
        },
      });
      await this.audit.record(tx, {
        organizationId: org.organizationId,
        actorId: me.id,
        title: '通知公告',
        businessType: BusinessType.UPDATE,
        action: 'notice:edit',
        resourceType: 'Notice',
        resourceId: id,
        before: { title: existing.title },
        after: { title: notice.title },
        traceId: req.traceId,
        ip: req.ip,
        requestMethod: 'PATCH',
      });
      return notice;
    });
  }

  @Delete(':id')
  @RequirePermissions('notice:remove')
  remove(
    @Param('id') id: string,
    @CurrentOrg() org: OrgContext,
    @CurrentUser() me: { id: string },
    @Req() req: Request,
  ) {
    return this.prisma.withOrgUser(org.organizationId, me.id, async (tx) => {
      await tx.notice.delete({ where: { id } });
      await this.audit.record(tx, {
        organizationId: org.organizationId,
        actorId: me.id,
        title: '通知公告',
        businessType: BusinessType.DELETE,
        action: 'notice:remove',
        resourceType: 'Notice',
        resourceId: id,
        traceId: req.traceId,
        ip: req.ip,
        requestMethod: 'DELETE',
      });
      return { deleted: true, id };
    });
  }

  /** 标记已读（幂等） */
  @Post(':id/read')
  markRead(
    @Param('id') id: string,
    @CurrentOrg() org: OrgContext,
    @CurrentUser() me: { id: string },
  ) {
    return this.prisma.withOrgUser(org.organizationId, me.id, async (tx) => {
      const notice = await tx.notice.findFirst({
        where: { id, organizationId: org.organizationId },
        select: { id: true },
      });
      if (!notice) throw new NotFoundException({ code: 'NOT_FOUND', message: '公告不存在' });
      const existing = await tx.noticeRead.findFirst({ where: { noticeId: id, userId: me.id } });
      if (!existing) await tx.noticeRead.create({ data: { noticeId: id, userId: me.id } });
      return { ok: true };
    });
  }
}
