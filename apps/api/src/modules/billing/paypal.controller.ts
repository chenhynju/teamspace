import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { IsIn, IsString } from 'class-validator';
import type { Request } from 'express';
import { PayPalBillingService } from './paypal.service';
import { OrgContextGuard } from '../../common/guards/org-context.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CurrentOrg, OrgContext } from '../../common/decorators/current-org.decorator';
import { Public } from '../../common/decorators/public.decorator';
class CheckoutDto { @IsString() planCode:string; @IsIn(['monthly','yearly']) interval:'monthly'|'yearly'; }
@Controller('billing/paypal')
export class PayPalController {
  constructor(private readonly billing:PayPalBillingService){}
  @Get('configuration') @UseGuards(OrgContextGuard,PermissionsGuard) @RequirePermissions('billing:view')
  configuration(){return this.billing.configuration();}
  @Post('checkout') @UseGuards(OrgContextGuard,PermissionsGuard) @RequirePermissions('billing:change')
  checkout(@Body()dto:CheckoutDto,@CurrentOrg()org:OrgContext){return this.billing.checkout(org.organizationId,dto.planCode,dto.interval);}
  @Post('reconcile') @UseGuards(OrgContextGuard,PermissionsGuard) @RequirePermissions('billing:manage')
  reconcile(@CurrentOrg()org:OrgContext){return this.billing.reconcile(org.organizationId);}
  @Post('cancel') @UseGuards(OrgContextGuard,PermissionsGuard) @RequirePermissions('billing:change')
  cancel(@CurrentOrg()org:OrgContext){return this.billing.cancel(org.organizationId);}
  @Public() @Post('webhook')
  async webhook(@Req()req:Request){await this.billing.verify(req.headers,req.body);return this.billing.handle(req.body);}
}
