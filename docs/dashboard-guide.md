# Dashboard Guide

Quick reference for reading the `P2-Order-Inventory` CloudWatch dashboard. For the design rationale behind each widget, see [MONITORING.md](../MONITORING.md).

```
https://eu-north-1.console.aws.amazon.com/cloudwatch/home?region=eu-north-1#dashboards/dashboard/P2-Order-Inventory
```

## The 30-second read

Look at the top row first — it tells you the failure *class* before you open a single log:

| If this widget is abnormal... | ...it likely means | Go check |
|---|---|---|
| **Saturation** only | Infrastructure/resource problem (CPU, memory, disk) | `pm2 monit`, `top`/`htop` via SSM |
| **Errors** only | Application or dependency problem | Errors widget's `reason` breakdown, then Logs Insights |
| **Latency** elevated | Could be caused by either of the above | Check Saturation and Errors together — see Incident #3 for a real example where CPU load caused a *small* latency increase |
| **Traffic** flat/zero when you expect load | Requests aren't reaching the app | Security group, DNS/IP, or the traffic source itself |

## Widget-by-widget

**Traffic** — orders/reservations per minute. A line near zero when you expect traffic is itself a symptom, not a null result.

**Errors** — `order_errors` and `reservation_failures`, split automatically by `reason` (and `sku` for stock issues). The specific line that's spiking tells you the failure type without needing to open logs first:
- `order_errors inventory_unreachable` spiking → downstream dependency down (see Incident #2)
- `reservation_failures insufficient_stock SKU-XXX` spiking → that SKU needs restocking, not an application bug

**Latency** — average and p95 for both services. Watch for p95 diverging from average (a subset of requests much slower than the rest) vs. both rising together (broad slowdown).

**Saturation** — CPU user/system %, memory %, disk %, 0-100 scale. The only widget that would have caught Incident #1 (a pure-CPU event that produced zero application log output).

**Orders & Revenue** — order count (left axis) vs. dollar value (right axis). Ties technical volume to business impact.

**Stock Level per SKU** — one line per SKU. Note: SKU-004 never appears here (expected — it's permanently out of stock, and this metric only updates on a *successful* reservation). Its state shows up in the Errors widget instead.

## Time range tips

- Default view is a rolling window (usually 3h) — for investigating a *past* incident, use the **Custom** time picker and set it to the specific window (all three documented incidents in [INCIDENTS.md](../INCIDENTS.md) needed this to get a legible screenshot rather than a spike squeezed at the edge of a wide window).
- The console defaults to **local timezone** display; CloudWatch API queries (`aws cloudwatch ...`) return **UTC**. Incident timestamps in this repo's documentation are in UTC unless stated otherwise — mind the offset (`+02:00` for Stockholm) when cross-referencing a console screenshot against a CLI query result.

## Getting a widget as an image without opening the console

Useful for automation or quick verification:
```bash
aws cloudwatch get-metric-widget-image --region eu-north-1 \
  --metric-widget file://widget.json \
  --output text --query MetricWidgetImage | base64 -D > widget.png
```
where `widget.json` is the `properties` object of one widget from `config/dashboard.json`.
