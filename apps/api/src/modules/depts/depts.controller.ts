import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  Req,
  ConflictException,
} from '@nestjs/common';
import type { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { OrgContextGuard } from '../../common/guards/org-context.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CurrentOrg, OrgContext } from '../../common/decorators/current-org.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuditService, BusinessType } from '../audit/audit.service';
import {
  IsString,
  MinLength,
  MaxLength,
  IsOptional,
  IsInt,
  Min,
} from 'class-validator';

class DeptDto {
  @IsString()
  @MinLength(1)
  @MaxLength(32)
  name: string;

  @IsOptional()
  @IsString()
  parentId?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  orderNum?: number;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  email?: string;
}

class PostDto {
  @IsString()
  @MinLength(1)
  @MaxLength(32)
  name: string;

  @IsString()
  @MinLength(2)
  @MaxLength(32)
  code: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  sort?: number;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  remark?: string;
}

@Controller()
@UseGuards(OrgContextGuard, PermissionsGuard)
export class DeptsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ---------- 部门 ----------

  @Get('depts/tree')
  @RequirePermissions('member:list', 'dept:manage')
  tree(@CurrentOrg() org: OrgContext) {
    return this.prisma.withOrg(org.organizationId, async (tx) => {
      const depts = await tx.dept.findMany({
        where: { organizationId: org.organizationId },
        orderBy: { orderNum: 'asc' },
      });
      const map = new Map<string, any>();
      depts.forEach((d) => map.set(d.id, { ...d, children: [] }));
      const roots: any[] = [];
      map.forEach((node) => {
        if (node.parentId && map.has(node.parentId)) map.get(node.parentId).children.push(node);
        else roots.push(node);
      });
      return roots;
    });
  }

  @Post('depts')
  @RequirePermissions('dept:manage')
  createDept(
    @Body() dto: DeptDto,
    @CurrentOrg() org: OrgContext,
    @CurrentUser() me: { id: string },
    @Req() req: Request,
  ) {
    return this.prisma.withOrg(org.organizationId, async (tx) => {
      let ancestors = '';
      if (dto.parentId) {
        const parent = await tx.dept.findFirst({
          where: { id: dto.parentId, organizationId: org.organizationId },
        });
        if (!parent) throw new ConflictException({ code: 'DEPT_PARENT_INVALID', message: '上级部门不存在' });
        ancestors = parent.ancestors === '' ? `,${parent.id},` : `${parent.ancestors}${parent.id},`;
      }
      const dept = await tx.dept.create({
        data: {
          organizationId: org.organizationId,
          name: dto.name,
          parentId: dto.parentId ?? null,
          ancestors,
          orderNum: dto.orderNum ?? 0,
          phone: dto.phone,
          email: dto.email,
          status: 'NORMAL',
        },
      });
      await this.audit.record(tx, {
        organizationId: org.organizationId,
        actorId: me.id,
        title: '部门管理',
        businessType: BusinessType.INSERT,
        action: 'dept:add',
        resourceType: 'Dept',
        resourceId: dept.id,
        after: { name: dept.name },
        traceId: req.traceId,
        ip: req.ip,
        requestMethod: 'POST',
      });
      return dept;
    });
  }

  @Patch('depts/:id')
  @RequirePermissions('dept:manage')
  updateDept(
    @Param('id') id: string,
    @Body() dto: Partial<DeptDto>,
    @CurrentOrg() org: OrgContext,
  ) {
    return this.prisma.withOrg(org.organizationId, (tx) =>
      tx.dept.update({
        where: { id },
        data: {
          name: dto.name,
          orderNum: dto.orderNum,
          phone: dto.phone,
          email: dto.email,
        },
      }),
    );
  }

  @Delete('depts/:id')
  @RequirePermissions('dept:manage')
  removeDept(
    @Param('id') id: string,
    @CurrentOrg() org: OrgContext,
    @CurrentUser() me: { id: string },
    @Req() req: Request,
  ) {
    return this.prisma.withOrg(org.organizationId, async (tx) => {
      const childCount = await tx.dept.count({ where: { parentId: id } });
      if (childCount > 0) {
        throw new ConflictException({ code: 'DEPT_HAS_CHILD', message: '存在下级部门，请先处理' });
      }
      const memberCount = await tx.membership.count({ where: { deptId: id } });
      if (memberCount > 0) {
        throw new ConflictException({ code: 'DEPT_HAS_MEMBER', message: '部门下仍有成员，请先调动' });
      }
      await tx.dept.delete({ where: { id } });
      await this.audit.record(tx, {
        organizationId: org.organizationId,
        actorId: me.id,
        title: '部门管理',
        businessType: BusinessType.DELETE,
        action: 'dept:remove',
        resourceType: 'Dept',
        resourceId: id,
        traceId: req.traceId,
        ip: req.ip,
        requestMethod: 'DELETE',
      });
      return { deleted: true, id };
    });
  }

  // ---------- 岗位 ----------

  @Get('posts')
  @RequirePermissions('member:list', 'post:manage')
  listPosts(@CurrentOrg() org: OrgContext) {
    return this.prisma.withOrg(org.organizationId, (tx) =>
      tx.post.findMany({
        where: { organizationId: org.organizationId },
        orderBy: { sort: 'asc' },
      }),
    );
  }

  @Post('posts')
  @RequirePermissions('post:manage')
  createPost(
    @Body() dto: PostDto,
    @CurrentOrg() org: OrgContext,
    @CurrentUser() me: { id: string },
    @Req() req: Request,
  ) {
    return this.prisma.withOrg(org.organizationId, async (tx) => {
      const post = await tx.post.create({
        data: {
          organizationId: org.organizationId,
          name: dto.name,
          code: dto.code.toUpperCase(),
          sort: dto.sort ?? 0,
          remark: dto.remark,
          status: 'NORMAL',
        },
      });
      await this.audit.record(tx, {
        organizationId: org.organizationId,
        actorId: me.id,
        title: '岗位管理',
        businessType: BusinessType.INSERT,
        action: 'post:add',
        resourceType: 'Post',
        resourceId: post.id,
        after: { name: post.name, code: post.code },
        traceId: req.traceId,
        ip: req.ip,
        requestMethod: 'POST',
      });
      return post;
    });
  }

  @Patch('posts/:id')
  @RequirePermissions('post:manage')
  updatePost(@Param('id') id: string, @Body() dto: Partial<PostDto>, @CurrentOrg() org: OrgContext) {
    return this.prisma.withOrg(org.organizationId, (tx) =>
      tx.post.update({
        where: { id },
        data: { name: dto.name, sort: dto.sort, remark: dto.remark },
      }),
    );
  }

  @Delete('posts/:id')
  @RequirePermissions('post:manage')
  removePost(
    @Param('id') id: string,
    @CurrentOrg() org: OrgContext,
    @CurrentUser() me: { id: string },
    @Req() req: Request,
  ) {
    return this.prisma.withOrg(org.organizationId, async (tx) => {
      await tx.membershipPost.deleteMany({ where: { postId: id } });
      await tx.post.delete({ where: { id } });
      await this.audit.record(tx, {
        organizationId: org.organizationId,
        actorId: me.id,
        title: '岗位管理',
        businessType: BusinessType.DELETE,
        action: 'post:remove',
        resourceType: 'Post',
        resourceId: id,
        traceId: req.traceId,
        ip: req.ip,
        requestMethod: 'DELETE',
      });
      return { deleted: true, id };
    });
  }
}
