/**
 * 一次性授权脚本：让应用账号（teamspace_app）能读取全部数据库统计。
 *
 * 默认情况下普通账号只能看到自己在 pg_stat_activity 中的会话行；
 * pg_read_all_stats（PG10+ 预设角色）授予后可看到全部会话，仅读统计、
 * 不增加任何业务数据访问权，符合最小权限原则。
 *
 * 用 DATABASE_ADMIN_URL（超级用户）执行。
 */
import { PrismaClient } from '@prisma/client';
import 'dotenv/config';

const admin = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL } },
});

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL 未设置');
  const appUser = decodeURIComponent(new URL(url).username);

  await admin.$executeRawUnsafe(`GRANT pg_read_all_stats TO "${appUser}"`);
  console.log(`已授予 ${appUser} 角色 pg_read_all_stats`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => admin.$disconnect());
