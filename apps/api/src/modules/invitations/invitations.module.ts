import { Module } from '@nestjs/common';
import { InvitationsController } from './invitations.controller';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [AuditModule],
  controllers: [InvitationsController],
})
export class InvitationsModule {}
