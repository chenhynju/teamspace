import { Module } from '@nestjs/common';
import { BillingController } from './billing.controller';
import { AuditModule } from '../audit/audit.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { WebhookIngestService } from './webhook-ingest.service';
import { BillingLifecycleService } from './billing-lifecycle.service';

@Module({
  imports: [AuditModule, RealtimeModule],
  controllers: [BillingController],
  providers: [WebhookIngestService, BillingLifecycleService],
})
export class BillingModule {}
