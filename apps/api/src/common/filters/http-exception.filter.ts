import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { TRACE_ID_HEADER } from '../middleware/trace-id.middleware';

export interface ApiError {
  code: string;
  message: string;
  request_id: string;
  retryable: boolean;
  details?: Record<string, any>;
}

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const traceId = (request.headers[TRACE_ID_HEADER] as string) || 'unknown';

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'INTERNAL_ERROR';
    let message = 'Internal server error';
    let retryable = false;
    let details: Record<string, any> | undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse();
      if (typeof res === 'string') {
        message = res;
      } else if (typeof res === 'object') {
        const r = res as any;
        code = r.code || this.statusToCode(status);
        message = r.message || exception.message;
        retryable = !!r.retryable;
        details = r.details;
      }
      if (!code || code === 'INTERNAL_ERROR') code = this.statusToCode(status);
    } else {
      this.logger.error(`Unhandled exception: ${(exception as Error)?.message}`, (exception as Error)?.stack);
    }

    const body: ApiError = {
      code,
      message,
      request_id: traceId,
      retryable,
      ...(details ? { details } : {}),
    };

    response.status(status).json(body);
  }

  private statusToCode(status: number): string {
    const map: Record<number, string> = {
      400: 'BAD_REQUEST',
      401: 'UNAUTHORIZED',
      403: 'FORBIDDEN',
      404: 'NOT_FOUND',
      409: 'CONFLICT',
      410: 'GONE',
      429: 'RATE_LIMITED',
      500: 'INTERNAL_ERROR',
    };
    return map[status] || `HTTP_${status}`;
  }
}
