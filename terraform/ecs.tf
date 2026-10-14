# ============================================================
# ECS Fargate：集群 + 任务定义 + 服务
# 镜像由 CD 工作流更新；Terraform 用 ignore_changes 避免覆盖线上镜像。
# ============================================================

resource "aws_ecs_cluster" "main" {
  name = "${var.project_name}-${var.environment}"

  setting {
    name  = "containerInsights"
    value = "enabled"
  }
}

# ---------- API 任务定义 ----------
resource "aws_ecs_task_definition" "api" {
  family                   = "${var.project_name}-api"
  execution_role_arn       = aws_iam_role.ecs_task_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = var.api_cpu
  memory                   = var.api_memory
  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  container_definitions = jsonencode([
    {
      name         = "api"
      image        = var.api_image
      essential    = true
      portMappings = [{ containerPort = 3001, protocol = "tcp" }]
      environment = [
        { name = "NODE_ENV", value = "production" },
        { name = "APP_PORT", value = "3001" },
        { name = "APP_URL", value = var.app_url },
        { name = "WEB_URL", value = var.web_url },
        { name = "DATABASE_URL", value = "postgresql://${var.app_db_user}:${var.app_db_password}@${aws_db_instance.main.address}:5432/${aws_db_instance.main.db_name}?schema=public" },
        { name = "DATABASE_ADMIN_URL", value = "postgresql://${var.db_username}:${var.db_password}@${aws_db_instance.main.address}:5432/${aws_db_instance.main.db_name}?schema=public" },
        { name = "REDIS_URL", value = "rediss://:${var.redis_auth_token}@${aws_elasticache_replication_group.main.primary_endpoint_address}:6379" },
        { name = "JWT_SECRET", value = var.jwt_secret },
        { name = "JWT_ACCESS_EXPIRES_IN", value = "1h" },
        { name = "EMAIL_PROVIDER", value = "resend" },
        { name = "EMAIL_FROM", value = var.email_from },
        { name = "RESEND_API_KEY", value = var.resend_api_key },
        { name = "GOOGLE_CLIENT_ID", value = var.google_client_id },
        { name = "GOOGLE_CLIENT_SECRET", value = var.google_client_secret },
        { name = "GOOGLE_CALLBACK_URL", value = "${var.app_url}/api/v1/auth/oauth/google/callback" },
        { name = "GITHUB_CLIENT_ID", value = var.github_client_id },
        { name = "GITHUB_CLIENT_SECRET", value = var.github_client_secret },
        { name = "GITHUB_CALLBACK_URL", value = "${var.app_url}/api/v1/auth/oauth/github/callback" },
        { name = "STRIPE_SECRET_KEY", value = var.stripe_secret_key },
        { name = "STRIPE_WEBHOOK_SECRET", value = var.stripe_webhook_secret },
      ]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.api.name
          awslogs-region        = var.aws_region
          awslogs-stream-prefix = "ecs"
        }
      }
      healthCheck = {
        command     = ["CMD-SHELL", "wget -qO- http://localhost:3001/api/v1/health/live >/dev/null 2>&1 || exit 1"]
        interval    = 30
        timeout     = 5
        retries     = 3
        startPeriod = 20
      }
    }
  ])

  # CD 工作流会更新 image；Terraform 不回滚镜像版本。
  # 修改非镜像配置（如环境变量）时，需临时移除此 ignore_changes。
  lifecycle {
    ignore_changes = [container_definitions]
  }
}

# ---------- Web 任务定义 ----------
resource "aws_ecs_task_definition" "web" {
  family                   = "${var.project_name}-web"
  execution_role_arn       = aws_iam_role.ecs_task_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = var.web_cpu
  memory                   = var.web_memory
  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  container_definitions = jsonencode([
    {
      name         = "web"
      image        = var.web_image
      essential    = true
      portMappings = [{ containerPort = 3000, protocol = "tcp" }]
      environment = [
        { name = "NODE_ENV", value = "production" },
        { name = "NEXT_PUBLIC_API_URL", value = "${var.app_url}/api/v1" },
        { name = "NEXT_PUBLIC_WS_URL", value = var.app_url },
      ]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.web.name
          awslogs-region        = var.aws_region
          awslogs-stream-prefix = "ecs"
        }
      }
      healthCheck = {
        command     = ["CMD-SHELL", "wget -qO- http://localhost:3000/api/health >/dev/null 2>&1 || exit 1"]
        interval    = 30
        timeout     = 5
        retries     = 3
        startPeriod = 20
      }
    }
  ])

  lifecycle {
    ignore_changes = [container_definitions]
  }
}

# ---------- API 服务 ----------
resource "aws_ecs_service" "api" {
  name            = "${var.project_name}-api"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.api.arn
  desired_count   = var.api_desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = module.vpc.private_subnets
    security_groups  = [aws_security_group.ecs_service.id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.api.arn
    container_name   = "api"
    container_port   = 3001
  }

  health_check_grace_period_seconds = 60

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200
}

# ---------- Web 服务 ----------
resource "aws_ecs_service" "web" {
  name            = "${var.project_name}-web"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.web.arn
  desired_count   = var.web_desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = module.vpc.private_subnets
    security_groups  = [aws_security_group.ecs_service.id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.web.arn
    container_name   = "web"
    container_port   = 3000
  }

  health_check_grace_period_seconds = 60

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200
}
