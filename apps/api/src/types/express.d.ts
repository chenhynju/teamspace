import type { OrgContext } from '../common/decorators/current-org.decorator';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      accessibleProjectIds?: string[];
      traceId: string;
      orgContext?: OrgContext;
      // user 由 @types/passport 声明；JWT 实际负载在需要处就地断言
    }
  }
}

export {};
