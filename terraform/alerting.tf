# ---------------------------------------------------------------------------
# SNS topic + email subscription. AWS will send a confirmation email to
# var.alert_email after apply - the subscription stays PendingConfirmation
# (no alarms will actually reach the inbox) until that link is clicked.
# ---------------------------------------------------------------------------

resource "aws_sns_topic" "alerts" {
  name = "${var.project_name}-alerts"

  tags = {
    Project = var.project_name
  }
}

resource "aws_sns_topic_subscription" "email" {
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = var.alert_email
}

# ---------------------------------------------------------------------------
# Log metric filters: turn order-service's structured logs into simple,
# single-dimension metrics. CloudWatch alarms can't use the SEARCH()
# expressions the dashboard uses (those need a fixed, known metric shape),
# and this also covers every endpoint (health checks, GET /orders/:id too),
# not just the StatsD-instrumented POST /orders path.
# ---------------------------------------------------------------------------

locals {
  order_service_log_group = "/${var.project_name}/order-service"
  alarm_namespace          = "${var.project_name}/Logs"
}

resource "aws_cloudwatch_log_metric_filter" "order_requests" {
  name           = "${var.project_name}-order-request-count"
  log_group_name = local.order_service_log_group
  pattern        = "{ $.event = \"request_completed\" }"

  metric_transformation {
    name          = "OrderServiceRequestCount"
    namespace     = local.alarm_namespace
    value         = "1"
    default_value = "0"
  }
}

resource "aws_cloudwatch_log_metric_filter" "order_errors" {
  name           = "${var.project_name}-order-error-count"
  log_group_name = local.order_service_log_group
  pattern        = "{ $.event = \"request_completed\" && $.statusCode >= 400 }"

  metric_transformation {
    name          = "OrderServiceErrorCount"
    namespace     = local.alarm_namespace
    value         = "1"
    default_value = "0"
  }
}

# ---------------------------------------------------------------------------
# Alarms. period=60 with evaluation_periods=3 / datapoints_to_alarm=2 is an
# "M out of N" pattern: needs 2 of the last 3 one-minute periods breaching,
# so a single one-off spike doesn't trip it, but a real sustained problem
# still alarms within ~2-3 minutes rather than needing a long wait - chosen
# for a workable feedback loop during failure-injection testing while still
# being a defensible, non-arbitrary evaluation strategy.
# ---------------------------------------------------------------------------

resource "aws_cloudwatch_metric_alarm" "order_error_rate_warning" {
  alarm_name          = "${var.project_name}-order-error-rate-warning"
  alarm_description   = "WARNING: order-service error rate > 10% over 3 min. Check recent order_rejected / order_validation_failed / inventory_service_unreachable events via CloudWatch Logs Insights on /${var.project_name}/order-service to identify the failure pattern."
  comparison_operator = "GreaterThanThreshold"
  threshold           = 10
  evaluation_periods  = 3
  datapoints_to_alarm = 2
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]

  metric_query {
    id          = "error_rate"
    expression  = "errors / requests * 100"
    label       = "Order Error Rate %"
    return_data = true
  }

  metric_query {
    id = "errors"
    metric {
      metric_name = "OrderServiceErrorCount"
      namespace   = local.alarm_namespace
      period      = 60
      stat        = "Sum"
    }
  }

  metric_query {
    id = "requests"
    metric {
      metric_name = "OrderServiceRequestCount"
      namespace   = local.alarm_namespace
      period      = 60
      stat        = "Sum"
    }
  }
}

resource "aws_cloudwatch_metric_alarm" "order_error_rate_critical" {
  alarm_name          = "${var.project_name}-order-error-rate-critical"
  alarm_description   = "CRITICAL: order-service error rate > 25% over 3 min. This is a serious, sustained failure - investigate immediately via Logs Insights on /${var.project_name}/order-service and the dashboard's Errors widget."
  comparison_operator = "GreaterThanThreshold"
  threshold           = 25
  evaluation_periods  = 3
  datapoints_to_alarm = 2
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]

  metric_query {
    id          = "error_rate"
    expression  = "errors / requests * 100"
    label       = "Order Error Rate %"
    return_data = true
  }

  metric_query {
    id = "errors"
    metric {
      metric_name = "OrderServiceErrorCount"
      namespace   = local.alarm_namespace
      period      = 60
      stat        = "Sum"
    }
  }

  metric_query {
    id = "requests"
    metric {
      metric_name = "OrderServiceRequestCount"
      namespace   = local.alarm_namespace
      period      = 60
      stat        = "Sum"
    }
  }
}

resource "aws_cloudwatch_metric_alarm" "order_latency_warning" {
  alarm_name          = "${var.project_name}-order-latency-warning"
  alarm_description   = "WARNING: order-service p95 latency > 200ms over 3 min. Baseline is ~4-6ms. Check the dashboard's Saturation widget for CPU/memory pressure, and whether the inventory-service call is slow."
  namespace           = "P2OrderInventory"
  metric_name         = "order_latency"
  dimensions = {
    InstanceId  = aws_instance.app.id
    metric_type = "timing"
  }
  extended_statistic  = "p95"
  period              = 60
  evaluation_periods  = 3
  datapoints_to_alarm = 2
  comparison_operator = "GreaterThanThreshold"
  threshold           = 200
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
}

resource "aws_cloudwatch_metric_alarm" "order_latency_critical" {
  alarm_name          = "${var.project_name}-order-latency-critical"
  alarm_description   = "CRITICAL: order-service p95 latency > 1000ms over 3 min. Users are experiencing multi-second delays - investigate immediately."
  namespace           = "P2OrderInventory"
  metric_name         = "order_latency"
  dimensions = {
    InstanceId  = aws_instance.app.id
    metric_type = "timing"
  }
  extended_statistic  = "p95"
  period              = 60
  evaluation_periods  = 3
  datapoints_to_alarm = 2
  comparison_operator = "GreaterThanThreshold"
  threshold           = 1000
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
}

resource "aws_cloudwatch_metric_alarm" "cpu_critical" {
  alarm_name          = "${var.project_name}-cpu-critical"
  alarm_description   = "CRITICAL: CPU utilization > 80% over 3 min. Baseline is <1%. Connect via SSM and check top/htop for the runaway process - likely correlates with an injected high-CPU failure scenario or a genuine traffic spike."
  comparison_operator = "GreaterThanThreshold"
  threshold           = 80
  evaluation_periods  = 3
  datapoints_to_alarm = 2
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]

  metric_query {
    id          = "utilization"
    expression  = "100 - idle"
    label       = "CPU Utilization %"
    return_data = true
  }

  metric_query {
    id = "idle"
    metric {
      metric_name = "cpu_usage_idle"
      namespace   = "P2OrderInventory"
      period      = 60
      stat        = "Average"
      dimensions = {
        InstanceId = aws_instance.app.id
        cpu        = "cpu-total"
      }
    }
  }
}

resource "aws_cloudwatch_metric_alarm" "memory_warning" {
  alarm_name          = "${var.project_name}-memory-warning"
  alarm_description   = "WARNING: memory utilization > 80% over 3 min. Baseline is ~35%. A steadily climbing trend on the dashboard's Saturation widget points to a memory leak rather than a one-off spike."
  namespace           = "P2OrderInventory"
  metric_name         = "mem_used_percent"
  dimensions = {
    InstanceId = aws_instance.app.id
  }
  statistic           = "Average"
  period              = 60
  evaluation_periods  = 3
  datapoints_to_alarm = 2
  comparison_operator = "GreaterThanThreshold"
  threshold           = 80
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
}
