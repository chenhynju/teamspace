import { Module } from '@nestjs/common';
import { NoticesController } from './notices.controller';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [AuditModule],
  controllers: [NoticesController],
})
export class NoticesModule {}
