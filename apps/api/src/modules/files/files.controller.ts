import { ResourceAccessGuard } from '../groups/resource-access.guard';
import { ResourcePolicyService } from '../groups/resource-policy.service';
import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  Req,
  Res,
  BadRequestException,
  NotFoundException,
  GoneException,
  UnauthorizedException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { createReadStream, mkdirSync, writeFileSync } from 'fs';
import * as path from 'path';
import { nanoid } from 'nanoid';
import { PrismaService } from '../../prisma/prisma.service';
import { OrgContextGuard } from '../../common/guards/org-context.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CurrentOrg, OrgContext } from '../../common/decorators/current-org.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { AuditService, BusinessType } from '../audit/audit.service';
import { IsOptional, IsString, IsInt, Min, Max } from 'class-validator';

const UPLOAD_ROOT = path.resolve(process.env.UPLOAD_ROOT || path.join(process.cwd(), '.uploads'));
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

class ShareDto {
  @IsOptional()
  @IsString()
  sharedWithUserId?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(30)
  ttlDays?: number;
}

@Controller('files')
export class FilesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly resourcePolicy: ResourcePolicyService,
  ) {}

  /** 文件列表（可按项目过滤） */
  @Get()
  @UseGuards(OrgContextGuard, PermissionsGuard, ResourceAccessGuard)
  @RequirePermissions('file:manage')
  async list(@CurrentOrg() org: OrgContext, @Req() accessReq: Request, @Query('projectId') projectId?: string) {
    const rows = await this.prisma.withOrg(org.organizationId, (tx) =>
      tx.file.findMany({
        where: {
          organizationId: org.organizationId,
          projectId: { in: accessReq.accessibleProjectIds ?? [] },
          ...(projectId ? { projectId } : {}),
        },
        include: {
          uploadedBy: { select: { id: true, name: true } },
          project: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
    );
    // size 为 BigInt，JSON 无法直接序列化
    return rows.map(({ size, ...f }) => ({ ...f, size: size.toString() }));
  }

  /** 上传文件（multipart，字段名 file；同名文件自动升版本） */
  @Post('upload')
  @UseGuards(OrgContextGuard, PermissionsGuard, ResourceAccessGuard)
  @RequirePermissions('file:manage')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES } }),
  )
  upload(
    @UploadedFile() file: Express.Multer.File,
    @Body('projectId') projectId: string,
    @CurrentOrg() org: OrgContext,
    @CurrentUser() me: { id: string },
    @Req() req: Request,
  ) {
    if (!file) throw new BadRequestException({ code: 'FILE_REQUIRED', message: '缺少上传文件' });
    if (!projectId) {
      throw new BadRequestException({ code: 'PROJECT_REQUIRED', message: '缺少 projectId' });
    }

    return this.prisma.withOrg(org.organizationId, async (tx) => {
      await this.resourcePolicy.assert(tx, org.organizationId, me.id, projectId, 'WRITE');
      const project = await tx.project.findFirst({
        where: { id: projectId, organizationId: org.organizationId },
      });
      if (!project) throw new BadRequestException({ code: 'PROJECT_INVALID', message: '项目不存在' });

      // 版本：同名取最新 +1
      const latest = await tx.file.findFirst({
        where: { projectId, name: file.originalname },
        orderBy: { version: 'desc' },
      });
      const version = latest ? latest.version + 1 : 1;

      // 磁盘对象键（随机名，杜绝路径穿越）
      const objectKey = `${org.organizationId}/${projectId}/${nanoid(16)}`;
      const absPath = path.join(UPLOAD_ROOT, objectKey);
      mkdirSync(path.dirname(absPath), { recursive: true });
      writeFileSync(absPath, file.buffer);

      const saved = await tx.file.create({
        data: {
          organizationId: org.organizationId,
          projectId,
          name: file.originalname,
          objectKey,
          size: BigInt(file.size),
          mimeType: file.mimetype || 'application/octet-stream',
          version,
          uploadedById: me.id,
        },
      });

      await this.audit.record(tx, {
        organizationId: org.organizationId,
        actorId: me.id,
        title: '文件管理',
        businessType: BusinessType.INSERT,
        action: 'file:upload',
        resourceType: 'File',
        resourceId: saved.id,
        after: { name: saved.name, version: saved.version, size: saved.size.toString() },
        traceId: req.traceId,
        ip: req.ip,
        requestMethod: 'POST',
      });

      return {
        id: saved.id,
        name: saved.name,
        version: saved.version,
        size: saved.size.toString(),
        mimeType: saved.mimeType,
      };
    });
  }

  /** 组织成员下载（必须是该组织成员） */
  @Get(':id/download')
  @UseGuards(OrgContextGuard, PermissionsGuard, ResourceAccessGuard)
  @RequirePermissions('file:manage')
  download(
    @Param('id') id: string,
    @CurrentOrg() org: OrgContext,
    @Res() res: Response,
  ) {
    return this.prisma.withOrg(org.organizationId, async (tx) => {
      const file = await tx.file.findFirst({
        where: { id, organizationId: org.organizationId },
      });
      if (!file) throw new NotFoundException({ code: 'NOT_FOUND', message: '文件不存在' });
      this.streamFile(res, file);
    });
  }

  /** 创建共享链接（可指定访问用户与有效期） */
  @Post(':id/share')
  @UseGuards(OrgContextGuard, PermissionsGuard, ResourceAccessGuard)
  @RequirePermissions('file:share')
  share(
    @Param('id') id: string,
    @Body() dto: ShareDto,
    @CurrentOrg() org: OrgContext,
    @CurrentUser() me: { id: string },
    @Req() req: Request,
  ) {
    return this.prisma.withOrg(org.organizationId, async (tx) => {
      const file = await tx.file.findFirst({
        where: { id, organizationId: org.organizationId },
      });
      if (!file) throw new NotFoundException({ code: 'NOT_FOUND', message: '文件不存在' });

      const expiresAt = dto.ttlDays
        ? new Date(Date.now() + dto.ttlDays * 24 * 60 * 60 * 1000)
        : null;

      const share = await tx.fileShare.create({
        data: {
          organizationId: org.organizationId,
          fileId: file.id,
          sharedWithUserId: dto.sharedWithUserId ?? null,
          expiresAt,
        },
      });

      await this.audit.record(tx, {
        organizationId: org.organizationId,
        actorId: me.id,
        title: '文件管理',
        businessType: BusinessType.INSERT,
        action: 'file:share',
        resourceType: 'FileShare',
        resourceId: share.id,
        after: { fileId: file.id, sharedWithUserId: share.sharedWithUserId },
        traceId: req.traceId,
        ip: req.ip,
        requestMethod: 'POST',
      });

      const webUrl = process.env.WEB_URL || 'http://localhost:3000';
      return {
        shareId: share.id,
        url: `${webUrl}/files/shared/${share.id}`,
        expiresAt: share.expiresAt,
      };
    });
  }

  /**
   * 访客凭共享 ID 下载（公开）。
   * 猜测内部 file id 无法命中此端点；内部 /files/:id/download 又要求成员身份，
   * 因此非成员无法越权读取。
   */
  @Public()
  @Get('shared/:shareId/download')
  async sharedDownload(
    @Param('shareId') shareId: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    // 先凭凭证定位共享
    const located = await this.prisma.withShareLookup((tx) =>
      tx.fileShare.findUnique({ where: { id: shareId } }),
    );
    if (!located) throw new NotFoundException({ code: 'SHARE_NOT_FOUND', message: '共享链接无效' });

    return this.prisma.withOrg(located.organizationId, async (tx) => {
      const share = await tx.fileShare.findUnique({ where: { id: shareId } });
      if (!share) throw new NotFoundException({ code: 'SHARE_NOT_FOUND', message: '共享链接无效' });

      if (share.expiresAt && share.expiresAt.getTime() < Date.now()) {
        throw new GoneException({ code: 'SHARE_EXPIRED', message: '共享链接已过期' });
      }
      if (share.sharedWithUserId) {
        const currentUserId = (req.user as { id?: string } | undefined)?.id;
        if (!currentUserId) {
          throw new UnauthorizedException({ code: 'LOGIN_REQUIRED', message: '该共享需登录指定账号' });
        }
        if (currentUserId !== share.sharedWithUserId) {
          throw new UnauthorizedException({ code: 'SHARE_USER_MISMATCH', message: '该共享不对当前账号开放' });
        }
      }

      const file = await tx.file.findUnique({ where: { id: share.fileId } });
      if (!file) throw new NotFoundException({ code: 'NOT_FOUND', message: '文件不存在' });
      this.streamFile(res, file);
    });
  }

  private streamFile(res: Response, file: { objectKey: string; name: string; mimeType: string; size: bigint }) {
    const absPath = path.join(UPLOAD_ROOT, file.objectKey);
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Content-Length', file.size.toString());
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(file.name)}"`,
    );
    const stream = createReadStream(absPath);
    stream.pipe(res);
  }
}
