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
  IsEnum,
  Matches,
} from 'class-validator';
import { CommonStatus, YesNo } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { OrgContextGuard } from '../../common/guards/org-context.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CurrentOrg, OrgContext } from '../../common/decorators/current-org.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuditService, BusinessType } from '../audit/audit.service';

class DictTypeDto {
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  name: string;

  @IsString()
  @MinLength(2)
  @MaxLength(50)
  @Matches(/^[a-zA-Z][a-zA-Z0-9_]*$/, { message: '字典编码须以字母开头，仅含字母数字下划线' })
  type: string;

  @IsOptional()
  @IsEnum(CommonStatus)
  status?: CommonStatus;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  remark?: string;
}

class DictDataDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  label: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  value: string;

  @IsString()
  @Matches(/^[a-zA-Z][a-zA-Z0-9_]*$/, { message: '字典编码格式不正确' })
  dictType: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  sort?: number;

  @IsOptional()
  @IsEnum(YesNo)
  isDefault?: YesNo;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  listClass?: string | null;

  @IsOptional()
  @IsEnum(CommonStatus)
  status?: CommonStatus;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  remark?: string;
}

/**
 * 字典管理（平台全局表）。
 * 字典=固定枚举数据的运营化维护（如状态、类型、等级），业务页面按 type 拉选项。
 */
@Controller()
@UseGuards(OrgContextGuard, PermissionsGuard)
export class DictController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /* ---------- 字典类型 ---------- */

  @Get('dict-types')
  @RequirePermissions('dict:list')
  listTypes(
    @Query('name') name?: string,
    @Query('type') type?: string,
    @Query('status') status?: CommonStatus,
  ) {
    return this.prisma.dictType.findMany({
      where: {
        ...(name ? { name: { contains: name } } : {}),
        ...(type ? { type: { contains: type } } : {}),
        ...(status ? { status } : {}),
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  @Post('dict-types')
  @RequirePermissions('dict:add')
  createType(
    @Body() dto: DictTypeDto,
    @CurrentOrg() org: OrgContext,
    @CurrentUser() me: { id: string },
    @Req() req: Request,
  ) {
    return this.prisma.withOrg(org.organizationId, async (tx) => {
      const type = await tx.dictType.create({
        data: {
          name: dto.name,
          type: dto.type,
          status: dto.status ?? CommonStatus.NORMAL,
          remark: dto.remark ?? null,
        },
      });
      await this.audit.record(tx, {
        organizationId: org.organizationId,
        actorId: me.id,
        title: '字典管理',
        businessType: BusinessType.INSERT,
        action: 'dict:add',
        resourceType: 'DictType',
        resourceId: type.id,
        after: { name: type.name, type: type.type },
        traceId: req.traceId,
        ip: req.ip,
        requestMethod: 'POST',
      });
      return type;
    });
  }

  @Patch('dict-types/:id')
  @RequirePermissions('dict:edit')
  updateType(
    @Param('id') id: string,
    @Body() dto: Partial<DictTypeDto>,
    @CurrentOrg() org: OrgContext,
    @CurrentUser() me: { id: string },
    @Req() req: Request,
  ) {
    return this.prisma.withOrg(org.organizationId, async (tx) => {
      const existing = await tx.dictType.findUnique({ where: { id } });
      if (!existing) throw new NotFoundException({ code: 'NOT_FOUND', message: '字典类型不存在' });

      const type = await tx.dictType.update({
        where: { id },
        data: { name: dto.name, status: dto.status, remark: dto.remark },
      });
      await this.audit.record(tx, {
        organizationId: org.organizationId,
        actorId: me.id,
        title: '字典管理',
        businessType: BusinessType.UPDATE,
        action: 'dict:edit',
        resourceType: 'DictType',
        resourceId: id,
        before: { name: existing.name, status: existing.status },
        after: { name: type.name, status: type.status },
        traceId: req.traceId,
        ip: req.ip,
        requestMethod: 'PATCH',
      });
      return type;
    });
  }

  @Delete('dict-types/:id')
  @RequirePermissions('dict:remove')
  removeType(
    @Param('id') id: string,
    @CurrentOrg() org: OrgContext,
    @CurrentUser() me: { id: string },
    @Req() req: Request,
  ) {
    return this.prisma.withOrg(org.organizationId, async (tx) => {
      const existing = await tx.dictType.findUnique({ where: { id } });
      if (!existing) throw new NotFoundException({ code: 'NOT_FOUND', message: '字典类型不存在' });
      const dataCount = await tx.dictData.count({ where: { dictType: existing.type } });
      if (dataCount > 0) {
        throw new ConflictException({ code: 'DICT_HAS_DATA', message: '字典下仍有数据，请先删除字典数据' });
      }
      await tx.dictType.delete({ where: { id } });
      await this.audit.record(tx, {
        organizationId: org.organizationId,
        actorId: me.id,
        title: '字典管理',
        businessType: BusinessType.DELETE,
        action: 'dict:remove',
        resourceType: 'DictType',
        resourceId: id,
        traceId: req.traceId,
        ip: req.ip,
        requestMethod: 'DELETE',
      });
      return { deleted: true, id };
    });
  }

  /* ---------- 字典数据 ---------- */

  /** 按字典编码拉数据（业务表单选项也走这里） */
  @Get('dict-data')
  @RequirePermissions('dict:list')
  listData(
    @Query('dictType') dictType: string,
    @Query('status') status?: CommonStatus,
  ) {
    if (!dictType) throw new BadRequestException({ code: 'DICT_TYPE_REQUIRED', message: '缺少 dictType 参数' });
    return this.prisma.dictData.findMany({
      where: { dictType, ...(status ? { status } : {}) },
      orderBy: [{ sort: 'asc' }, { createdAt: 'asc' }],
    });
  }

  @Post('dict-data')
  @RequirePermissions('dict:add')
  createData(
    @Body() dto: DictDataDto,
    @CurrentOrg() org: OrgContext,
    @CurrentUser() me: { id: string },
    @Req() req: Request,
  ) {
    return this.prisma.withOrg(org.organizationId, async (tx) => {
      const typeExists = await tx.dictType.findUnique({ where: { type: dto.dictType } });
      if (!typeExists) throw new BadRequestException({ code: 'DICT_TYPE_NOT_FOUND', message: '字典类型不存在' });

      const data = await tx.dictData.create({
        data: {
          dictType: dto.dictType,
          label: dto.label,
          value: dto.value,
          sort: dto.sort ?? 0,
          isDefault: dto.isDefault ?? YesNo.NO,
          listClass: dto.listClass ?? null,
          status: dto.status ?? CommonStatus.NORMAL,
          remark: dto.remark ?? null,
        },
      });
      await this.audit.record(tx, {
        organizationId: org.organizationId,
        actorId: me.id,
        title: '字典管理',
        businessType: BusinessType.INSERT,
        action: 'dict:data:add',
        resourceType: 'DictData',
        resourceId: data.id,
        after: { label: data.label, value: data.value },
        traceId: req.traceId,
        ip: req.ip,
        requestMethod: 'POST',
      });
      return data;
    });
  }

  @Patch('dict-data/:id')
  @RequirePermissions('dict:edit')
  updateData(
    @Param('id') id: string,
    @Body() dto: Partial<DictDataDto>,
    @CurrentOrg() org: OrgContext,
    @CurrentUser() me: { id: string },
    @Req() req: Request,
  ) {
    return this.prisma.withOrg(org.organizationId, async (tx) => {
      const existing = await tx.dictData.findUnique({ where: { id } });
      if (!existing) throw new NotFoundException({ code: 'NOT_FOUND', message: '字典数据不存在' });

      const data = await tx.dictData.update({
        where: { id },
        data: {
          label: dto.label,
          value: dto.value,
          sort: dto.sort,
          isDefault: dto.isDefault,
          listClass: dto.listClass,
          status: dto.status,
          remark: dto.remark,
        },
      });
      await this.audit.record(tx, {
        organizationId: org.organizationId,
        actorId: me.id,
        title: '字典管理',
        businessType: BusinessType.UPDATE,
        action: 'dict:data:edit',
        resourceType: 'DictData',
        resourceId: id,
        before: { label: existing.label, value: existing.value },
        after: { label: data.label, value: data.value },
        traceId: req.traceId,
        ip: req.ip,
        requestMethod: 'PATCH',
      });
      return data;
    });
  }

  @Delete('dict-data/:id')
  @RequirePermissions('dict:remove')
  removeData(
    @Param('id') id: string,
    @CurrentOrg() org: OrgContext,
    @CurrentUser() me: { id: string },
    @Req() req: Request,
  ) {
    return this.prisma.withOrg(org.organizationId, async (tx) => {
      await tx.dictData.delete({ where: { id } });
      await this.audit.record(tx, {
        organizationId: org.organizationId,
        actorId: me.id,
        title: '字典管理',
        businessType: BusinessType.DELETE,
        action: 'dict:data:remove',
        resourceType: 'DictData',
        resourceId: id,
        traceId: req.traceId,
        ip: req.ip,
        requestMethod: 'DELETE',
      });
      return { deleted: true, id };
    });
  }
}
