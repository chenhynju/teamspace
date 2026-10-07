-- 首次部署初始化：创建最小权限应用账号并授权（用 postgres 超管执行一次）
-- psql -U postgres -d teamspace -f deploy/init-db.sql
CREATE USER teamspace_app WITH PASSWORD 'CHANGE_ME_STRONG_PASSWORD'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;

GRANT CONNECT ON DATABASE teamspace TO teamspace_app;
GRANT USAGE ON SCHEMA public TO teamspace_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO teamspace_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO teamspace_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO teamspace_app;
-- 系统监控读取 pg_stat_activity 全部会话（仅统计，不含业务数据）
GRANT pg_read_all_stats TO teamspace_app;
