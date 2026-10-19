import { ConflictException, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';

/** Persist the provider intent BEFORE network I/O. An unknown result must retry the same intent. */
@Injectable()
export class CheckoutCoordinator {
  constructor(private readonly prisma: PrismaService) {}
  reserve(orgId: string, provider: 'stripe' | 'paypal', planKey: string) {
    return this.prisma.withOrg(orgId, async tx => {
      await tx.$executeRaw`SELECT id FROM org_organization WHERE id = ${orgId} FOR UPDATE`;
      const org = await tx.organization.findUniqueOrThrow({ where: { id: orgId } });
      const active = await tx.subscription.findFirst({ where: { organizationId: orgId, provider: { in: ['stripe','paypal'] }, status: { in: ['ACTIVE','PAST_DUE'] } } });
      if (active) throw new ConflictException({ code: 'SUBSCRIPTION_EXISTS', message: '已有付费订阅，请先管理或取消现有订阅' });
      // Only Stripe Checkout provides an authoritative expiry. PayPal pending approvals require explicit cancellation.
      const expired = org.checkoutProvider === 'stripe' && org.checkoutExpiresAt && org.checkoutExpiresAt <= new Date();
      if (org.checkoutAttemptId && !expired) {
        if (org.checkoutProvider !== provider || org.checkoutPlanKey !== planKey) throw new ConflictException({ code: 'CHECKOUT_PENDING', message: '已有待确认支付，请先完成或取消；结果未知时不可重复创建' });
        return org;
      }
      return tx.organization.update({ where: { id: orgId }, data: { checkoutAttemptId: randomUUID(), checkoutProvider: provider, checkoutPlanKey: planKey, checkoutSessionId: null, checkoutUrl: null, checkoutExpiresAt: null } });
    });
  }
}
