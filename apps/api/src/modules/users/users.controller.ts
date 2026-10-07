import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('users')
export class UsersController {
  constructor(private readonly prisma: PrismaService) {}

  /** 当前登录用户资料 + 所属组织（含角色 key） */
  @Get('me')
  me(@CurrentUser() user: { id: string }) {
    return this.prisma.withUser(user.id, async (tx) => {
      const u = await tx.user.findUnique({
        where: { id: user.id },
        select: {
          id: true,
          email: true,
          name: true,
          avatarUrl: true,
          status: true,
          isPlatformAdmin: true,
          createdAt: true,
        },
      });

      const memberships = await tx.membership.findMany({
        where: { userId: user.id },
        include: {
          organization: { select: { id: true, name: true, slug: true, status: true } },
          roles: { include: { role: { select: { key: true, name: true } } } },
        },
        orderBy: { joinedAt: 'asc' },
      });

      const organizations = memberships.map((m) => ({
        ...m.organization,
        membershipId: m.id,
        membershipStatus: m.status,
        deptId: m.deptId,
        roleKeys: m.roles.map((mr) => mr.role.key),
        roleNames: m.roles.map((mr) => mr.role.name),
      }));

      return { ...u, organizations };
    });
  }
}
