# Instrumented & Monitored Cloud Service — Order & Inventory

Project 2: a two-service order/inventory API deployed to EC2, instrumented end-to-end with structured logging, correlation IDs, 8 custom CloudWatch metrics, a Golden Signals dashboard, 6 tiered alarms with SNS email alerting, and 3 documented failure-injection incidents. Built on top of the split-service starter code — see [order-service/README.md](order-service/README.md) and [inventory-service/README.md](inventory-service/README.md) for the base application details.

**Emphasis of this project is observability, not application complexity** — the app itself is deliberately simple (in-memory data, two Express services), and the work is in what surrounds it.

## Architecture

```
Internet --> :3000 only --> EC2 (order-service + inventory-service via pm2)
                                    |
                     CloudWatch Agent (logs, custom metrics via StatsD, CPU/mem/disk)
                                    |
                     CloudWatch Logs + Metrics --> Dashboard --> Alarms --> SNS --> Email
```

Full detail, component table, and design rationale: **[ARCHITECTURE.md](ARCHITECTURE.md)**.

## Documentation index

| Doc | Covers |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | Components, diagram, log/metric/alert flow, technology choices |
| [INSTRUMENTATION.md](INSTRUMENTATION.md) | Logging strategy, correlation IDs, all 8 custom metrics with rationale |
| [MONITORING.md](MONITORING.md) | Dashboard design, widget-by-widget purpose, incident-response usage |
| [ALERTING.md](ALERTING.md) | All 6 alarms, thresholds with baseline-backed rationale, SNS setup |
| [INCIDENTS.md](INCIDENTS.md) | 3 investigated failure scenarios with real evidence and root causes |
| [docs/runbook.md](docs/runbook.md) | Practical troubleshooting commands |
| [docs/dashboard-guide.md](docs/dashboard-guide.md) | Quick-reference guide to reading the dashboard |
| [docs/deployment.md](docs/deployment.md) | Full deployment sequence, as actually run |

## Key observability features

- **Structured JSON logs** shipped to CloudWatch Logs (`/p2-order-inventory/order-service`, `/p2-order-inventory/inventory-service`), with `INFO`/`WARN`/`ERROR` levels and a correlation ID on every line, traced end-to-end across both services.
- **8 custom metrics** (5 genuinely business-focused: orders created, order value, reservation failures by SKU, stock level, plus error/latency technical metrics) published via a hand-written StatsD sender — no logging or metrics library dependency anywhere in the app.
- **CPU/memory/disk monitoring** via the CloudWatch Agent (memory and disk aren't available at all without it).
- **7-widget Golden Signals dashboard** (`P2-Order-Inventory`) — Traffic, Errors, Latency, Saturation across the top, business detail below.
- **6 tiered CloudWatch alarms** (warning/critical on error rate and latency, critical on CPU, warning on memory), all backed by real observed baselines, wired to SNS email alerts — verified working via 3 real failure-injection tests, not just configured.
- **Infrastructure as code** — EC2, IAM, security group, SNS, alarms, and log metric filters are all in [`terraform/`](terraform/), reviewable via `terraform plan` before anything is created.
- **Instance access via SSM Session Manager only** — no SSH key exists, no port 22 is open.

## Deploying

Full step-by-step: **[docs/deployment.md](docs/deployment.md)**.

```bash
cd terraform && terraform init && terraform plan -out=tfplan && terraform apply tfplan
aws ssm start-session --target $(terraform output -raw instance_id) --region eu-north-1
# on the instance: install Node.js/pm2, git clone, npm ci, pm2 start ecosystem.config.js,
# install + configure the CloudWatch Agent — see docs/deployment.md for exact commands
```

## Running locally (no AWS required)

```bash
cd inventory-service && cp .env.example .env && npm install && npm start &
cd order-service && cp .env.example .env && npm install && npm start &
curl http://localhost:3000/health
./scripts/generate-traffic.sh http://localhost:3000 20 0.5
```
Structured JSON logs print to stdout; custom metrics attempt to send to `127.0.0.1:8125` (silently no-op locally unless a StatsD listener is running there).

## Evidence

Screenshots from the deployed system, captured during actual testing (not staged): [`evidence/dashboard-screenshots/`](evidence/dashboard-screenshots/), [`evidence/alert-screenshots/`](evidence/alert-screenshots/), [`evidence/incident-screenshots/`](evidence/incident-screenshots/). Referenced inline throughout [INCIDENTS.md](INCIDENTS.md).

## Repo structure

```
.
├── README.md, ARCHITECTURE.md, INSTRUMENTATION.md,
│   MONITORING.md, ALERTING.md, INCIDENTS.md
├── order-service/            # public API (:3000)
│   ├── server.js, logger.js, metrics.js
├── inventory-service/        # internal-only API (:3001)
│   ├── server.js, logger.js, metrics.js
├── ecosystem.config.js       # pm2 process definitions
├── terraform/                 # EC2, IAM, security group, SNS, alarms, log metric filters
├── config/
│   ├── dashboard.json                    # CloudWatch dashboard definition
│   └── cloudwatch-agent-config.json      # logs + metrics + StatsD agent config
├── docs/
│   ├── runbook.md, dashboard-guide.md, deployment.md
├── evidence/
│   ├── dashboard-screenshots/, alert-screenshots/, incident-screenshots/
└── scripts/
    └── generate-traffic.sh   # load generator for testing metrics/dashboard/alarms
```

## What's deliberately not included

No database (in-memory state, resets on restart — intentional, see [order-service/README.md](order-service/README.md)), no Docker/ECS, no load balancer, no auto-scaling, no Lambda auto-remediation. The project brief explicitly favors "simple application + strong observability" over infrastructure complexity.
