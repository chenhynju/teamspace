/**
 * TeamSpace 系统管理 + 系统监控 端到端验收（AT10）
 * 运行：npx ts-node --transpile-only scripts/acceptance-system.ts
 * 前置：API 运行于 3001，seed + enable-rls + seed-system-menus + grant-monitor-privs 已执行
 *
 * 覆盖：
 *  正常：菜单 CRUD、字典类型/数据 CRUD、参数 CRUD、公告发布/已读、登录日志查询/删除/清空、
 *        服务/缓存/任务/数据库/在线用户监控、手动触发定时任务
 *  拒绝：菜单防环(自己/后代)、有子菜单/已授权时删除、字典有数据时删类型、内置参数不可删、
 *        MEMBER 越权（全部管理+监控端点 403）、公告跨组织隔离
 *
 * 输出：控制台 + evidence/acceptance-AT10-system.md
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
  console.log(`\n=== TeamSpace 系统管理/监控验收（AT10）@ ${new Date().toISOString()} ===`);
  console.log(`API: ${BASE}\n`);

  const login = async (email: string) => {
    const r = await call('POST', '/auth/login', { body: { email, password: 'Passw0rd!' } });
    if (r.status < 200 || r.status >= 300)
      throw new Error(`登录失败 ${email}: ${r.status} ${JSON.stringify(r.body)}`);
    return r.body.accessToken as string;
  };
  const tOwner = await login('owner@acme.dev');
  const tMember = await login('member@acme.dev');
  const tGlobex = await login('owner@globex.dev');

  const meOwner = (await call('GET', '/users/me', { token: tOwner })).body;
  const meGlobex = (await call('GET', '/users/me', { token: tGlobex })).body;
  const acmeOrg: string = meOwner.organizations[0].id;
  const globexOrg: string = meGlobex.organizations[0].id;
  console.log(`acme=${acmeOrg} globex=${globexOrg}\n`);

  /* ==================== 1. 菜单管理 ==================== */
  const listMenus = await call('GET', '/menus', { token: tOwner, org: acmeOrg });
  check('菜单列表', '200 且非空', listMenus.status === 200 && Array.isArray(listMenus.body) && listMenus.body.length > 0, `${listMenus.status} ${listMenus.body?.length} 条`);

  const createParent = await call('POST', '/menus', {
    token: tOwner, org: acmeOrg,
    body: { name: 'AT验收父菜单', type: 'MENU', path: '/at-parent', icon: 'Wrench', orderNum: 99 },
  });
  check('创建菜单', '201 + id', createParent.status === 201 && !!createParent.body?.id, `${createParent.status}`);
  const parentId = createParent.body.id as string;

  const createChild = await call('POST', '/menus', {
    token: tOwner, org: acmeOrg,
    body: { name: 'AT验收子菜单', type: 'MENU', parentId, path: '/at-child', icon: 'Tool' },
  });
  const childId = createChild.body.id as string;
  check('创建子菜单', '201', createChild.status === 201 && !!childId, `${createChild.status}`);

  const editMenu = await call('PATCH', `/menus/${parentId}`, {
    token: tOwner, org: acmeOrg, body: { name: 'AT验收父菜单(改)' },
  });
  check('编辑菜单', '200 + 新名称', editMenu.status === 200 && editMenu.body?.name === 'AT验收父菜单(改)', `${editMenu.status} ${editMenu.body?.name}`);

  const loopSelf = await call('PATCH', `/menus/${childId}`, {
    token: tOwner, org: acmeOrg, body: { parentId: childId },
  });
  check('防环：父级不能是自己', '400 MENU_PARENT_SELF', loopSelf.status === 400 && loopSelf.body?.code === 'MENU_PARENT_SELF', `${loopSelf.status} ${loopSelf.body?.code}`);

  const loopDesc = await call('PATCH', `/menus/${parentId}`, {
    token: tOwner, org: acmeOrg, body: { parentId: childId },
  });
  check('防环：父级不能是后代', '400 MENU_PARENT_LOOP', loopDesc.status === 400 && loopDesc.body?.code === 'MENU_PARENT_LOOP', `${loopDesc.status} ${loopDesc.body?.code}`);

  const delParentInUse = await call('DELETE', `/menus/${parentId}`, { token: tOwner, org: acmeOrg });
  check('有子菜单时删除父级', '409 MENU_HAS_CHILD', delParentInUse.status === 409 && delParentInUse.body?.code === 'MENU_HAS_CHILD', `${delParentInUse.status} ${delParentInUse.body?.code}`);

  // btn_notice_add 已授权给 OWNER/ADMIN：删除应被 MENU_IN_USE 拒绝（不真删）
  const delReferenced = await call('DELETE', '/menus/btn_notice_add', { token: tOwner, org: acmeOrg });
  check('删除已授权菜单', '409 MENU_IN_USE', delReferenced.status === 409 && delReferenced.body?.code === 'MENU_IN_USE', `${delReferenced.status} ${delReferenced.body?.code}`);

  const delChild = await call('DELETE', `/menus/${childId}`, { token: tOwner, org: acmeOrg });
  check('删除子菜单', '200', delChild.status === 200, `${delChild.status}`);
  const delParent = await call('DELETE', `/menus/${parentId}`, { token: tOwner, org: acmeOrg });
  check('删除父菜单', '200', delParent.status === 200, `${delParent.status}`);

  /* ==================== 2. 字典管理 ==================== */
  const SUFFIX = Date.now().toString().slice(-6);
  const DICT_TYPE = `at_dict_${SUFFIX}`;

  const createDictType = await call('POST', '/dict-types', {
    token: tOwner, org: acmeOrg, body: { name: 'AT验收字典', type: DICT_TYPE },
  });
  check('创建字典类型', '201', createDictType.status === 201 && !!createDictType.body?.id, `${createDictType.status}`);
  const dictTypeId = createDictType.body.id as string;

  const badTypeCode = await call('POST', '/dict-types', {
    token: tOwner, org: acmeOrg, body: { name: 'bad', type: '1badcode' },
  });
  check('字典编码格式校验', '400', badTypeCode.status === 400, `${badTypeCode.status}`);

  const createDictData = await call('POST', '/dict-data', {
    token: tOwner, org: acmeOrg,
    body: { label: '选项A', value: 'A', dictType: DICT_TYPE, listClass: 'blue' },
  });
  check('创建字典数据', '201', createDictData.status === 201 && !!createDictData.body?.id, `${createDictData.status}`);
  const dictDataId = createDictData.body.id as string;

  const listDictData = await call('GET', `/dict-data?dictType=${DICT_TYPE}`, { token: tOwner, org: acmeOrg });
  check('按编码查字典数据', '200 且含 1 条', listDictData.status === 200 && listDictData.body?.length === 1, `${listDictData.status} ${listDictData.body?.length} 条`);

  const editDictData = await call('PATCH', `/dict-data/${dictDataId}`, {
    token: tOwner, org: acmeOrg, body: { label: '选项A(改)' },
  });
  check('编辑字典数据', '200 + 新标签', editDictData.status === 200 && editDictData.body?.label === '选项A(改)', `${editDictData.status}`);

  const delTypeWithData = await call('DELETE', `/dict-types/${dictTypeId}`, { token: tOwner, org: acmeOrg });
  check('有数据时删字典类型', '409 DICT_HAS_DATA', delTypeWithData.status === 409 && delTypeWithData.body?.code === 'DICT_HAS_DATA', `${delTypeWithData.status} ${delTypeWithData.body?.code}`);

  const delDictData = await call('DELETE', `/dict-data/${dictDataId}`, { token: tOwner, org: acmeOrg });
  check('删除字典数据', '200', delDictData.status === 200, `${delDictData.status}`);
  const delDictType = await call('DELETE', `/dict-types/${dictTypeId}`, { token: tOwner, org: acmeOrg });
  check('删除字典类型', '200', delDictType.status === 200, `${delDictType.status}`);

  /* ==================== 3. 参数管理 ==================== */
  const CONFIG_KEY = `at.config.${SUFFIX}`;
  const createConfig = await call('POST', '/configs', {
    token: tOwner, org: acmeOrg, body: { name: 'AT验收参数', key: CONFIG_KEY, value: '100' },
  });
  check('创建参数', '201', createConfig.status === 201 && !!createConfig.body?.id, `${createConfig.status}`);
  const configId = createConfig.body.id as string;

  const editConfig = await call('PATCH', `/configs/${configId}`, {
    token: tOwner, org: acmeOrg, body: { value: '200' },
  });
  check('编辑参数', '200 + 新值', editConfig.status === 200 && editConfig.body?.value === '200', `${editConfig.status}`);

  const delConfig = await call('DELETE', `/configs/${configId}`, { token: tOwner, org: acmeOrg });
  check('删除参数', '200', delConfig.status === 200, `${delConfig.status}`);

  const allConfigs = await call('GET', '/configs', { token: tOwner, org: acmeOrg });
  const builtin = (allConfigs.body as any[]).find((c) => c.configType === 'YES');
  if (builtin) {
    const delBuiltin = await call('DELETE', `/configs/${builtin.id}`, { token: tOwner, org: acmeOrg });
    check('删除内置参数', '409 CONFIG_BUILTIN', delBuiltin.status === 409 && delBuiltin.body?.code === 'CONFIG_BUILTIN', `${delBuiltin.status} ${delBuiltin.body?.code}`);
  } else {
    check('删除内置参数', '存在内置参数', false, '未找到 configType=Y 的参数');
  }

  /* ==================== 4. 通知公告 ==================== */
  const createNotice = await call('POST', '/notices', {
    token: tOwner, org: acmeOrg,
    body: { title: `AT系统维护公告 ${SUFFIX}`, type: 'NOTICE', content: '本周六凌晨进行系统维护，请提前保存工作。' },
  });
  check('发布公告', '201', createNotice.status === 201 && !!createNotice.body?.id, `${createNotice.status}`);
  const noticeId = createNotice.body.id as string;

  const ownerNotices = await call('GET', '/notices', { token: tOwner, org: acmeOrg });
  const ownerRow = (ownerNotices.body as any[]).find((n) => n.id === noticeId);
  check('发布者已读状态', 'readByMe=true', ownerRow?.readByMe === true, `readByMe=${ownerRow?.readByMe}`);

  // 跨组织隔离
  const globexNotices = await call('GET', '/notices', { token: tGlobex, org: globexOrg });
  const globexLeak = (globexNotices.body as any[]).some((n) => n.id === noticeId);
  check('公告跨组织隔离', 'Globex 看不到', globexLeak === false, `globex ${globexNotices.body?.length} 条，含该公告=${globexLeak}`);

  // 普通成员：可读
  const memberNotices = await call('GET', '/notices', { token: tMember, org: acmeOrg });
  const memberRow = (memberNotices.body as any[]).find((n) => n.id === noticeId);
  check('成员可查看公告', '200 readByMe=false', memberNotices.status === 200 && memberRow?.readByMe === false, `readByMe=${memberRow?.readByMe}`);

  const markRead = await call('POST', `/notices/${noticeId}/read`, { token: tMember, org: acmeOrg });
  const markReadAgain = await call('POST', `/notices/${noticeId}/read`, { token: tMember, org: acmeOrg });
  const memberNotices2 = await call('GET', '/notices', { token: tMember, org: acmeOrg });
  const memberRow2 = (memberNotices2.body as any[]).find((n) => n.id === noticeId);
  check('成员标记已读（幂等）', '201/201 + readByMe=true',
    markRead.status === 201 && markReadAgain.status === 201 && memberRow2?.readByMe === true,
    `${markRead.status}/${markReadAgain.status}, readByMe=${memberRow2?.readByMe}`);

  const memberCreateNotice = await call('POST', '/notices', {
    token: tMember, org: acmeOrg, body: { title: 'hacked', type: 'NOTICE', content: 'x' },
  });
  check('成员发布公告', '403', memberCreateNotice.status === 403, `${memberCreateNotice.status}`);
  const memberDelNotice = await call('DELETE', `/notices/${noticeId}`, { token: tMember, org: acmeOrg });
  check('成员删除公告', '403', memberDelNotice.status === 403, `${memberDelNotice.status}`);

  const delNotice = await call('DELETE', `/notices/${noticeId}`, { token: tOwner, org: acmeOrg });
  check('管理员删除公告', '200', delNotice.status === 200, `${delNotice.status}`);

  /* ==================== 5. 登录日志 ==================== */
  const listLoginLogs = await call('GET', '/login-logs?page=1&pageSize=10', { token: tOwner, org: acmeOrg });
  check('登录日志分页', '200 含 items/total',
    listLoginLogs.status === 200 && Array.isArray(listLoginLogs.body?.items) && typeof listLoginLogs.body?.total === 'number',
    `${listLoginLogs.status} total=${listLoginLogs.body?.total}`);

  const filteredLogs = await call('GET', '/login-logs?status=0&pageSize=5', { token: tOwner, org: acmeOrg });
  const allSuccess = (filteredLogs.body?.items ?? []).every((l: any) => l.status === 0);
  check('登录日志状态过滤', '全部成功', allSuccess, `${filteredLogs.body?.items?.length} 条全成功=${allSuccess}`);

  // 删除最旧一条
  const lastPage = Math.ceil(listLoginLogs.body.total / 20);
  const lastPageRes = await call('GET', `/login-logs?page=${lastPage}&pageSize=20`, { token: tOwner, org: acmeOrg });
  const oldest = lastPageRes.body?.items?.[lastPageRes.body.items.length - 1];
  if (oldest) {
    const delLog = await call('DELETE', `/login-logs/${oldest.id}`, { token: tOwner, org: acmeOrg });
    check('删除单条登录日志', '200', delLog.status === 200, `${delLog.status}`);
  } else {
    check('删除单条登录日志', '存在日志', false, '无日志');
  }

  /* ==================== 6. 系统监控 ==================== */
  const serverInfo = await call('GET', '/monitor/server', { token: tOwner, org: acmeOrg });
  check('服务监控', "200 含 cpu/memory/node",
    serverInfo.status === 200 && !!serverInfo.body?.cpu && !!serverInfo.body?.memory && !!serverInfo.body?.node,
    `${serverInfo.status} cpu=${serverInfo.body?.cpu?.usedPercent}%`);

  const dbInfo = await call('GET', '/monitor/database', { token: tOwner, org: acmeOrg });
  check('数据库会话监控', '200 含 maxConnections/活动',
    dbInfo.status === 200 && !!dbInfo.body?.maxConnections && Array.isArray(dbInfo.body?.stateBreakdown),
    `${dbInfo.status} max=${dbInfo.body?.maxConnections} 连接=${dbInfo.body?.totalConnections}`);

  const cacheInfo = await call('GET', '/monitor/cache', { token: tOwner, org: acmeOrg });
  check('缓存监控', '200 含 enabled 字段',
    cacheInfo.status === 200 && typeof cacheInfo.body?.enabled === 'boolean',
    `${cacheInfo.status} enabled=${cacheInfo.body?.enabled}`);

  const jobsInfo = await call('GET', '/monitor/jobs', { token: tOwner, org: acmeOrg });
  const billingJob = (jobsInfo.body as any[])?.find((j) => j.name.startsWith('BillingLifecycleService'));
  check('定时任务列表', '200 含 billing 任务',
    jobsInfo.status === 200 && !!billingJob,
    `${jobsInfo.status} jobs=${jobsInfo.body?.length}, next=${billingJob?.nextExecution ?? '-'}`);

  if (billingJob) {
    const trigger = await call('POST', `/monitor/jobs/${encodeURIComponent(billingJob.name)}/run`, {
      token: tOwner, org: acmeOrg,
    });
    check('手动触发订阅扫描任务', '201 ok', (trigger.status === 200 || trigger.status === 201) && trigger.body?.ok === true, `${trigger.status} ${JSON.stringify(trigger.body)}`);
  }

  // 在线用户：建立 WS 连接 → 列表含自己 → 强退 → 断开
  const ws = await connectWs(tOwner);
  const ownerUserId = meOwner.id;
  await new Promise((r) => setTimeout(r, 500));
  const onlineInfo = await call('GET', '/monitor/online', { token: tOwner, org: acmeOrg });
  const meOnline = (onlineInfo.body?.connections ?? []).some((c: any) => c.userId === ownerUserId);
  check('在线用户列表含当前连接', 'true', onlineInfo.status === 200 && meOnline,
    `${onlineInfo.status} users=${onlineInfo.body?.totalUsers} conns=${onlineInfo.body?.totalConnections}, 含自己=${meOnline}`);

  const myConn = (onlineInfo.body?.connections ?? []).find((c: any) => c.userId === ownerUserId);
  if (myConn) {
    const forceLogout = await call('DELETE', `/monitor/online/${myConn.socketId}`, { token: tOwner, org: acmeOrg });
    await new Promise((r) => setTimeout(r, 800));
    const onlineAfter = await call('GET', '/monitor/online', { token: tOwner, org: acmeOrg });
    const stillThere = (onlineAfter.body?.connections ?? []).some((c: any) => c.socketId === myConn.socketId);
    check('强制下线', '200 + 连接已消失', forceLogout.status === 200 && !stillThere,
      `${forceLogout.status} stillThere=${stillThere}`);
  }
  ws.disconnect();

  /* ==================== 7. 越权拒绝（MEMBER） ==================== */
  const denied: Array<[string, string, string?]> = [
    ['GET', '/menus', undefined],
    ['GET', '/dict-types', undefined],
    ['GET', '/configs', undefined],
    ['GET', '/login-logs', undefined],
    ['GET', '/monitor/server', undefined],
    ['GET', '/monitor/database', undefined],
    ['GET', '/monitor/jobs', undefined],
    ['GET', '/monitor/online', undefined],
  ];
  for (const [m, p] of denied) {
    const r = await call(m, p, { token: tMember, org: acmeOrg });
    check(`MEMBER 拒绝 ${p}`, '403', r.status === 403, `${r.status}`);
  }
  const memberTriggerJob = await call('POST', `/monitor/jobs/${encodeURIComponent(billingJob?.name ?? 'x')}/run`, {
    token: tMember, org: acmeOrg,
  });
  check('MEMBER 触发定时任务', '403', memberTriggerJob.status === 403, `${memberTriggerJob.status}`);

  /* ==================== 汇总 ==================== */
  // 清空登录日志（最后执行，不影响其他检查）
  const clearLogs = await call('POST', '/login-logs/clear', { token: tOwner, org: acmeOrg });
  check('清空登录日志', '201', clearLogs.status === 201, `${clearLogs.status}`);

  const passed = checks.filter((c) => c.pass).length;
  console.log(`\n=== 结果：${passed}/${checks.length} 通过 ===\n`);

  mkdirSync(join(process.cwd(), '..', '..', 'evidence'), { recursive: true });
  const lines = [
    `# TeamSpace 系统管理/监控验收证据（AT10）`,
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
  writeFileSync(join(process.cwd(), '..', '..', 'evidence', 'acceptance-AT10-system.md'), lines.join('\n'));

  await prisma.$disconnect();
  process.exit(passed === checks.length ? 0 : 1);
}

main().catch(async (e) => {
  console.error('验收脚本异常：', e);
  await prisma.$disconnect();
  process.exit(1);
});
