# Architecture

## Overview

Two Node.js/Express services running on a single EC2 instance, instrumented with structured logs and custom metrics, observed through CloudWatch. No database — both services hold state in memory, which is intentional: this project is graded on observability, not persistence.

## Diagram

```
                          Internet
                             |
                             | HTTP :3000 (only open port)
                             v
+----------------------------------------------------------------+
|  EC2 instance (i-0a73e6a486c1efbeb, t3.micro, Amazon Linux 2023)|
|  eu-north-1b, security group: only :3000 inbound, no SSH        |
|                                                                  |
|   pm2 (process manager)                                        |
|    +-- order-service      (:3000, public)                      |
|    +-- inventory-service  (:3001, localhost only)               |
|         order-service --> inventory-service over localhost      |
|                                                                  |
|   CloudWatch Agent                                              |
|    - tails pm2 log files      --> CloudWatch Logs               |
|    - collects CPU/mem/disk    --> CloudWatch Metrics            |
|    - StatsD listener :8125    --> CloudWatch Metrics            |
+----------------------------------------------------------------+
         |                        |                    |
         | structured JSON logs   | custom app metrics | resource metrics
         v                        v                    v
   CloudWatch Logs          CloudWatch Metrics    CloudWatch Metrics
   (2 log groups,           (namespace             (namespace
    metric filters           P2OrderInventory,      P2OrderInventory,
    -> error-rate metrics)   8 custom metrics)       cpu/mem/disk)
         |                        |                    |
         +------------------------+--------------------+
                                   v
                        CloudWatch Dashboard
                     (P2-Order-Inventory, 7 widgets)
                                   v
                        CloudWatch Alarms (6, tiered)
                                   v
                             SNS Topic
                                   v
                          Email notification
```

Instance access is via **SSM Session Manager**, not SSH — no key pair exists, no port 22 is open. This is IAM-authenticated (the human IAM user has an inline policy granting `ssm:StartSession`; the instance's own role has `AmazonSSMManagedInstanceCore`).

## Components

| Component | Purpose | Why this choice |
|---|---|---|
| **order-service** (EC2, port 3000) | Public API: `POST /orders`, `GET /orders/:id`, `GET /health`. Generates the correlation ID if the caller didn't supply one. | The entry point / "front door" of the system — where request rate, error rate, and end-to-end latency are measured from the caller's perspective. |
| **inventory-service** (EC2, port 3001, internal only) | `POST /inventory/reserve`, `GET /inventory/:sku`, `GET /health`. Owns the in-memory stock+price catalog. | Downstream dependency — deliberately not exposed publicly, since order-service is the only real caller. |
| **pm2** | Process manager: keeps both services running, restarts on crash, structures logs into per-app files the CloudWatch Agent can tail. | Matches the starter repo's existing `ecosystem.config.js`; no need for a heavier orchestrator (ECS/Docker) for two Node processes. |
| **EC2 (t3.micro, Amazon Linux 2023)** | Runs both services. One instance, not two — simplest topology that still lets order-service call inventory-service over `localhost` rather than the network. | "Simple app, strong observability" principle — avoids load balancers, multiple instances, or service discovery for a two-service toy app. |
| **IAM role (instance profile)** | Grants the instance `CloudWatchAgentServerPolicy` (push logs/metrics) and `AmazonSSMManagedInstanceCore` (Session Manager). No access keys anywhere. | Least-privilege, no long-lived credentials on disk. |
| **Security group** | Only port 3000 open to `0.0.0.0/0`. No SSH port. | Port 3001 never needs to be public (order-service reaches it via `localhost`); SSH is replaced entirely by SSM. |
| **CloudWatch Agent** | Runs on the instance. Three jobs: tail pm2's log files into CloudWatch Logs, collect CPU/memory/disk (not available by default — only CPU is free without the agent), and listen for StatsD packets on `127.0.0.1:8125` for custom app metrics. | One agent covers logs, resource metrics, and custom metrics — avoids a second collection mechanism. |
| **CloudWatch Logs** (`/p2-order-inventory/order-service`, `/p2-order-inventory/inventory-service`) | Structured JSON log storage, queryable via Logs Insights. | Required for correlation-ID tracing and log-level (INFO/WARN/ERROR) visibility. |
| **CloudWatch Logs metric filters** | Extract simple `OrderServiceRequestCount`/`OrderServiceErrorCount` metrics from `request_completed` log lines. | CloudWatch alarms can't use the dashboard's `SEARCH()` expressions (which need a fixed metric shape); these filters give the error-rate alarms a clean, single-dimension metric to reference, and incidentally cover *every* endpoint (not just the StatsD-instrumented order-creation path). |
| **CloudWatch custom metrics** (namespace `P2OrderInventory`) | 8 metrics via a hand-written StatsD UDP sender (no npm dependency) — see [INSTRUMENTATION.md](INSTRUMENTATION.md). | Business + technical metrics beyond what logs/resource monitoring give you. |
| **CloudWatch Dashboard** (`P2-Order-Inventory`) | 7 widgets: Golden Signals across the top, business detail below. | See [MONITORING.md](MONITORING.md). |
| **CloudWatch Alarms** (6, tiered warning/critical) | Automated threshold watchers on error rate, latency, CPU, memory. | See [ALERTING.md](ALERTING.md). |
| **SNS topic + email subscription** | Fan-out notification: alarm state change → email. | Simplest possible notification channel for a single-operator project. |
| **Terraform** (`terraform/`) | Infrastructure as code for the EC2 instance, IAM role/policies, security group, SNS topic, log metric filters, and all 6 alarms. | Reviewable via `plan` before anything is created; matches the Cloud/DevOps learning goal of this project. The dashboard itself is deployed via `aws cloudwatch put-dashboard` with `config/dashboard.json` rather than Terraform, since it was iterated on quickly during development. |

## Log flow

1. `logger.js` in each service writes one JSON object per line to stdout via `console.log`.
2. pm2 redirects each app's stdout/stderr to `~/.pm2/logs/<app-name>-out.log` / `-error.log`.
3. The CloudWatch Agent tails those 4 files (configured in `config/cloudwatch-agent-config.json`) and ships new lines to the corresponding CloudWatch Logs log group.
4. Two of those log lines (`request_completed`, filtered by status code) are also captured by CloudWatch Logs metric filters into simple numeric metrics used by the error-rate alarms.

## Metric flow

1. Application code calls `metrics.increment()` / `.gauge()` / `.timing()` (in `metrics.js`, one per service) at the point an event happens (order created, reservation failed, etc.).
2. This sends a single UDP packet in StatsD text format to `127.0.0.1:8125` — fire-and-forget, never blocks the HTTP response.
3. The CloudWatch Agent's StatsD listener batches and aggregates these over a 60-second window and pushes them to CloudWatch under namespace `P2OrderInventory`.
4. Separately, the agent's own `cpu`/`mem`/`disk` plugins collect OS-level resource metrics into the same namespace every 60 seconds, independent of application traffic.

## Alert flow

1. A CloudWatch alarm evaluates its metric (or metric-math expression) every 60 seconds.
2. If 2 of the last 3 periods breach the threshold, the alarm transitions to `ALARM` and invokes its SNS topic action.
3. SNS fans out to the subscribed email address.
4. When the underlying metric recovers (2 of 3 periods back under threshold), the alarm transitions to `OK` and SNS sends a second notification.

## Technology choices

- **Node.js/Express** — provided by the starter repo; no reason to change it for an observability-focused project.
- **In-memory data, no database** — explicit project design choice (see repo README) to keep focus on instrumentation rather than persistence.
- **pm2, not Docker/ECS** — "simple app, strong observability" principle; two Node processes don't need container orchestration.
- **Hand-written JSON logger and StatsD sender, no libraries** — every byte of what gets logged/measured is visible and explainable, nothing delegated to a library's defaults.
- **SSM Session Manager over SSH** — no key management, no open port 22, IAM-authenticated access, a more current AWS-native practice.
- **Terraform for infrastructure, plain CLI for the dashboard** — infrastructure that's genuinely long-lived and reviewable (EC2, IAM, alarms, SNS) is IaC; the dashboard JSON, which was iterated on quickly by testing `SEARCH()` expressions against real data, was deployed directly and is still version-controlled as a file (`config/dashboard.json`), just not through a `terraform apply` cycle.
