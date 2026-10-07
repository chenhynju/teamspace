/**
 * 增量脚本：为已有数据库补充【系统管理 + 系统监控】菜单权限。
 * 幂等：upsert 菜单，再为各组织 OWNER/ADMIN 角色补充缺失关联。
 * 与 prisma/seed.ts 的 MENUS 定义保持一致。
 */
import { PrismaClient } from '@prisma/client';
import 'dotenv/config';

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL } },
});

type Row = {
  id: string;
  parentId: string | null;
  name: string;
  type: 'DIR' | 'MENU' | 'BUTTON';
  orderNum: number;
  path?: string | null;
  perms?: string | null;
  icon?: string | null;
};

const NEW_MENUS: Row[] = [
  { id: 'btn_notice_add', parentId: 'menu_notices', name: '公告发布', type: 'BUTTON', orderNum: 1, perms: 'notice:add' },
  { id: 'btn_notice_edit', parentId: 'menu_notices', name: '公告编辑', type: 'BUTTON', orderNum: 2, perms: 'notice:edit' },
  { id: 'btn_notice_remove', parentId: 'menu_notices', name: '公告删除', type: 'BUTTON', orderNum: 3, perms: 'notice:remove' },

  { id: 'menu_sys_menus', parentId: 'dir_system', name: '菜单管理', type: 'MENU', orderNum: 3, path: '/system/menus', perms: 'menu:list', icon: 'Menu' },
  { id: 'btn_menu_add', parentId: 'menu_sys_menus', name: '菜单新增', type: 'BUTTON', orderNum: 1, perms: 'menu:add' },
  { id: 'btn_menu_edit', parentId: 'menu_sys_menus', name: '菜单编辑', type: 'BUTTON', orderNum: 2, perms: 'menu:edit' },
  { id: 'btn_menu_remove', parentId: 'menu_sys_menus', name: '菜单删除', type: 'BUTTON', orderNum: 3, perms: 'menu:remove' },

  { id: 'menu_sys_dicts', parentId: 'dir_system', name: '字典管理', type: 'MENU', orderNum: 4, path: '/system/dicts', perms: 'dict:list', icon: 'BookOpen' },
  { id: 'btn_dict_add', parentId: 'menu_sys_dicts', name: '字典新增', type: 'BUTTON', orderNum: 1, perms: 'dict:add' },
  { id: 'btn_dict_edit', parentId: 'menu_sys_dicts', name: '字典编辑', type: 'BUTTON', orderNum: 2, perms: 'dict:edit' },
  { id: 'btn_dict_remove', parentId: 'menu_sys_dicts', name: '字典删除', type: 'BUTTON', orderNum: 3, perms: 'dict:remove' },

  { id: 'menu_sys_configs', parentId: 'dir_system', name: '参数设置', type: 'MENU', orderNum: 5, path: '/system/configs', perms: 'config:list', icon: 'SlidersHorizontal' },
  { id: 'btn_config_add', parentId: 'menu_sys_configs', name: '参数新增', type: 'BUTTON', orderNum: 1, perms: 'config:add' },
  { id: 'btn_config_edit', parentId: 'menu_sys_configs', name: '参数编辑', type: 'BUTTON', orderNum: 2, perms: 'config:edit' },
  { id: 'btn_config_remove', parentId: 'menu_sys_configs', name: '参数删除', type: 'BUTTON', orderNum: 3, perms: 'config:remove' },

  { id: 'menu_sys_login_logs', parentId: 'dir_system', name: '登录日志', type: 'MENU', orderNum: 6, path: '/system/login-logs', perms: 'logininfor:list', icon: 'LogIn' },
  { id: 'btn_loginlog_remove', parentId: 'menu_sys_login_logs', name: '日志删除', type: 'BUTTON', orderNum: 1, perms: 'logininfor:remove' },

  { id: 'dir_monitor', parentId: null, name: '系统监控', type: 'DIR', orderNum: 7, path: '/monitor', icon: 'Activity' },
  { id: 'menu_mon_online', parentId: 'dir_monitor', name: '在线用户', type: 'MENU', orderNum: 1, path: '/monitor/online', perms: 'monitor:online:list', icon: 'Wifi' },
  { id: 'btn_mon_online_force', parentId: 'menu_mon_online', name: '强退用户', type: 'BUTTON', orderNum: 1, perms: 'monitor:online:force-logout' },
  { id: 'menu_mon_server', parentId: 'dir_monitor', name: '服务监控', type: 'MENU', orderNum: 2, path: '/monitor/server', perms: 'monitor:server:view', icon: 'Server' },
  { id: 'menu_mon_cache', parentId: 'dir_monitor', name: '缓存监控', type: 'MENU', orderNum: 3, path: '/monitor/cache', perms: 'monitor:cache:view', icon: 'Database' },
  { id: 'menu_mon_job', parentId: 'dir_monitor', name: '定时任务', type: 'MENU', orderNum: 4, path: '/monitor/jobs', perms: 'monitor:job:list', icon: 'Clock' },
  { id: 'btn_mon_job_run', parentId: 'menu_mon_job', name: '执行一次', type: 'BUTTON', orderNum: 1, perms: 'monitor:job:run' },
  { id: 'menu_mon_db', parentId: 'dir_monitor', name: '数据库会话', type: 'MENU', orderNum: 5, path: '/monitor/database', perms: 'monitor:db:view', icon: 'HardDrive' },
];

// 仅 OWNER/ADMIN 获得本批菜单
const ALLOWED_ROLE_KEYS = new Set(['OWNER', 'ADMIN']);

async function main() {
  console.log('→ Upsert 菜单 ...');
  for (const m of NEW_MENUS) {
    await prisma.menu.upsert({
      where: { id: m.id },
      update: {},
      create: {
        id: m.id,
        parentId: m.parentId,
        name: m.name,
        type: m.type,
        orderNum: m.orderNum,
        path: m.path,
        icon: m.icon ?? '#',
        perms: m.perms,
      },
    });
  }

  console.log('→ 为 OWNER/ADMIN 角色补充关联 ...');
  const roles = await prisma.role.findMany({
    where: { organizationId: { not: null } },
    select: { id: true, key: true },
  });

  for (const r of roles) {
    if (!ALLOWED_ROLE_KEYS.has(r.key)) continue;
    for (const m of NEW_MENUS) {
      const exists = await prisma.roleMenu.findFirst({ where: { roleId: r.id, menuId: m.id } });
      if (!exists) {
        await prisma.roleMenu.create({ data: { roleId: r.id, menuId: m.id } });
        console.log(`  ${r.key}(${r.id}) + ${m.id}`);
      }
    }
  }

  console.log('→ 完成');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
