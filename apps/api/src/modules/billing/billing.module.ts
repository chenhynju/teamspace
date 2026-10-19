import { PayPalBillingService } from './paypal.service';
import { PayPalController } from './paypal.controller';
import { CheckoutCoordinator } from './checkout-coordinator.service';
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
  controllers: [BillingController, StripeController, PayPalController],
  providers: [PayPalBillingService, CheckoutCoordinator, WebhookIngestService, BillingLifecycleService, StripeBillingService],
})
export class BillingModule {}
