import { Injectable, Logger } from '@nestjs/common';
import type { TxClient } from '../../prisma/prisma.service';
import { PrismaService } from '../../prisma/prisma.service';
import { maskSensitive, normalizeForJson } from '../../common/util/mask';

/** 操作日志状态：0 正常，1 异常（schema 中为 Int） */
export enum OperLogStatus {
  SUCCESS = 0,
  FAIL = 1,
}

/** 业务操作类型（对齐 RuoYi sys_oper_log.business_type 并扩展） */
export enum BusinessType {
  OTHER = 0,
  INSERT = 1,
  UPDATE = 2,
  DELETE = 3,
  GRANT = 4,
  STATUS = 5,
}

export interface AuditRecordInput {
  organizationId: string;
  actorId: string | null;
  title: string; // 模块标题
  businessType?: BusinessType;
  action: string; // 权限标识/动作
  resourceType: string;
  resourceId?: string | null;
  before?: unknown;
  after?: unknown;
  traceId: string;
  ip?: string | null;
  method?: string | null; // 后端处理方法
  requestMethod?: string | null; // HTTP 方法
  status?: OperLogStatus;
  costTime?: number;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 在调用方的组织事务（withOrg）内写审计。
   * before/after 经敏感字段脱敏后落库，确保 actor/资源/前后差异/trace_id 可追溯。
   */
  async record(tx: TxClient, input: AuditRecordInput): Promise<void> {
    // SAVEPOINT 隔离：审计 INSERT 即使触发 RLS 错误，也只回滚到保存点，
    // 不会像裸 try/catch 那样让整条 Postgres 事务进入 aborted 状态
    await tx.$executeRaw`SAVEPOINT audit_record_sp`;
    try {
      await tx.operLog.create({
        data: {
          organizationId: input.organizationId,
          actorId: input.actorId,
          title: input.title,
          businessType: input.businessType ?? BusinessType.OTHER,
          method: input.method ?? null,
          requestMethod: input.requestMethod ?? null,
          action: input.action,
          resourceType: input.resourceType,
          resourceId: input.resourceId ?? null,
          beforeValue:
            input.before === undefined ? undefined : (maskSensitive(normalizeForJson(input.before)) as any),
          afterValue:
            input.after === undefined ? undefined : (maskSensitive(normalizeForJson(input.after)) as any),
          traceId: input.traceId,
          ip: input.ip ?? null,
          status: input.status ?? OperLogStatus.SUCCESS,
          costTime: input.costTime ?? 0,
        },
      });
    } catch (e) {
      await tx.$executeRaw`ROLLBACK TO SAVEPOINT audit_record_sp`;
      this.logger.error(`Failed to write oper log: ${(e as Error).message}`);
    }
  }

  /** 登录日志走全局 sys_login_log（无租户隔离）；此方法在事务外调用 */
  async loginLog(params: {
    userId?: string | null;
    username: string;
    ip?: string | null;
    browser?: string | null;
    os?: string | null;
    status: number;
    msg?: string | null;
  }): Promise<void> {
    try {
      await this.prisma.loginLog.create({
        data: {
          userId: params.userId ?? null,
          username: params.username,
          ip: params.ip ?? null,
          browser: params.browser ?? null,
          os: params.os ?? null,
          status: params.status,
          msg: params.msg ?? null,
        },
      });
    } catch (e) {
      this.logger.error(`Failed to write login log: ${(e as Error).message}`);
    }
  }
}
