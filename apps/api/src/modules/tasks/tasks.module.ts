import { Module } from '@nestjs/common';
import { TasksController } from './tasks.controller';
import { RealtimeModule } from '../realtime/realtime.module';

@Module({
  imports: [RealtimeModule],
  controllers: [TasksController],
})
export class TasksModule {}
