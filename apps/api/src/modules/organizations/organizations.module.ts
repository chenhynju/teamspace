import { Module } from '@nestjs/common';
import { OrganizationsController } from './organizations.controller';
import { ProvisioningModule } from '../provisioning/provisioning.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [ProvisioningModule, AuditModule],
  controllers: [OrganizationsController],
})
export class OrganizationsModule {}
