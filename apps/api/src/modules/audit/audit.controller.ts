import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { OrgContextGuard } from '../../common/guards/org-context.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CurrentOrg, OrgContext } from '../../common/decorators/current-org.decorator';
import { PrismaService } from '../../prisma/prisma.service';

@Controller('audit')
@UseGuards(OrgContextGuard, PermissionsGuard)
export class AuditController {
  constructor(private readonly prisma: PrismaService) {}

  /** 审计日志列表（组织隔离；可按资源类型过滤） */
  @Get()
  @RequirePermissions('audit:list')
  list(
    @CurrentOrg() org: OrgContext,
    @Query('resourceType') resourceType?: string,
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
  ) {
    const p = Math.max(1, Number(page) || 1);
    const ps = Math.min(100, Math.max(1, Number(pageSize) || 20));

    return this.prisma.withOrg(org.organizationId, async (tx) => {
      const where = {
        organizationId: org.organizationId,
        ...(resourceType ? { resourceType } : {}),
      };
      const [total, items] = await Promise.all([
        tx.operLog.count({ where }),
        tx.operLog.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (p - 1) * ps,
          take: ps,
          include: { actor: { select: { id: true, name: true, email: true } } },
        }),
      ]);
      return { total, page: p, pageSize: ps, items };
    });
  }
}
