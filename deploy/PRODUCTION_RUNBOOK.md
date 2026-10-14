# TeamSpace 生产上线操作手册

> 适用路径：**AWS ECS Fargate + Terraform + GitHub Actions**（主路径）。
> 本手册是给**你本人**照着执行的 checklist；所有命令都在你本地或 AWS Console 操作，模型不会替你跑。
> 全程不往仓库提交任何真实密钥。

---

## 0. 前置条件

| 项 | 要求 | 备注 |
| --- | --- | --- |
| AWS 账号 | 已开通账单 | 首次部署月成本预估 **$30–$60**（RDS t4g.micro + ElastiCache t4g.micro + 1 Fargate + NAT + ALB） |
| 域名 | 一个可管理 DNS 的域名 | 建议用 Route53；外部域名也可，需手动加 CNAME |
| GitHub 仓库 | 已 push 到 `chenhynju/teamspace` | 必须是你能改 Secrets 的仓库 |
| 本地工具 | `aws` CLI、`terraform`、`git` | terraform 可用 `winget install Hashicorp.Terraform` |
| 邮箱 | 用于 Stripe/Resend/OAuth 回调 | 可选，不配置对应功能就跳过 |

> **预算提示**：NAT Gateway 是固定成本（~$33/月），即使没流量也收费。如果想压成本，可在 `terraform/network.tf` 把 `enable_nat_gateway` 设为 `false`，但 ECS 任务将无法拉外网镜像/调 Resend/Stripe——生产不建议关。

---

## 1. 域名准备（约 10 分钟）

### 1.1 Route53（推荐）

1. AWS Console → Route53 → **Create hosted zone** → 输入你的域名（如 `teamspace.dev`）→ Type: Public。
2. 记下 **Hosted zone ID**（形如 `Z0123456789ABCDEF`）。
3. 去域名注册商处，把 NS 记录改成 Route53 给出的 4 条 NS（如 `ns-xxxx.awsdns-xx.org`）。
4. 等待 DNS 生效（5 分钟–48 小时）。验证：`dig NS teamspace.dev` 应返回 AWS 的 NS。

### 1.2 外部 DNS（备选）

- 不走 Route53 也行：`terraform.tfvars` 里把 `route53_zone_id` 留空，Terraform 不会建 DNS 记录。
- 部署完后手动在你的 DNS 服务商加两条 A 记录（alias 到 ALB），或用 CNAME 指向 ALB DNS。
- ACM 证书验证会卡在 DNS 验证环节——需手动按 Terraform output 给出的 CNAME 记录添加。

---

## 2. AWS OIDC + IAM Role（让 GitHub Actions 安全访问 AWS）

> 不用长期 Access Key，用 OIDC 临时凭证。这是 AWS 官方推荐做法。

### 2.1 创建 OIDC Provider

AWS Console → IAM → Identity providers → **Add provider**：
- Provider type: **OpenID Connect**
- Provider URL: `https://token.actions.githubusercontent.com` → 点 **Get thumbprint**
- Audience: `sts.amazonaws.com`
- Add provider

### 2.2 创建部署 Role

IAM → Roles → **Create role** → Custom trust policy，粘贴（把 `<ACCOUNT_ID>` 换成你的 AWS 账号 ID）：

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::<ACCOUNT_ID>:oidc-provider/token.actions.githubusercontent.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
        },
        "StringLike": {
          "token.actions.githubusercontent.com:sub": "repo:chenhynju/teamspace:*"
        }
      }
    }
  ]
}
```

Role 名建议：`teamspace-github-actions-deploy`。

### 2.3 附加权限策略

给这个 Role 挂以下 **AWS 托管策略**（生产可再细化，先跑通）：
- `AdministratorAccess` ← **Terraform 需要创建各种资源，先用这个跑通；上线后再收缩为自定义策略**
- 或者自定义最小策略（见附录 A）

### 2.4 记录 Role ARN

形如 `arn:aws:iam::<ACCOUNT_ID>:role/teamspace-github-actions-deploy`，待会儿填到 GitHub Secrets。

---

## 3. Terraform State 后端（S3 + DynamoDB）

在你本地终端执行（确保 `aws` CLI 已配好凭证，且是能建 S3/DynamoDB 的账号）：

```bash
# 1. 建 state bucket（名字全局唯一，改成你自己的）
aws s3 mb s3://teamspace-tfstate-<你的后缀> --region us-east-1
aws s3api put-bucket-versioning --bucket teamspace-tfstate-<你的后缀> --versioning-configuration Status=Enabled
aws s3api put-bucket-encryption --bucket teamspace-tfstate-<你的后缀> \
  --server-side-encryption-configuration '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'
aws s3api put-public-access-block --bucket teamspace-tfstate-<你的后缀> \
  --public-access-block-configuration "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true"

# 2. 建锁表
aws dynamodb create-table \
  --table-name teamspace-tfstate-lock \
  --attribute-definitions AttributeName=LockID,AttributeType=S \
  --key-schema AttributeName=LockID,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  --region us-east-1
```

### 3.1 修改 terraform/main.tf 的 backend 配置

打开 `terraform/main.tf`，把 backend 块里的 bucket 名改成你刚建的：

```hcl
backend "s3" {
  bucket         = "teamspace-tfstate-<你的后缀>"
  key            = "production/terraform.tfstate"
  region         = "us-east-1"
  dynamodb_table = "teamspace-tfstate-lock"
  encrypt        = true
}
```

---

## 4. GitHub Secrets / Variables 配置

仓库 → Settings → Secrets and variables → Actions。

### 4.1 Secrets（点 New repository secret）

| Secret 名 | 值 | 生成方式 |
| --- | --- | --- |
| `AWS_DEPLOY_ROLE_ARN` | `arn:aws:iam::<ACCOUNT_ID>:role/teamspace-github-actions-deploy` | 步骤 2.4 拿到 |
| `DB_PASSWORD` | RDS 主密码 | `openssl rand -base64 24` |
| `APP_DB_PASSWORD` | 应用账号密码 | `openssl rand -base64 24`（与 init-db.sql 一致） |
| `REDIS_AUTH_TOKEN` | Redis AUTH | `openssl rand -base64 24` |
| `JWT_SECRET` | JWT 签名密钥 | `openssl rand -base64 48` |

### 4.2 Variables（点 Variables 标签 → New repository variable）

| Variable 名 | 值 |
| --- | --- |
| `AWS_REGION` | `us-east-1`（或你选的区域） |
| `NEXT_PUBLIC_API_URL` | `https://api.<你的域名>/api/v1` |
| `NEXT_PUBLIC_WS_URL` | `https://api.<你的域名>` |

---

## 5. 首次 Terraform Apply（约 15–20 分钟）

### 5.1 填写变量

```bash
cd terraform
cp terraform.tfvars.example terraform.tfvars
```

编辑 `terraform.tfvars`，**必填项**：
- `api_image` / `web_image`：首次用占位镜像，比如 `public.ecr.aws/nginx/nginx:latest`（CD 后续会覆盖）
  - 或先留空，先不建 ECS 服务——但 Terraform 会报错，所以必须给值
- `app_url`：`https://api.<你的域名>`
- `web_url`：`https://app.<你的域名>`
- `domain_name`：`<你的域名>`
- `route53_zone_id`：步骤 1.1 的 Zone ID
- `jwt_secret`、`db_password`、`app_db_password`、`redis_auth_token`：与步骤 4.1 的 Secrets **完全一致**
- 其他可选（Stripe/Google/GitHub）留空即可

### 5.2 初始化并预览

```bash
terraform init
terraform plan -var-file=terraform.tfvars
```

仔细看 plan 输出，确认资源数（约 40–50 个）、区域、规格无误。重点检查：
- RDS 实例规格（默认 `db.t4g.micro`，符合免费档但超免费期后收费）
- `desired_count`（默认 1，省钱）
- 没有意外的公网暴露

### 5.3 执行

```bash
terraform apply -var-file=terraform.tfvars
```

输入 `yes` 确认。等待 15–20 分钟（RDS 和 ElastiCache 创建较慢）。

成功后 `terraform output` 会输出：
- `alb_dns_name`：ALB 的 DNS
- `ecr_api_repo` / `ecr_web_repo`：ECR 仓库地址
- `rds_endpoint` / `redis_endpoint`：内网端点

---

## 6. 数据库初始化（创建最小权限账号）

RDS 在私有子网，不能直连。两种方式：

### 方式 A：通过 ECS 任务 exec（推荐）

等 CD 首次部署后，用 SSM Session Manager 或 ECS Exec：

```bash
# 找到一个 API 任务
TASK_ID=$(aws ecs list-tasks --cluster teamspace --service-name teamspace-api --query 'taskArns[0]' --output text)

# 进容器
aws ecs execute-command \
  --cluster teamspace \
  --task $TASK_ID \
  --container api \
  --interactive \
  --command "sh"
```

容器内执行（把 `<APP_DB_PASSWORD>` 换成你设的值）：

```bash
# 容器里装 psql（alpine）
apk add --no-cache postgresql-client

# 用主账号连 RDS，建应用账号
psql "postgresql://teamspace:<DB_PASSWORD>@<RDS_ENDPOINT>:5432/teamspace" -c \
  "CREATE USER teamspace_app WITH PASSWORD '<APP_DB_PASSWORD>' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;"
psql "postgresql://teamspace:<DB_PASSWORD>@<RDS_ENDPOINT>:5432/teamspace" -c \
  "GRANT CONNECT ON DATABASE teamspace TO teamspace_app;"
# ... 其余授权见 deploy/init-db.sql，逐条执行
```

### 方式 B：临时开一个堡垒机 EC2

在公有子网起一个 Amazon Linux EC2，装 psql，连 RDS 执行 `deploy/init-db.sql`。用完销毁。

> ⚠️ `init-db.sql` 里的密码要改成你 `terraform.tfvars` 里的 `app_db_password`。

---

## 7. 首次 CD 部署（推送镜像 + 起服务）

### 7.1 触发 CD

推一个空 commit 到 main：

```bash
git commit --allow-empty -m "chore: trigger first production deploy"
git push origin main
```

去 GitHub Actions 看 **CD — Build & Deploy to ECS** 工作流：
1. Build API & Web 镜像 → 推 ECR
2. 更新 ECS 任务定义（替换镜像为本次 commit sha）
3. ECS 滚动部署 → 等待服务稳定

约 5–8 分钟。

### 7.2 数据库迁移 + 种子

首次部署后，API 容器里没有数据，需要跑迁移：

```bash
# ECS exec 进 API 容器
aws ecs execute-command --cluster teamspace --task $TASK_ID --container api --interactive --command "sh"

# 容器内
npx prisma migrate deploy
npx ts-node prisma/seed.ts        # 种子数据（含 owner@acme.dev / Passw0rd!）
node prisma/enable-rls.ts          # 启用 RLS 策略（如项目有此脚本）
```

> 生产注意：`seed.ts` 里有测试账号，生产环境建议跑一个精简版 seed（只建角色/菜单，不建测试组织）。

---

## 8. 验收验证

### 8.1 健康检查

```bash
curl https://api.<你的域名>/api/v1/health/ready
# 期望：{"status":"ok","uptimeSeconds":...,"checks":{"database":"up","redis":"up"}}
```

```bash
curl https://app.<你的域名>/api/health
# 期望：{"status":"ok","ts":...}
```

### 8.2 登录测试

浏览器打开 `https://app.<你的域名>/login`，用 `owner@acme.dev / Passw0rd!` 登录。
- 能看到侧边栏 → 前端正常
- 打开「系统监控 → 服务器」→ 有数据 → API + DB 正常
- 打开「消息」→ 能加载 → Redis + WebSocket 正常

### 8.3 CloudWatch

AWS Console → CloudWatch → Dashboards → `teamspace-overview`，确认 CPU、请求数有数据。
Logs → Log groups → `/ecs/teamspace/api` 能看到结构化 JSON 日志。

---

## 9. 回滚预案

| 场景 | 操作 |
| --- | --- |
| 新版本 API 崩了 | AWS Console → ECS → 服务 → **Update** → Revision 选上一个版本 → Deploy |
| 数据库迁移搞坏了 | RDS → 实例 → **Restore to point in time** → 选故障前时间点 → 恢复到新实例 → 改 ECS 环境变量指向新实例 |
| Terraform 改坏了 | `git revert` 那次 Terraform PR → `terraform apply` 恢复；或从 S3 找旧 state 版本恢复 |
| 镜像有问题 | ECR 里旧 tag 还在（保留 30 个），把任务定义镜像改回旧 tag 重新部署 |

---

## 10. 日常运维

### 10.1 备份
- RDS：自动 PITR（7 天），Terraform 已配
- Redis：自动快照（7 天）
- 额外：每月手动 `pg_dump` 存 S3

### 10.2 监控告警
- CloudWatch 告警已建（CPU > 80%、5xx > 10、不健康实例、RDS 存储 < 2GB）
- 去 SNS 建一个 Topic，订阅你的邮箱，然后在 Terraform 里把 `alarm_sns_topic_arn` 填上重新 apply

### 10.3 扩容
- 改 `terraform.tfvars` 的 `api_desired_count` / `web_desired_count` → `terraform apply`
- 或在 ECS Console 直接改 desired count

### 10.4 密钥轮换
- RDS 密码：RDS Console → Modify → 改密码 → 同步更新 GitHub Secret `DB_PASSWORD` → 重新 apply
- JWT：改 GitHub Secret `JWT_SECRET` → 重新部署（会踢掉所有登录态）

### 10.5 成本控制
- 非生产时段把 `desired_count` 设 0（停服省钱）
- RDS/ElastiCache 没法停，只能删（注意数据）
- 长期省钱可考虑预留实例或迁移到 Hetzner（见 `deploy/DEPLOY.md` 路径 A）

---

## 附录 A：最小权限 IAM 策略（可选，跑通后再切）

生产环境不建议给 `AdministratorAccess`。可创建自定义策略，至少包含：

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {"Effect":"Allow","Action":["ec2:*","ecs:*","ecr:*","rds:*","elasticache:*",
      "elasticloadbalancing:*","logs:*","cloudwatch:*","route53:*","acm:*",
      "iam:PassRole","iam:CreateRole","iam:AttachRolePolicy","iam:CreatePolicy",
      "s3:*","dynamodb:*"],"Resource":"*"}
  ]
}
```

再进一步可按资源 ARN 细化，但维护成本高，个人项目够用即可。

---

## 附录 B：常见问题

**Q: `terraform apply` 卡在 ACM 证书验证？**
A: DNS 还没生效。`dig CNAME <acm验证域名>` 确认能解析到。Route53 一般 5 分钟内，外部 DNS 可能更久。

**Q: ECS 服务一直 unstable，任务不停重启？**
A: 看 CloudWatch Logs `/ecs/teamspace/api`。常见原因：
- 数据库连不上 → 检查 RDS 安全组是否放行了 ECS 安全组的 5432
- Redis 连不上 → 检查 AUTH token 和 TLS（`rediss://`）
- 环境变量缺失 → 看任务定义的 environment

**Q: `terraform apply` 报 `Error: error creating Security Group` 之类？**
A: 检查 AWS 账号是否有默认 VPC / 配额是否够。新账号一般没问题。

**Q: 我没有域名，能先跑起来吗？**
A: 可以。`terraform.tfvars` 里 `route53_zone_id` 留空，`domain_name` 随便填个占位。ACM 证书会验证失败（可忽略），用 ALB 的 HTTP（80）端口先测，或自己用 ALB DNS + `/etc/hosts` 测。生产必须有域名 + HTTPS。
