import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  UseGuards,
} from '@nestjs/common';
import { OrgContextGuard } from '../../common/guards/org-context.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { MonitorService } from './monitor.service';

/**
 * 系统监控：在线用户 / 服务指标 / 缓存 / 定时任务 / 数据库会话。
 * 全部只读监控（在线强退、手动触发任务除外），不提供在线配置，降低误操作面。
 */
@Controller('monitor')
@UseGuards(OrgContextGuard, PermissionsGuard)
export class MonitorController {
  constructor(private readonly monitor: MonitorService) {}

  @Get('online')
  @RequirePermissions('monitor:online:list')
  online() {
    return this.monitor.listOnline();
  }

  @Delete('online/:socketId')
  @RequirePermissions('monitor:online:force-logout')
  forceLogout(@Param('socketId') socketId: string) {
    return this.monitor.forceLogout(socketId);
  }

  @Get('server')
  @RequirePermissions('monitor:server:view')
  server() {
    return this.monitor.serverInfo();
  }

  @Get('cache')
  @RequirePermissions('monitor:cache:view')
  cache() {
    return this.monitor.cacheInfo();
  }

  @Get('jobs')
  @RequirePermissions('monitor:job:list')
  jobs() {
    return this.monitor.listJobs();
  }

  @Post('jobs/:name/run')
  @RequirePermissions('monitor:job:run')
  runJob(@Param('name') name: string) {
    return this.monitor.runJob(decodeURIComponent(name));
  }

  @Get('database')
  @RequirePermissions('monitor:db:view')
  database() {
    return this.monitor.databaseInfo();
  }
}
