/**
 * 为所有租户表启用并强制 PostgreSQL 行级安全（RLS）。
 *
 * 设计：
 *  - ENABLE + FORCE：即使是表 owner（Prisma 连接账号）也受策略约束。
 *  - 普通租户表：organization_id 必须等于事务 GUC app.current_org_id（缺失即拒绝，fail-closed）。
 *  - org_membership：额外放行“我自己”的成员关系（user_id = app.current_user_id）。
 *  - org_organization：放行当前组织，或“我所属的组织”。
 *  - sys_role：放行当前组织角色，或模板角色（organization_id IS NULL 且 app.role_templates=on）。
 *
 * 用法（在 db push、seed 之后执行）：npx ts-node --transpile-only scripts/enable-rls.ts
 * 幂等：先 DROP POLICY IF EXISTS 再重建。
 */
import { PrismaClient } from '@prisma/client';

import 'dotenv/config';

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL } },
});

// 标准租户表：仅按 organization_id 隔离
const STANDARD_TABLES = [
  'org_workspace',
  'org_collaboration_group',
  'org_group_member',
  'org_resource_grant',
  'sys_dept',
  'sys_post',
  'prj_project',
  'prj_task',
  'prj_file',
  'sys_notice',
];

// 计费表：组织隔离 + 定时任务维护上下文（受控、仅任务期间生效）
const BILLING_TABLES = [
  'bill_subscription',
  'bill_entitlement',
  'bill_billing_event',
];

const STANDARD_POLICY = `
    organization_id = NULLIF(current_setting('app.current_org_id', true), '')::text
`;

const BILLING_POLICY = `
    organization_id = NULLIF(current_setting('app.current_org_id', true), '')::text
    OR current_setting('app.billing_maintenance', true) = 'on'
`;

// 审计日志：组织隔离 + 维护任务写生命周期审计
const OPERLOG_POLICY = `
    organization_id = NULLIF(current_setting('app.current_org_id', true), '')::text
    OR current_setting('app.billing_maintenance', true) = 'on'
`;

// IM 表：组织隔离 + 会话成员资格。
// 注意：成员资格判断必须走 im_is_member()（SECURITY DEFINER，函数属主为超级用户，
// 内部查询绕过 RLS），否则策略子查询 im_conversation_member 会自引用导致 42P17 无限递归。
const IM_MEMBER_FN = `
  CREATE OR REPLACE FUNCTION im_is_member(conv_id text)
  RETURNS boolean
  LANGUAGE sql
  SECURITY DEFINER
  STABLE
  SET search_path = public
  AS $$
    SELECT EXISTS (
      SELECT 1 FROM im_conversation_member
      WHERE conversation_id = conv_id
        AND user_id = NULLIF(current_setting('app.current_user_id', true), '')::text
        AND status = 'ACTIVE'
    );
  $$;
`;

// 会话创建者判断：创建会话时初始成员行先于成员关系存在，
// WITH CHECK 必须放行"创建者为自己会话添加初始成员"，否则嵌套插入被 42501 拒绝。
const IM_CREATOR_FN = `
  CREATE OR REPLACE FUNCTION im_is_conversation_creator(conv_id text)
  RETURNS boolean
  LANGUAGE sql
  SECURITY DEFINER
  STABLE
  SET search_path = public
  AS $$
    SELECT EXISTS (
      SELECT 1 FROM im_conversation
      WHERE id = conv_id
        AND created_by_id = NULLIF(current_setting('app.current_user_id', true), '')::text
    );
  $$;
`;

const IM_CONVERSATION_POLICY = `
    organization_id = NULLIF(current_setting('app.current_org_id', true), '')::text
    AND (
      created_by_id = NULLIF(current_setting('app.current_user_id', true), '')::text
      OR im_is_member(id)
    )
`;

const IM_MEMBER_POLICY = `
    organization_id = NULLIF(current_setting('app.current_org_id', true), '')::text
    AND (
      user_id = NULLIF(current_setting('app.current_user_id', true), '')::text
      OR im_is_member(conversation_id)
      OR im_is_conversation_creator(conversation_id)
    )
`;

const IM_MESSAGE_POLICY = `
    organization_id = NULLIF(current_setting('app.current_org_id', true), '')::text
    AND im_is_member(conversation_id)
    OR current_setting('app.im_retention', true) = 'on'
`;

async function applyStandard(table: string, policy = STANDARD_POLICY) {
  await prisma.$executeRawUnsafe(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY`);
  await prisma.$executeRawUnsafe(`DROP POLICY IF EXISTS "${table}_tenant_iso" ON "${table}"`);
  await prisma.$executeRawUnsafe(`
    CREATE POLICY "${table}_tenant_iso" ON "${table}"
      USING (${policy})
      WITH CHECK (${policy})
  `);
}

async function main() {
  for (const t of STANDARD_TABLES) {
    await applyStandard(t);
    console.log(`RLS enforced: ${t}`);
  }
  for (const t of BILLING_TABLES) {
    await applyStandard(t, BILLING_POLICY);
    console.log(`RLS enforced: ${t}`);
  }
  await applyStandard('sys_oper_log', OPERLOG_POLICY);
  console.log('RLS enforced: sys_oper_log');

  // IM 表：组织隔离 + 会话成员资格（先建 SECURITY DEFINER 函数再建策略）
  await prisma.$executeRawUnsafe(IM_MEMBER_FN);
  console.log('function created: im_is_member(text)');
  await prisma.$executeRawUnsafe(IM_CREATOR_FN);
  console.log('function created: im_is_conversation_creator(text)');
  await applyStandard('im_conversation', IM_CONVERSATION_POLICY);
  console.log('RLS enforced: im_conversation');
  await applyStandard('im_conversation_member', IM_MEMBER_POLICY);
  console.log('RLS enforced: im_conversation_member');
  await applyStandard('im_message', IM_MESSAGE_POLICY);
  console.log('RLS enforced: im_message');
  await applyStandard('im_message_attachment', IM_MESSAGE_POLICY);
  console.log('RLS enforced: im_message_attachment');

  // 邀请：组织隔离 + 凭 token 哈希的受限查询（仅 SELECT）
  await prisma.$executeRawUnsafe(`ALTER TABLE org_invitation ENABLE ROW LEVEL SECURITY`);
  await prisma.$executeRawUnsafe(`ALTER TABLE org_invitation FORCE ROW LEVEL SECURITY`);
  await prisma.$executeRawUnsafe(`DROP POLICY IF EXISTS org_invitation_iso ON org_invitation`);
  await prisma.$executeRawUnsafe(`
    CREATE POLICY org_invitation_iso ON org_invitation
      USING (
        organization_id = NULLIF(current_setting('app.current_org_id', true), '')::text
        OR current_setting('app.invite_lookup', true) = 'on'
      )
      WITH CHECK (
        organization_id = NULLIF(current_setting('app.current_org_id', true), '')::text
      )
  `);
  console.log('RLS enforced: org_invitation');

  // 文件共享：组织隔离 + 凭 shareId 的受限查询（仅 SELECT）
  await prisma.$executeRawUnsafe(`ALTER TABLE prj_file_share ENABLE ROW LEVEL SECURITY`);
  await prisma.$executeRawUnsafe(`ALTER TABLE prj_file_share FORCE ROW LEVEL SECURITY`);
  await prisma.$executeRawUnsafe(`DROP POLICY IF EXISTS prj_file_share_iso ON prj_file_share`);
  await prisma.$executeRawUnsafe(`
    CREATE POLICY prj_file_share_iso ON prj_file_share
      USING (
        organization_id = NULLIF(current_setting('app.current_org_id', true), '')::text
        OR current_setting('app.file_share_lookup', true) = 'on'
      )
      WITH CHECK (
        organization_id = NULLIF(current_setting('app.current_org_id', true), '')::text
      )
  `);
  console.log('RLS enforced: prj_file_share');

  // 成员关系：组织隔离 + 本人可见
  await prisma.$executeRawUnsafe(`ALTER TABLE org_membership ENABLE ROW LEVEL SECURITY`);
  await prisma.$executeRawUnsafe(`ALTER TABLE org_membership FORCE ROW LEVEL SECURITY`);
  await prisma.$executeRawUnsafe(`DROP POLICY IF EXISTS org_membership_iso ON org_membership`);
  await prisma.$executeRawUnsafe(`
    CREATE POLICY org_membership_iso ON org_membership
      USING (
        organization_id = NULLIF(current_setting('app.current_org_id', true), '')::text
        OR user_id = NULLIF(current_setting('app.current_user_id', true), '')::text
      )
      WITH CHECK (
        organization_id = NULLIF(current_setting('app.current_org_id', true), '')::text
      )
  `);
  console.log('RLS enforced: org_membership');

  // 组织：当前组织 + 我所属的组织
  await prisma.$executeRawUnsafe(`ALTER TABLE org_organization ENABLE ROW LEVEL SECURITY`);
  await prisma.$executeRawUnsafe(`ALTER TABLE org_organization FORCE ROW LEVEL SECURITY`);
  await prisma.$executeRawUnsafe(`DROP POLICY IF EXISTS org_organization_iso ON org_organization`);
  await prisma.$executeRawUnsafe(`
    CREATE POLICY org_organization_iso ON org_organization
      USING (
        id = NULLIF(current_setting('app.current_org_id', true), '')::text
        OR current_setting('app.create_org', true) = 'on'
        OR current_setting('app.billing_maintenance', true) = 'on'
        OR id IN (
          SELECT organization_id FROM org_membership
          WHERE user_id = NULLIF(current_setting('app.current_user_id', true), '')::text
        )
      )
      WITH CHECK (
        id = NULLIF(current_setting('app.current_org_id', true), '')::text
        OR current_setting('app.create_org', true) = 'on'
        OR current_setting('app.billing_maintenance', true) = 'on'
      )
  `);
  console.log('RLS enforced: org_organization');

  // 角色：组织角色 + 模板角色 + 本人所属组织的角色（供 /users/me 跨组织读取）
  await prisma.$executeRawUnsafe(`ALTER TABLE sys_role ENABLE ROW LEVEL SECURITY`);
  await prisma.$executeRawUnsafe(`ALTER TABLE sys_role FORCE ROW LEVEL SECURITY`);
  await prisma.$executeRawUnsafe(`DROP POLICY IF EXISTS sys_role_iso ON sys_role`);
  await prisma.$executeRawUnsafe(`
    CREATE POLICY sys_role_iso ON sys_role
      USING (
        organization_id = NULLIF(current_setting('app.current_org_id', true), '')::text
        OR (
          organization_id IS NULL
          AND current_setting('app.role_templates', true) = 'on'
        )
        OR organization_id IN (
          SELECT organization_id FROM org_membership
          WHERE user_id = NULLIF(current_setting('app.current_user_id', true), '')::text
            AND status = 'ACTIVE'
        )
      )
      WITH CHECK (
        organization_id = NULLIF(current_setting('app.current_org_id', true), '')::text
      )
  `);
  console.log('RLS enforced: sys_role');

  // 邮箱验证凭证：仅本人；凭 token 校验时开放受限 SELECT
  await prisma.$executeRawUnsafe(
    `ALTER TABLE sys_email_verification_token ENABLE ROW LEVEL SECURITY`,
  );
  await prisma.$executeRawUnsafe(
    `ALTER TABLE sys_email_verification_token FORCE ROW LEVEL SECURITY`,
  );
  await prisma.$executeRawUnsafe(
    `DROP POLICY IF EXISTS sys_email_verification_token_iso ON sys_email_verification_token`,
  );
  await prisma.$executeRawUnsafe(`
    CREATE POLICY sys_email_verification_token_iso ON sys_email_verification_token
      USING (
        user_id = NULLIF(current_setting('app.current_user_id', true), '')::text
        OR current_setting('app.email_verify_lookup', true) = 'on'
      )
      WITH CHECK (
        user_id = NULLIF(current_setting('app.current_user_id', true), '')::text
      )
  `);
  console.log('RLS enforced: sys_email_verification_token');

  // 密码重置凭证：仅本人；凭 token 校验时开放受限 SELECT
  await prisma.$executeRawUnsafe(
    `ALTER TABLE sys_password_reset_token ENABLE ROW LEVEL SECURITY`,
  );
  await prisma.$executeRawUnsafe(
    `ALTER TABLE sys_password_reset_token FORCE ROW LEVEL SECURITY`,
  );
  await prisma.$executeRawUnsafe(
    `DROP POLICY IF EXISTS sys_password_reset_token_iso ON sys_password_reset_token`,
  );
  await prisma.$executeRawUnsafe(`
    CREATE POLICY sys_password_reset_token_iso ON sys_password_reset_token
      USING (
        user_id = NULLIF(current_setting('app.current_user_id', true), '')::text
        OR current_setting('app.password_reset_lookup', true) = 'on'
      )
      WITH CHECK (
        user_id = NULLIF(current_setting('app.current_user_id', true), '')::text
      )
  `);
  console.log('RLS enforced: sys_password_reset_token');

  /* ---------- 关联表：跟随主实体的可见性 ---------- */
  const joinPolicies: Array<[string, string]> = [
    // 成员-角色：当前组织成员关系，或本人的成员关系
    [
      'org_membership_role',
      `membership_id IN (
        SELECT id FROM org_membership
        WHERE organization_id = NULLIF(current_setting('app.current_org_id', true), '')::text
           OR user_id = NULLIF(current_setting('app.current_user_id', true), '')::text
      )`,
    ],
    // 成员-岗位：同上
    [
      'org_membership_post',
      `membership_id IN (
        SELECT id FROM org_membership
        WHERE organization_id = NULLIF(current_setting('app.current_org_id', true), '')::text
           OR user_id = NULLIF(current_setting('app.current_user_id', true), '')::text
      )`,
    ],
    // 角色-菜单 / 角色-部门：跟随角色（组织角色或模板角色）
    [
      'sys_role_menu',
      `role_id IN (
        SELECT id FROM sys_role
        WHERE organization_id = NULLIF(current_setting('app.current_org_id', true), '')::text
           OR (organization_id IS NULL AND current_setting('app.role_templates', true) = 'on')
      )`,
    ],
    [
      'sys_role_dept',
      `role_id IN (
        SELECT id FROM sys_role
        WHERE organization_id = NULLIF(current_setting('app.current_org_id', true), '')::text
           OR (organization_id IS NULL AND current_setting('app.role_templates', true) = 'on')
      )`,
    ],
    // 公告已读：组织上下文或本人记录
    [
      'sys_notice_read',
      `user_id = NULLIF(current_setting('app.current_user_id', true), '')::text
       OR notice_id IN (
         SELECT id FROM sys_notice
         WHERE organization_id = NULLIF(current_setting('app.current_org_id', true), '')::text
       )`,
    ],
    // OAuth 账号：仅本人
    [
      'sys_user_oauth',
      `user_id = NULLIF(current_setting('app.current_user_id', true), '')::text`,
    ],
  ];

  for (const [table, expr] of joinPolicies) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`);
    await prisma.$executeRawUnsafe(`ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY`);
    await prisma.$executeRawUnsafe(`DROP POLICY IF EXISTS "${table}_iso" ON "${table}"`);
    await prisma.$executeRawUnsafe(`
      CREATE POLICY "${table}_iso" ON "${table}"
        USING (${expr})
        WITH CHECK (${expr})
    `);
    console.log(`RLS enforced: ${table}`);
  }

  console.log('\nAll tenant tables are now protected by RLS.');
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
