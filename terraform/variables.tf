variable "project_name" {
  description = "项目名，用于资源命名前缀"
  type        = string
  default     = "teamspace"
}

variable "environment" {
  description = "环境名（production / staging）"
  type        = string
  default     = "production"
}

variable "aws_region" {
  description = "AWS 区域"
  type        = string
  default     = "us-east-1"
}

variable "vpc_cidr" {
  description = "VPC CIDR"
  type        = string
  default     = "10.0.0.0/16"
}

variable "azs" {
  description = "可用区列表（至少 2 个）"
  type        = list(string)
  default     = ["us-east-1a", "us-east-1b"]
}

# ---------- 数据库 ----------
variable "db_username" {
  description = "RDS PostgreSQL 主用户名"
  type        = string
  default     = "teamspace"
}

variable "db_password" {
  description = "RDS PostgreSQL 主密码（从 Secrets Manager 或 CI 注入，禁止硬编码）"
  type        = string
  sensitive   = true
}

variable "app_db_user" {
  description = "应用最小权限账号（由 init-db.sql 创建）"
  type        = string
  default     = "teamspace_app"
}

variable "app_db_password" {
  description = "应用最小权限账号密码（与 init-db.sql 中一致）"
  type        = string
  sensitive   = true
}

variable "db_instance_class" {
  description = "RDS 实例规格"
  type        = string
  default     = "db.t4g.micro"
}

variable "db_allocated_storage" {
  description = "RDS 存储 (GB)"
  type        = number
  default     = 20
}

# ---------- 缓存 ----------
variable "redis_node_type" {
  description = "ElastiCache Redis 节点规格"
  type        = string
  default     = "cache.t4g.micro"
}

variable "redis_auth_token" {
  description = "Redis AUTH token（敏感）"
  type        = string
  sensitive   = true
}

# ---------- ECS ----------
variable "api_image" {
  description = "API 容器镜像（首次部署占位，后续由 CD 工作流更新）"
  type        = string
}

variable "web_image" {
  description = "Web 容器镜像（首次部署占位，后续由 CD 工作流更新）"
  type        = string
}

variable "api_desired_count" {
  description = "API 服务期望实例数"
  type        = number
  default     = 1
}

variable "web_desired_count" {
  description = "Web 服务期望实例数"
  type        = number
  default     = 1
}

variable "api_cpu" {
  type    = number
  default = 512
}
variable "api_memory" {
  type    = number
  default = 1024
}
variable "web_cpu" {
  type    = number
  default = 512
}
variable "web_memory" {
  type    = number
  default = 1024
}

# ---------- 应用配置（注入 ECS 容器环境变量） ----------
variable "app_url" {
  description = "API 对外 URL（含 https://）"
  type        = string
}

variable "web_url" {
  description = "Web 对外 URL（含 https://）"
  type        = string
}

variable "jwt_secret" {
  type      = string
  sensitive = true
}

variable "resend_api_key" {
  type      = string
  sensitive = true
  default   = ""
}

variable "email_from" {
  type    = string
  default = "TeamSpace <noreply@teamspace.dev>"
}

variable "stripe_secret_key" {
  type      = string
  sensitive = true
  default   = ""
}

variable "stripe_webhook_secret" {
  type      = string
  sensitive = true
  default   = ""
}

variable "google_client_id" {
  type    = string
  default = ""
}
variable "google_client_secret" {
  type      = string
  sensitive = true
  default   = ""
}
variable "github_client_id" {
  type    = string
  default = ""
}
variable "github_client_secret" {
  type      = string
  sensitive = true
  default   = ""
}

# ---------- 域名与证书 ----------
variable "domain_name" {
  description = "主域名（如 teamspace.dev）"
  type        = string
}

variable "app_subdomain" {
  type    = string
  default = "app"
}

variable "api_subdomain" {
  type    = string
  default = "api"
}

variable "route53_zone_id" {
  description = "Route53 托管 Zone ID（留空则不创建 DNS 记录）"
  type        = string
  default     = ""
}

# ---------- 告警 ----------
variable "alarm_sns_topic_arn" {
  description = "告警通知 SNS Topic ARN（留空则不创建告警订阅）"
  type        = string
  default     = ""
}
