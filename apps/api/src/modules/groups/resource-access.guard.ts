import { CanActivate, ExecutionContext, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ResourcePolicyService } from './resource-policy.service';

@Injectable()
export class ResourceAccessGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService, private readonly policy: ResourcePolicyService) {}
  async canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest();
    const orgId = req.orgContext.organizationId;
    const userId = req.user.id;
    const action = req.method === 'GET' ? 'READ' : 'WRITE';
    return this.prisma.withOrg(orgId, async tx => {
      req.accessibleProjectIds = await this.policy.accessible(tx, orgId, userId, action);
      let projectId = req.body?.projectId ?? req.query?.projectId;
      const route = req.route.path as string;
      if (route.includes('/projects/:id')) projectId = req.params.id;
      if (route.includes('/tasks/:id')) projectId = (await tx.task.findFirst({ where: { id: req.params.id, organizationId: orgId } }))?.projectId ?? '__missing__';
      if (route.includes('/files/:id')) projectId = (await tx.file.findFirst({ where: { id: req.params.id, organizationId: orgId } }))?.projectId ?? '__missing__';
      if (projectId && !req.accessibleProjectIds.includes(projectId)) throw new NotFoundException({ code: 'PROJECT_NOT_FOUND', message: '项目不存在或没有访问权限' });
      return true;
    });
  }
}
