import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { nanoid } from 'nanoid';

export const TRACE_ID_HEADER = 'x-trace-id';

@Injectable()
export class TraceIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const traceId = (req.headers[TRACE_ID_HEADER] as string) || nanoid(16);
    req.headers[TRACE_ID_HEADER] = traceId;
    res.setHeader(TRACE_ID_HEADER, traceId);
    (req as any).traceId = traceId;
    next();
  }
}
