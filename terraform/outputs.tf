output "alb_dns_name" {
  description = "ALB 对外 DNS（可配置 CNAME 指向）"
  value       = aws_lb.main.dns_name
}

output "app_url" {
  value = var.app_url
}

output "api_url" {
  value = var.app_url
}

output "ecs_cluster_name" {
  value = aws_ecs_cluster.main.name
}

output "ecs_api_service" {
  value = aws_ecs_service.api.name
}

output "ecs_web_service" {
  value = aws_ecs_service.web.name
}

output "ecr_api_repo" {
  value = aws_ecr_repository.api.repository_url
}

output "ecr_web_repo" {
  value = aws_ecr_repository.web.repository_url
}

output "rds_endpoint" {
  description = "RDS 内网端点（仅 VPC 内可达）"
  value       = aws_db_instance.main.address
  sensitive   = true
}

output "redis_endpoint" {
  description = "Redis 主端点"
  value       = aws_elasticache_replication_group.main.primary_endpoint_address
  sensitive   = true
}

output "cloudwatch_dashboard_url" {
  value = "https://${var.aws_region}.console.aws.amazon.com/cloudwatch/home?region=${var.aws_region}#dashboards:name=${aws_cloudwatch_dashboard.main.dashboard_name}"
}
