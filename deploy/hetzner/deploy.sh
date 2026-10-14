#!/usr/bin/env bash
# TeamSpace — Hetzner VPS 一键部署脚本
# 前置：cloud-init 已完成基础环境；/opt/teamspace/.env.production 已填写。
# 用法：sudo ./deploy.sh
set -euo pipefail

APP_DIR="/opt/teamspace"
ENV_FILE="${APP_DIR}/.env.production"

cd "$APP_DIR"

if [ ! -f "$ENV_FILE" ]; then
  echo "❌ 缺少 $ENV_FILE，请先复制 .env.production.example 并填写密钥" >&2
  exit 1
fi

echo "1/6 拉取最新代码..."
git fetch --all
git reset --hard origin/main

echo "2/6 构建并启动容器..."
docker compose -f docker-compose.prod.yml --env-file "$ENV_FILE" up -d --build

echo "3/6 等待数据库就绪..."
until docker compose -f docker-compose.prod.yml exec -T postgres pg_isready -U "$(grep POSTGRES_USER "$ENV_FILE" | cut -d= -f2)" -d "$(grep POSTGRES_DB "$ENV_FILE" | cut -d= -f2)" 2>/dev/null; do
  sleep 2
done

echo "4/6 创建最小权限应用账号（首次）..."
# 若 teamspace_app 已存在则跳过
docker compose -f docker-compose.prod.yml exec -T postgres psql -U "$(grep POSTGRES_USER "$ENV_FILE" | cut -d= -f2)" -d "$(grep POSTGRES_DB "$ENV_FILE" | cut -d= -f2)" <<'SQL' || true
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'teamspace_app') THEN
    CREATE ROLE teamspace_app LOGIN PASSWORD 'PLACEHOLDER_APP_PWD' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END $$;
SQL

echo "5/6 数据库迁移 + 种子数据..."
docker compose -f docker-compose.prod.yml exec -T api sh -c "npx prisma migrate deploy && npx ts-node prisma/seed.ts" || echo "⚠️ seed 返回非零（幂等可忽略）"

echo "6/6 配置 Nginx 域名 + HTTPS 证书..."
APP_DOMAIN="$(grep '^WEB_URL=' "$ENV_FILE" | cut -d= -f2 | sed 's|https://||;s|/||')"
API_DOMAIN="$(grep '^APP_URL=' "$ENV_FILE" | cut -d= -f2 | sed 's|https://||;s|/||')"

sed -i "s/app.example.com/${APP_DOMAIN}/g; s/api.example.com/${API_DOMAIN}/g" /etc/nginx/conf.d/teamspace.conf
nginx -t && systemctl reload nginx

certbot --nginx -d "$APP_DOMAIN" -d "$API_DOMAIN" --non-interactive --agree-tos -m admin@"${APP_DOMAIN#*.}" --redirect || echo "⚠️ certbot 失败，请检查 DNS 是否已指向本机"

echo ""
echo "✅ 部署完成"
echo "   Web: https://${APP_DOMAIN}"
echo "   API: https://${API_DOMAIN}/api/v1"
echo "   健康检查: https://${API_DOMAIN}/api/v1/health/ready"
