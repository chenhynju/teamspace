import { Global, Module } from '@nestjs/common';
import { GroupsController } from './groups.controller';
import { ResourcePolicyService } from './resource-policy.service';
import { ResourceAccessGuard } from './resource-access.guard';
import { AuditModule } from '../audit/audit.module';

@Global()
@Module({ imports: [AuditModule], controllers: [GroupsController], providers: [ResourcePolicyService, ResourceAccessGuard], exports: [ResourcePolicyService, ResourceAccessGuard] })
export class GroupsModule {}
