terraform {
  required_version = ">= 1.9.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.60"
    }
  }

  # 远程状态：S3 存储 + DynamoDB 锁（团队协作标准做法）。
  # 首次使用前需手动创建 S3 bucket 与 DynamoDB 表（见 deploy/DEPLOY.md）。
  # 若仅本地试用，可删除本 backend 块改用本地 state。
  backend "s3" {
    bucket         = "teamspace-tfstate"
    key            = "production/terraform.tfstate"
    region         = "us-east-1"
    dynamodb_table = "teamspace-tfstate-lock"
    encrypt        = true
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = var.project_name
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}

data "aws_caller_identity" "current" {}
data "aws_region" "current" {}
