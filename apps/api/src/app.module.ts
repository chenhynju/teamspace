import { GroupsModule } from './modules/groups/groups.module';
import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { APP_GUARD } from '@nestjs/core';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { OrganizationsModule } from './modules/organizations/organizations.module';
import { WorkspacesModule } from './modules/workspaces/workspaces.module';
import { MembershipsModule } from './modules/memberships/memberships.module';
import { DeptsModule } from './modules/depts/depts.module';
import { RolesModule } from './modules/roles/roles.module';
import { InvitationsModule } from './modules/invitations/invitations.module';
import { ProjectsModule } from './modules/projects/projects.module';
import { TasksModule } from './modules/tasks/tasks.module';
import { FilesModule } from './modules/files/files.module';
import { BillingModule } from './modules/billing/billing.module';
import { AuditModule } from './modules/audit/audit.module';
import { RealtimeModule } from './modules/realtime/realtime.module';
import { ImModule } from './modules/im/im.module';
import { SystemModule } from './modules/system/system.module';
import { NoticesModule } from './modules/notices/notices.module';
import { MonitorModule } from './modules/monitor/monitor.module';
import { HealthModule } from './modules/health/health.module';
import { TraceIdMiddleware } from './common/middleware/trace-id.middleware';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env' }),
    ScheduleModule.forRoot(),
    PrismaModule,
    GroupsModule,
    RealtimeModule,
    AuthModule,
    UsersModule,
    OrganizationsModule,
    WorkspacesModule,
    MembershipsModule,
    DeptsModule,
    RolesModule,
    InvitationsModule,
    ProjectsModule,
    TasksModule,
    FilesModule,
    BillingModule,
    AuditModule,
    ImModule,
    SystemModule,
    NoticesModule,
    MonitorModule,
    HealthModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(TraceIdMiddleware).forRoutes('*');
  }
}
