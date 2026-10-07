# TeamSpace 上线方案

两套部署路径：**A. 自托管 Docker Compose**（单 VPS 即可跑全套）；**B. 云托管**（免运维，按需付费）。
凭据一律走环境变量，不进仓库（见 `.env.production.example`）。

## 架构总览

```
浏览器 ──HTTPS──> Nginx ──> web (Next.js :3000)
                    └────> api (NestJS :3001, /api/v1 + WebSocket)
                              ├── PostgreSQL 16（RLS 多租户隔离）
                              └── Redis 7（Socket.IO 集群广播 + 缓存）
```

## 方案 A：自托管 Docker Compose

### 1. 准备

- 一台 Linux VPS（2C4G 起），安装 Docker + Docker Compose 插件
- 两个域名（如 `app.example.com` / `api.example.com`）DNS 指向 VPS
- `cp .env.production.example .env.production`，填好全部 `__生成__` 项
  - `JWT_SECRET`：`openssl rand -base64 48`
  - 证书：`certbot certonly --standalone -d app.example.com -d api.example.com`

### 2. 启动

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
```

### 3. 初始化数据库（仅首次）

```bash
# 建最小权限应用账号（先改 deploy/init-db.sql 里的密码）
docker compose -f docker-compose.prod.yml exec postgres \
  psql -U $POSTGRES_USER -d $POSTGRES_DB -f /deploy/init-db.sql   # 或将文件挂载进容器执行

# 迁移 + 种子数据 + RLS 策略
docker compose -f docker-compose.prod.yml exec api \
  sh -c "npx prisma migrate deploy && npx ts-node prisma/seed.ts"
```

### 4. 反代与 HTTPS

`deploy/nginx.conf` 已给出双域名配置（含 Socket.IO 的 Upgrade 头与 80→443 跳转），
复制到宿主机 Nginx 或用 Caddy/Traefik 等价替换。

### 5. 升级与备份

```bash
# 升级：拉代码后重建
git pull && docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml exec api npx prisma migrate deploy

# 备份：每日 pg_dump 到对象存储（cron 示例）
0 3 * * * docker compose -f docker-compose.prod.yml exec -T postgres \
  pg_dump -U teamspace teamspace | gzip > /backups/teamspace-$(date +\%F).sql.gz
```

注意：compose 内 postgres/redis 不暴露宿主端口，仅内部网络可达；对外只有 nginx 443。

## 方案 B：云托管（免运维）

| 组件 | 服务 | 说明 |
| --- | --- | --- |
| 前端 | Vercel | 根目录 `apps/web`；环境变量 `NEXT_PUBLIC_API_URL`、`NEXT_PUBLIC_WS_URL` 指向 API 域名 |
| API | Render / Railway | 根目录 `apps/api`；构建 `pnpm install && pnpm build`，启动 `node dist/src/main.js`；打开 WebSocket 支持 |
| 数据库 | Neon（Serverless Postgres 16） | 建库后跑 `prisma migrate deploy` + `deploy/init-db.sql` + `seed`；Neon 支持 RLS |
| Redis | Upstash（TLS） | 传统 TCP 模式，把 `REDIS_URL` 换成 `rediss://...` |

### 步骤

1. **Neon**：建项目 → 拿两个连接串（owner 做迁移/seed，另建最小权限角色跑应用，参照 `deploy/init-db.sql`）。
2. **Upstash**：建 Redis → 复制 `rediss://` URL。
3. **Render/Railway 部署 API**：
   - Build：`corepack enable && pnpm install --frozen-lockfile && pnpm --filter @teamspace/api exec prisma generate && pnpm --filter @teamspace/api build`
   - Start：`node apps/api/dist/src/main.js`（Render 上把仓库根目录作为 build context）
   - 环境变量同 `.env.production.example`（`APP_URL`/`WEB_URL` 换成云端域名；`DATABASE_URL` 用 Neon 最小权限角色）
   - 首次部署后在 Shell 里执行 `npx prisma migrate deploy && npx ts-node prisma/seed.ts`
4. **Vercel 部署前端**：导入仓库，Root Directory 选 `apps/web`；配 `NEXT_PUBLIC_API_URL=https://<api域名>/api/v1`、`NEXT_PUBLIC_WS_URL=https://<api域名>`。
5. **Stripe/Resend/OAuth**：在各自控制台把回调地址改为生产域名；密钥填到 API 的环境变量面板。

### 两方案取舍

- **A** 成本可控、数据自持，适合有运维能力的团队；扩到多节点时 Socket.IO 经 Redis adapter 广播无需改代码（监控页的在线用户跨节点聚合已验证）。
- **B** 零运维、弹性伸缩，适合快速上线；注意 Render 免费档会休眠，WebSocket 场景至少选付费常驻实例。

## 上线前检查清单

- [ ] `.env.production` 全部密钥已生成且未提交仓库
- [ ] `DATABASE_URL` 用最小权限角色（NOSUPERUSER/NOBYPASSRLS），admin 连接串仅迁移/seed 用
- [ ] `prisma migrate deploy` + seed 完成，RLS 已启用（`scripts/enable-rls.ts`）
- [ ] Nginx/平台已开启 WebSocket Upgrade（否则 IM 与在线状态不可用）
- [ ] CORS 仅允许 `WEB_URL`（`main.ts` 按环境变量收敛）
- [ ] 备份策略生效（A：pg_dump cron；B：Neon 自动快照 + PITR）
- [ ] 监控页（/monitor/server、/monitor/database）用 OWNER 账号实测可访问
