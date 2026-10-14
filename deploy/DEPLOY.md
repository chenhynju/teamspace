# TeamSpace 上线方案

三条部署路径：**A. 自托管**（Hetzner / 任意 VPS，Docker Compose + Nginx）；**B. 云托管**（Vercel + Render/Railway + Neon + Upstash，免运维）；**C. AWS ECS Fargate**（Terraform IaC + GitHub Actions CI/CD，生产级弹性）。凭据一律走环境变量 / Secrets Manager，不进仓库（见 `.env.production.example` 与 `terraform/terraform.tfvars.example`）。

## 架构总览

```
浏览器 ──HTTPS──> ALB/Nginx ──> web (Next.js :3000)
                       └────> api (NestJS :3001, /api/v1 + WebSocket)
                                 ├── PostgreSQL 16（RLS 多租户隔离）
                                 └── Redis 7（Socket.IO 集群广播 + 缓存）
```

## 路径 C：AWS ECS Fargate（Terraform + GitHub Actions）

推荐用于生产。基础设施与应用发布解耦：Terraform 管稳态资源，CD 工作流管镜像与滚动部署。

### 1. 前置准备

- AWS 账号，已创建 S3 bucket（存 Terraform state）与 DynamoDB 表（state 锁），例如：
  ```bash
  aws s3 mb s3://teamspace-tfstate
  aws dynamodb create-table --table-name teamspace-tfstate-lock \
    --attribute-definitions AttributeName=LockID,AttributeType=S \
    --key-schema AttributeName=LockID,KeyType=HASH \
    --billing-mode PAY_PER_REQUEST
  ```
- GitHub OIDC 与 AWS IAM Role 对接（`cd.yml` / `terraform.yml` 用 OIDC 免长期密钥）。Role 信任策略允许 GitHub Actions 扮演，附加 `AmazonECS_FullAccess`、`AmazonEC2ContainerRegistryFullAccess`、`CloudWatchLogsFullAccess` 等最小权限策略。
- GitHub 仓库配置 Secrets / Variables：
  - Secrets：`AWS_DEPLOY_ROLE_ARN`、`DB_PASSWORD`、`APP_DB_PASSWORD`、`REDIS_AUTH_TOKEN`、`JWT_SECRET`
  - Variables：`AWS_REGION`、`NEXT_PUBLIC_API_URL`、`NEXT_PUBLIC_WS_URL`

### 2. 配置 Terraform 变量

```bash
cd terraform
cp terraform.tfvars.example terraform.tfvars   # .tfvars 已被 .gitignore
# 填入域名、RDS/Redis 密码、镜像占位（首次可用 public.ecr.aws/nginx 之类占位，CD 会覆盖）
```

### 3. 首次部署基础设施

```bash
terraform init
terraform plan -var-file=terraform.tfvars
terraform apply -var-file=terraform.tfvars
```

Terraform 会创建：VPC（2 AZ 公/私有子网 + NAT）、ECS 集群、ALB（HTTPS + WebSocket）、RDS PostgreSQL（私有、加密、7 天 PITR）、ElastiCache Redis（TLS + AUTH）、ECR 仓库、IAM 角色、CloudWatch 日志组 + 告警 + 仪表盘、Route53 + ACM 证书（DNS 自动校验）。

### 4. 初始化数据库

```bash
# 用 RDS 主账号连入（可在 ECS 任务里 exec，或用 SSM/堡垒机）
psql "postgresql://teamspace:<主密码>@<rds-endpoint>:5432/teamspace" -f deploy/init-db.sql
# 修改 init-db.sql 中的密码为 terraform.tfvars 里的 app_db_password
```

### 5. 推送镜像并部署应用

合入 main 分支即触发 `.github/workflows/cd.yml`：
1. 构建 `apps/api` 与 `apps/web` 多阶段镜像
2. 推送至 ECR（tag = commit sha + latest）
3. 下载 ECS 任务定义 → 替换镜像 → 注册新版本 → 更新服务
4. 等待服务稳定（滚动部署，最小 100% 可用 + circuit breaker 自动回滚）

### 6. 验证

- `terraform output` 查看 ALB DNS、ECS 服务名、CloudWatch 仪表盘 URL
- 访问 `https://api.<domain>/api/v1/health/ready` 确认 `status: ok`
- CloudWatch 仪表盘查看 CPU / 请求数 / 5xx

> 镜像版本由 CD 管理；Terraform 对任务定义的 `container_definitions` 设了 `ignore_changes`，避免 `terraform apply` 回滚线上镜像。修改环境变量时临时移除该 lifecycle 规则即可。

---

## 路径 A：自托管 Docker Compose（Hetzner / 任意 VPS）

### 1. 准备

- 一台 Linux VPS（Hetzner CX22 起，2C4G），Ubuntu 22.04/24.04
- 两个域名（如 `app.example.com` / `api.example.com`）DNS 指向 VPS
- `cp .env.production.example .env.production`，填好全部 `__生成__` 项

### 2a. 全自动：Hetzner cloud-init

在 Hetzner Console 创建服务器时，把 `deploy/hetzner/cloud-init.yml` 粘贴到 **User data**。启动后自动安装 Docker / Nginx / UFW / fail2ban / certbot 并克隆仓库。SSH 登录后：

```bash
cd /opt/teamspace
cp .env.production.example .env.production  # 填密钥
sudo ./deploy/hetzner/deploy.sh              # 构建、迁移、配 Nginx + HTTPS
```

### 2b. 手动

```bash
# 安装 Docker + Compose 插件 + Nginx
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
```

### 3. 初始化数据库（仅首次）

```bash
# 建最小权限应用账号（先改 deploy/init-db.sql 里的密码）
docker compose -f docker-compose.prod.yml exec postgres \
  psql -U $POSTGRES_USER -d $POSTGRES_DB -f /deploy/init-db.sql

# 迁移 + 种子数据 + RLS 策略
docker compose -f docker-compose.prod.yml exec api \
  sh -c "npx prisma migrate deploy && npx ts-node prisma/seed.ts"
```

### 4. 反代与 HTTPS

`deploy/nginx.conf` 已给出双域名配置（含 Socket.IO 的 Upgrade 头与 80→443 跳转），
复制到 `/etc/nginx/conf.d/teamspace.conf`，替换域名后 `nginx -t && systemctl reload nginx`。
证书用 certbot：`certbot --nginx -d app.example.com -d api.example.com`。

### 5. 安全加固

```bash
ufw allow 22/tcp && ufw allow 80/tcp && ufw allow 443/tcp && ufw enable
systemctl enable --now fail2ban
```

### 6. 升级与备份

```bash
# 升级：拉代码后重建
git pull && docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml exec api npx prisma migrate deploy

# 备份：每日 pg_dump 到对象存储（cron 示例）
0 3 * * * docker compose -f docker-compose.prod.yml exec -T postgres \
  pg_dump -U teamspace teamspace | gzip > /backups/teamspace-$(date +\%F).sql.gz
```

注意：compose 内 postgres/redis 不暴露宿主端口，仅内部网络可达；对外只有 nginx 443。

---

## 路径 B：云托管（免运维）

| 组件 | 服务 | 说明 |
| --- | --- | --- |
| 前端 | Vercel | 根目录 `apps/web`；环境变量 `NEXT_PUBLIC_API_URL`、`NEXT_PUBLIC_WS_URL` 指向 API 域名 |
| API | Render / Railway | 根目录 `apps/api`；构建 `pnpm install && pnpm build`，启动 `node dist/main.js`；打开 WebSocket 支持 |
| 数据库 | Neon（Serverless Postgres 16） | 建库后跑 `prisma migrate deploy` + `deploy/init-db.sql` + `seed`；Neon 支持 RLS |
| Redis | Upstash（TLS） | 传统 TCP 模式，把 `REDIS_URL` 换成 `rediss://...` |

### 步骤

1. **Neon**：建项目 → 拿两个连接串（owner 做迁移/seed，另建最小权限角色跑应用，参照 `deploy/init-db.sql`）。
2. **Upstash**：建 Redis → 复制 `rediss://` URL。
3. **Render/Railway 部署 API**：
   - Build：`corepack enable && pnpm install --frozen-lockfile && pnpm --filter @teamspace/api exec prisma generate && pnpm --filter @teamspace/api build`
   - Start：`node apps/api/dist/main.js`（Render 上把仓库根目录作为 build context）
   - 环境变量同 `.env.production.example`（`APP_URL`/`WEB_URL` 换成云端域名；`DATABASE_URL` 用 Neon 最小权限角色）
   - 首次部署后在 Shell 里执行 `npx prisma migrate deploy && npx ts-node prisma/seed.ts`
4. **Vercel 部署前端**：导入仓库，Root Directory 选 `apps/web`；配 `NEXT_PUBLIC_API_URL=https://<api域名>/api/v1`、`NEXT_PUBLIC_WS_URL=https://<api域名>`。
5. **Stripe/Resend/OAuth**：在各自控制台把回调地址改为生产域名；密钥填到 API 的环境变量面板。

### 三方案取舍

- **C (AWS ECS)**：生产首选，弹性伸缩 + 托管数据层 + CloudWatch 监控；成本随用量增长，适合有一定流量的产品。
- **A (Hetzner VPS)**：成本可控（约 €5/月起）、数据自持，适合 MVP / 小团队；扩到多节点时 Socket.IO 经 Redis adapter 广播无需改代码。
- **B (云托管)**：零运维、按用量付费，适合快速验证；Render 免费档会休眠，WebSocket 场景至少选付费常驻实例。

## 上线前检查清单

- [ ] `.env.production` / `terraform.tfvars` 全部密钥已生成且未提交仓库
- [ ] `DATABASE_URL` 用最小权限角色（NOSUPERUSER/NOBYPASSRLS），admin 连接串仅迁移/seed 用
- [ ] `prisma migrate deploy` + seed 完成，RLS 已启用（`scripts/enable-rls.ts`）
- [ ] Nginx/ALB 已开启 WebSocket Upgrade（否则 IM 与在线状态不可用）
- [ ] CORS 仅允许 `WEB_URL`（`main.ts` 按环境变量收敛）
- [ ] 备份策略生效（A：pg_dump cron；B：Neon 自动快照 + PITR；C：RDS PITR 7 天）
- [ ] 监控页（/monitor/server、/monitor/database）用 OWNER 账号实测可访问
- [ ] CloudWatch 告警已配置通知渠道（SNS → 邮件/钉钉/Slack）
