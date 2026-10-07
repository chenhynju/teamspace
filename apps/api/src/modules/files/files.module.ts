import { Module } from '@nestjs/common';
import { FilesController } from './files.controller';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [AuditModule],
  controllers: [FilesController],
})
export class FilesModule {}
