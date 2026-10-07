/**
 * TeamSpace IM 端到端验收（AT09）
 * 运行：npx ts-node --transpile-only scripts/acceptance-im.ts
 * 前置：API 运行于 3001，seed + enable-rls + seed-im-menus 已执行
 *
 * 覆盖：
 *  正常：私聊（幂等创建/文本/图片/文件/历史/已读/未读数）、群聊（创建/加人/发言）
 *  拒绝：跨组织访问、伪造组织头、GUEST 越权（建群/传附件）、非群主移除成员、退群后发言、RLS 直查
 *  实时：WebSocket 收到 im:message:new，非会话成员收不到
 *
 * 输出：控制台 + evidence/acceptance-AT09-im.md
 */
import { PrismaClient } from '@prisma/client';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { io, Socket } from 'socket.io-client';
import 'dotenv/config';

const BASE = process.env.API_BASE ?? 'http://localhost:3001/api/v1';
const WS_URL = process.env.WS_URL ?? 'http://localhost:3001';
const prisma = new PrismaClient();

process.on('uncaughtException', (e) => console.error('UNCAUGHT_EXCEPTION', e));
process.on('unhandledRejection', (e) => console.error('UNHANDLED_REJECTION', e));

/* 1x1 PNG */
const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const PNG_BYTES = Buffer.from(PNG_B64, 'base64');

async function call(
  method: string,
  path: string,
  opts: { token?: string; org?: string; body?: unknown } = {},
): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = {};
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  if (opts.org) headers['x-organization-id'] = opts.org;
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

async function upload(
  path: string,
  fileName: string,
  bytes: Buffer,
  mime: string,
  opts: { token: string; org: string },
): Promise<{ status: number; body: any }> {
  const fd = new FormData();
  fd.append('file', new Blob([bytes], { type: mime }), fileName);
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: { authorization: `Bearer ${opts.token}`, 'x-organization-id': opts.org },
    body: fd,
  });
  const ct = res.headers.get('content-type') ?? '';
  const text = await res.text();
  const body = ct.includes('json') && text ? JSON.parse(text) : text;
  return { status: res.status, body };
}

interface Check {
  name: string;
  expected: string;
  actual: string;
  pass: boolean;
}
const checks: Check[] = [];
function check(name: string, expected: string, pass: boolean, actual: string) {
  checks.push({ name, expected, actual, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name} | 期望: ${expected} | 实际: ${actual}`);
}

function connectWs(token: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const s = io(WS_URL, { auth: { token }, transports: ['websocket'] });
    const timer = setTimeout(() => reject(new Error('ws connect timeout')), 5000);
    s.on('connect', () => {
      clearTimeout(timer);
      resolve(s);
    });
    s.on('connect_error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
}

async function main() {
  console.log(`\n=== TeamSpace IM 验收（AT09）@ ${new Date().toISOString()} ===`);
  console.log(`API: ${BASE}\n`);

  const login = async (email: string) => {
    const r = await call('POST', '/auth/login', { body: { email, password: 'Passw0rd!' } });
    if (r.status < 200 || r.status >= 300)
      throw new Error(`登录失败 ${email}: ${r.status} ${JSON.stringify(r.body)}`);
    return r.body.accessToken as string;
  };
  const tOwner = await login('owner@acme.dev');
  const tAdmin = await login('admin@acme.dev');
  const tMember = await login('member@acme.dev');
  const tGlobex = await login('owner@globex.dev');

  const meOwner = (await call('GET', '/users/me', { token: tOwner })).body;
  const meGlobex = (await call('GET', '/users/me', { token: tGlobex })).body;
  const acmeOrg: string = meOwner.organizations[0].id;
  const globexOrg: string = meGlobex.organizations[0].id;

  const members = (await call('GET', '/members', { token: tOwner, org: acmeOrg })).body as any[];
  const adminId = members.find((m) => m.user.email === 'admin@acme.dev').user.id as string;
  const memberId = members.find((m) => m.user.email === 'member@acme.dev').user.id as string;
  console.log(`acme=${acmeOrg} owner=${meOwner.id} admin=${adminId} member=${memberId}\n`);

  /* ============ 1. 私聊：创建（幂等） ============ */
  const dc1 = await call('POST', '/conversations/direct', {
    token: tOwner, org: acmeOrg, body: { userId: adminId },
  });
  check('私聊创建', '201 + 会话 id', dc1.status === 201 && !!dc1.body?.id, `${dc1.status} ${JSON.stringify(dc1.body)}`);
  const directConvId = dc1.body.id as string;

  // 私聊幂等复用同一会话，历史消息已落库会跨多次运行累积；
  // 为保证断言确定性，开跑前清空该会话的旧消息（走保留策略旁路）
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.im_retention', 'on', true)`;
    await tx.message.deleteMany({ where: { conversationId: directConvId } });
  });

  const dc2 = await call('POST', '/conversations/direct', {
    token: tAdmin, org: acmeOrg, body: { userId: meOwner.id },
  });
  check('私聊幂等（对端再建返回同一会话）', dc1.body.id, dc2.status === 201 && dc2.body?.id === dc1.body.id, `${dc2.status} ${dc2.body?.id}`);

  const dcSelf = await call('POST', '/conversations/direct', {
    token: tOwner, org: acmeOrg, body: { userId: meOwner.id },
  });
  check('拒绝与自己私聊', '400 SELF_CHAT', dcSelf.status === 400 && dcSelf.body?.code === 'SELF_CHAT', `${dcSelf.status} ${dcSelf.body?.code ?? ''}`);

  /* ============ 2. 私聊：文本消息 + 未读数 + 已读 ============ */
  const mText = await call('POST', `/conversations/${directConvId}/messages`, {
    token: tAdmin, org: acmeOrg, body: { type: 'TEXT', content: 'owner，方案文档看过了吗？' },
  });
  check('admin 发送文本消息', '201 + 消息 id', mText.status === 201 && !!mText.body?.id, `${mText.status} ${JSON.stringify(mText.body)}`);

  const listOwner1 = await call('GET', '/conversations', { token: tOwner, org: acmeOrg });
  const convInList1 = (listOwner1.body as any[]).find((c) => c.id === directConvId);
  check(
    'owner 会话列表未读数=1 且标题为对端名字',
    'unreadCount=1, title=柯博文',
    listOwner1.status === 200 && convInList1?.unreadCount === 1 && convInList1?.title === '柯博文',
    `${listOwner1.status} unread=${convInList1?.unreadCount} title=${convInList1?.title}`,
  );

  const read1 = await call('POST', `/conversations/${directConvId}/read`, {
    token: tOwner, org: acmeOrg, body: { lastReadMessageId: mText.body.id },
  });
  const listOwner2 = await call('GET', '/conversations', { token: tOwner, org: acmeOrg });
  const convInList2 = (listOwner2.body as any[]).find((c) => c.id === directConvId);
  check('标记已读后未读数归零', 'unreadCount=0', read1.status === 201 && convInList2?.unreadCount === 0, `read=${read1.status} unread=${convInList2?.unreadCount}`);

  /* ============ 3. 私聊：图片 + 文件附件 ============ */
  const upImg = await upload(`/conversations/${directConvId}/attachments`, 'pixel.png', PNG_BYTES, 'image/png', { token: tOwner, org: acmeOrg });
  check('上传图片附件', '201 + 附件 id', upImg.status === 201 && !!upImg.body?.id, `${upImg.status} ${JSON.stringify(upImg.body)}`);

  const mImg = await call('POST', `/conversations/${directConvId}/messages`, {
    token: tOwner, org: acmeOrg,
    body: { type: 'IMAGE', content: '截图如下', attachmentId: upImg.body.id },
  });
  check('发送图片消息', '201 + attachment', mImg.status === 201 && mImg.body?.attachment?.id === upImg.body.id, `${mImg.status} ${JSON.stringify(mImg.body)}`);

  const upFile = await upload(`/conversations/${directConvId}/attachments`, 'spec.txt', Buffer.from('TeamSpace IM 需求 v1'), 'text/plain', { token: tOwner, org: acmeOrg });
  const mFile = await call('POST', `/conversations/${directConvId}/messages`, {
    token: tOwner, org: acmeOrg,
    body: { type: 'FILE', content: '需求文档', attachmentId: upFile.body.id },
  });
  check('发送文件消息', '201 + attachment', mFile.status === 201 && mFile.body?.attachment?.id === upFile.body.id, `${mFile.status} ${JSON.stringify(mFile.body)}`);

  const hist = await call('GET', `/conversations/${directConvId}/messages`, { token: tAdmin, org: acmeOrg });
  const msgs = hist.body as any[];
  check(
    'admin 拉取历史含 3 条消息（TEXT/IMAGE/FILE）',
    '3 条，类型齐全',
    hist.status === 200 && msgs.length === 3 && ['TEXT', 'IMAGE', 'FILE'].every((t) => msgs.some((m) => m.type === t)),
    `${hist.status} 数量=${Array.isArray(msgs) ? msgs.length : '-'} 类型=${Array.isArray(msgs) ? msgs.map((m) => m.type).join(',') : '-'}`,
  );

  const dl = await fetch(`${BASE}/messages/attachments/${upImg.body.id}/download`, {
    headers: { authorization: `Bearer ${tAdmin}`, 'x-organization-id': acmeOrg },
  });
  const dlBytes = Buffer.from(await dl.arrayBuffer());
  check(
    '会话成员可下载图片附件',
    `200 image/png ${PNG_BYTES.length}B`,
    dl.status === 200 && (dl.headers.get('content-type') ?? '').includes('image/png') && dlBytes.length === PNG_BYTES.length,
    `${dl.status} ${dl.headers.get('content-type')} ${dlBytes.length}B`,
  );

  /* ============ 4. 群聊：创建 / 加人 / 权限 ============ */
  const gc = await call('POST', '/conversations/group', {
    token: tOwner, org: acmeOrg,
    body: { title: '交付冲刺群', memberIds: [adminId, memberId] },
  });
  check('创建群聊', '201 + 会话 id', gc.status === 201 && !!gc.body?.id, `${gc.status} ${JSON.stringify(gc.body)}`);
  const groupId = gc.body.id as string;

  const detail = await call('GET', `/conversations/${groupId}`, { token: tOwner, org: acmeOrg });
  check('群详情含 3 名成员', '3', detail.status === 200 && detail.body?.members?.length === 3, `${detail.status} 成员数=${detail.body?.members?.length}`);

  const gMsg = await call('POST', `/conversations/${groupId}/messages`, {
    token: tMember, org: acmeOrg, body: { type: 'TEXT', content: '收到，今天提测。' },
  });
  check('群成员发言', '201', gMsg.status === 201, `${gMsg.status} ${JSON.stringify(gMsg.body)}`);

  const listOwner3 = await call('GET', '/conversations', { token: tOwner, org: acmeOrg });
  const groupInList = (listOwner3.body as any[]).find((c) => c.id === groupId);
  check('owner 群聊未读数=1（member 的发言）', 'unreadCount=1', groupInList?.unreadCount === 1, `unread=${groupInList?.unreadCount}`);

  // 非群主移除他人 → 拒绝
  const rmByMember = await call('DELETE', `/conversations/${groupId}/members/${adminId}`, { token: tMember, org: acmeOrg });
  check('非群主移除他人被拒', '403 NO_PERMISSION', rmByMember.status === 403 && rmByMember.body?.code === 'NO_PERMISSION', `${rmByMember.status} ${rmByMember.body?.code ?? ''}`);

  // 群主移除 member → member 再发言被拒
  const rmByOwner = await call('DELETE', `/conversations/${groupId}/members/${memberId}`, { token: tOwner, org: acmeOrg });
  const speakAfterLeft = await call('POST', `/conversations/${groupId}/messages`, {
    token: tMember, org: acmeOrg, body: { type: 'TEXT', content: '还能看到吗' },
  });
  check(
    '被移出群的成员再发言被拒',
    '403 NOT_MEMBER',
    rmByOwner.status === 200 && speakAfterLeft.status === 403 && speakAfterLeft.body?.code === 'NOT_MEMBER',
    `移除=${rmByOwner.status} 发言=${speakAfterLeft.status} ${speakAfterLeft.body?.code ?? ''}`,
  );

  /* ============ 5. 跨组织与 RLS ============ */
  const xRead = await call('GET', `/conversations/${directConvId}/messages`, { token: tGlobex, org: globexOrg });
  check('跨组织读取消息被拒（应用层）', '403 NOT_MEMBER', xRead.status === 403 && xRead.body?.code === 'NOT_MEMBER', `${xRead.status} ${xRead.body?.code ?? ''}`);

  const xForged = await call('GET', `/conversations/${directConvId}`, { token: tGlobex, org: acmeOrg });
  check('伪造 acme 组织头被拒', '403 NOT_MEMBER', xForged.status === 403 && xForged.body?.code === 'NOT_MEMBER', `${xForged.status} ${xForged.body?.code ?? ''}`);

  const xDownload = await fetch(`${BASE}/messages/attachments/${upImg.body.id}/download`, {
    headers: { authorization: `Bearer ${tGlobex}`, 'x-organization-id': globexOrg },
  });
  check('跨组织下载附件被拒', '403/404', xDownload.status === 403 || xDownload.status === 404, `${xDownload.status}`);

  const rls = await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SELECT set_config('app.current_org_id', $1, true)`, globexOrg);
    await tx.$executeRawUnsafe(`SELECT set_config('app.current_user_id', $1, true)`, meGlobex.id);
    const rows = await tx.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS n FROM im_message WHERE conversation_id = ${directConvId}`;
    return Number(rows[0].n);
  });
  check('RLS 防御层：globex 上下文直查 acme 消息', '0 行', rls === 0, `${rls} 行`);

  const rlsOwn = await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SELECT set_config('app.current_org_id', $1, true)`, acmeOrg);
    await tx.$executeRawUnsafe(`SELECT set_config('app.current_user_id', $1, true)`, meOwner.id);
    const rows = await tx.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS n FROM im_message WHERE conversation_id = ${directConvId}`;
    return Number(rows[0].n);
  });
  check('RLS 对照：owner 上下文可查本会话消息', '>0 行', rlsOwn > 0, `${rlsOwn} 行`);

  /* ============ 6. WebSocket 实时推送 ============ */
  const sAdmin = await connectWs(tAdmin);
  const sMember = await connectWs(tMember); // 已被移出群，不在私聊中

  const gotByAdmin = new Promise<any>((resolve) => {
    const timer = setTimeout(() => resolve(null), 4000);
    sAdmin.on('im:message:new', (p) => {
      clearTimeout(timer);
      resolve(p);
    });
  });
  const gotByMember = new Promise<any>((resolve) => {
    const timer = setTimeout(() => resolve('TIMEOUT'), 3000);
    sMember.on('im:message:new', (p) => {
      clearTimeout(timer);
      resolve(p);
    });
  });

  const mWs = await call('POST', `/conversations/${directConvId}/messages`, {
    token: tOwner, org: acmeOrg, body: { type: 'TEXT', content: '实时推送测试' },
  });
  const adminRecv = await gotByAdmin;
  const memberRecv = await gotByMember;

  check(
    '会话成员实时收到 im:message:new',
    'payload 含新消息',
    !!adminRecv && adminRecv.message?.id === mWs.body?.id && adminRecv.message?.content === '实时推送测试',
    adminRecv ? `收到 ${adminRecv.message?.content}` : '未收到',
  );
  check('非会话成员收不到该消息推送', 'TIMEOUT', memberRecv === 'TIMEOUT', memberRecv === 'TIMEOUT' ? '未收到（符合预期）' : `异常收到 ${JSON.stringify(memberRecv)}`);

  sAdmin.disconnect();
  sMember.disconnect();

  /* ============ 汇总 ============ */
  const passed = checks.filter((c) => c.pass).length;
  console.log(`\n=== 结果：${passed}/${checks.length} 通过 ===\n`);

  mkdirSync(join(process.cwd(), '..', '..', 'evidence'), { recursive: true });
  const lines = [
    `# TeamSpace IM 验收证据（AT09）`,
    ``,
    `- 时间：${new Date().toISOString()}`,
    `- API：${BASE}`,
    `- 结果：${passed}/${checks.length} 通过`,
    ``,
    `| 检查项 | 期望 | 实际 | 结论 |`,
    `| --- | --- | --- | --- |`,
    ...checks.map((c) => `| ${c.name} | ${c.expected} | ${c.actual.replace(/\|/g, '\\|')} | ${c.pass ? 'PASS' : 'FAIL'} |`),
    ``,
  ];
  writeFileSync(join(process.cwd(), '..', '..', 'evidence', 'acceptance-AT09-im.md'), lines.join('\n'));

  await prisma.$disconnect();
  process.exit(passed === checks.length ? 0 : 1);
}

main().catch(async (e) => {
  console.error('验收脚本异常：', e);
  await prisma.$disconnect();
  process.exit(1);
});
