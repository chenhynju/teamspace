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
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { Request } from 'express';
import {
  IsString,
  MinLength,
  MaxLength,
  IsOptional,
  IsEnum,
  Matches,
} from 'class-validator';
import { YesNo } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { OrgContextGuard } from '../../common/guards/org-context.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CurrentOrg, OrgContext } from '../../common/decorators/current-org.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuditService, BusinessType } from '../audit/audit.service';

class ConfigDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name: string;

  @IsString()
  @MinLength(2)
  @MaxLength(100)
  @Matches(/^[a-zA-Z][a-zA-Z0-9_.]*$/, { message: '参数键须以字母开头，仅含字母数字下划线点' })
  key: string;

  @IsString()
  @MaxLength(1000)
  value: string;

  @IsOptional()
  @IsEnum(YesNo)
  configType?: YesNo;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  remark?: string;
}

/**
 * 参数管理（平台全局表）：运营可调的系统配置，避免硬编码。
 * configType=Y 为系统内置（仍可修改值，删除需谨慎——这里允许删除，由权限把关）。
 */
@Controller('configs')
@UseGuards(OrgContextGuard, PermissionsGuard)
export class ConfigController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @RequirePermissions('config:list')
  list(
    @Query('name') name?: string,
    @Query('key') key?: string,
  ) {
    return this.prisma.config.findMany({
      where: {
        ...(name ? { name: { contains: name } } : {}),
        ...(key ? { key: { contains: key } } : {}),
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  @Get(':id')
  @RequirePermissions('config:list')
  async detail(@Param('id') id: string) {
    const config = await this.prisma.config.findUnique({ where: { id } });
    if (!config) throw new NotFoundException({ code: 'NOT_FOUND', message: '参数不存在' });
    return config;
  }

  @Post()
  @RequirePermissions('config:add')
  create(
    @Body() dto: ConfigDto,
    @CurrentOrg() org: OrgContext,
    @CurrentUser() me: { id: string },
    @Req() req: Request,
  ) {
    return this.prisma.withOrg(org.organizationId, async (tx) => {
      const config = await tx.config.create({
        data: {
          name: dto.name,
          key: dto.key,
          value: dto.value,
          configType: dto.configType ?? YesNo.NO,
          remark: dto.remark ?? null,
        },
      });
      await this.audit.record(tx, {
        organizationId: org.organizationId,
        actorId: me.id,
        title: '参数管理',
        businessType: BusinessType.INSERT,
        action: 'config:add',
        resourceType: 'Config',
        resourceId: config.id,
        after: { key: config.key, value: config.value },
        traceId: req.traceId,
        ip: req.ip,
        requestMethod: 'POST',
      });
      return config;
    });
  }

  @Patch(':id')
  @RequirePermissions('config:edit')
  update(
    @Param('id') id: string,
    @Body() dto: Partial<ConfigDto>,
    @CurrentOrg() org: OrgContext,
    @CurrentUser() me: { id: string },
    @Req() req: Request,
  ) {
    return this.prisma.withOrg(org.organizationId, async (tx) => {
      const existing = await tx.config.findUnique({ where: { id } });
      if (!existing) throw new NotFoundException({ code: 'NOT_FOUND', message: '参数不存在' });

      const config = await tx.config.update({
        where: { id },
        data: { name: dto.name, value: dto.value, remark: dto.remark },
      });
      await this.audit.record(tx, {
        organizationId: org.organizationId,
        actorId: me.id,
        title: '参数管理',
        businessType: BusinessType.UPDATE,
        action: 'config:edit',
        resourceType: 'Config',
        resourceId: id,
        before: { value: existing.value },
        after: { value: config.value },
        traceId: req.traceId,
        ip: req.ip,
        requestMethod: 'PATCH',
      });
      return config;
    });
  }

  @Delete(':id')
  @RequirePermissions('config:remove')
  remove(
    @Param('id') id: string,
    @CurrentOrg() org: OrgContext,
    @CurrentUser() me: { id: string },
    @Req() req: Request,
  ) {
    return this.prisma.withOrg(org.organizationId, async (tx) => {
      const existing = await tx.config.findUnique({ where: { id } });
      if (!existing) throw new NotFoundException({ code: 'NOT_FOUND', message: '参数不存在' });
      if (existing.configType === YesNo.YES) {
        throw new ConflictException({ code: 'CONFIG_BUILTIN', message: '系统内置参数不允许删除' });
      }
      await tx.config.delete({ where: { id } });
      await this.audit.record(tx, {
        organizationId: org.organizationId,
        actorId: me.id,
        title: '参数管理',
        businessType: BusinessType.DELETE,
        action: 'config:remove',
        resourceType: 'Config',
        resourceId: id,
        traceId: req.traceId,
        ip: req.ip,
        requestMethod: 'DELETE',
      });
      return { deleted: true, id };
    });
  }
}
