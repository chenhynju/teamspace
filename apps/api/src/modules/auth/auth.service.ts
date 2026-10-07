import {
  Injectable,
  ConflictException,
  UnauthorizedException,
  ForbiddenException,
  BadRequestException,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { createHash } from 'crypto';
import { nanoid } from 'nanoid';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { OAuthService } from './oauth.service';
import { ProvisioningService } from '../provisioning/provisioning.service';
import { AuditService, BusinessType } from '../audit/audit.service';
import { MailService } from '../mail/mail.service';

type ProviderKey = 'google' | 'github';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly oauth: OAuthService,
    private readonly provisioning: ProvisioningService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
  ) {}

  /** 邮箱注册：创建用户 + 开通组织（克隆角色/根部门/免费套餐），注册人为 OWNER */
  async register(dto: RegisterDto, meta: RequestMeta) {
    const exists = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (exists) {
      throw new ConflictException({ code: 'EMAIL_EXISTS', message: '该邮箱已注册' });
    }

    const passwordHash = await bcrypt.hash(dto.password, 12);
    const orgName = dto.organizationName || `${dto.name} 的组织`;

    const result = await this.prisma.provision(async (tx) => {
      const u = await tx.user.create({
        data: { email: dto.email, passwordHash, name: dto.name },
      });

      // 依赖 DB 唯一约束处理 slug 冲突（RLS 下事务内无法预读其他组织）
      const org = await this.createOrgWithUniqueSlug(tx, orgName);

      // 切换事务的组织上下文，后续租户写入受 RLS WITH CHECK 校验
      await tx.$executeRaw`SELECT set_config('app.current_org_id', ${org.id}, true)`;

      const roleMap = await this.provisioning.cloneTemplateRoles(tx, org.id);
      const dept = await this.provisioning.createRootDept(tx, org.id, org.name, u.id);

      const membership = await tx.membership.create({
        data: { organizationId: org.id, userId: u.id, deptId: dept.id, status: 'ACTIVE' },
      });
      await tx.membershipRole.create({
        data: { membershipId: membership.id, roleId: roleMap.get('OWNER')! },
      });

      await this.provisioning.applyPlan(tx, org.id, 'FREE', 1);

      await this.audit.record(tx, {
        organizationId: org.id,
        actorId: u.id,
        title: '组织注册',
        businessType: BusinessType.INSERT,
        action: 'auth:register',
        resourceType: 'Organization',
        resourceId: org.id,
        after: { organizationName: org.name, owner: u.email },
        traceId: meta.traceId,
        ip: meta.ip,
        requestMethod: 'POST',
      });

      return { u, org };
    });

    await this.audit.loginLog({
      userId: result.u.id,
      username: result.u.email,
      ip: meta.ip,
      status: 0,
      msg: 'register',
    });

    // 是否要求邮箱验证由系统参数 sys.account.emailVerify 控制；
    // 关闭时注册后直接签发 token 登录
    if (!(await this.isEmailVerifyRequired())) {
      await this.prisma.user.update({
        where: { id: result.u.id },
        data: { emailVerifiedAt: new Date() },
      });
      return {
        email: result.u.email,
        requireEmailVerification: false,
        ...(await this.issueToken(result.u)),
      };
    }
    const issued = await this.issueVerification(result.u);
    return {
      email: result.u.email,
      requireEmailVerification: true,
      emailSent: issued.sent,
      emailProvider: issued.provider,
    };
  }

  /** 读取系统参数 sys.account.emailVerify，缺省视为 true（安全默认） */
  private async isEmailVerifyRequired(): Promise<boolean> {
    const cfg = await this.prisma.config.findUnique({
      where: { key: 'sys.account.emailVerify' },
    });
    return cfg ? cfg.value !== 'false' : true;
  }

  /** 验证邮箱：凭邮件中的 token 置位 emailVerifiedAt，验证通过后直接登录 */
  async verifyEmail(rawToken: string) {
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');

    const record = await this.prisma.withEmailVerifyLookup((tx) =>
      tx.emailVerificationToken.findUnique({
        where: { tokenHash },
        include: { user: true },
      }),
    );

    if (!record || record.consumedAt) {
      throw new BadRequestException({
        code: 'TOKEN_INVALID',
        message: '验证链接无效或已使用，请重新获取',
      });
    }
    if (record.expiresAt < new Date()) {
      throw new BadRequestException({
        code: 'TOKEN_EXPIRED',
        message: '验证链接已过期，请重新获取',
      });
    }

    const user = await this.prisma.withUser(record.userId, async (tx) => {
      await tx.emailVerificationToken.update({
        where: { id: record.id },
        data: { consumedAt: new Date() },
      });
      return tx.user.update({
        where: { id: record.userId },
        data: { emailVerifiedAt: new Date() },
      });
    });

    await this.audit.loginLog({
      userId: user.id,
      username: user.email,
      ip: '',
      status: 0,
      msg: 'email verified',
    });
    return this.issueToken(user);
  }

  /** 重发验证邮件（60 秒频率限制；不暴露邮箱是否存在） */
  async resendVerification(email: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || user.emailVerifiedAt) {
      return { ok: true };
    }

    const latest = await this.prisma.withUser(user.id, (tx) =>
      tx.emailVerificationToken.findFirst({
        where: { userId: user.id },
        orderBy: { createdAt: 'desc' },
      }),
    );

    if (latest && Date.now() - latest.createdAt.getTime() < 60_000) {
      throw new HttpException(
        {
          code: 'RESEND_RATE_LIMIT',
          message: '发送过于频繁，请 1 分钟后再试',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const issued = await this.issueVerification(user);
    return { ok: true, emailSent: issued.sent };
  }

  /** 生成验证凭证（sha256 哈希入库，原始值只出现在邮件链接中）并发信 */
  private async issueVerification(user: { id: string; email: string; name: string }) {
    const rawToken = nanoid(32);
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await this.prisma.withUser(user.id, (tx) =>
      tx.emailVerificationToken.create({
        data: { userId: user.id, tokenHash, expiresAt },
      }),
    );

    const webUrl = this.config.get<string>('WEB_URL') ?? 'http://localhost:3000';
    const url = `${webUrl}/verify-email?token=${rawToken}`;

    try {
      const res = await this.mail.sendVerificationEmail(user.email, url, user.name);
      return { sent: true, provider: res.provider };
    } catch (e) {
      this.logger.error(
        `验证邮件发送失败 userId=${user.id}: ${(e as Error).message}`,
      );
      return { sent: false, provider: 'none' as const };
    }
  }

  /**
   * 忘记密码：对注册邮箱发送重置链接（1 小时有效，60 秒频控）。
   * 不暴露邮箱是否注册：未命中统一返回 ok。
   */
  async requestPasswordReset(email: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) {
      return { ok: true };
    }

    const latest = await this.prisma.withUser(user.id, (tx) =>
      tx.passwordResetToken.findFirst({
        where: { userId: user.id },
        orderBy: { createdAt: 'desc' },
      }),
    );

    if (latest && Date.now() - latest.createdAt.getTime() < 60_000) {
      throw new HttpException(
        {
          code: 'RESEND_RATE_LIMIT',
          message: '发送过于频繁，请 1 分钟后再试',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const issued = await this.issuePasswordReset(user);
    return { ok: true, emailSent: issued.sent };
  }

  /** 重置密码：校验链接后写入新密码并直接登录 */
  async resetPassword(rawToken: string, newPassword: string) {
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');

    const record = await this.prisma.withPasswordResetLookup((tx) =>
      tx.passwordResetToken.findUnique({
        where: { tokenHash },
        include: { user: true },
      }),
    );

    if (!record || record.consumedAt) {
      throw new BadRequestException({
        code: 'TOKEN_INVALID',
        message: '重置链接无效或已使用，请重新获取',
      });
    }
    if (record.expiresAt < new Date()) {
      throw new BadRequestException({
        code: 'TOKEN_EXPIRED',
        message: '重置链接已过期，请重新获取',
      });
    }
    if (record.user.status === 'DISABLED') {
      throw new ForbiddenException({
        code: 'ACCOUNT_DISABLED',
        message: '账号已停用，无法重置密码',
      });
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);
    const user = await this.prisma.withUser(record.userId, async (tx) => {
      await tx.passwordResetToken.update({
        where: { id: record.id },
        data: { consumedAt: new Date() },
      });
      return tx.user.update({
        where: { id: record.userId },
        data: { passwordHash },
      });
    });

    await this.audit.loginLog({
      userId: user.id,
      username: user.email,
      ip: '',
      status: 0,
      msg: 'password reset',
    });
    return this.issueToken(user);
  }

  /** 生成密码重置凭证（sha256 哈希入库）并发信 */
  private async issuePasswordReset(user: { id: string; email: string; name: string }) {
    const rawToken = nanoid(32);
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

    await this.prisma.withUser(user.id, (tx) =>
      tx.passwordResetToken.create({
        data: { userId: user.id, tokenHash, expiresAt },
      }),
    );

    const webUrl = this.config.get<string>('WEB_URL') ?? 'http://localhost:3000';
    const url = `${webUrl}/reset-password?token=${rawToken}`;

    try {
      const res = await this.mail.sendPasswordResetEmail(user.email, url, user.name);
      return { sent: true, provider: res.provider };
    } catch (e) {
      this.logger.error(
        `重置邮件发送失败 userId=${user.id}: ${(e as Error).message}`,
      );
      return { sent: false, provider: 'none' as const };
    }
  }

  /** 邮箱 + 密码登录 */
  async login(dto: LoginDto, meta: RequestMeta) {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (!user || !user.passwordHash) {
      await this.audit.loginLog({
        username: dto.email,
        ip: meta.ip,
        status: 1,
        msg: 'invalid credentials',
      });
      throw new UnauthorizedException({
        code: 'INVALID_CREDENTIALS',
        message: '邮箱或密码错误',
      });
    }
    const ok = await bcrypt.compare(dto.password, user.passwordHash);
    if (!ok) {
      await this.audit.loginLog({
        userId: user.id,
        username: dto.email,
        ip: meta.ip,
        status: 1,
        msg: 'bad password',
      });
      throw new UnauthorizedException({
        code: 'INVALID_CREDENTIALS',
        message: '邮箱或密码错误',
      });
    }
    if (user.status === 'DISABLED') {
      throw new UnauthorizedException({ code: 'ACCOUNT_DISABLED', message: '账号已停用' });
    }
    if (!user.emailVerifiedAt && (await this.isEmailVerifyRequired())) {
      throw new ForbiddenException({
        code: 'EMAIL_NOT_VERIFIED',
        message: '邮箱尚未验证，请先查收验证邮件完成验证',
      });
    }

    await this.audit.loginLog({
      userId: user.id,
      username: user.email,
      ip: meta.ip,
      status: 0,
      msg: 'login',
    });
    return this.issueToken(user);
  }

  /** 发起 OAuth：返回授权 URL（state 存 Redis，5 分钟一次性消费） */
  async getOAuthUrl(provider: ProviderKey) {
    const url = await this.oauth.getAuthorizeUrl(provider);
    return { url };
  }

  getEnabledOAuthProviders() {
    return { google: this.oauth.isEnabled('google'), github: this.oauth.isEnabled('github') };
  }

  /** OAuth 回调：code 换资料，查找/创建用户；新用户开通个人组织 */
  async handleOAuthCallback(provider: ProviderKey, code: string, state: string) {
    const profile = await this.oauth.exchangeCode(provider, code, state);
    const providerEnum = provider === 'google' ? 'GOOGLE' : 'GITHUB';

    const user = await this.prisma.provision(async (tx) => {
      const existing = await tx.userOAuth.findUnique({
        where: { provider_providerUserId: { provider: providerEnum, providerUserId: profile.id } },
        include: { user: true },
      });
      if (existing) {
        await tx.userOAuth.update({
          where: { id: existing.id },
          data: { accessToken: profile.accessToken, refreshToken: profile.refreshToken },
        });
        return existing.user;
      }

      let u = profile.email
        ? await tx.user.findUnique({ where: { email: profile.email } })
        : null;

      if (!u) {
        u = await tx.user.create({
          data: {
            email: profile.email || `${profile.id}@${provider}.oauth`,
            passwordHash: null,
            name: profile.name || profile.email || 'OAuth User',
            avatarUrl: profile.avatarUrl,
            emailVerifiedAt: new Date(),
          },
        });

        const orgName = `${u.name} 的组织`;
        const org = await this.createOrgWithUniqueSlug(tx, orgName);
        await tx.$executeRaw`SELECT set_config('app.current_org_id', ${org.id}, true)`;
        const roleMap = await this.provisioning.cloneTemplateRoles(tx, org.id);
        const dept = await this.provisioning.createRootDept(tx, org.id, orgName, u.id);
        const membership = await tx.membership.create({
          data: { organizationId: org.id, userId: u.id, deptId: dept.id, status: 'ACTIVE' },
        });
        await tx.membershipRole.create({
          data: { membershipId: membership.id, roleId: roleMap.get('OWNER')! },
        });
        await this.provisioning.applyPlan(tx, org.id, 'FREE', 1);
      }

      await tx.userOAuth.create({
        data: {
          userId: u.id,
          provider: providerEnum,
          providerUserId: profile.id,
          accessToken: profile.accessToken,
          refreshToken: profile.refreshToken,
        },
      });
      return u;
    });

    return this.issueToken(user);
  }

  private issueToken(user: { id: string; email: string; name: string }) {
    const payload = { sub: user.id, email: user.email, name: user.name };
    const accessToken = this.jwt.sign(payload, {
      secret: this.config.get('JWT_SECRET'),
      expiresIn: this.config.get('JWT_ACCESS_EXPIRES_IN', '7d'),
    });
    return {
      accessToken,
      tokenType: 'Bearer',
      user: { id: user.id, email: user.email, name: user.name },
    };
  }

  private slugify(s: string): string {
    return (
      s
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '')
        .slice(0, 40) || 'org'
    );
  }

  /** 在事务内创建组织。注意：Postgres 事务中唯一约束冲突会中止整个事务（25P02），
   * 因此不能用 try/catch 重试，必须先 SELECT 挑选空闲 slug 再插入。 */
  private async createOrgWithUniqueSlug(tx: Prisma.TransactionClient, name: string) {
    const base = this.slugify(name);
    const existing = await tx.organization.findMany({
      where: { slug: { startsWith: base } },
      select: { slug: true },
    });
    const taken = new Set(existing.map((o) => o.slug));
    let slug = base;
    for (let i = 1; i <= 50 && taken.has(slug); i++) {
      slug = `${base}-${i}`;
    }
    if (taken.has(slug)) {
      throw new ConflictException({ code: 'SLUG_EXHAUSTED', message: '无法生成唯一组织标识' });
    }
    return tx.organization.create({ data: { name, slug } });
  }
}

export interface RequestMeta {
  traceId: string;
  ip: string;
}
