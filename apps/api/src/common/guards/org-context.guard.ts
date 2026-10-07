import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { MemberStatus, CommonStatus } from '@prisma/client';
import type { OrgContext } from '../decorators/current-org.decorator';

/**
 * 组织上下文守卫：
 *  1. 从请求头 x-organization-id 读取目标组织；
 *  2. 在该组织的 RLS 事务内反查 Membership（不信任请求体 orgId），加载其有效角色、菜单权限、数据范围；
 *  3. 挂载 request.orgContext。
 */
@Injectable()
export class OrgContextGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;
    if (!user) throw new ForbiddenException({ code: 'FORBIDDEN', message: '未登录' });

    const orgId = (request.headers['x-organization-id'] as string)?.trim();
    if (!orgId) {
      throw new BadRequestException({
        code: 'ORG_REQUIRED',
        message: '缺少组织上下文（x-organization-id）',
      });
    }

    const membership = await this.prisma.withOrg(orgId, (tx) =>
      tx.membership.findUnique({
        where: { organizationId_userId: { organizationId: orgId, userId: user.id } },
        include: {
          roles: {
            include: {
              role: {
                include: {
                  menus: { include: { menu: true } },
                },
              },
            },
          },
        },
      }),
    );

    if (!membership) {
      throw new ForbiddenException({ code: 'NOT_MEMBER', message: '你不是该组织的成员' });
    }
    if (membership.status !== MemberStatus.ACTIVE) {
      throw new ForbiddenException({
        code: 'MEMBERSHIP_INACTIVE',
        message: '成员状态无效（已暂停或移除）',
      });
    }

    const roleIds: string[] = [];
    const roleKeys: string[] = [];
    const perms = new Set<string>();
    const dataScopes = new Set<OrgContext['dataScopes'][number]>();

    for (const mr of membership.roles) {
      const role = mr.role;
      if (role.status !== CommonStatus.NORMAL) continue;
      roleIds.push(role.id);
      roleKeys.push(role.key);
      dataScopes.add(role.dataScope);
      for (const rm of role.menus) {
        const menu = rm.menu;
        if (menu.status === CommonStatus.NORMAL && menu.perms) {
          perms.add(menu.perms);
        }
      }
    }

    request.orgContext = {
      organizationId: orgId,
      membershipId: membership.id,
      deptId: membership.deptId,
      roleIds,
      roleKeys,
      perms: [...perms],
      dataScopes: [...dataScopes],
    } satisfies OrgContext;

    return true;
  }
}
