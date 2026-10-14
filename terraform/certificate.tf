# ACM 证书：覆盖 app 与 api 子域名；通过 Route53 DNS 自动验证（zone 存在时）。
# 证书与 ALB 同区域（var.aws_region）。
resource "aws_acm_certificate" "main" {
  domain_name = var.domain_name
  subject_alternative_names = [
    "${var.app_subdomain}.${var.domain_name}",
    "${var.api_subdomain}.${var.domain_name}",
  ]
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_route53_record" "cert_validation" {
  count   = var.route53_zone_id != "" ? length(aws_acm_certificate.main.domain_validation_options) : 0
  name    = tolist(aws_acm_certificate.main.domain_validation_options)[count.index].resource_record_name
  type    = tolist(aws_acm_certificate.main.domain_validation_options)[count.index].resource_record_type
  records = [tolist(aws_acm_certificate.main.domain_validation_options)[count.index].resource_record_value]
  zone_id = var.route53_zone_id
  ttl     = 60
}

resource "aws_acm_certificate_validation" "main" {
  count                   = var.route53_zone_id != "" ? 1 : 0
  certificate_arn         = aws_acm_certificate.main.arn
  validation_record_fqdns = [for r in aws_route53_record.cert_validation : r.fqdn]
}
