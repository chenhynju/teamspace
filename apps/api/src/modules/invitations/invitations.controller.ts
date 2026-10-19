import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  Req,
  ConflictException,
  BadRequestException,
  GoneException,
  NotFoundException,
} from '@nestjs/common';
import type { Request } from 'express';
import { createHash } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { nanoid } from 'nanoid';
import { PrismaService } from '../../prisma/prisma.service';
import { OrgContextGuard } from '../../common/guards/org-context.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CurrentOrg, OrgContext } from '../../common/decorators/current-org.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { AuditService, BusinessType } from '../audit/audit.service';
import { CreateInvitationDto } from './dto/invitation.dto';

function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

@Controller('invitations')
export class InvitationsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
  ) {}

  /** 邀请列表（组织隔离） */
  @Get()
  @UseGuards(OrgContextGuard, PermissionsGuard)
  @RequirePermissions('invite:list')
  list(@CurrentOrg() org: OrgContext) {
    return this.prisma.withOrg(org.organizationId, async (tx) => {
      // 惰性过期：列表加载时把已过期的 PENDING 邀请标记为 EXPIRED
      await tx.invitation.updateMany({
        where: {
          organizationId: org.organizationId,
          status: 'PENDING',
          expiresAt: { lt: new Date() },
        },
        data: { status: 'EXPIRED' },
      });
      return tx.invitation.findMany({
        where: { organizationId: org.organizationId },
        include: { role: { select: { id: true, name: true, key: true } } },
        orderBy: { createdAt: 'desc' },
      });
    });
  }

  /** 发送邀请（生成随机 token，仅存 sha256 哈希） */
  @Post()
  @UseGuards(OrgContextGuard, PermissionsGuard)
  @RequirePermissions('invite:send')
  create(
    @Body() dto: CreateInvitationDto,
    @CurrentOrg() org: OrgContext,
    @CurrentUser() me: { id: string },
    @Req() req: Request,
  ) {
    const email = dto.email.toLowerCase();
    return this.prisma.withOrg(org.organizationId, async (tx) => {
      // 角色必须属于当前组织
      const role = await tx.role.findFirst({
        where: { id: dto.roleId, organizationId: org.organizationId },
      });
      if (!role) {
        throw new BadRequestException({ code: 'ROLE_INVALID', message: '角色不存在' });
      }

      // 精确匹配该邮箱的有效成员
      const already = await tx.membership.findFirst({
        where: {
          organizationId: org.organizationId,
          status: 'ACTIVE',
          user: { email },
        },
      });
      if (already) {
        throw new ConflictException({ code: 'ALREADY_MEMBER', message: '该邮箱已是组织成员' });
      }

      // 同邮箱已有未过期 PENDING 邀请时拒绝重复发送（请先撤销或等待过期）
      const pendingDup = await tx.invitation.findFirst({
        where: {
          organizationId: org.organizationId,
          email,
          status: 'PENDING',
          expiresAt: { gt: new Date() },
        },
      });
      if (pendingDup) {
        throw new ConflictException({
          code: 'INVITE_EXISTS',
          message: '该邮箱已有待接受的邀请，请撤销后再重新发送',
        });
      }

      const rawToken = nanoid(32);
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

      const invitation = await tx.invitation.create({
        data: {
          organizationId: org.organizationId,
          email,
          roleId: role.id,
          tokenHash: hashToken(rawToken),
          expiresAt,
          status: 'PENDING',
          invitedById: me.id,
        },
      });

      await this.audit.record(tx, {
        organizationId: org.organizationId,
        actorId: me.id,
        title: '邀请管理',
        businessType: BusinessType.INSERT,
        action: 'invite:send',
        resourceType: 'Invitation',
        resourceId: invitation.id,
        after: { email, role: role.key },
        traceId: req.traceId,
        ip: req.ip,
        requestMethod: 'POST',
      });

      const webUrl = this.config.get('WEB_URL', 'http://localhost:3000');
      return {
        id: invitation.id,
        email: invitation.email,
        status: invitation.status,
        expiresAt: invitation.expiresAt,
        inviteUrl: `${webUrl}/invite/accept?token=${rawToken}`,
      };
    });
  }

  /** 撤销邀请（仅 PENDING 可撤销） */
  @Post(':id/revoke')
  @UseGuards(OrgContextGuard, PermissionsGuard)
  @RequirePermissions('invite:revoke')
  revoke(
    @Param('id') id: string,
    @CurrentOrg() org: OrgContext,
    @CurrentUser() me: { id: string },
    @Req() req: Request,
  ) {
    return this.prisma.withOrg(org.organizationId, async (tx) => {
      const invitation = await tx.invitation.findFirst({
        where: { id, organizationId: org.organizationId },
      });
      if (!invitation) throw new NotFoundException({ code: 'NOT_FOUND', message: '邀请不存在' });
      if (invitation.status !== 'PENDING') {
        throw new ConflictException({ code: 'INVITE_NOT_PENDING', message: '仅待处理邀请可撤销' });
      }
      const updated = await tx.invitation.update({
        where: { id },
        data: { status: 'REVOKED' },
      });
      await this.audit.record(tx, {
        organizationId: org.organizationId,
        actorId: me.id,
        title: '邀请管理',
        businessType: BusinessType.STATUS,
        action: 'invite:revoke',
        resourceType: 'Invitation',
        resourceId: id,
        before: { status: 'PENDING' },
        after: { status: updated.status },
        traceId: req.traceId,
        ip: req.ip,
        requestMethod: 'POST',
      });
      return updated;
    });
  }

  /** 凭 token 预览邀请（公开） */
  @Public()
  @Get('preview')
  preview(@Query('token') token: string) {
    if (!token) throw new BadRequestException({ code: 'TOKEN_REQUIRED', message: '缺少邀请凭证' });
    return this.locate(token).then((invitation) =>
      this.prisma.withOrg(invitation.organizationId, async (tx) => {
        const [organization, role] = await Promise.all([
          tx.organization.findUnique({ where: { id: invitation.organizationId }, select: { id: true, name: true } }),
          tx.role.findUnique({ where: { id: invitation.roleId }, select: { id: true, name: true, key: true } }),
        ]);
        return {
          email: invitation.email,
          status: invitation.status,
          expiresAt: invitation.expiresAt,
          organization,
          role,
        };
      }),
    );
  }

  /** 接受邀请（需登录，且邮箱与邀请一致；原子事务） */
  @Post('accept')
  accept(
    @Body('token') token: string,
    @CurrentUser() user: { id: string; email: string },
    @Req() req: Request,
  ) {
    return this.locate(token).then((invitation) =>
      this.prisma.withOrg(invitation.organizationId, async (tx) => {
        // 状态机校验
        if (invitation.status === 'REVOKED') {
          throw new GoneException({ code: 'INVITE_REVOKED', message: '邀请已被撤销' });
        }
        if (invitation.status === 'ACCEPTED') {
          throw new ConflictException({ code: 'INVITE_USED', message: '邀请已被使用' });
        }
        const expired = invitation.expiresAt.getTime() < Date.now();
        if (expired || invitation.status === 'EXPIRED') {
          if (invitation.status === 'PENDING') {
            await tx.invitation.update({ where: { id: invitation.id }, data: { status: 'EXPIRED' } });
          }
          throw new GoneException({ code: 'INVITE_EXPIRED', message: '邀请已过期' });
        }

        // 邮箱一致性
        if (user.email.toLowerCase() !== invitation.email.toLowerCase()) {
          throw new BadRequestException({
            code: 'EMAIL_MISMATCH',
            message: '当前账号邮箱与邀请邮箱不一致',
          });
        }

        // 邀请本身投递到该邮箱，接受即代表邮箱所有权已验证
        await tx.user.updateMany({
          where: { id: user.id, emailVerifiedAt: null },
          data: { emailVerifiedAt: new Date() },
        });

        // 席位配额（仅计 ACTIVE）
        const entitlement = await tx.entitlement.findUnique({
          where: { organizationId: invitation.organizationId },
        });
        const activeSeats = await tx.membership.count({
          where: { organizationId: invitation.organizationId, status: 'ACTIVE' },
        });
        if (entitlement && activeSeats >= entitlement.seatsIncluded) {
          throw new ConflictException({
            code: 'SEAT_LIMIT',
            message: `已达套餐席位上限（${entitlement.seatsIncluded}），请升级或联系管理员`,
          });
        }

        const existing = await tx.membership.findFirst({
          where: {
            organizationId: invitation.organizationId,
            userId: user.id,
          },
        });
        let membershipId: string;
        if (existing) {
          if (existing.status === 'ACTIVE') {
            throw new ConflictException({ code: 'ALREADY_MEMBER', message: '你已是组织成员' });
          }
          const rootDept = await tx.dept.findFirst({
            where: { organizationId: invitation.organizationId, parentId: null },
          });
          await tx.membership.update({
            where: { id: existing.id },
            data: { status: 'ACTIVE', deptId: existing.deptId ?? rootDept?.id ?? null },
          });
          await tx.membershipRole.deleteMany({ where: { membershipId: existing.id } });
          await tx.membershipRole.create({ data: { membershipId: existing.id, roleId: invitation.roleId } });
          membershipId = existing.id;
        } else {
          const rootDept = await tx.dept.findFirst({
            where: { organizationId: invitation.organizationId, parentId: null },
          });
          const membership = await tx.membership.create({
            data: {
              organizationId: invitation.organizationId,
              userId: user.id,
              deptId: rootDept?.id ?? null,
              status: 'ACTIVE',
            },
          });
          await tx.membershipRole.create({
            data: { membershipId: membership.id, roleId: invitation.roleId },
          });
          membershipId = membership.id;
        }

        await tx.invitation.update({
          where: { id: invitation.id },
          data: { status: 'ACCEPTED', acceptedById: user.id, acceptedAt: new Date() },
        });

        await this.audit.record(tx, {
          organizationId: invitation.organizationId,
          actorId: user.id,
          title: '邀请管理',
          businessType: BusinessType.UPDATE,
          action: 'invite:accept',
          resourceType: 'Membership',
          resourceId: membershipId,
          after: { roleId: invitation.roleId },
          traceId: req.traceId,
          ip: req.ip,
          requestMethod: 'POST',
        });

        return { accepted: true, organizationId: invitation.organizationId, membershipId };
      }),
    );
  }

  /** 内部：在受限查询事务内凭 token 哈希定位邀请 */
  private async locate(token: string) {
    const tokenHash = hashToken(token);
    const invitation = await this.prisma.withInviteLookup((tx) =>
      tx.invitation.findFirst({ where: { tokenHash } }),
    );
    if (!invitation) {
      throw new NotFoundException({ code: 'INVITE_NOT_FOUND', message: '邀请不存在或链接无效' });
    }
    return invitation;
  }
}
