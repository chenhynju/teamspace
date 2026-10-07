import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { DataScope } from '@prisma/client';

/**
 * 服务端反查得到的组织上下文（不信任请求传入的 orgId）。
 * perms 为该成员在当前组织下所有有效角色的菜单权限标识并集。
 */
export interface OrgContext {
  organizationId: string;
  membershipId: string;
  deptId: string | null;
  roleIds: string[];
  roleKeys: string[];
  perms: string[];
  dataScopes: DataScope[];
}

export const CurrentOrg = createParamDecorator(
  (data: keyof OrgContext | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const org = request.orgContext as OrgContext;
    return data ? org?.[data] : org;
  },
);
