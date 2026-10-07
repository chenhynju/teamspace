import { Module } from '@nestjs/common';
import { DeptsController } from './depts.controller';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [AuditModule],
  controllers: [DeptsController],
})
export class DeptsModule {}
