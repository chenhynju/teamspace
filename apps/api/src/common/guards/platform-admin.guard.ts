import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * 平台级运维接口守卫：仅 isPlatformAdmin=true 的平台超管可用
 * （如手动触发订阅生命周期扫描）。不信任请求体，以 JWT 反查的用户为准。
 */
@Injectable()
export class PlatformAdminGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const userId: string | undefined = req.user?.sub ?? req.user?.id;
    if (!userId) throw new ForbiddenException('缺少用户身份');

    const user = await this.prisma.withUser(userId, (tx) =>
      tx.user.findFirst({
        where: { id: userId, isPlatformAdmin: true },
        select: { id: true },
      }),
    );
    if (!user) throw new ForbiddenException('仅平台超级管理员可执行此操作');
    return true;
  }
}
