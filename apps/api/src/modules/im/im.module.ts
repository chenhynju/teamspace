import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { ImController, MessageAttachmentController } from './im.controller';
import { ImRetentionService } from './im-retention.service';

@Module({
  imports: [AuditModule, RealtimeModule],
  controllers: [ImController, MessageAttachmentController],
  providers: [ImRetentionService],
})
export class ImModule {}
