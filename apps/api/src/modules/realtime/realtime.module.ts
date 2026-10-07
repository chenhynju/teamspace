import { Module } from '@nestjs/common';
import { CollaborationGateway } from './collaboration.gateway';
import { RealtimeEventsService } from './realtime-events.service';

@Module({
  providers: [CollaborationGateway, RealtimeEventsService],
  exports: [RealtimeEventsService],
})
export class RealtimeModule {}
