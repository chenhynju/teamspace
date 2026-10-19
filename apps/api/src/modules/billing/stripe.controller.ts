import { BadRequestException, Body, Controller, Get, Post, Req, ServiceUnavailableException, UnauthorizedException, UseGuards, type RawBodyRequest } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import Stripe from 'stripe';
import { IsIn, IsString } from 'class-validator';
import { PrismaService } from '../../prisma/prisma.service';
import { OrgContextGuard } from '../../common/guards/org-context.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CurrentOrg, OrgContext } from '../../common/decorators/current-org.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { StripeBillingService } from './stripe.service';

class CheckoutDto {
  @IsString() planCode: string;
  @IsIn(['monthly', 'yearly']) interval: 'monthly' | 'yearly';
}

@Controller('billing/stripe')
export class StripeController {
  constructor(private readonly config: ConfigService, private readonly prisma: PrismaService, private readonly billing: StripeBillingService) {}

  @Get('configuration')
  @UseGuards(OrgContextGuard, PermissionsGuard)
  @RequirePermissions('billing:view')
  configuration() { return this.billing.configuration(); }

  @Post('checkout')
  @UseGuards(OrgContextGuard, PermissionsGuard)
  @RequirePermissions('billing:change')
  checkout(@Body() dto: CheckoutDto, @CurrentOrg() org: OrgContext) {
    return this.billing.checkout(org.organizationId, dto.planCode, dto.interval);
  }

  @Post('portal')
  @UseGuards(OrgContextGuard, PermissionsGuard)
  @RequirePermissions('billing:change')
  async portal(@CurrentOrg() org: OrgContext) {
    const row = await this.prisma.withOrg(org.organizationId, tx => tx.organization.findUniqueOrThrow({ where: { id: org.organizationId } }));
    if (!row.stripeCustomerId) throw new BadRequestException({ code: 'NO_STRIPE_CUSTOMER', message: '尚未建立 Stripe 订阅' });
    const session = await this.billing.client().billingPortal.sessions.create({ customer: row.stripeCustomerId, return_url: this.billing.webUrl() + '/billing' });
    return { url: session.url };
  }

  @Post('reconcile')
  @UseGuards(OrgContextGuard, PermissionsGuard)
  @RequirePermissions('billing:manage')
  async reconcile(@CurrentOrg() org: OrgContext) { return this.billing.reconcile(org.organizationId); }

  @Public()
  @Post('webhook')
  async webhook(@Req() req: RawBodyRequest<Request>) {
    const secret = this.config.get<string>('STRIPE_WEBHOOK_SECRET');
    if (!secret) throw new ServiceUnavailableException({ code: 'STRIPE_NOT_CONFIGURED', message: 'Stripe webhook 未配置' });
    let event: Stripe.Event;
    try {
      const signature = req.headers['stripe-signature'];
      if (!req.rawBody || typeof signature !== 'string') throw new Error('signature required');
      event = this.billing.client().webhooks.constructEvent(req.rawBody, signature, secret);
    } catch { throw new UnauthorizedException({ code: 'STRIPE_SIGNATURE_INVALID', message: 'Stripe 签名无效' }); }
    return this.billing.handle(event);
  }
}
