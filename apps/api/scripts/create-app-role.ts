/**
 * 创建应用专用最小权限数据库角色 teamspace_app（NOSUPERUSER / NOBYPASSRLS）。
 * RLS 只对非超级用户且无 BYPASSRLS 的角色真正生效。
 *
 * 运行：npx ts-node --transpile-only scripts/create-app-role.ts
 * 幂等：角色已存在时补齐密码与授权。
 */
import { PrismaClient } from '@prisma/client';
import 'dotenv/config';

const prisma = new PrismaClient();

const APP_ROLE = 'teamspace_app';
const APP_PWD = 'teamspace_app_pwd';

// 表 owner：取管理连接串用户名（嵌入式为 teamspace，本机安装通常为 postgres）
const adminUrl = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL ?? '';
const TABLE_OWNER = decodeURIComponent(
  adminUrl.replace(/^[a-zA-Z]+:\/\/([^:]+):.*$/, '$1'),
);

async function main() {
  await prisma.$executeRawUnsafe(`DO $$
  BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${APP_ROLE}') THEN
      CREATE ROLE ${APP_ROLE} LOGIN PASSWORD '${APP_PWD}'
        NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT;
    ELSE
      ALTER ROLE ${APP_ROLE} LOGIN PASSWORD '${APP_PWD}'
        NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT;
    END IF;
  END $$;`);

  await prisma.$executeRawUnsafe('GRANT USAGE ON SCHEMA public TO teamspace_app');
  await prisma.$executeRawUnsafe('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO teamspace_app');
  await prisma.$executeRawUnsafe('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO teamspace_app');

  // 未来 db push 新建表（owner=teamspace）时自动授权
  await prisma.$executeRawUnsafe(`
    ALTER DEFAULT PRIVILEGES FOR ROLE ${TABLE_OWNER} IN SCHEMA public
      GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO teamspace_app`);
  await prisma.$executeRawUnsafe(`
    ALTER DEFAULT PRIVILEGES FOR ROLE ${TABLE_OWNER} IN SCHEMA public
      GRANT USAGE, SELECT ON SEQUENCES TO teamspace_app`);

  const rows: any = await prisma.$queryRaw`
    SELECT rolname, rolsuper, rolbypassrls FROM pg_roles
    WHERE rolname IN ('teamspace', 'teamspace_app') ORDER BY rolname`;
  console.log('roles:', rows);
  console.log('teamspace_app ready (use it in DATABASE_URL; admin scripts use DATABASE_ADMIN_URL).');
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
