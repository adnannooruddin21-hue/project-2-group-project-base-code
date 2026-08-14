# Alerting

## Strategy

6 CloudWatch alarms, tiered warning/critical where the signal supports it, all notifying one SNS topic (`p2-order-inventory-alerts`) with a single email subscription. Thresholds are based on **real baseline data pulled from CloudWatch**, not guessed — see the rationale column below.

Defined in Terraform ([`terraform/alerting.tf`](terraform/alerting.tf)), so the exact configuration is reviewable in the repo, not just describable.

## Why two alarms needed CloudWatch Logs metric filters

CloudWatch **alarms** can't use the dashboard's `SEARCH()` expressions — those need a metric with a fixed, predictable dimension shape, and `orders_created`/`order_errors` vary by `sku`/`reason`. Rather than construct fragile metric-math across every possible dimension combination, the error-rate alarms instead reference two purpose-built CloudWatch Logs metric filters on order-service's log group:

```hcl
resource "aws_cloudwatch_log_metric_filter" "order_requests" {
  pattern = "{ $.event = \"request_completed\" }"
  metric_transformation {
    name      = "OrderServiceRequestCount"
    namespace = "p2-order-inventory/Logs"
    value     = "1"
  }
}
# + an equivalent ErrorCount filter with statusCode >= 400 in the pattern
```

This has a bonus: these metrics cover **every** endpoint (health checks, GET requests too), not just the StatsD-instrumented order-creation path — a more complete Traffic/Error signal than the business metrics alone.

## Alarm reference

All alarms: `period = 60s`, `evaluation_periods = 3`, `datapoints_to_alarm = 2` — an "M of N" pattern requiring 2 of the last 3 one-minute periods to breach. This avoids tripping on a single-datapoint blip while still alarming within ~2-3 minutes of a real sustained problem, rather than waiting much longer for a stricter N-of-N rule. `treat_missing_data = notBreaching` so a quiet period (no traffic) doesn't itself trigger an alarm.

| # | Alarm | Severity | Metric | Threshold | Baseline observed | Rationale |
|---|---|---|---|---|---|---|
| 1 | `order-error-rate-warning` | WARNING | `OrderServiceErrorCount / OrderServiceRequestCount * 100` | > 10% | ~50-56% *with our deliberately-bad-SKU test traffic* (see note below); expected near-0% with realistic traffic | Well above what real traffic should ever produce |
| 2 | `order-error-rate-critical` | CRITICAL | same | > 25% | same | Roughly half the observed synthetic-test rate — a genuine "something is seriously wrong" bar for production traffic |
| 3 | `order-latency-warning` | WARNING | `order_latency` p95 | > 200ms | avg ~3.6-4.5ms, p95 ~4.1-6.2ms | ~30-50x baseline — wide margin, verified against Incident #3's real CPU-saturation test (latency rose to ~11-16ms under load, still 12-18x below this threshold) |
| 4 | `order-latency-critical` | CRITICAL | `order_latency` p95 | > 1000ms | same | Matches the project brief's own example threshold; ~150-250x baseline |
| 5 | `cpu-critical` | CRITICAL | `100 - cpu_usage_idle` | > 80% | ~0.25-0.6% average, max ~0.4% | ~150-300x baseline — verified in Incident #1 (fired cleanly at real 100% load, silent under normal traffic) |
| 6 | `memory-warning` | WARNING | `mem_used_percent` | > 80% | ~34-36%, very stable | Sized to catch a genuine memory-leak scenario without false-triggering on normal usage |

### Honest note on alarms #1 and #2

`scripts/generate-traffic.sh` deliberately sends requests against a nonexistent SKU and a permanently-out-of-stock SKU, specifically to exercise WARN/ERROR log paths during testing. This means the error-rate alarms are frequently in `ALARM` state during active testing — **that's expected given our synthetic traffic, not a sign the app is broken.** In a real deployment serving genuine customer traffic, these thresholds (10%/25%) would apply to organic error rates, which should be far lower.

## SNS configuration

- Topic: `p2-order-inventory-alerts` (`terraform/alerting.tf`)
- Subscription: email, `adnan.nooruddin21@gmail.com`
- **Manual step required and completed:** AWS sends a confirmation email on subscription creation; the subscription stays `PendingConfirmation` (no alarms reach the inbox) until the link is clicked. This was verified via `aws sns list-subscriptions-by-topic` showing a real subscription ARN (not the literal string `PendingConfirmation`), and confirmed by actually receiving and reading alarm emails during all three incident tests.

## Response procedure (runbook summary — full detail in [docs/runbook.md](docs/runbook.md))

1. **Alarm email arrives** → note which alarm and its severity tier.
2. **Open the dashboard** → check which Golden Signal widget corresponds to the alarm; this narrows the failure class immediately (see [MONITORING.md](MONITORING.md)'s incident-usage section).
3. **Check CloudWatch Logs Insights** on the relevant log group, filtered by the incident's time window, for the specific `event`/`level` pattern.
4. **Identify root cause using evidence**, not guesswork — this is the pattern followed in all three documented incidents ([INCIDENTS.md](INCIDENTS.md)).
5. **Remediate** — each alarm's `alarm_description` field (visible in the email itself) includes a specific first investigation step.
6. **Confirm recovery** — wait for the alarm to auto-transition back to `OK` (2 of 3 clean periods), don't just assume the fix worked.

## Per-alarm response guidance

| Alarm | First investigation step (from the alarm's own description) |
|---|---|
| `order-error-rate-warning`/`-critical` | Check recent `order_rejected` / `order_validation_failed` / `inventory_service_unreachable` events via Logs Insights on `/p2-order-inventory/order-service` |
| `order-latency-warning`/`-critical` | Check the dashboard's Saturation widget for CPU/memory pressure, and whether the inventory-service call is slow |
| `cpu-critical` | Connect via SSM and check `top`/`htop` for the runaway process |
| `memory-warning` | Check for a steadily climbing trend on the dashboard (memory leak signature) vs. a one-off spike |
