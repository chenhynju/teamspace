import { SetMetadata } from '@nestjs/common';

export const PERMISSIONS_KEY = 'required_permissions';
export const REQUIRE_ALL_KEY = 'require_all_permissions';

/**
 * 要求当前用户在当前组织下拥有指定权限码（任一即可通过）。
 * 权限码来自 sys_menu.perms，如 'system:user:list' / 'project:add'。
 */
export const RequirePermissions = (...permissions: string[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);

/** 要求拥有全部指定权限 */
export const RequireAllPermissions = (...permissions: string[]) =>
  SetMetadata(REQUIRE_ALL_KEY, permissions);
