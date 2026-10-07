import { Module } from '@nestjs/common';
import { WorkspacesController } from './workspaces.controller';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [AuditModule],
  controllers: [WorkspacesController],
})
export class WorkspacesModule {}
