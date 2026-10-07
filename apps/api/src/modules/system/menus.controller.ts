import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Req,
  BadRequestException,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { Request } from 'express';
import {
  IsString,
  MinLength,
  MaxLength,
  IsOptional,
  IsInt,
  Min,
  IsBoolean,
  IsEnum,
  ValidateIf,
} from 'class-validator';
import { MenuType, ShowHide, CommonStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { OrgContextGuard } from '../../common/guards/org-context.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CurrentOrg, OrgContext } from '../../common/decorators/current-org.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuditService, BusinessType } from '../audit/audit.service';

interface MenuNode {
  id: string;
  parentId: string | null;
  name: string;
  type: string;
  orderNum: number;
  path: string | null;
  component: string | null;
  perms: string | null;
  icon: string | null;
  visible: string;
  children: MenuNode[];
}

class MenuDto {
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  name: string;

  @IsEnum(MenuType)
  type: MenuType;

  @IsOptional()
  @ValidateIf((o) => o.parentId !== null)
  @IsString()
  parentId?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  orderNum?: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  path?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  component?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  query?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  routeName?: string | null;

  @IsOptional()
  @IsBoolean()
  isFrame?: boolean;

  @IsOptional()
  @IsBoolean()
  isCache?: boolean;

  @IsOptional()
  @IsEnum(ShowHide)
  visible?: ShowHide;

  @IsOptional()
  @IsEnum(CommonStatus)
  status?: CommonStatus;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  perms?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  icon?: string | null;
}

/**
 * 菜单管理（平台全局表，无组织 RLS；访问完全由角色权限点控制）。
 * 写操作在 withOrg 事务内进行，使审计写入具备组织上下文。
 */
@Controller('menus')
@UseGuards(OrgContextGuard, PermissionsGuard)
export class MenusController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** 扁平列表（可按名称/状态过滤） */
  @Get()
  @RequirePermissions('menu:list')
  flat(
    @Query('name') name?: string,
    @Query('status') status?: CommonStatus,
  ) {
    return this.prisma.menu.findMany({
      where: {
        ...(name ? { name: { contains: name } } : {}),
        ...(status ? { status } : {}),
      },
      orderBy: [{ parentId: 'asc' }, { orderNum: 'asc' }],
    });
  }

  /** 菜单树（角色授权/导航/上级菜单选择用） */
  @Get('tree')
  @RequirePermissions('menu:list')
  async tree(@Query('onlyNormal') onlyNormal?: string) {
    const menus = await this.prisma.menu.findMany({
      where: onlyNormal === '1' ? { status: CommonStatus.NORMAL } : undefined,
      orderBy: { orderNum: 'asc' },
    });

    const map = new Map<string, MenuNode>();
    menus.forEach((m) =>
      map.set(m.id, {
        id: m.id,
        parentId: m.parentId,
        name: m.name,
        type: m.type,
        orderNum: m.orderNum,
        path: m.path,
        component: m.component,
        perms: m.perms,
        icon: m.icon,
        visible: m.visible,
        children: [],
      }),
    );

    const roots: MenuNode[] = [];
    map.forEach((node) => {
      if (node.parentId && map.has(node.parentId)) {
        map.get(node.parentId)!.children.push(node);
      } else {
        roots.push(node);
      }
    });
    return roots;
  }

  @Get(':id')
  @RequirePermissions('menu:list')
  async detail(@Param('id') id: string) {
    const menu = await this.prisma.menu.findUnique({ where: { id } });
    if (!menu) throw new NotFoundException({ code: 'NOT_FOUND', message: '菜单不存在' });
    return menu;
  }

  @Post()
  @RequirePermissions('menu:add')
  create(
    @Body() dto: MenuDto,
    @CurrentOrg() org: OrgContext,
    @CurrentUser() me: { id: string },
    @Req() req: Request,
  ) {
    return this.prisma.withOrg(org.organizationId, async (tx) => {
      if (dto.parentId) {
        const parent = await tx.menu.findUnique({ where: { id: dto.parentId } });
        if (!parent) throw new BadRequestException({ code: 'MENU_PARENT_INVALID', message: '上级菜单不存在' });
      }
      const menu = await tx.menu.create({
        data: {
          parentId: dto.parentId ?? null,
          name: dto.name,
          type: dto.type,
          orderNum: dto.orderNum ?? 0,
          path: dto.path ?? null,
          component: dto.component ?? null,
          query: dto.query ?? null,
          routeName: dto.routeName ?? null,
          isFrame: dto.isFrame ?? false,
          isCache: dto.isCache ?? false,
          visible: dto.visible ?? ShowHide.SHOW,
          status: dto.status ?? CommonStatus.NORMAL,
          perms: dto.perms ?? null,
          icon: dto.icon ?? '#',
        },
      });
      await this.audit.record(tx, {
        organizationId: org.organizationId,
        actorId: me.id,
        title: '菜单管理',
        businessType: BusinessType.INSERT,
        action: 'menu:add',
        resourceType: 'Menu',
        resourceId: menu.id,
        after: { name: menu.name, type: menu.type },
        traceId: req.traceId,
        ip: req.ip,
        requestMethod: 'POST',
      });
      return menu;
    });
  }

  @Patch(':id')
  @RequirePermissions('menu:edit')
  async update(
    @Param('id') id: string,
    @Body() dto: Partial<MenuDto>,
    @CurrentOrg() org: OrgContext,
    @CurrentUser() me: { id: string },
    @Req() req: Request,
  ) {
    return this.prisma.withOrg(org.organizationId, async (tx) => {
      const existing = await tx.menu.findUnique({ where: { id } });
      if (!existing) throw new NotFoundException({ code: 'NOT_FOUND', message: '菜单不存在' });

      const newParentId = dto.parentId === undefined ? existing.parentId : dto.parentId;
      if (newParentId) {
        if (newParentId === id) {
          throw new BadRequestException({ code: 'MENU_PARENT_SELF', message: '上级菜单不能选择自己' });
        }
        // 防环：新上级不能是自己的后代
        const descendants = await this.collectDescendants(tx, id);
        if (descendants.has(newParentId)) {
          throw new BadRequestException({ code: 'MENU_PARENT_LOOP', message: '上级菜单不能选择自己的下级' });
        }
        const parent = await tx.menu.findUnique({ where: { id: newParentId } });
        if (!parent) throw new BadRequestException({ code: 'MENU_PARENT_INVALID', message: '上级菜单不存在' });
      }

      const before = { name: existing.name, type: existing.type, perms: existing.perms, status: existing.status };
      const menu = await tx.menu.update({
        where: { id },
        data: {
          parentId: newParentId,
          name: dto.name,
          type: dto.type,
          orderNum: dto.orderNum,
          path: dto.path,
          component: dto.component,
          query: dto.query,
          routeName: dto.routeName,
          isFrame: dto.isFrame,
          isCache: dto.isCache,
          visible: dto.visible,
          status: dto.status,
          perms: dto.perms,
          icon: dto.icon,
        },
      });
      await this.audit.record(tx, {
        organizationId: org.organizationId,
        actorId: me.id,
        title: '菜单管理',
        businessType: BusinessType.UPDATE,
        action: 'menu:edit',
        resourceType: 'Menu',
        resourceId: id,
        before,
        after: { name: menu.name, type: menu.type, perms: menu.perms, status: menu.status },
        traceId: req.traceId,
        ip: req.ip,
        requestMethod: 'PATCH',
      });
      return menu;
    });
  }

  @Delete(':id')
  @RequirePermissions('menu:remove')
  async remove(
    @Param('id') id: string,
    @CurrentOrg() org: OrgContext,
    @CurrentUser() me: { id: string },
    @Req() req: Request,
  ) {
    return this.prisma.withOrg(org.organizationId, async (tx) => {
      const childCount = await tx.menu.count({ where: { parentId: id } });
      if (childCount > 0) {
        throw new ConflictException({ code: 'MENU_HAS_CHILD', message: '存在子菜单，请先删除子菜单' });
      }
      const refCount = await tx.roleMenu.count({ where: { menuId: id } });
      if (refCount > 0) {
        throw new ConflictException({ code: 'MENU_IN_USE', message: '菜单已分配给角色，请先取消授权' });
      }
      await tx.menu.delete({ where: { id } });
      await this.audit.record(tx, {
        organizationId: org.organizationId,
        actorId: me.id,
        title: '菜单管理',
        businessType: BusinessType.DELETE,
        action: 'menu:remove',
        resourceType: 'Menu',
        resourceId: id,
        traceId: req.traceId,
        ip: req.ip,
        requestMethod: 'DELETE',
      });
      return { deleted: true, id };
    });
  }

  /** 收集某菜单的全部后代 id（防环校验用） */
  private async collectDescendants(tx: any, rootId: string): Promise<Set<string>> {
    const result = new Set<string>();
    let frontier = [rootId];
    while (frontier.length) {
      const children = await tx.menu.findMany({
        where: { parentId: { in: frontier } },
        select: { id: true },
      });
      frontier = children.map((c: { id: string }) => c.id).filter((id: string) => !result.has(id));
      frontier.forEach((id: string) => result.add(id));
    }
    return result;
  }
}
