import { Module } from '@nestjs/common';
import { DataScopeService } from './services/data-scope.service';

@Module({
  providers: [DataScopeService],
  exports: [DataScopeService],
})
export class CommonServicesModule {}
