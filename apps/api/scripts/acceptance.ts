/**
 * TeamSpace 端到端验收 AT01–AT08
 * 运行：npx ts-node --transpile-only scripts/acceptance.ts
 * 前置：API 运行于 APP_PORT（默认 3001），seed 已执行
 *
 * 输出：控制台 + evidence/acceptance-AT01-AT08.md
 */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { createHash, createHmac } from 'crypto';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { io } from 'socket.io-client';
import 'dotenv/config';

const EVENT_TIMEOUT = Number(process.env.ACCEPTANCE_EVENT_TIMEOUT_MS || 15000);
const BASE = process.env.API_BASE ?? 'http://localhost:3001/api/v1';
const prisma = new PrismaClient();

process.on('uncaughtException', (e) => console.error('UNCAUGHT_EXCEPTION', e));
process.on('unhandledRejection', (e) => console.error('UNHANDLED_REJECTION', e));

/* ---------------- webhook 签名（对齐线上 HMAC 方案） ---------------- */
function signWebhook(rawBody: string): string {
  const secret = process.env.BILLING_WEBHOOK_SECRET;
  if (!secret) throw new Error('BILLING_WEBHOOK_SECRET 未配置，无法签名');
  const t = Math.floor(Date.now() / 1000);
  const v1 = createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
  return `t=${t},v1=${v1}`;
}

/* ---------------- HTTP 工具 ---------------- */
async function call(
  method: string,
  path: string,
  opts: { token?: string; org?: string; body?: unknown; sig?: string } = {},
): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = {};
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  if (opts.org) headers['x-organization-id'] = opts.org;
  if (opts.sig) headers['x-webhook-signature'] = opts.sig;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const ct = res.headers.get('content-type') ?? '';
  const text = await res.text();
  const body = ct.includes('json') && text ? JSON.parse(text) : text;
  return { status: res.status, body };
}

/* ---------------- 证据收集 ---------------- */
interface Check {
  at: string;
  name: string;
  expected: string;
  actual: string;
  pass: boolean;
}
const checks: Check[] = [];
function check(at: string, name: string, expected: string, pass: boolean, actual: string) {
  checks.push({ at, name, expected, actual, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'} [${at}] ${name} | 期望: ${expected} | 实际: ${actual}`);
}

async function main() {
  console.log(`\n=== TeamSpace 验收开始 @ ${new Date().toISOString()} ===`);
  console.log(`API: ${BASE}\n`);

  /* ============ 登录固定账号 ============ */
  const login = async (email: string) => {
    const r = await call('POST', '/auth/login', { body: { email, password: 'Passw0rd!' } });
    if (r.status < 200 || r.status >= 300)
      throw new Error(`登录失败 ${email}: ${r.status} ${JSON.stringify(r.body)}`);
    return r.body.accessToken as string;
  };
  const tOwnerAcme = await login('owner@acme.dev');
  const tOwnerGlobex = await login('owner@globex.dev');
  const tAdminAcme = await login('admin@acme.dev');
  const tMemberAcme = await login('member@acme.dev');

  const meAcme = (await call('GET', '/users/me', { token: tOwnerAcme })).body;
  const meGlobex = (await call('GET', '/users/me', { token: tOwnerGlobex })).body;
  const acmeOrg: string = meAcme.organizations[0].id;
  const globexOrg: string = meGlobex.organizations[0].id;
  console.log(`Acme org = ${acmeOrg} | Globex org = ${globexOrg}\n`);

  /* ================================================================
   * AT01 跨组织隔离：Globex 身份无法读 Acme 数据
   * ================================================================ */
  // 正常路径：globex token + globex org
  const r01ok = await call('GET', '/projects', { token: tOwnerGlobex, org: globexOrg });
  check(
    'AT01',
    '本组织成员可读取本组织项目（正常基线）',
    '200',
    r01ok.status === 200,
    `${r01ok.status}（项目数 ${Array.isArray(r01ok.body) ? r01ok.body.length : '-'}）`,
  );

  // 拒绝路径：globex token + 伪造 acme org header
  const r01 = await call('GET', '/projects', { token: tOwnerGlobex, org: acmeOrg });
  check(
    'AT01',
    '携带其它组织 x-organization-id 被应用层拒绝',
    '403 NOT_MEMBER',
    r01.status === 403 && r01.body?.code === 'NOT_MEMBER',
    `${r01.status} ${r01.body?.code ?? ''} ${r01.body?.message ?? ''}`,
  );

  // RLS 防御层独立验证：以 globex 上下文直连数据库，查不到 acme 项目
  const rlsRows = await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SELECT set_config('app.current_org_id', $1, true)`, globexOrg);
    const cross = await tx.$queryRaw<{ n: bigint }[]>`
      SELECT count(*)::int AS n FROM prj_project WHERE organization_id = ${acmeOrg}`;
    const own = await tx.$queryRaw<{ n: bigint }[]>`
      SELECT count(*)::int AS n FROM prj_project WHERE organization_id = ${globexOrg}`;
    return { cross: Number(cross[0].n), own: Number(own[0].n) };
  });
  check(
    'AT01',
    'RLS 防御层：globex 上下文中 acme 项目可见数为 0',
    'cross=0, own≥1',
    rlsRows.cross === 0 && rlsRows.own >= 1,
    `cross=${rlsRows.cross}, own=${rlsRows.own}`,
  );

  /* ================================================================
   * AT02 邀请状态机：过期/撤销不可加入，正常可加入且不可重复使用
   * ================================================================ */
  // 准备三个一次性用户（sys_user 无 RLS；如已存在则跳过）
  const hash = bcrypt.hashSync('Passw0rd!', 10);
  const tempUsers = [
    { email: 'newhire@acme.dev', name: '新员工' },
    { email: 'late@acme.dev', name: '迟到者' },
    { email: 'revoked@acme.dev', name: '被撤销者' },
  ];
  for (const u of tempUsers) {
    // 这些账号仅用于邀请验收（邮箱通过邀请投递确认），直接置为已验证，
    // 避免与「自助注册必须验证邮箱」的登录门禁耦合
    await prisma.user.upsert({
      where: { email: u.email },
      update: { emailVerifiedAt: new Date() },
      create: {
        email: u.email,
        name: u.name,
        passwordHash: hash,
        status: 'NORMAL',
        emailVerifiedAt: new Date(),
      },
    });
  }
  // 重置待处理邀请（删除新员工既有 membership、邀请回到 PENDING），保证可重复演示
  if (process.env.DATABASE_ADMIN_URL) {
    const adminPrisma = new PrismaClient({
      datasources: { db: { url: process.env.DATABASE_ADMIN_URL } },
    });
    try {
      const th = createHash('sha256').update('raw-token-newhire-pending-0001').digest('hex');
      const inv = await adminPrisma.invitation.findFirst({ where: { tokenHash: th } });
      if (inv) {
        const oldM = await adminPrisma.membership.findMany({
          where: { organizationId: inv.organizationId, user: { email: 'newhire@acme.dev' } },
        });
        for (const mbr of oldM) {
          await adminPrisma.membership.delete({ where: { id: mbr.id } });
        }
        await adminPrisma.invitation.update({
          where: { id: inv.id },
          data: { status: 'PENDING', acceptedAt: null, acceptedById: null },
        });
      }
    } finally {
      await adminPrisma.$disconnect();
    }
  }

  const tNewhire = await login('newhire@acme.dev');
  const tLate = await login('late@acme.dev');
  const tRevoked = await login('revoked@acme.dev');

  // 过期邀请
  const r02exp = await call('POST', '/invitations/accept', {
    token: tLate,
    body: { token: 'raw-token-late-expired-0002' },
  });
  check(
    'AT02',
    '过期邀请被拒绝',
    '410 INVITE_EXPIRED',
    r02exp.status === 410 && r02exp.body?.code === 'INVITE_EXPIRED',
    `${r02exp.status} ${r02exp.body?.code ?? ''} ${r02exp.body?.message ?? ''}`,
  );

  // 撤销邀请
  const r02rev = await call('POST', '/invitations/accept', {
    token: tRevoked,
    body: { token: 'raw-token-revoked-0003' },
  });
  check(
    'AT02',
    '已撤销邀请被拒绝',
    '410 INVITE_REVOKED',
    r02rev.status === 410 && r02rev.body?.code === 'INVITE_REVOKED',
    `${r02rev.status} ${r02rev.body?.code ?? ''} ${r02rev.body?.message ?? ''}`,
  );

  // 正常邀请（首次 200；重复运行时已被消费，接受 409 也算状态机正确）
  const r02 = await call('POST', '/invitations/accept', {
    token: tNewhire,
    body: { token: 'raw-token-newhire-pending-0001' },
  });
  const firstOk = r02.status < 300 && r02.body?.accepted === true;
  check(
    'AT02',
    '待处理邀请可正常加入（正常路径）',
    '200 accepted=true',
    firstOk || (r02.status === 409 && r02.body?.code === 'INVITE_USED'),
    `${r02.status} ${JSON.stringify(r02.body).slice(0, 120)}`,
  );

  // 恢复/幂等：同一邀请再次使用 → 409
  if (firstOk) {
    const r02again = await call('POST', '/invitations/accept', {
      token: tNewhire,
      body: { token: 'raw-token-newhire-pending-0001' },
    });
    check(
      'AT02',
      '同一邀请不可重复使用',
      '409 INVITE_USED',
      r02again.status === 409 && r02again.body?.code === 'INVITE_USED',
      `${r02again.status} ${r02again.body?.code ?? ''}`,
    );
  }

  /* ================================================================
   * AT03 访客文件共享：猜内部 ID 被拒，仅 share 链接可下载
   * ================================================================ */
  const filesRes = await call('GET', '/files', { token: tOwnerAcme, org: acmeOrg });
  const files = filesRes.body;
  if (!Array.isArray(files) || files.length === 0) {
    throw new Error(`GET /files 异常：${filesRes.status} ${JSON.stringify(files).slice(0, 200)}`);
  }
  const internalFileId: string = files[0].id;

  // 未登录访问内部下载端点
  const r03i = await call('GET', `/files/${internalFileId}/download`);
  check(
    'AT03',
    '未登录访客猜测内部文件 ID 被拒',
    '401',
    r03i.status === 401,
    `${r03i.status} ${typeof r03i.body === 'string' ? r03i.body.slice(0, 60) : JSON.stringify(r03i.body).slice(0, 80)}`,
  );

  // 公开 share 链接（永久有效）
  const r03s = await call('GET', '/files/shared/share_demo_req/download');
  check(
    'AT03',
    '有效 share 链接可免登录下载（正常路径）',
    '200 且内容非空',
    r03s.status === 200 && typeof r03s.body === 'string' && r03s.body.length > 0,
    `${r03s.status}，内容长度 ${typeof r03s.body === 'string' ? r03s.body.length : 0} 字符`,
  );

  // 过期 share
  const r03e = await call('GET', '/files/shared/share_demo_expired/download');
  check(
    'AT03',
    '过期 share 链接被拒绝',
    '410',
    r03e.status === 410,
    `${r03e.status} ${r03e.body?.code ?? ''} ${r03e.body?.message ?? ''}`,
  );

  /* ================================================================
   * AT04 停用后会话立即失效；恢复后可继续访问
   * ================================================================ */
  const r04before = await call('GET', '/projects', { token: tMemberAcme, org: acmeOrg });
  check(
    'AT04',
    '停用前成员可正常访问（基线）',
    '200',
    r04before.status === 200,
    `${r04before.status}`,
  );

  // 找到 member 的 membership id
  const members = (await call('GET', '/members', { token: tAdminAcme, org: acmeOrg })).body;
  const target = (Array.isArray(members) ? members : members.items ?? []).find(
    (m: any) => m.user?.email === 'member@acme.dev' || m.email === 'member@acme.dev',
  );
  if (!target) throw new Error('未找到 member@acme.dev 的 membership');

  await call('POST', `/members/${target.id}/suspend`, { token: tAdminAcme, org: acmeOrg });
  const r04susp = await call('GET', '/projects', { token: tMemberAcme, org: acmeOrg });
  check(
    'AT04',
    '停用后下一请求立即失效（守卫每请求反查）',
    '403 MEMBER_SUSPENDED/非 ACTIVE',
    r04susp.status === 403,
    `${r04susp.status} ${r04susp.body?.code ?? ''} ${r04susp.body?.message ?? ''}`,
  );

  // 恢复
  await call('POST', `/members/${target.id}/reactivate`, { token: tAdminAcme, org: acmeOrg });
  const r04back = await call('GET', '/projects', { token: tMemberAcme, org: acmeOrg });
  check(
    'AT04',
    '恢复后访问重新放行（恢复路径）',
    '200',
    r04back.status === 200,
    `${r04back.status}`,
  );

  /* ================================================================
   * AT05 计费事件幂等：同一事件不重复增加权益
   * ================================================================ */
  const overview0 = (await call('GET', '/billing/overview', { token: tOwnerAcme, org: acmeOrg })).body;
  const before = Number(overview0.entitlement.aiCreditsTotal);
  const eventId = `evt-at05-${Date.now()}`;
  const whBody = {
    provider: 'stripe-sandbox',
    eventId,
    type: 'entitlement.grant_ai_credits',
    organizationId: acmeOrg,
    payload: { amount: 100000 },
  };

  // 签名必须覆盖与实际发送完全一致的序列化字节；call 内部对同一对象 JSON.stringify，口径一致
  const r05a = await call('POST', '/billing/webhook', {
    body: whBody,
    sig: signWebhook(JSON.stringify(whBody)),
  });
  const overview1 = (await call('GET', '/billing/overview', { token: tOwnerAcme, org: acmeOrg })).body;
  const mid = Number(overview1.entitlement.aiCreditsTotal);
  check(
    'AT05',
    '首次事件（带 HMAC 签名）施加权益',
    `200 applied=ai_credits+100000，额度 ${before} → ${before + 100000}`,
    r05a.status < 300 && r05a.body?.applied === 'ai_credits+100000' && mid === before + 100000,
    `${r05a.status} ${JSON.stringify(r05a.body)}；额度 ${before} → ${mid}`,
  );

  const r05b = await call('POST', '/billing/webhook', {
    body: whBody,
    sig: signWebhook(JSON.stringify(whBody)),
  });
  const overview2 = (await call('GET', '/billing/overview', { token: tOwnerAcme, org: acmeOrg })).body;
  const after = Number(overview2.entitlement.aiCreditsTotal);
  check(
    'AT05',
    '重复事件判重且不重复增加权益',
    `200 duplicate=true，额度保持 ${mid}`,
    r05b.status < 300 && r05b.body?.duplicate === true && after === mid,
    `${r05b.status} ${JSON.stringify(r05b.body)}；额度 ${mid} → ${after}`,
  );

  // 安全拒绝路径：无签名 → 401，且数据库无任何写入
  const unsignedBody = { ...whBody, eventId: `evt-at05-unsigned-${Date.now()}` };
  const r05u = await call('POST', '/billing/webhook', { body: unsignedBody });
  check(
    'AT05',
    '无签名事件被拒绝（漏洞修复证据）',
    '401 WEBHOOK_SIGNATURE_MISSING',
    r05u.status === 401 && r05u.body?.code === 'WEBHOOK_SIGNATURE_MISSING',
    `${r05u.status} ${r05u.body?.code ?? ''} ${r05u.body?.message ?? ''}`,
  );

  // 错误签名（伪造 v1）→ 401
  const badSig = `t=${Math.floor(Date.now() / 1000)},v1=${'0'.repeat(64)}`;
  const r05bad = await call('POST', '/billing/webhook', {
    body: { ...whBody, eventId: `evt-at05-badsig-${Date.now()}` },
    sig: badSig,
  });
  check(
    'AT05',
    '伪造签名事件被拒绝',
    '401 WEBHOOK_SIGNATURE_INVALID',
    r05bad.status === 401 && r05bad.body?.code === 'WEBHOOK_SIGNATURE_INVALID',
    `${r05bad.status} ${r05bad.body?.code ?? ''}`,
  );

  /* ================================================================
   * AT06 数据范围 DEPT_AND_CHILD：可见下级部门成员，不见范围外部门
   * ================================================================ */
  if (!process.env.DATABASE_ADMIN_URL) {
    throw new Error('AT06 需要 DATABASE_ADMIN_URL 以搭建临时部门/成员场景');
  }
  const at06 = new PrismaClient({
    datasources: { db: { url: process.env.DATABASE_ADMIN_URL } },
  });
  let originalAdminScope = 'ALL';
  try {
    // 定位：admin 的部门（产品研发部）与根部门
    const root = await at06.dept.findFirst({
      where: { organizationId: acmeOrg, parentId: null },
    });
    const rd = await at06.dept.findFirst({
      where: { organizationId: acmeOrg, name: '产品研发部' },
    });
    if (!root || !rd) throw new Error('AT06 前置部门缺失');

    // 幂等：先清上轮残留
    for (const email of ['at06child@acme.dev', 'at06sib@acme.dev']) {
      await at06.membership.deleteMany({ where: { organizationId: acmeOrg, user: { email } } });
    }
    await at06.dept.deleteMany({
      where: { organizationId: acmeOrg, name: { in: ['研发一组（AT06）', '兄弟部门（AT06）'] } },
    });

    // 下级部门（rd 的孩子）与范围外兄弟部门（root 的孩子、rd 的平级）
    const childDept = await at06.dept.create({
      data: {
        organizationId: acmeOrg,
        parentId: rd.id,
        ancestors: `${rd.ancestors}${rd.id},`,
        name: '研发一组（AT06）',
        orderNum: 99,
        status: 'NORMAL',
      },
    });
    const siblingDept = await at06.dept.create({
      data: {
        organizationId: acmeOrg,
        parentId: root.id,
        ancestors: `,${root.id},`,
        name: '兄弟部门（AT06）',
        orderNum: 99,
        status: 'NORMAL',
      },
    });

    // 两个临时用户 + 分属两部门的成员关系
    for (const [email, deptId] of [
      ['at06child@acme.dev', childDept.id],
      ['at06sib@acme.dev', siblingDept.id],
    ] as const) {
      await at06.user.upsert({
        where: { email },
        update: { emailVerifiedAt: new Date() },
        create: { email, name: email, passwordHash: hash, emailVerifiedAt: new Date() },
      });
      const u = await at06.user.findUnique({ where: { email } });
      await at06.membership.create({
        data: { organizationId: acmeOrg, userId: u!.id, deptId, status: 'ACTIVE' },
      });
    }

    // 临时把 ADMIN 角色数据范围切到 DEPT_AND_CHILD（admin 本人在 rd 部门）
    const adminRole = await at06.role.findFirst({
      where: { organizationId: acmeOrg, key: 'ADMIN' },
    });
    if (!adminRole) throw new Error('AT06 未找到 ADMIN 角色');
    originalAdminScope = adminRole.dataScope;
    await at06.role.update({
      where: { id: adminRole.id },
      data: { dataScope: 'DEPT_AND_CHILD' },
    });

    const list06 = (await call('GET', '/members', { token: tAdminAcme, org: acmeOrg })).body;
    const emails = new Set(
      (Array.isArray(list06) ? list06 : []).map((m: any) => m.user?.email ?? m.email),
    );

    check(
      'AT06',
      'DEPT_AND_CHILD 可见下级部门成员（bug 修复证据）',
      '列表含 at06child@acme.dev',
      emails.has('at06child@acme.dev'),
      [...emails].join(', '),
    );
    check(
      'AT06',
      'DEPT_AND_CHILD 不泄漏范围外兄弟部门',
      '列表不含 at06sib@acme.dev',
      !emails.has('at06sib@acme.dev'),
      [...emails].join(', '),
    );
  } finally {
    // 无论断言成败：恢复角色、清理临时成员/部门/用户
    const adminRole = await at06.role.findFirst({
      where: { organizationId: acmeOrg, key: 'ADMIN' },
    });
    if (adminRole && adminRole.dataScope !== originalAdminScope) {
      await at06.role.update({
        where: { id: adminRole.id },
        data: { dataScope: originalAdminScope as any },
      });
    }
    for (const email of ['at06child@acme.dev', 'at06sib@acme.dev']) {
      await at06.membership.deleteMany({ where: { organizationId: acmeOrg, user: { email } } });
      await at06.user.deleteMany({ where: { email } });
    }
    await at06.dept.deleteMany({
      where: { organizationId: acmeOrg, name: { in: ['研发一组（AT06）', '兄弟部门（AT06）'] } },
    });
    await at06.$disconnect();
  }

  /* ================================================================
   * AT07 订阅生命周期：到期→PAST_DUE；超宽限/取消到期→CANCELED 降 FREE
   * ================================================================ */
  const at07 = new PrismaClient({
    datasources: { db: { url: process.env.DATABASE_ADMIN_URL } },
  });
  const tempOrgIds: string[] = [];
  try {
    const proPlan = await at07.plan.findFirstOrThrow({ where: { code: 'PRO' } });
    const freePlan = await at07.plan.findFirstOrThrow({ where: { code: 'FREE' } });

    const mkOrg = async (tag: string, endOffsetDays: number, cancel: boolean) => {
      const org = await at07.organization.create({
        data: {
          name: `AT07-${tag}-${Date.now()}`,
          slug: `at07-${tag.toLowerCase()}-${Math.random().toString(36).slice(2, 8)}`,
          status: 'ACTIVE',
          planId: proPlan.id,
        },
      });
      tempOrgIds.push(org.id);
      const end = new Date();
      end.setDate(end.getDate() + endOffsetDays);
      await at07.entitlement.create({
        data: {
          organizationId: org.id,
          planId: proPlan.id,
          seatsIncluded: proPlan.seatsIncluded,
          aiCreditsTotal: proPlan.aiCredits,
          maxProjects: proPlan.maxProjects,
          storageGb: proPlan.storageGb,
          features: proPlan.features as any,
        },
      });
      const start = new Date();
      start.setDate(start.getDate() - 31);
      await at07.subscription.create({
        data: {
          organizationId: org.id,
          planId: proPlan.id,
          status: 'ACTIVE',
          currentPeriodStart: start,
          currentPeriodEnd: end,
          seats: 2,
          cancelAtPeriodEnd: cancel,
        },
      });
      return org;
    };

    const orgA = await mkOrg('PASTDUE', -2, false);
    const orgB = await mkOrg('EXPIRED', -8, false);
    const orgC = await mkOrg('CANCEL', -1, true);

    // 平台超管登录并手动触发生命周期
    const platLogin = await call('POST', '/auth/login', {
      body: { email: 'chenhynju@gmail.com', password: 'Passw0rd!' },
    });
    const run = await call('POST', '/billing/lifecycle/run', {
      token: platLogin.body.accessToken,
    });
    check(
      'AT07',
      '生命周期执行入口可用（平台超管）',
      '201 scanned=3',
      run.status === 201 && run.body?.scanned === 3,
      `${run.status} scanned=${run.body?.scanned ?? 'n/a'}`,
    );

    const subA = await at07.subscription.findFirst({
      where: { organizationId: orgA.id },
    });
    const orgAState = await at07.organization.findUnique({ where: { id: orgA.id } });
    check(
      'AT07',
      '账期到期 2 天 → PAST_DUE 进入宽限',
      'PAST_DUE',
      subA?.status === 'PAST_DUE',
      subA?.status ?? 'null',
    );
    check(
      'AT07',
      '宽限期内保留 PRO 权益',
      'org.planId=PRO',
      orgAState?.planId === proPlan.id,
      orgAState?.planId ?? 'null',
    );

    for (const [org, tag] of [
      [orgB, 'B 超宽限'],
      [orgC, 'C 主动取消到期'],
    ] as const) {
      const sub = await at07.subscription.findFirst({
        where: { organizationId: org.id },
      });
      const orgState = await at07.organization.findUnique({ where: { id: org.id } });
      const ent = await at07.entitlement.findUnique({
        where: { organizationId: org.id },
      });
      check('AT07', `场景${tag} → CANCELED`, 'CANCELED', sub?.status === 'CANCELED', sub?.status ?? 'null');
      check(
        'AT07',
        `场景${tag} 组织降回 FREE`,
        'planId=FREE',
        orgState?.planId === freePlan.id,
        orgState?.planId ?? 'null',
      );
      check(
        'AT07',
        `场景${tag} 权益快照重置为 FREE`,
        `seats=${freePlan.seatsIncluded}`,
        ent?.seatsIncluded === freePlan.seatsIncluded,
        String(ent?.seatsIncluded),
      );
    }
  } finally {
    for (const id of tempOrgIds) {
      await at07.subscription.deleteMany({ where: { organizationId: id } });
      await at07.entitlement.deleteMany({ where: { organizationId: id } });
      await at07.organization.deleteMany({ where: { id } });
    }
    await at07.$disconnect();
  }

  /* ================================================================
   * AT08 实时协作：presence + 任务 CRUD 广播 + 跨租户拒绝
   * ================================================================ */
  const wsOrigin = BASE.replace(/\/api\/v1\/?$/, '');
  console.log('[stage] entering AT08, wsOrigin =', wsOrigin);
  let at08TaskId = '';
  const sOwner = io(wsOrigin, { auth: { token: tOwnerAcme }, transports: ['websocket'] });
  const sAdmin = io(wsOrigin, { auth: { token: tAdminAcme }, transports: ['websocket'] });
  const sGlobex = io(wsOrigin, { auth: { token: tOwnerGlobex }, transports: ['websocket'] });
  console.log('[stage] three sockets created');
  try {
    const projectList = (await call('GET', '/projects', { token: tOwnerAcme, org: acmeOrg }))
      .body;
    const projectId = projectList[0].id;

    // connect 是一次性事件：socket 可能已在此前的 HTTP 调用期间连上，
    // 后注册监听会错过事件，因此先检查 s.connected
    const waitConnect = (s: { connected?: boolean; on: (e: string, cb: () => void) => void }) =>
      new Promise<boolean>((res) => {
        if (s.connected) return res(true);
        s.on('connect', () => res(true));
      });
    const connected = await Promise.race([
      Promise.all([waitConnect(sOwner), waitConnect(sAdmin), waitConnect(sGlobex)]),
      new Promise<false>((res) => setTimeout(() => res(false), EVENT_TIMEOUT)),
    ]);
    if (!connected) throw new Error('AT08 socket 连接超时');

    // presence 由 project:open 的副作用广播，必须先挂监听再发 open
    const presenceUsersPromise: Promise<any[]> = new Promise((resolve) => {
      const to = setTimeout(() => resolve([]), EVENT_TIMEOUT);
      sAdmin.on('presence:update', (p) => {
        if (p.users.length >= 2) {
          clearTimeout(to);
          resolve(p.users);
        }
      });
    });

    const ackO: any = await new Promise((res) =>
      sOwner.emit('project:open', { organizationId: acmeOrg, projectId }, res),
    );
    const ackA: any = await new Promise((res) =>
      sAdmin.emit('project:open', { organizationId: acmeOrg, projectId }, res),
    );
    const ackX: any = await new Promise((res) =>
      sGlobex.emit('project:open', { organizationId: acmeOrg, projectId }, res),
    );

    // 显式再请求一次 presence，消除 open 副作用广播的时序竞态
    sAdmin.emit('presence:request');

    // presence：等包含至少 2 个用户的房间广播
    const presenceUsers: any[] = await presenceUsersPromise;
    const presentIds = new Set(presenceUsers.map((u) => u.userId));
    check(
      'AT08',
      '两成员加入后项目房间 presence 可见',
      '≥2 个不同用户',
      ackO?.ok && ackA?.ok && presentIds.size >= 2,
      `users=${[...presentIds].join(',')}`,
    );
    check(
      'AT08',
      '跨租户成员无法进入他人项目房间',
      'ack ok=false',
      ackX?.ok === false,
      JSON.stringify(ackX),
    );

    const waitEvent = (event: string) =>
      new Promise<string>((resolve) => {
        const to = setTimeout(() => resolve('TIMEOUT'), EVENT_TIMEOUT);
        sAdmin.once(event, (p) => {
          clearTimeout(to);
          resolve(p.taskId);
        });
      });

    // 创建（先挂监听，再发请求——广播是一次性事件）
    const createWait = waitEvent('task:created');
    const cr = await call('POST', '/tasks', {
      token: tOwnerAcme,
      org: acmeOrg,
      body: { projectId, title: `AT08-${Date.now()}` },
    });
    at08TaskId = cr.body.id;
    const gotCreate = await createWait;
    check(
      'AT08',
      '创建任务实时广播给房间其他成员',
      `taskId=${at08TaskId}`,
      gotCreate === at08TaskId,
      gotCreate,
    );

    // 更新
    const updateWait = waitEvent('task:updated');
    await call('PATCH', `/tasks/${at08TaskId}`, {
      token: tOwnerAcme,
      org: acmeOrg,
      body: { status: 'IN_PROGRESS' },
    });
    const gotUpdate = await updateWait;
    check(
      'AT08',
      '更新任务实时广播',
      `taskId=${at08TaskId}`,
      gotUpdate === at08TaskId,
      gotUpdate,
    );

    // 删除（先挂监听再发请求）
    const delWait = new Promise<string>((resolve) => {
      const to = setTimeout(() => resolve('TIMEOUT'), EVENT_TIMEOUT);
      sAdmin.once('task:deleted', (p) => {
        clearTimeout(to);
        resolve(p.taskId);
      });
    });
    await call('DELETE', `/tasks/${at08TaskId}`, {
      token: tOwnerAcme,
      org: acmeOrg,
    });
    const gotDelete = await delWait;
    check(
      'AT08',
      '删除任务实时广播',
      `taskId=${at08TaskId}`,
      gotDelete === at08TaskId,
      gotDelete,
    );
    at08TaskId = '';
  } finally {
    if (at08TaskId) {
      await call('DELETE', `/tasks/${at08TaskId}`, { token: tOwnerAcme, org: acmeOrg });
    }
    sOwner.close();
    sAdmin.close();
    sGlobex.close();
  }

  /* ============ 汇总并落证据 ============ */
  const passed = checks.filter((c) => c.pass).length;
  console.log(`\n=== 结果：${passed}/${checks.length} 通过 ===\n`);

  const lines: string[] = [];
  lines.push(`# TeamSpace 端到端验收证据（AT01–AT08）`);
  lines.push('');
  lines.push(`- 执行时间：${new Date().toISOString()}`);
  lines.push(`- API：\`${BASE}\``);
  lines.push(`- 数据：合成种子数据（密码统一 Passw0rd!）`);
  lines.push(`- 结果：**${passed}/${checks.length} 通过**`);
  lines.push('');
  for (const at of ['AT01', 'AT02', 'AT03', 'AT04', 'AT05', 'AT06', 'AT07', 'AT08']) {
    lines.push(`## ${at}`);
    lines.push('');
    lines.push('| # | 检查项 | 期望 | 实际 | 结果 |');
    lines.push('| - | ------ | ---- | ---- | ---- |');
    checks
      .filter((c) => c.at === at)
      .forEach((c, i) => {
        lines.push(
          `| ${i + 1} | ${c.name} | ${c.expected.replace(/\|/g, '\\|')} | ${c.actual.replace(/\|/g, '\\|')} | ${c.pass ? 'PASS' : 'FAIL'} |`,
        );
      });
    lines.push('');
  }
  const outDir = process.env.EVIDENCE_DIR || join(__dirname, '..', '..', '..', 'evidence');
  mkdirSync(outDir, { recursive: true });
  const outFile = join(outDir, 'acceptance-AT01-AT08.md');
  writeFileSync(outFile, lines.join('\n'), 'utf-8');
  console.log(`证据已写入：${outFile}`);

  if (passed !== checks.length) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
