import { Controller, Get, HttpCode, HttpStatus } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { HealthService, HealthStatus } from './health.service';

@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  /** 存活探针：进程存活即 200 */
  @Get('live')
  @Public()
  @HttpCode(HttpStatus.OK)
  live() {
    return { status: 'alive' };
  }

  /** 就绪探针：DB/Redis 可达才 200，否则 503（供 ALB/Nginx 摘流） */
  @Get('ready')
  @Public()
  async ready(): Promise<HealthStatus> {
    return this.health.check();
  }

  /** 兼容老路径 */
  @Get()
  @Public()
  @HttpCode(HttpStatus.OK)
  async index(): Promise<HealthStatus> {
    return this.health.check();
  }
}
