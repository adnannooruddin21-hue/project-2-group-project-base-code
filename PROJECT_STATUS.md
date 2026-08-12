# Project Status — Instrumented & Monitored Cloud Service

_Last updated: 2026-08-12 (Phase 1 inspection)_

## Completed

- Two working Node.js/Express services (`order-service`, `inventory-service`) with real business logic (order creation, stock reservation, in-memory store).
- `GET /health` implemented on both services.
- Service-to-service call wired up (order-service → inventory-service via axios) using `INVENTORY_SERVICE_URL`.
- Process management via `pm2` (`ecosystem.config.js`) — ready for EC2 deployment.
- Local traffic generator script (`scripts/generate-traffic.sh`) that produces a mix of success/4xx/409 requests.
- AWS CLI is installed and configured locally (account `128529977749`, region `eu-north-1`, IAM user `AdnanTest`).

## In Progress

- Nothing yet — this is a clean starter repo. No instrumentation work has started.

## Missing (required by the assignment, not yet started)

- Correlation ID middleware (both services have a TODO stub, currently a no-op passthrough).
- Structured JSON logging (both services currently use plain `console.log`).
- Log levels (ERROR/WARN/INFO) — not implemented.
- Any shipping of logs to CloudWatch Logs (no CloudWatch Agent, no SDK log transport).
- Custom metrics (0 of the required 5+; no CloudWatch SDK calls anywhere in the code).
- Business metrics (e.g. orders/min, order value).
- CloudWatch dashboard (Golden Signals) — none exists in the AWS account.
- CPU / memory / disk monitoring — no CloudWatch Agent config, no EC2 instance to install it on.
- CloudWatch alarms — none exist (0 found in the account).
- SNS topic + email subscription — none exist (0 topics found).
- Any deployment to EC2/ECS — **no EC2 instances are currently running** in this account/region.
- All required documentation files (README currently only covers local dev; no `ARCHITECTURE.md`, `INSTRUMENTATION.md`, `MONITORING.md`, `ALERTING.md`, `INCIDENTS.md`, `docs/runbook.md`, `docs/dashboard-guide.md`, `docs/deployment.md`).
- `config/` directory (dashboard.json, alarms.json, cloudwatch-agent-config.json) — does not exist.
- `evidence/` and `presentation/` directories — do not exist.
- Failure injection / incident reports — not started (nothing to inject into yet).
- No Terraform in this repo — infrastructure has not been decided/created yet (see note below).

## Broken

- Nothing is "broken" per se — the app has never been instrumented or deployed, so there's nothing to be broken yet. The one thing worth flagging as **unexpected, not broken**: your AWS account already has two CloudWatch log groups that predate this project and are unrelated to it:
  - `/aws/application/api` (created ~2026-08 range, has a metric filter, 7-day retention)
  - `/vpc/threetier-flowlogs` (VPC flow logs, 8KB stored)

  There's also a leftover VPC tagged `cicd-lab-dev-vpc` (`ManagedBy=terraform`) from what looks like an earlier lab/project. No NAT Gateways or unattached Elastic IPs were found, so none of this is actively costing money beyond negligible log storage — but I did **not** touch any of it. We should decide together whether to ignore it, reuse it, or clean it up later — your call, not mine.

## Next Step

Move to **Phase 2 — Design the Solution**: propose the simplest architecture (EC2 vs ECS, one instance vs two, where logs/metrics go) and walk through cost/purpose of each AWS service, before writing any code or creating any AWS resources.

---

## Checklist (from CLAUDE_PROJECT_GUIDE.md §12), verified against actual repo/AWS state

- [ ] Application deployed — **not deployed** (no EC2 instances found)
- [ ] Health endpoint working — code exists, **not yet verified running**
- [ ] Structured JSON logging — **not started**
- [ ] Correlation IDs — **not started**
- [ ] CloudWatch Logs — **not started**
- [ ] 5+ custom metrics — **not started**
- [ ] Business metric included — **not started**
- [ ] Golden Signals dashboard — **not started**
- [ ] CPU monitoring — **not started**
- [ ] Memory monitoring — **not started**
- [ ] Disk monitoring — **not started**
- [ ] 3+ alarms — **not started** (0 alarms in account)
- [ ] Warning threshold — **not started**
- [ ] Critical threshold — **not started**
- [ ] SNS topic — **not started** (0 topics in account)
- [ ] Email subscription — **not started**
- [ ] Alert test completed — **not started**
- [ ] Failure scenario #1 — **not started**
- [ ] Failure scenario #2 — **not started**
- [ ] Complex failure scenario — **not started**
- [ ] Root-cause analysis — **not started**
- [ ] Incident screenshots — **not started**
- [ ] README — partial (local dev only, needs architecture/observability sections later)
- [ ] ARCHITECTURE.md — **missing**
- [ ] INSTRUMENTATION.md — **missing**
- [ ] MONITORING.md — **missing**
- [ ] ALERTING.md — **missing**
- [ ] INCIDENTS.md — **missing**
- [ ] Runbook — **missing**
- [ ] Dashboard guide — **missing**
- [ ] Deployment guide — **missing**
- [ ] Presentation — **missing**
- [ ] Demo script — **missing**
- [ ] Backup screenshots — **missing**
