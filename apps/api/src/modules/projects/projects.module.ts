import { Module } from '@nestjs/common';
import { ProjectsController } from './projects.controller';
import { AuditModule } from '../audit/audit.module';
import { RealtimeModule } from '../realtime/realtime.module';

@Module({
  imports: [AuditModule, RealtimeModule],
  controllers: [ProjectsController],
})
export class ProjectsModule {}
