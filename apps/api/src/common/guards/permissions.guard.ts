import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  PERMISSIONS_KEY,
  REQUIRE_ALL_KEY,
} from '../decorators/permissions.decorator';
import { hasPermission, hasAny } from '../util/perms';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const orgContext = request.orgContext;
    if (!orgContext) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: '缺少组织上下文' });
    }

    // OWNER 角色在组织内拥有全部权限（对应 RuoYi 超管放行）
    const granted: string[] = orgContext.roleKeys?.includes('OWNER')
      ? ['*']
      : orgContext.perms ?? [];

    const allRequired = this.reflector.getAllAndOverride<string[]>(REQUIRE_ALL_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (allRequired?.length) {
      const ok = allRequired.every((p) => hasPermission(granted, p));
      if (!ok) {
        throw new ForbiddenException({
          code: 'PERMISSION_DENIED',
          message: `缺少权限: ${allRequired.join(', ')}`,
        });
      }
      return true;
    }

    const anyRequired = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!anyRequired?.length) return true;

    if (!hasAny(granted, anyRequired)) {
      throw new ForbiddenException({
        code: 'PERMISSION_DENIED',
        message: `缺少权限: ${anyRequired.join(', ')}`,
      });
    }
    return true;
  }
}
