/**
 * 增量脚本：为已有数据库补充 IM 菜单权限。
 * 幂等：先 upsert 菜单，再为各组织角色补充缺失的菜单关联。
 */
import { PrismaClient } from '@prisma/client';
import 'dotenv/config';

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL } },
});

const IM_MENUS = [
  { id: 'dir_im', parentId: null, name: '即时通讯', type: 'DIR' as const, orderNum: 6, path: '/im', icon: 'MessageSquare', perms: null },
  { id: 'menu_im', parentId: 'dir_im', name: '消息', type: 'MENU' as const, orderNum: 1, path: '', icon: null, perms: 'im:view' },
  { id: 'btn_im_use', parentId: 'menu_im', name: '发送消息', type: 'BUTTON' as const, orderNum: 1, path: null, icon: null, perms: 'im:use' },
  { id: 'btn_im_group_create', parentId: 'menu_im', name: '创建群聊', type: 'BUTTON' as const, orderNum: 2, path: null, icon: null, perms: 'im:group:create' },
  { id: 'btn_im_attachment_upload', parentId: 'menu_im', name: '上传附件', type: 'BUTTON' as const, orderNum: 3, path: null, icon: null, perms: 'im:attachment:upload' },
];

const ROLE_MENUS: Record<string, string[]> = {
  OWNER: IM_MENUS.map((m) => m.id),
  ADMIN: IM_MENUS.map((m) => m.id),
  MEMBER: ['dir_im', 'menu_im', 'btn_im_use', 'btn_im_group_create', 'btn_im_attachment_upload'],
  GUEST: ['dir_im', 'menu_im', 'btn_im_use'],
  FINANCE: [],
};

async function main() {
  console.log('→ Upsert IM 菜单 ...');
  for (const m of IM_MENUS) {
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

  console.log('→ 为各组织角色补充 IM 菜单关联 ...');
  const roles = await prisma.role.findMany({ where: { organizationId: { not: null } }, select: { id: true, key: true, organizationId: true } });
  for (const r of roles) {
    const toAdd = ROLE_MENUS[r.key] ?? [];
    for (const menuId of toAdd) {
      const exists = await prisma.roleMenu.findFirst({ where: { roleId: r.id, menuId } });
      if (!exists) {
        await prisma.roleMenu.create({ data: { roleId: r.id, menuId } });
        console.log(`  角色 ${r.key}(${r.id}) + ${menuId}`);
      }
    }
  }

  console.log('→ 完成');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
