import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  cpus,
  freemem,
  totalmem,
  loadavg,
  uptime as osUptime,
  hostname,
  platform,
  arch,
  type CpuInfo,
} from 'node:os';
import { statfsSync } from 'node:fs';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { createClient } from 'redis';
import { SchedulerRegistry } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { RealtimeEventsService } from '../realtime/realtime-events.service';

type RedisClientType = ReturnType<typeof createClient>;

@Injectable()
export class MonitorService implements OnModuleInit {
  private readonly logger = new Logger(MonitorService.name);
  private redisClient?: RedisClientType | null;

  // CPU 采样（两次快照做差得使用率）
  private cpuPercent = 0;
  private prevTick?: { idle: number; total: number };
  private readonly elDelay = monitorEventLoopDelay({ resolution: 20 });

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeEventsService,
    private readonly schedulerRegistry: SchedulerRegistry,
  ) {}

  onModuleInit() {
    this.elDelay.enable();
    // 5 秒采样一次 CPU
    setInterval(() => this.sampleCpu(), 5000);
    this.sampleCpu();
  }

  /* ==================== 在线用户 ==================== */

  async listOnline() {
    const sockets = await this.realtime.fetchSockets();
    const connections: Array<{
      socketId: string;
      userId: string;
      name: string;
      email: string;
    }> = [];
    for (const s of sockets) {
      const user = s.data.user;
      if (!user) continue;
      connections.push({
        socketId: s.id,
        userId: user.id,
        name: user.name,
        email: user.email,
      });
    }
    // 同一用户可能多端连接：聚合计数
    const users = new Map<string, { userId: string; name: string; email: string; connectionCount: number }>();
    for (const c of connections) {
      const cur = users.get(c.userId);
      if (cur) cur.connectionCount += 1;
      else users.set(c.userId, { userId: c.userId, name: c.name, email: c.email, connectionCount: 1 });
    }
    return {
      totalConnections: connections.length,
      totalUsers: users.size,
      users: [...users.values()],
      connections,
    };
  }

  async forceLogout(socketId: string) {
    const sockets = await this.realtime.fetchSockets();
    const target = sockets.find((s) => s.id === socketId);
    if (!target) return { ok: false, code: 'NOT_FOUND' };
    target.disconnect(true);
    return { ok: true };
  }

  /* ==================== 服务监控 ==================== */

  serverInfo() {
    const memTotal = totalmem();
    const memFree = freemem();
    const heap = process.memoryUsage();

    // 磁盘：工作目录所在文件系统（容器内即卷/宿主视角）
    let disk: { path: string; total: number; free: number; usedPercent: number } | null = null;
    try {
      const s = statfsSync(process.cwd());
      const total = Number(s.blocks) * Number(s.bsize);
      const free = Number(s.bavail) * Number(s.bsize);
      disk = {
        path: process.cwd(),
        total,
        free,
        usedPercent: total ? Math.round(((total - free) / total) * 1000) / 10 : 0,
      };
    } catch {
      disk = null;
    }

    return {
      host: {
        hostname: hostname(),
        platform: platform(),
        arch: arch(),
        osUptimeSeconds: Math.round(osUptime()),
        loadAverage: loadavg(),
      },
      cpu: {
        model: cpus()[0]?.model ?? 'unknown',
        cores: cpus().length,
        usedPercent: this.cpuPercent,
      },
      memory: {
        total: memTotal,
        free: memFree,
        usedPercent: Math.round(((memTotal - memFree) / memTotal) * 1000) / 10,
      },
      disk,
      node: {
        version: process.version,
        pid: process.pid,
        uptimeSeconds: Math.round(process.uptime()),
        rss: heap.rss,
        heapTotal: heap.heapTotal,
        heapUsed: heap.heapUsed,
        external: heap.external,
        arrayBuffers: heap.arrayBuffers,
        heapUsedPercent: Math.round((heap.heapUsed / heap.heapTotal) * 1000) / 10,
        eventLoopDelayMs: {
          mean: Number((this.elDelay.mean / 1e6).toFixed(2)),
          max: Number((this.elDelay.max / 1e6).toFixed(2)),
          p99: Number((this.elDelay.percentile(99) / 1e6).toFixed(2)),
        },
      },
    };
  }

  /* ==================== 缓存监控 ==================== */

  async cacheInfo(): Promise<
    | { enabled: false; reason: string }
    | { enabled: true; info: Record<string, string>; dbsize: number }
  > {
    const client = await this.getRedisClient();
    if (!client) {
      return { enabled: false, reason: 'REDIS_URL 未配置或 Redis 不可达，系统以单节点模式运行' };
    }
    const [rawInfo, dbsize] = await Promise.all([client.info(), client.dbSize()]);
    const info: Record<string, string> = {};
    for (const line of rawInfo.split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const idx = t.indexOf(':');
      if (idx > 0) info[t.slice(0, idx)] = t.slice(idx + 1);
    }
    return { enabled: true, info, dbsize };
  }

  private async getRedisClient(): Promise<RedisClientType | null> {
    if (this.redisClient !== undefined) return this.redisClient;
    const url = process.env.REDIS_URL;
    if (!url) {
      this.redisClient = null;
      return null;
    }
    const client = createClient({
      url,
      socket: { connectTimeout: 2000, reconnectStrategy: false },
    });
    client.on('error', () => undefined);
    try {
      await client.connect();
      this.redisClient = client;
    } catch {
      this.redisClient = null;
    }
    return this.redisClient;
  }

  /* ==================== 定时任务 ==================== */

  listJobs() {
    const jobs = this.schedulerRegistry.getCronJobs();
    const result: Array<{ name: string; running: boolean; nextExecution: string | null; lastExecution: string | null }> = [];
    for (const [name, job] of jobs) {
      let next: string | null = null;
      try {
        next = job.nextDate().toISO();
      } catch {
        next = null;
      }
      // CronJob 无标准 lastRun；手动触发时记录（见 runJob）
      result.push({
        name,
        running: true,
        nextExecution: next,
        lastExecution: (job as any)._lastRun?.toISO?.() ?? null,
      });
    }
    return result;
  }

  async runJob(name: string) {
    let job;
    try {
      job = this.schedulerRegistry.getCronJob(name);
    } catch {
      return { ok: false, code: 'NOT_FOUND' };
    }
    const startedAt = new Date();
    // 只允许白名单内的任务手动触发（防止触发到内部任意 cron）
    if (!ALLOWED_MANUAL_JOBS.has(name)) {
      return { ok: false, code: 'NOT_ALLOWED' };
    }
    job.fireOnTick();
    (job as any)._lastRun = startedAt;
    return { ok: true, firedAt: startedAt.toISOString() };
  }

  /* ==================== 数据库会话 ==================== */

  async databaseInfo() {
    const maxConnRows = await this.prisma.$queryRaw<{ setting: number }[]>`
      SELECT setting::int FROM pg_settings WHERE name = 'max_connections'`;

    const stats = await this.prisma.$queryRaw<
      { state: string; n: number }[]
    >`
      SELECT COALESCE(state, 'idle-in-tx(unknown)') AS state, count(*)::int AS n
      FROM pg_stat_activity
      WHERE datname = current_database()
      GROUP BY state`;

    const activities = await this.prisma.$queryRaw<ActivityRow[]>`
      SELECT
        pid,
        usename,
        application_name,
        host(client_addr) AS client_addr,
        state,
        CASE WHEN state = 'active' THEN left(query, 500) ELSE NULL END AS query,
        CASE
          WHEN state = 'active' THEN round(extract(epoch FROM now() - query_start))::int
          ELSE round(extract(epoch FROM now() - state_change))::int
        END AS seconds
      FROM pg_stat_activity
      WHERE datname = current_database()
        AND pid <> pg_backend_pid()
      ORDER BY
        CASE state WHEN 'active' THEN 0 WHEN 'idle in transaction' THEN 1 ELSE 2 END,
        query_start DESC
      LIMIT 50
    `;

    const total = stats.reduce((sum, s) => sum + s.n, 0);
    return {
      maxConnections: maxConnRows[0]?.setting ?? null,
      totalConnections: total,
      stateBreakdown: stats,
      activities,
    };
  }

  /* ==================== 内部：CPU 采样 ==================== */

  private sampleCpu() {
    const snapshot = cpuTimes(cpus());
    if (this.prevTick) {
      const idleDiff = snapshot.idle - this.prevTick.idle;
      const totalDiff = snapshot.total - this.prevTick.total;
      this.cpuPercent = totalDiff > 0
        ? Math.round((1 - idleDiff / totalDiff) * 1000) / 10
        : 0;
    }
    this.prevTick = snapshot;
  }
}

/** 可手动触发的 cron 白名单 */
const ALLOWED_MANUAL_JOBS = new Set([
  'BillingLifecycleService_scheduledRun',
  'BillingLifecycleService_scheduledRun_1',
  'ImRetentionService_dailyPurge',
]);

export interface ActivityRow {
  pid: number;
  usename: string;
  application_name: string;
  client_addr: string | null;
  state: string;
  query: string | null;
  seconds: number | null;
}

function cpuTimes(list: CpuInfo[]) {
  let idle = 0;
  let total = 0;
  for (const c of list) {
    for (const key of Object.keys(c.times) as Array<keyof CpuInfo['times']>) {
      total += c.times[key];
    }
    idle += c.times.idle;
  }
  return { idle, total };
}
