import { Module } from '@nestjs/common';
import { BillingController } from './billing.controller';
import { AuditModule } from '../audit/audit.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { WebhookIngestService } from './webhook-ingest.service';
import { BillingLifecycleService } from './billing-lifecycle.service';
import { StripeController } from './stripe.controller';
import { StripeBillingService } from './stripe.service';

@Module({
  imports: [AuditModule, RealtimeModule],
  controllers: [BillingController, StripeController],
  providers: [WebhookIngestService, BillingLifecycleService, StripeBillingService],
})
export class BillingModule {}
