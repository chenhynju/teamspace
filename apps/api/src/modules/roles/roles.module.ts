import { Module } from '@nestjs/common';
import { RolesController } from './roles.controller';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [AuditModule],
  controllers: [RolesController],
})
export class RolesModule {}
