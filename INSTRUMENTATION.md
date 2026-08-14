# Instrumentation

## Logging strategy

Both services write **one JSON object per line to stdout** via a hand-written logger (`logger.js`, ~12 lines, no dependency):

```js
function log(level, event, fields = {}) {
  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    service: SERVICE_NAME,
    event,
    ...fields,
  }));
}
```

pm2 captures stdout to a per-app log file; the CloudWatch Agent tails those files into CloudWatch Logs. No logging library (Winston, Pino, etc.) — `JSON.stringify` + `console.log` is the entire mechanism, which keeps every field that ends up in a log line fully visible in the code that emits it.

Every request produces two kinds of log line:

1. **Access log** (`request_completed`) — one per request, emitted by middleware on `res.on('finish')`. Always includes `correlationId`, `method`, `endpoint`, `statusCode`, `latencyMs`. Level is derived automatically from status code: `ERROR` for 5xx, `WARN` for 4xx, `INFO` otherwise. This line alone is enough to compute request rate, error rate, and latency for *any* endpoint, not just instrumented business events.
2. **Business event logs** — one per meaningful thing that happened (`order_created`, `reservation_failed_insufficient_stock`, etc.), with event-specific fields.

### Log levels

| Level | Used for | Examples |
|---|---|---|
| `INFO` | Normal, expected outcomes | `order_created`, `reservation_succeeded`, `order_retrieved`, `inventory_lookup` |
| `WARN` | Handled edge cases — the system worked correctly, the request just didn't succeed | `order_validation_failed`, `order_rejected`, `reservation_failed_insufficient_stock`, `reservation_failed_unknown_sku`, `order_not_found` |
| `ERROR` | Unexpected failures — something outside normal request handling went wrong | `inventory_service_unreachable` (downstream connection failure) |

This distinction matters for the access-log line specifically: a `404` on `GET /orders/:id` for an ID that doesn't exist is a normal, expected `WARN`, not a bug — but a `502` because inventory-service is unreachable is a genuine `ERROR`, confirmed by Incident #2 in [INCIDENTS.md](INCIDENTS.md).

### Correlation IDs

Middleware in both services (registered before any routes):

```js
app.use((req, res, next) => {
  req.correlationId = req.headers['x-correlation-id'] || crypto.randomUUID();
  res.setHeader('X-Correlation-Id', req.correlationId);
  next();
});
```

- order-service is the start of the request chain: it generates a UUID if the caller didn't supply one, and forwards it as `X-Correlation-Id` on its outbound call to inventory-service.
- inventory-service reads the header if order-service sent it, or self-generates if hit directly (e.g. during local testing) — it's never left blank.
- Every log line in both services includes `correlationId`, so a single CloudWatch Logs Insights query pulls the complete story of one request across both services.

**Verified example** — the same `correlationId` (`095db674-0b25-49ab-b39d-f9dbab0f23d8`) appearing in both services for one order:
```json
{"timestamp":"2026-08-12T15:23:15.331Z","level":"INFO","service":"inventory-service","event":"reservation_succeeded","correlationId":"095db674-0b25-49ab-b39d-f9dbab0f23d8","sku":"SKU-001","quantity":1,"remainingStock":49}
{"timestamp":"2026-08-12T15:23:15.335Z","level":"INFO","service":"order-service","event":"order_created","correlationId":"095db674-0b25-49ab-b39d-f9dbab0f23d8","orderId":1,"customerId":"cust-ec2-test","sku":"SKU-001","quantity":1,"remainingStock":49}
```

### Example log lines (real, captured from the deployed instance)

```json
{"timestamp":"2026-08-12T13:16:04.868Z","level":"WARN","service":"order-service","event":"order_rejected","correlationId":"b9517099-8988-4871-8127-e649103ed2ad","customerId":"cust-13","sku":"SKU-DOES-NOT-EXIST","quantity":3,"reason":"SKU not found","inventoryStatus":404}
```
```json
{"timestamp":"2026-08-13T09:00:18.228Z","level":"ERROR","service":"order-service","event":"inventory_service_unreachable","correlationId":"e316d822-c7dc-41ee-8578-a1124064184f","customerId":"cust-15","sku":"SKU-001","errorMessage":"connect ECONNREFUSED 127.0.0.1:3001"}
```

---

## Custom metrics

All published under CloudWatch namespace **`P2OrderInventory`**, generated via a hand-written StatsD UDP sender (`metrics.js`, ~30 lines, no npm dependency) sending to the CloudWatch Agent's StatsD listener on `127.0.0.1:8125`.

| Metric | Type | Dimensions | Unit | What it measures | Why it matters | Business or technical |
|---|---|---|---|---|---|---|
| `orders_created` | Counter | `sku` | count | Successful order creations | The core "is the store working" signal; Sum stat over a period gives orders/minute | **Business** |
| `order_value` | Counter | — | USD | Revenue per confirmed order | Sum stat gives revenue/period — the actual dollar-value business metric | **Business** |
| `order_errors` | Counter | `reason` (validation / rejected / inventory_unreachable) | count | Failed order attempts, by cause | The `reason` tag tells you what kind of failure without opening logs | Technical |
| `order_latency` | Timer | — | ms | End-to-end time to fulfill an order, including the call to inventory-service | The Golden Signal "Latency"; CloudWatch derives avg/p95/max automatically from timer data | Technical |
| `reservation_attempts` | Counter | — | count | Every reservation request inventory-service receives | Traffic/Rate signal for the downstream service | Technical |
| `reservation_failures` | Counter | `reason`, plus `sku` for `insufficient_stock` specifically | count | Failed reservations | Surfaces *which SKU* is running out, not just "something failed" | **Business** |
| `stock_level` | Gauge | `sku` | count | Current stock remaining, updated on every successful reservation | Lets you alert on "about to sell out" per product | **Business** |
| `reservation_latency` | Timer | — | ms | inventory-service's own processing time | Isolates whether latency comes from order-service or inventory-service | Technical |

5 of 8 are genuinely business metrics (orders_created, order_value, reservation_failures, stock_level — plus order_errors arguably straddling both), satisfying the "meaningful business metrics, not just infrastructure" requirement.

### How they're generated

```js
// metrics.js — sent as e.g. "orders_created:1|c|#sku:SKU-001"
function increment(name, value = 1, tags = {}) { send(`${name}:${value}|c${formatTags(tags)}`); }
function gauge(name, value, tags = {}) { send(`${name}:${value}|g${formatTags(tags)}`); }
function timing(name, ms, tags = {}) { send(`${name}:${ms}|ms${formatTags(tags)}`); }
```

Called at the exact point each event happens — e.g. in `order-service/server.js`, on a successful order:
```js
const orderValue = Math.round((reservation.data.price || 0) * quantity * 100) / 100;
metrics.increment('orders_created', 1, { sku });
metrics.increment('order_value', orderValue);
metrics.timing('order_latency', latencyMs);
```

### A discovered quirk worth documenting

The CloudWatch Agent automatically adds a `metric_type` dimension (`counter`/`gauge`/`timing`) to every StatsD-sourced metric — this isn't something we configured. It was only discovered by querying real `list-metrics` output while building the dashboard (see [MONITORING.md](MONITORING.md)) and is the reason the dashboard uses `SEARCH()` expressions instead of hardcoded dimension lists.

### Resource metrics (CPU / memory / disk)

Collected by the CloudWatch Agent directly (not via StatsD), also under `P2OrderInventory`:

| Metric | Dimensions | Why it needs the agent |
|---|---|---|
| `cpu_usage_idle`, `cpu_usage_user`, `cpu_usage_system` | `InstanceId`, `cpu=cpu-total` | CPU is the *only* one of these three available for free without the agent (basic EC2 monitoring) |
| `mem_used_percent` | `InstanceId` | Not available at all without the agent |
| `disk_used_percent` | `InstanceId`, `path=/`, `device=nvme0n1p1`, `fstype=xfs` | Not available at all without the agent |

### Troubleshooting value

Two log-derived metrics (`OrderServiceRequestCount`, `OrderServiceErrorCount`, namespace `p2-order-inventory/Logs`) exist specifically because CloudWatch alarms can't consume the dashboard's dynamic `SEARCH()` expressions — see [ALERTING.md](ALERTING.md) for why.
