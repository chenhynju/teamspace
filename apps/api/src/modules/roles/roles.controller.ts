import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Put,
  Body,
  Param,
  UseGuards,
  Req,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { OrgContextGuard } from '../../common/guards/org-context.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CurrentOrg, OrgContext } from '../../common/decorators/current-org.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuditService, BusinessType } from '../audit/audit.service';
import {
  CreateRoleDto,
  UpdateRoleDto,
  AssignMenusDto,
  AssignDeptsDto,
} from './dto/role.dto';

const RESERVED_KEYS = ['OWNER'];

@Controller('roles')
@UseGuards(OrgContextGuard, PermissionsGuard)
export class RolesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @RequirePermissions('role:list')
  list(@CurrentOrg() org: OrgContext) {
    return this.prisma.withOrg(org.organizationId, (tx) =>
      tx.role.findMany({
        where: { organizationId: org.organizationId },
        include: { _count: { select: { memberships: true, menus: true } } },
        orderBy: [{ sort: 'asc' }, { createdAt: 'asc' }],
      }),
    );
  }

  @Get(':id')
  @RequirePermissions('role:list')
  detail(@Param('id') id: string, @CurrentOrg() org: OrgContext) {
    return this.prisma.withOrg(org.organizationId, async (tx) => {
      const role = await tx.role.findFirst({
        where: { id, organizationId: org.organizationId },
        include: {
          menus: { select: { menuId: true } },
          depts: { select: { deptId: true } },
        },
      });
      if (!role) return null;
      return {
        ...role,
        menuIds: role.menus.map((m) => m.menuId),
        deptIds: role.depts.map((d) => d.deptId),
      };
    });
  }

  @Post()
  @RequirePermissions('role:add')
  create(
    @Body() dto: CreateRoleDto,
    @CurrentOrg() org: OrgContext,
    @CurrentUser() me: { id: string },
    @Req() req: Request,
  ) {
    const key = dto.key.trim().toUpperCase();
    if (RESERVED_KEYS.includes(key)) {
      throw new BadRequestException({ code: 'ROLE_KEY_RESERVED', message: '该角色标识为系统保留' });
    }
    return this.prisma.withOrg(org.organizationId, async (tx) => {
      const role = await tx.role.create({
        data: {
          organizationId: org.organizationId,
          name: dto.name,
          key,
          dataScope: (dto.dataScope as any) ?? 'SELF',
          sort: dto.sort ?? 10,
          remark: dto.remark,
          status: 'NORMAL',
        },
      });
      await this.audit.record(tx, {
        organizationId: org.organizationId,
        actorId: me.id,
        title: '角色管理',
        businessType: BusinessType.INSERT,
        action: 'role:add',
        resourceType: 'Role',
        resourceId: role.id,
        after: { name: role.name, key: role.key },
        traceId: req.traceId,
        ip: req.ip,
        requestMethod: 'POST',
      });
      return role;
    });
  }

  @Patch(':id')
  @RequirePermissions('role:edit')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateRoleDto,
    @CurrentOrg() org: OrgContext,
    @CurrentUser() me: { id: string },
    @Req() req: Request,
  ) {
    return this.prisma.withOrg(org.organizationId, async (tx) => {
      const before = await tx.role.findFirst({
        where: { id, organizationId: org.organizationId },
      });
      const updated = await tx.role.update({
        where: { id },
        data: {
          name: dto.name,
          dataScope: dto.dataScope as any,
          status: dto.status as any,
          sort: dto.sort,
          remark: dto.remark,
        },
      });
      await this.audit.record(tx, {
        organizationId: org.organizationId,
        actorId: me.id,
        title: '角色管理',
        businessType: BusinessType.UPDATE,
        action: 'role:edit',
        resourceType: 'Role',
        resourceId: id,
        before,
        after: updated,
        traceId: req.traceId,
        ip: req.ip,
        requestMethod: 'PATCH',
      });
      return updated;
    });
  }

  /** 配置角色菜单权限（功能权限） */
  @Put(':id/menus')
  @RequirePermissions('role:assign-menu')
  async assignMenus(
    @Param('id') id: string,
    @Body() dto: AssignMenusDto,
    @CurrentOrg() org: OrgContext,
    @CurrentUser() me: { id: string },
    @Req() req: Request,
  ) {
    return this.prisma.withOrg(org.organizationId, async (tx) => {
      // 菜单为全局模板，校验 id 全部存在
      const menus = await tx.menu.count({ where: { id: { in: dto.menuIds } } });
      if (menus !== new Set(dto.menuIds).size) {
        throw new BadRequestException({ code: 'MENU_INVALID', message: '存在无效菜单' });
      }
      await tx.roleMenu.deleteMany({ where: { roleId: id } });
      if (dto.menuIds.length) {
        await tx.roleMenu.createMany({
          data: dto.menuIds.map((menuId) => ({ roleId: id, menuId })),
          skipDuplicates: true,
        });
      }
      await this.audit.record(tx, {
        organizationId: org.organizationId,
        actorId: me.id,
        title: '角色管理',
        businessType: BusinessType.GRANT,
        action: 'role:assign-menu',
        resourceType: 'Role',
        resourceId: id,
        after: { menuIds: dto.menuIds },
        traceId: req.traceId,
        ip: req.ip,
        requestMethod: 'PUT',
      });
      return { roleId: id, menuIds: dto.menuIds };
    });
  }

  /** 配置自定义数据范围部门（dataScope=CUSTOM 时生效） */
  @Put(':id/depts')
  @RequirePermissions('role:assign-menu')
  async assignDepts(
    @Param('id') id: string,
    @Body() dto: AssignDeptsDto,
    @CurrentOrg() org: OrgContext,
    @CurrentUser() me: { id: string },
    @Req() req: Request,
  ) {
    return this.prisma.withOrg(org.organizationId, async (tx) => {
      const depts = await tx.dept.count({
        where: { id: { in: dto.deptIds }, organizationId: org.organizationId },
      });
      if (depts !== new Set(dto.deptIds).size) {
        throw new BadRequestException({ code: 'DEPT_INVALID', message: '存在不属于当前组织的部门' });
      }
      await tx.roleDept.deleteMany({ where: { roleId: id } });
      if (dto.deptIds.length) {
        await tx.roleDept.createMany({
          data: dto.deptIds.map((deptId) => ({ roleId: id, deptId })),
          skipDuplicates: true,
        });
      }
      await this.audit.record(tx, {
        organizationId: org.organizationId,
        actorId: me.id,
        title: '角色管理',
        businessType: BusinessType.GRANT,
        action: 'role:assign-dept',
        resourceType: 'Role',
        resourceId: id,
        after: { deptIds: dto.deptIds },
        traceId: req.traceId,
        ip: req.ip,
        requestMethod: 'PUT',
      });
      return { roleId: id, deptIds: dto.deptIds };
    });
  }

  @Delete(':id')
  @RequirePermissions('role:remove')
  async remove(
    @Param('id') id: string,
    @CurrentOrg() org: OrgContext,
    @CurrentUser() me: { id: string },
    @Req() req: Request,
  ) {
    return this.prisma.withOrg(org.organizationId, async (tx) => {
      const role = await tx.role.findFirst({
        where: { id, organizationId: org.organizationId },
        include: { _count: { select: { memberships: true } } },
      });
      if (!role) return { deleted: false };
      if (RESERVED_KEYS.includes(role.key)) {
        throw new ConflictException({ code: 'ROLE_PROTECTED', message: '内置 OWNER 角色不可删除' });
      }
      if (role._count.memberships > 0) {
        throw new ConflictException({
          code: 'ROLE_IN_USE',
          message: `该角色仍被 ${role._count.memberships} 名成员使用，请先调整`,
        });
      }
      await tx.role.delete({ where: { id } });
      await this.audit.record(tx, {
        organizationId: org.organizationId,
        actorId: me.id,
        title: '角色管理',
        businessType: BusinessType.DELETE,
        action: 'role:remove',
        resourceType: 'Role',
        resourceId: id,
        before: { name: role.name, key: role.key },
        traceId: req.traceId,
        ip: req.ip,
        requestMethod: 'DELETE',
      });
      return { deleted: true, id };
    });
  }
}
