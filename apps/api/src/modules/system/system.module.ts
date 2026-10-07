import { Module } from '@nestjs/common';
import { MenusController } from './menus.controller';
import { DictController } from './dict.controller';
import { ConfigController } from './config.controller';
import { LoginLogController } from './login-log.controller';
import { AuditModule } from '../audit/audit.module';

/**
 * 系统管理（平台全局部分）：菜单 / 字典 / 参数 / 登录日志。
 * 这些表无组织 RLS，访问完全由角色权限点控制；写操作经 withOrg 事务记录审计。
 */
@Module({
  imports: [AuditModule],
  controllers: [MenusController, DictController, ConfigController, LoginLogController],
})
export class SystemModule {}
