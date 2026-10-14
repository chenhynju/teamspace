import { Injectable, LoggerService, LogLevel } from '@nestjs/common';
import { AsyncLocalStorage } from 'async_hooks';

/** 请求级上下文存储，让日志自动携带 traceId（不依赖静态变量，避免并发串扰） */
export const requestContext = new AsyncLocalStorage<{ traceId?: string }>();

/**
 * 结构化 JSON 日志：每行一个 JSON 对象，便于 CloudWatch / ELK / Loki 解析与告警。
 * 字段：ts、level、context、msg、traceId（请求内自动注入）。
 */
@Injectable()
export class StructuredLogger implements LoggerService {
  private emit(level: LogLevel, message: any, context?: string, trace?: string) {
    const ctx = requestContext.getStore();
    const entry: Record<string, unknown> = {
      ts: new Date().toISOString(),
      level,
      msg: typeof message === 'string' ? message : safeStringify(message),
    };
    if (context) entry.context = context;
    if (ctx?.traceId) entry.traceId = ctx.traceId;
    if (trace) entry.trace = trace;
    const stream = level === 'error' || level === 'fatal' ? process.stderr : process.stdout;
    stream.write(JSON.stringify(entry) + '\n');
  }

  log(message: any, context?: string) {
    this.emit('log', message, context);
  }
  error(message: any, trace?: string, context?: string) {
    this.emit('error', message, context, trace);
  }
  warn(message: any, context?: string) {
    this.emit('warn', message, context);
  }
  debug?(message: any, context?: string) {
    this.emit('debug', message, context);
  }
  verbose?(message: any, context?: string) {
    this.emit('verbose', message, context);
  }
  fatal?(message: any, traceOrContext?: string, context?: string) {
    this.emit('fatal', message, context, traceOrContext);
  }
}

function safeStringify(obj: any): string {
  try {
    return JSON.stringify(obj);
  } catch {
    return String(obj);
  }
}
