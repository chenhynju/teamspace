import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { createClient, RedisClientType } from 'redis';

export interface HealthStatus {
  status: 'ok' | 'degraded';
  uptimeSeconds: number;
  checks: {
    database: 'up' | 'down';
    redis: 'up' | 'down' | 'skipped';
  };
}

/**
 * 应用存活与就绪探针：供 ECS / ALB / Nginx 探活。
 * - DB 连接：SELECT 1
 * - Redis：PING（未配置 REDIS_URL 时标记 skipped，不影响就绪）
 */
@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);
  private readonly startedAt = Date.now();
  private redisClient?: RedisClientType;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async check(): Promise<HealthStatus> {
    const db = await this.checkDatabase();
    const redis = await this.checkRedis();

    const status: HealthStatus['status'] =
      db === 'up' && (redis === 'up' || redis === 'skipped') ? 'ok' : 'degraded';

    return {
      status,
      uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000),
      checks: { database: db, redis },
    };
  }

  private async checkDatabase(): Promise<'up' | 'down'> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return 'up';
    } catch (e) {
      this.logger.warn(`DB health check failed: ${(e as Error).message}`);
      return 'down';
    }
  }

  private async checkRedis(): Promise<'up' | 'down' | 'skipped'> {
    const url = this.config.get<string>('REDIS_URL');
    if (!url) return 'skipped';
    try {
      if (!this.redisClient) {
        this.redisClient = createClient({ url, socket: { connectTimeout: 2000 } });
        this.redisClient.on('error', () => {});
      }
      if (!this.redisClient.isOpen) await this.redisClient.connect();
      const pong = await this.redisClient.ping();
      return pong === 'PONG' ? 'up' : 'down';
    } catch (e) {
      this.logger.warn(`Redis health check failed: ${(e as Error).message}`);
      return 'down';
    }
  }
}
