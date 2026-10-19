import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Query,
  Body,
  UseGuards,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { OrgContextGuard } from '../../common/guards/org-context.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CurrentOrg, OrgContext } from '../../common/decorators/current-org.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuditService, BusinessType } from '../audit/audit.service';

/**
 * 登录日志（平台全局表）：登录/注册/改密等认证事件的审计线索。
 * 分页返回，支持按账号/IP/状态过滤；可单条删除或清空。
 */
@Controller('login-logs')
@UseGuards(OrgContextGuard, PermissionsGuard)
export class LoginLogController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @RequirePermissions('logininfor:list')
  async list(
    @Query('username') username?: string,
    @Query('ip') ip?: string,
    @Query('status') status?: string,
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
  ) {
    const p = Math.max(parseInt(page, 10) || 1, 1);
    const size = Math.min(Math.max(parseInt(pageSize, 10) || 20, 1), 100);
    const statusNum = status === undefined ? undefined : parseInt(status, 10);

    const where = {
      ...(username ? { username: { contains: username } } : {}),
      ...(ip ? { ip: { contains: ip } } : {}),
      ...(statusNum === 0 || statusNum === 1 ? { status: statusNum } : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.loginLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (p - 1) * size,
        take: size,
      }),
      this.prisma.loginLog.count({ where }),
    ]);

    return { items, total, page: p, pageSize: size };
  }

  @Delete(':id')
  @RequirePermissions('logininfor:remove')
  remove(
    @Param('id') id: string,
    @CurrentOrg() org: OrgContext,
    @CurrentUser() me: { id: string },
    @Req() req: Request,
  ) {
    return this.prisma.withOrg(org.organizationId, async (tx) => {
      await tx.loginLog.delete({ where: { id } });
      await this.audit.record(tx, {
        organizationId: org.organizationId,
        actorId: me.id,
        title: '登录日志',
        businessType: BusinessType.DELETE,
        action: 'logininfor:remove',
        resourceType: 'LoginLog',
        resourceId: id,
        traceId: req.traceId,
        ip: req.ip,
        requestMethod: 'DELETE',
      });
      return { deleted: true, id };
    });
  }

  /** 清空全部登录日志（危险操作，单独权限） */
  @Post('clear')
  @RequirePermissions('logininfor:remove')
  clear(
    @CurrentOrg() org: OrgContext,
    @CurrentUser() me: { id: string },
    @Req() req: Request,
  ) {
    return this.prisma.withOrg(org.organizationId, async (tx) => {
      await tx.loginLog.deleteMany({});
      await this.audit.record(tx, {
        organizationId: org.organizationId,
        actorId: me.id,
        title: '登录日志',
        businessType: BusinessType.DELETE,
        action: 'logininfor:clear',
        resourceType: 'LoginLog',
        traceId: req.traceId,
        ip: req.ip,
        requestMethod: 'POST',
      });
      return { cleared: true };
    });
  }
}
