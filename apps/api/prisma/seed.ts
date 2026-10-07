/**
 * TeamSpace 合成数据种子。
 * 顺序：prisma db push → 本脚本（此时 RLS 尚未启用）→ scripts/enable-rls.ts
 *
 * 内容：
 *  - 全局菜单模板（DIR/MENU/BUTTON + perms）
 *  - 模板角色 OWNER/ADMIN/MEMBER/GUEST/FINANCE（organizationId=null）
 *  - 套餐 FREE/PRO/ENTERPRISE、字典、参数
 *  - 两组织、两工作区、成员/部门/岗位/项目/任务/文件/共享/邀请
 */
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { createHash } from 'crypto';
import { mkdirSync, writeFileSync } from 'fs';
import * as path from 'path';
import { ProvisioningService } from '../src/modules/provisioning/provisioning.service';

import 'dotenv/config';

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL } },
});
const provisioning = new ProvisioningService();
const PASSWORD = 'Passw0rd!';
const UPLOAD_ROOT = path.resolve(process.cwd(), '.uploads');

// ==================== 菜单模板 ====================
type MenuSeed = {
  id: string;
  parentId: string | null;
  name: string;
  type: 'DIR' | 'MENU' | 'BUTTON';
  orderNum: number;
  path?: string;
  perms?: string;
  icon?: string;
};

const MENUS: MenuSeed[] = [
  { id: 'dir_dashboard', parentId: null, name: '仪表盘', type: 'DIR', orderNum: 1, path: '/dashboard', icon: 'LayoutDashboard' },
  { id: 'menu_dashboard', parentId: 'dir_dashboard', name: '工作台', type: 'MENU', orderNum: 1, path: '', perms: 'dashboard:view' },

  { id: 'dir_collab', parentId: null, name: '项目协同', type: 'DIR', orderNum: 2, path: '/collab', icon: 'FolderKanban' },
  { id: 'menu_workspaces', parentId: 'dir_collab', name: '工作区', type: 'MENU', orderNum: 1, path: '/workspaces', perms: 'workspace:list' },
  { id: 'btn_ws_add', parentId: 'menu_workspaces', name: '工作区新增', type: 'BUTTON', orderNum: 1, perms: 'workspace:add' },
  { id: 'btn_ws_edit', parentId: 'menu_workspaces', name: '工作区编辑', type: 'BUTTON', orderNum: 2, perms: 'workspace:edit' },
  { id: 'btn_ws_remove', parentId: 'menu_workspaces', name: '工作区删除', type: 'BUTTON', orderNum: 3, perms: 'workspace:remove' },
  { id: 'menu_projects', parentId: 'dir_collab', name: '项目', type: 'MENU', orderNum: 2, path: '/projects', perms: 'project:list' },
  { id: 'btn_pj_query', parentId: 'menu_projects', name: '项目详情', type: 'BUTTON', orderNum: 1, perms: 'project:query' },
  { id: 'btn_pj_add', parentId: 'menu_projects', name: '项目新增', type: 'BUTTON', orderNum: 2, perms: 'project:add' },
  { id: 'btn_pj_edit', parentId: 'menu_projects', name: '项目编辑', type: 'BUTTON', orderNum: 3, perms: 'project:edit' },
  { id: 'btn_pj_remove', parentId: 'menu_projects', name: '项目删除', type: 'BUTTON', orderNum: 4, perms: 'project:remove' },
  { id: 'btn_pj_deliver', parentId: 'menu_projects', name: '项目交付', type: 'BUTTON', orderNum: 5, perms: 'project:deliver' },
  { id: 'menu_tasks', parentId: 'dir_collab', name: '任务', type: 'MENU', orderNum: 3, path: '/tasks', perms: 'task:manage' },
  { id: 'menu_files', parentId: 'dir_collab', name: '文件', type: 'MENU', orderNum: 4, path: '/files', perms: 'file:manage' },
  { id: 'btn_file_share', parentId: 'menu_files', name: '文件共享', type: 'BUTTON', orderNum: 1, perms: 'file:share' },

  { id: 'dir_org', parentId: null, name: '组织管理', type: 'DIR', orderNum: 3, path: '/org', icon: 'Users' },
  { id: 'menu_members', parentId: 'dir_org', name: '成员', type: 'MENU', orderNum: 1, path: '/members', perms: 'member:list' },
  { id: 'btn_member_edit', parentId: 'menu_members', name: '成员编辑', type: 'BUTTON', orderNum: 1, perms: 'member:edit' },
  { id: 'btn_member_role', parentId: 'menu_members', name: '分配角色', type: 'BUTTON', orderNum: 2, perms: 'member:assign-role' },
  { id: 'btn_member_suspend', parentId: 'menu_members', name: '停用成员', type: 'BUTTON', orderNum: 3, perms: 'member:suspend' },
  { id: 'btn_member_remove', parentId: 'menu_members', name: '移除成员', type: 'BUTTON', orderNum: 4, perms: 'member:remove' },
  { id: 'menu_invitations', parentId: 'dir_org', name: '邀请', type: 'MENU', orderNum: 2, path: '/invitations', perms: 'invite:list' },
  { id: 'btn_invite_create', parentId: 'menu_invitations', name: '发起邀请', type: 'BUTTON', orderNum: 1, perms: 'invite:send' },
  { id: 'btn_invite_revoke', parentId: 'menu_invitations', name: '撤销邀请', type: 'BUTTON', orderNum: 2, perms: 'invite:revoke' },
  { id: 'menu_depts', parentId: 'dir_org', name: '部门', type: 'MENU', orderNum: 3, path: '/depts', perms: 'dept:manage' },
  { id: 'menu_posts', parentId: 'dir_org', name: '岗位', type: 'MENU', orderNum: 4, path: '/posts', perms: 'post:manage' },
  { id: 'menu_roles', parentId: 'dir_org', name: '角色', type: 'MENU', orderNum: 5, path: '/roles', perms: 'role:list' },
  { id: 'btn_role_add', parentId: 'menu_roles', name: '角色新增', type: 'BUTTON', orderNum: 1, perms: 'role:add' },
  { id: 'btn_role_edit', parentId: 'menu_roles', name: '角色编辑', type: 'BUTTON', orderNum: 2, perms: 'role:edit' },
  { id: 'btn_role_remove', parentId: 'menu_roles', name: '角色删除', type: 'BUTTON', orderNum: 3, perms: 'role:remove' },
  { id: 'btn_role_assign', parentId: 'menu_roles', name: '角色授权', type: 'BUTTON', orderNum: 4, perms: 'role:assign-menu' },

  { id: 'dir_system', parentId: null, name: '系统管理', type: 'DIR', orderNum: 4, path: '/system', icon: 'Settings' },
  { id: 'menu_notices', parentId: 'dir_system', name: '通知公告', type: 'MENU', orderNum: 1, path: '/notices', perms: 'notice:list' },
  { id: 'btn_notice_add', parentId: 'menu_notices', name: '公告发布', type: 'BUTTON', orderNum: 1, perms: 'notice:add' },
  { id: 'btn_notice_edit', parentId: 'menu_notices', name: '公告编辑', type: 'BUTTON', orderNum: 2, perms: 'notice:edit' },
  { id: 'btn_notice_remove', parentId: 'menu_notices', name: '公告删除', type: 'BUTTON', orderNum: 3, perms: 'notice:remove' },
  { id: 'menu_audit', parentId: 'dir_system', name: '审计日志', type: 'MENU', orderNum: 2, path: '/audit', perms: 'audit:list' },
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

  { id: 'dir_billing', parentId: null, name: '计费中心', type: 'DIR', orderNum: 5, path: '/billing', icon: 'CreditCard' },
  { id: 'menu_billing_overview', parentId: 'dir_billing', name: '套餐总览', type: 'MENU', orderNum: 1, path: '/overview', perms: 'billing:view' },
  { id: 'btn_billing_change', parentId: 'menu_billing_overview', name: '变更套餐', type: 'BUTTON', orderNum: 1, perms: 'billing:change' },
  { id: 'menu_billing_events', parentId: 'dir_billing', name: '计费事件', type: 'MENU', orderNum: 2, path: '/events', perms: 'billing:manage' },

  { id: 'dir_im', parentId: null, name: '即时通讯', type: 'DIR', orderNum: 6, path: '/im', icon: 'MessageSquare' },
  { id: 'menu_im', parentId: 'dir_im', name: '消息', type: 'MENU', orderNum: 1, path: '', perms: 'im:view' },
  { id: 'btn_im_use', parentId: 'menu_im', name: '发送消息', type: 'BUTTON', orderNum: 1, perms: 'im:use' },
  { id: 'btn_im_group_create', parentId: 'menu_im', name: '创建群聊', type: 'BUTTON', orderNum: 2, perms: 'im:group:create' },
  { id: 'btn_im_attachment_upload', parentId: 'menu_im', name: '上传附件', type: 'BUTTON', orderNum: 3, perms: 'im:attachment:upload' },
];

// ==================== 模板角色 ====================
const ALL_MENU_IDS = MENUS.map((m) => m.id);

type RoleSeed = {
  key: string;
  name: string;
  sort: number;
  dataScope: 'ALL' | 'CUSTOM' | 'DEPT' | 'DEPT_AND_CHILD' | 'SELF';
  menuIds: string[];
  remark: string;
};

const ROLES: RoleSeed[] = [
  {
    key: 'OWNER',
    name: '组织拥有者',
    sort: 1,
    dataScope: 'ALL',
    menuIds: ALL_MENU_IDS,
    remark: '不可删除的保留角色，拥有全部权限',
  },
  {
    key: 'ADMIN',
    name: '组织管理员',
    sort: 2,
    dataScope: 'ALL',
    menuIds: ALL_MENU_IDS.filter(
      (id) => id !== 'menu_billing_events' && id !== 'btn_billing_change',
    ),
    remark: '管理组织与项目，不管理资金',
  },
  {
    key: 'MEMBER',
    name: '普通成员',
    sort: 3,
    dataScope: 'DEPT_AND_CHILD',
    menuIds: [
      'dir_dashboard', 'menu_dashboard',
      'dir_collab', 'menu_workspaces', 'menu_projects', 'btn_pj_query', 'btn_pj_add', 'btn_pj_edit',
      'menu_tasks', 'menu_files', 'btn_file_share',
      'dir_org', 'menu_members',
      'dir_system', 'menu_notices',
      'dir_im', 'menu_im', 'btn_im_use', 'btn_im_group_create', 'btn_im_attachment_upload',
    ],
    remark: '参与项目交付',
  },
  {
    key: 'GUEST',
    name: '访客',
    sort: 4,
    dataScope: 'SELF',
    menuIds: [
      'dir_dashboard', 'menu_dashboard',
      'dir_collab', 'menu_workspaces', 'menu_projects', 'btn_pj_query',
      'dir_org', 'menu_members',
      'dir_im', 'menu_im', 'btn_im_use',
    ],
    remark: '只读浏览',
  },
  {
    key: 'FINANCE',
    name: '财务',
    sort: 5,
    dataScope: 'ALL',
    menuIds: [
      'dir_dashboard', 'menu_dashboard',
      'dir_system', 'menu_notices', 'menu_audit',
      'dir_billing', 'menu_billing_overview', 'btn_billing_change', 'menu_billing_events',
    ],
    remark: '管理套餐与计费',
  },
];

async function main() {
  console.log('→ 清空全部业务表 ...');
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      sys_user_oauth, org_membership_role, org_membership_post, org_membership,
      sys_role_menu, sys_role_dept, sys_role, sys_menu, sys_dept, sys_post,
      org_invitation, prj_task, prj_file_share, prj_file, prj_project,
      org_workspace, bill_billing_event, bill_subscription, bill_entitlement,
      bill_plan, org_organization, sys_dict_data, sys_dict_type, sys_config,
      sys_notice_read, sys_notice, sys_oper_log, sys_login_log, sys_outbox, sys_user
    RESTART IDENTITY CASCADE
  `);

  console.log('→ 写入全局菜单模板 ...');
  await prisma.menu.createMany({
    data: MENUS.map((m) => ({
      id: m.id,
      parentId: m.parentId,
      name: m.name,
      type: m.type,
      orderNum: m.orderNum,
      path: m.path ?? null,
      perms: m.perms ?? null,
      icon: m.icon ?? '#',
    })),
  });

  console.log('→ 写入模板角色 ...');
  for (const r of ROLES) {
    await prisma.role.create({
      data: {
        organizationId: null,
        name: r.name,
        key: r.key,
        sort: r.sort,
        dataScope: r.dataScope,
        status: 'NORMAL',
        remark: r.remark,
        menus: { create: r.menuIds.map((menuId) => ({ menuId })) },
      },
    });
  }

  console.log('→ 写入套餐 ...');
  await prisma.plan.createMany({
    data: [
      {
        code: 'FREE',
        name: '免费版',
        priceMonthly: '0',
        priceYearly: '0',
        seatsIncluded: 5,
        aiCredits: 100000,
        maxProjects: 3,
        storageGb: 1,
        features: {
          seats: '最多 5 人',
          aiCredits: 'AI 助手 10 万 token/月',
          projects: '最多 3 个项目',
          sso: false,
          auditRetention: '7 天',
          support: '社区支持',
        },
      },
      {
        code: 'PRO',
        name: '专业版',
        priceMonthly: '99.00',
        priceYearly: '999.00',
        seatsIncluded: 20,
        aiCredits: 2000000,
        maxProjects: 50,
        storageGb: 50,
        features: {
          seats: '最多 20 人',
          aiCredits: 'AI 助手 200 万 token/月',
          projects: '最多 50 个项目',
          sso: true,
          auditRetention: '90 天',
          support: '工单支持',
        },
      },
      {
        code: 'ENTERPRISE',
        name: '企业版',
        priceMonthly: '2999.00',
        priceYearly: '29999.00',
        seatsIncluded: 200,
        aiCredits: 20000000,
        maxProjects: 1000,
        storageGb: 1000,
        features: {
          seats: '最多 200 人（可扩）',
          aiCredits: 'AI 助手 2000 万 token/月',
          projects: '最多 1000 个项目',
          sso: true,
          auditRetention: '365 天',
          support: '专属客户成功',
          sla: '99.9%',
        },
      },
    ],
  });

  console.log('→ 写入字典 / 参数 ...');
  await prisma.dictType.createMany({
    data: [
      { name: '用户性别', type: 'sys_user_sex' },
      { name: '菜单状态', type: 'sys_normal_disable' },
      { name: '成员状态', type: 'sys_member_status' },
    ],
  });
  await prisma.dictData.createMany({
    data: [
      { sort: 1, label: '男', value: 'm', dictType: 'sys_user_sex', isDefault: 'YES' },
      { sort: 2, label: '女', value: 'f', dictType: 'sys_user_sex' },
      { sort: 3, label: '未知', value: 'n', dictType: 'sys_user_sex' },
      { sort: 1, label: '正常', value: 'NORMAL', dictType: 'sys_normal_disable', listClass: 'success', isDefault: 'YES' },
      { sort: 2, label: '停用', value: 'DISABLED', dictType: 'sys_normal_disable', listClass: 'danger' },
      { sort: 1, label: '正常', value: 'ACTIVE', dictType: 'sys_member_status', listClass: 'success', isDefault: 'YES' },
      { sort: 2, label: '停用', value: 'SUSPENDED', dictType: 'sys_member_status', listClass: 'warning' },
      { sort: 3, label: '移除', value: 'REMOVED', dictType: 'sys_member_status', listClass: 'danger' },
    ],
  });
  await prisma.config.createMany({
    data: [
      { name: '初始密码', key: 'user.initPassword', value: '123456', configType: 'YES' },
      { name: '自助注册', key: 'sys.account.registerUser', value: 'true', configType: 'YES' },
      { name: '邮箱验证', key: 'sys.account.emailVerify', value: 'false', configType: 'YES' },
    ],
  });

  console.log('→ 写入用户 ...');
  const hash = await bcrypt.hash(PASSWORD, 10);
  const users = await Promise.all(
    [
      { email: 'owner@acme.dev', name: '陈知微' },
      { email: 'admin@acme.dev', name: '柯博文' },
      { email: 'member@acme.dev', name: '陆小鹿' },
      { email: 'owner@globex.dev', name: '高行远' },
      { email: 'member@globex.dev', name: '夏知秋' },
      { email: 'chenhynju@gmail.com', name: '平台超管', isPlatformAdmin: true },
    ].map((u) =>
      prisma.user.create({
        data: {
          email: u.email,
          name: u.name,
          passwordHash: hash,
          emailVerifiedAt: new Date(),
          isPlatformAdmin: u.isPlatformAdmin ?? false,
        },
      }),
    ),
  );
  const [acmeOwner, acmeAdmin, acmeMember, globexOwner, globexMember, platformAdmin] = users;

  console.log('→ 写入两组织 / 两工作区 / 成员 / 项目 ...');
  await prisma.$transaction(async (tx) => {
    // ---------- Acme ----------
    const acme = await tx.organization.create({
      data: { name: 'Acme 智造', slug: 'acme', status: 'ACTIVE' },
    });
    const acmeRoles = await provisioning.cloneTemplateRoles(tx, acme.id);
    const acmeRoot = await provisioning.createRootDept(tx, acme.id, 'Acme 智造', acmeOwner.id);
    const acmeRd = await tx.dept.create({
      data: {
        organizationId: acme.id,
        parentId: acmeRoot.id,
        ancestors: `,${acmeRoot.id},`,
        name: '产品研发部',
        orderNum: 1,
        leader: acmeAdmin.id,
        status: 'NORMAL',
      },
    });
    const [postCeo, postEng, postPm] = await Promise.all(
      [
        { code: 'ceo', name: 'CEO', sort: 1 },
        { code: 'engineer', name: '研发工程师', sort: 2 },
        { code: 'pm', name: '产品经理', sort: 3 },
      ].map((p) =>
        tx.post.create({
          data: { organizationId: acme.id, code: p.code, name: p.name, sort: p.sort },
        }),
      ),
    );
    const acmeWs = await tx.workspace.create({
      data: { organizationId: acme.id, name: '默认工作区', description: 'Acme 主工作区' },
    });

    const memberRows = [
      { user: acmeOwner, deptId: acmeRoot.id, roles: ['OWNER'], postId: postCeo.id },
      { user: acmeAdmin, deptId: acmeRd.id, roles: ['ADMIN'], postId: postPm.id },
      { user: acmeMember, deptId: acmeRd.id, roles: ['MEMBER'], postId: postEng.id },
    ];
    for (const m of memberRows) {
      const ms = await tx.membership.create({
        data: { organizationId: acme.id, userId: m.user.id, deptId: m.deptId, status: 'ACTIVE' },
      });
      await tx.membershipRole.createMany({
        data: m.roles.map((key) => ({ membershipId: ms.id, roleId: acmeRoles.get(key)! })),
      });
      await tx.membershipPost.create({
        data: { membershipId: ms.id, postId: m.postId },
      });
    }

    await provisioning.applyPlan(tx, acme.id, 'FREE', 3);

    const acmeProject = await tx.project.create({
      data: {
        organizationId: acme.id,
        workspaceId: acmeWs.id,
        ownerId: acmeOwner.id,
        name: '官网 3.0 改版',
        description: '品牌升级与官网重构',
        status: 'ACTIVE',
      },
    });
    await tx.task.createMany({
      data: [
        {
          organizationId: acme.id,
          projectId: acmeProject.id,
          title: '梳理信息架构',
          assigneeId: acmeMember.id,
          status: 'DONE',
          priority: 1,
        },
        {
          organizationId: acme.id,
          projectId: acmeProject.id,
          title: '视觉稿设计',
          assigneeId: acmeMember.id,
          status: 'IN_PROGRESS',
          priority: 2,
        },
        {
          organizationId: acme.id,
          projectId: acmeProject.id,
          title: '前端页面开发',
          status: 'TODO',
          priority: 2,
        },
      ],
    });

    // 文件（物理写入 .uploads）+ 共享链接（AT03）
    const fileContent = Buffer.from(
      'TeamSpace 交付物示例\n官网 3.0 改版 · 需求说明\n1. 品牌升级\n2. 信息架构重构\n3. 性能优化目标 LCP<2s\n',
      'utf-8',
    );
    const objectKey = `${acme.id}/${acmeProject.id}/seed-requirements`;
    const absPath = path.join(UPLOAD_ROOT, objectKey);
    mkdirSync(path.dirname(absPath), { recursive: true });
    writeFileSync(absPath, fileContent);
    const acmeFile = await tx.file.create({
      data: {
        organizationId: acme.id,
        projectId: acmeProject.id,
        name: '需求说明.txt',
        objectKey,
        size: BigInt(fileContent.length),
        mimeType: 'text/plain; charset=utf-8',
        version: 1,
        uploadedById: acmeOwner.id,
      },
    });
    await tx.fileShare.create({
      data: {
        id: 'share_demo_req',
        organizationId: acme.id,
        fileId: acmeFile.id,
        expiresAt: null,
      },
    });
    await tx.fileShare.create({
      data: {
        id: 'share_demo_expired',
        organizationId: acme.id,
        fileId: acmeFile.id,
        expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
      },
    });

    // 邀请：待接受 / 已过期 / 已撤销（AT02）
    const invites: Array<{
      email: string;
      roleKey: string;
      rawToken: string;
      status: 'PENDING' | 'REVOKED';
      expiresAt: Date;
    }> = [
      {
        email: 'newhire@acme.dev',
        roleKey: 'MEMBER',
        rawToken: 'raw-token-newhire-pending-0001',
        status: 'PENDING',
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
      {
        email: 'late@acme.dev',
        roleKey: 'MEMBER',
        rawToken: 'raw-token-late-expired-0002',
        status: 'PENDING',
        expiresAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
      },
      {
        email: 'revoked@acme.dev',
        roleKey: 'GUEST',
        rawToken: 'raw-token-revoked-0003',
        status: 'REVOKED',
        expiresAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
      },
    ];
    for (const inv of invites) {
      await tx.invitation.create({
        data: {
          organizationId: acme.id,
          email: inv.email,
          roleId: acmeRoles.get(inv.roleKey)!,
          tokenHash: createHash('sha256').update(inv.rawToken).digest('hex'),
          expiresAt: inv.expiresAt,
          status: inv.status,
          invitedById: acmeOwner.id,
        },
      });
    }

    await tx.notice.create({
      data: {
        organizationId: acme.id,
        title: '欢迎使用 TeamSpace',
        type: 'NOTICE',
        content: '这里是 Acme 智造的协作空间，从工作区开始管理项目交付。',
      },
    });

    // ---------- Globex ----------
    const globex = await tx.organization.create({
      data: { name: 'Globex 环球', slug: 'globex', status: 'ACTIVE' },
    });
    const globexRoles = await provisioning.cloneTemplateRoles(tx, globex.id);
    const globexRoot = await provisioning.createRootDept(tx, globex.id, 'Globex 环球', globexOwner.id);
    const globexWs = await tx.workspace.create({
      data: { organizationId: globex.id, name: '默认工作区', description: 'Globex 主工作区' },
    });
    for (const [user, key] of [
      [globexOwner, 'OWNER'],
      [globexMember, 'MEMBER'],
    ] as const) {
      const ms = await tx.membership.create({
        data: { organizationId: globex.id, userId: user.id, deptId: globexRoot.id, status: 'ACTIVE' },
      });
      await tx.membershipRole.create({
        data: { membershipId: ms.id, roleId: globexRoles.get(key)! },
      });
    }
    await provisioning.applyPlan(tx, globex.id, 'FREE', 2);
    await tx.project.create({
      data: {
        organizationId: globex.id,
        workspaceId: globexWs.id,
        ownerId: globexOwner.id,
        name: '数据中台一期',
        description: 'Globex 内部数据平台建设',
        status: 'ACTIVE',
      },
    });

    // ---------- 平台超管自有组织（不参与两租户演示口径） ----------
    const platform = await tx.organization.create({
      data: { name: '平台运营空间', slug: 'platform', status: 'ACTIVE' },
    });
    const platformRoles = await provisioning.cloneTemplateRoles(tx, platform.id);
    const platformRoot = await provisioning.createRootDept(
      tx,
      platform.id,
      '平台运营空间',
      platformAdmin.id,
    );
    const platformWs = await tx.workspace.create({
      data: { organizationId: platform.id, name: '默认工作区' },
    });
    const platformMs = await tx.membership.create({
      data: {
        organizationId: platform.id,
        userId: platformAdmin.id,
        deptId: platformRoot.id,
        status: 'ACTIVE',
      },
    });
    await tx.membershipRole.create({
      data: { membershipId: platformMs.id, roleId: platformRoles.get('OWNER')! },
    });
    await provisioning.applyPlan(tx, platform.id, 'PRO', 10);
    await tx.project.create({
      data: {
        organizationId: platform.id,
        workspaceId: platformWs.id,
        ownerId: platformAdmin.id,
        name: '平台运营工作台',
        status: 'ACTIVE',
      },
    });
  });

  console.log('\n✅ seed 完成');
  console.log('────────────────────────────────────────────');
  console.log('账号（密码均为', PASSWORD, '）:');
  console.log('  Acme   owner@acme.dev / admin@acme.dev / member@acme.dev');
  console.log('  Globex owner@globex.dev / member@globex.dev');
  console.log('  平台超管 chenhynju@gmail.com');
  console.log('文件共享链接（AT03）:');
  console.log('  有效: /api/v1/files/shared/share_demo_req/download');
  console.log('  过期: /api/v1/files/shared/share_demo_expired/download');
  console.log('邀请原始 token（AT02，accept 时提交）:');
  console.log('  待接受: raw-token-newhire-pending-0001  (newhire@acme.dev)');
  console.log('  已过期: raw-token-late-expired-0002     (late@acme.dev)');
  console.log('  已撤销: raw-token-revoked-0003           (revoked@acme.dev)');
  console.log('────────────────────────────────────────────');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
