import { Module } from '@nestjs/common';
import { MembershipsController } from './memberships.controller';
import { CommonServicesModule } from '../../common/common.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [CommonServicesModule, AuditModule],
  controllers: [MembershipsController],
})
export class MembershipsModule {}
