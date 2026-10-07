import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

// 事务内可用的 Prisma 客户端（单连接，保证 SET LOCAL 生效）
export type TxClient = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit() {
    await this.$connect();
    this.logger.log('Prisma connected');
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  /**
   * 组织数据上下文：事务内 SET LOCAL app.current_org_id。
   * 该事务内所有租户表都受 PostgreSQL RLS 约束，只能访问当前组织数据。
   * 应用层查询仍显式带 organization_id（来自服务端反查的 orgContext），RLS 为防御层。
   */
  async withOrg<T>(organizationId: string, fn: (tx: TxClient) => Promise<T>): Promise<T> {
    return this.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_org_id', ${organizationId}, true)`;
        return fn(tx);
      },
      { timeout: 30000, maxWait: 10000 },
    );
  }

  /**
   * 用户自身上下文：用于查询“我的成员关系/组织列表”等不归属单一组织的数据。
   * RLS 策略对 org_membership 额外放行 user_id = app.current_user_id 的行。
   */
  async withUser<T>(userId: string, fn: (tx: TxClient) => Promise<T>): Promise<T> {
    return this.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_user_id', ${userId}, true)`;
        return fn(tx);
      },
      { timeout: 30000, maxWait: 10000 },
    );
  }

  /**
   * 邀请凭证查询：凭原始 token 的哈希在不知道组织的情况下读取邀请（仅限 SELECT）。
   * 查询命中后，写操作仍在 withOrg 事务内完成，且 WITH CHECK 强制组织一致。
   */
  async withInviteLookup<T>(fn: (tx: TxClient) => Promise<T>): Promise<T> {
    return this.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.invite_lookup', 'on', true)`;
        return fn(tx);
      },
      { timeout: 20000, maxWait: 10000 },
    );
  }

  /** 共享链接凭证查询：凭 shareId 在无组织上下文时读取 FileShare（仅 SELECT） */
  async withShareLookup<T>(fn: (tx: TxClient) => Promise<T>): Promise<T> {
    return this.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.file_share_lookup', 'on', true)`;
        return fn(tx);
      },
      { timeout: 20000, maxWait: 10000 },
    );
  }

  /** 邮箱验证凭证查询：凭 token 哈希在无用户上下文时读取验证记录（仅 SELECT） */
  async withEmailVerifyLookup<T>(fn: (tx: TxClient) => Promise<T>): Promise<T> {
    return this.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.email_verify_lookup', 'on', true)`;
        return fn(tx);
      },
      { timeout: 20000, maxWait: 10000 },
    );
  }

  /**
   * 计费维护上下文：定时任务跨组织扫描到期订阅并降级。
   * 仅对 bill_* 与 org_organization 的 RLS 策略开放，且仅限任务执行期间（LOCAL）。
   */
  async withBillingMaintenance<T>(fn: (tx: TxClient) => Promise<T>): Promise<T> {
    return this.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.billing_maintenance', 'on', true)`;
        return fn(tx);
      },
      { timeout: 60000, maxWait: 10000 },
    );
  }

  /**
   * IM 保留策略上下文：定时任务跨组织删除过期消息/附件。
   * 仅对 im_message / im_message_attachment 的 RLS 策略开放，且仅限任务执行期间（LOCAL）。
   */
  async withImRetention<T>(fn: (tx: TxClient) => Promise<T>): Promise<T> {
    return this.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.im_retention', 'on', true)`;
        return fn(tx);
      },
      { timeout: 60000, maxWait: 10000 },
    );
  }

  /** 密码重置凭证查询：凭 token 哈希在无用户上下文时读取重置记录（仅 SELECT） */
  async withPasswordResetLookup<T>(fn: (tx: TxClient) => Promise<T>): Promise<T> {
    return this.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.password_reset_lookup', 'on', true)`;
        return fn(tx);
      },
      { timeout: 20000, maxWait: 10000 },
    );
  }

  /**
   * 组织 + 用户双上下文：IM 等需要同时验证 org_id 和 user_id 的场景。
   * RLS 策略可同时引用 app.current_org_id 与 app.current_user_id 两个 GUC。
   */
  async withOrgUser<T>(
    organizationId: string,
    userId: string,
    fn: (tx: TxClient) => Promise<T>,
  ): Promise<T> {
    return this.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_org_id', ${organizationId}, true)`;
        await tx.$executeRaw`SELECT set_config('app.current_user_id', ${userId}, true)`;
        return fn(tx);
      },
      { timeout: 30000, maxWait: 10000 },
    );
  }

  /**
   * 开通上下文：注册/建组织时读取 organization_id IS NULL 的模板角色/菜单。
   * 事务内先放开模板读取，创建组织后可再 set_config 切换为具体组织。
   */
  async provision<T>(fn: (tx: TxClient) => Promise<T>): Promise<T> {
    return this.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.role_templates', 'on', true)`;
        await tx.$executeRaw`SELECT set_config('app.create_org', 'on', true)`;
        return fn(tx);
      },
      { timeout: 40000, maxWait: 10000 },
    );
  }
}
