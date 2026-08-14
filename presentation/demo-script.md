# Demo Script

Companion to `slides.pptx`/`slides.pdf`. Covers the live-demo flow, exact commands to run, what to say, and anticipated questions.

## Before you start

- [ ] Confirm the EC2 instance is running: `aws ec2 describe-instances --instance-ids i-0a73e6a486c1efbeb --region eu-north-1 --query "Reservations[0].Instances[0].State.Name"` (start it if stopped — see `docs/deployment.md`)
- [ ] Have the CloudWatch console open in a browser tab, logged in, on the `P2-Order-Inventory` dashboard
- [ ] Have a terminal ready with `curl`/`generate-traffic.sh` commands pre-typed (don't type live under pressure)
- [ ] Have `presentation/backup-screenshots/` open in a viewer as fallback
- [ ] Know the current public IP: `terraform output -raw public_ip` (from `terraform/`) — it may differ from `13.60.31.126` if the instance was ever stopped/restarted without an Elastic IP

## Slide-by-slide flow

### 1. Title
Say: introduce the project name and the one-sentence scope — "an order/inventory API instrumented end-to-end, deployed on EC2, observed through CloudWatch."

### 2. The Assignment
Say: walk the requirement list quickly, then land on the guiding principle slide — this is the thesis of the whole presentation. Everything after this slide is evidence for that one sentence.

### 3. Architecture
Say: trace the pipeline left to right — EC2 → CloudWatch Agent → CloudWatch → Dashboard → Alarms → SNS. Call out the two AWS-native choices worth defending: SSM over SSH, one instance instead of two.

### 4. Instrumentation — Logs & Correlation IDs
Say: point at the real log snippet on the right — same `correlationId`, two different services, two different log lines. This is not a diagram, it's an actual captured request.

### 5. Instrumentation — 8 Custom Metrics
Say: emphasize the business/technical split — the rubric wants real business metrics, not just infrastructure counters. `order_value`, `stock_level`, and `reservation_failures` (by SKU) are the business case.

### 6. Live Demo — switch to browser now
**What to actually do:**
```bash
./scripts/generate-traffic.sh http://<public-ip>:3000 30 0.4
```
While it runs, switch to the CloudWatch console and let the widgets visibly update. Point out:
- Traffic widget ticking up in real time
- Errors widget showing a couple of lines (bad-SKU traffic is intentional in the generator)
- Latency staying flat and low

**If the live demo fails** (network issue, console won't load, etc.): fall back to slide 6's embedded screenshot and `backup-screenshots/01-full-dashboard.png` — say so plainly ("the live demo isn't cooperating, here's the same dashboard captured during testing") rather than pretending it's live.

### 7. Golden Signals Tour
Say: one sentence per widget, but linger on Saturation — foreshadow Incident #1, since it's the widget that carries that story.

### 8. Alerting — 6 Tiered Alarms
Say: point at the "Observed baseline" column — every threshold has real data behind it. Call out the honest note about the error-rate alarms' relationship to the test traffic generator if asked (don't volunteer it unless there's time; it's in `ALERTING.md` if pressed).

### 9. Alerting — SNS Email Flow
Say: this is a real email, not a mockup — point at the timestamp and the exact breaching datapoints in the email body.

### 10-12. Incidents #1-3
Say for each: state the one-line finding first, then the evidence. Incident #3 is the strongest slide in the deck — the bar chart is a real, data-backed correlation, not an assumption. If time is short, this is the one incident to keep in full; #1 and #2 can be summarized from memory.

### 13. Learnings
Say: pick two of the five to actually elaborate on out loud (missing timeout + correlation≠severity are the strongest); read the rest, don't over-explain all five.

### 14. Questions?
Open the floor.

## Anticipated questions and answers

**Q: Why didn't you use a database?**
A: Explicit project design choice — the assignment grades observability, not persistence. In-memory state keeps the app simple enough that all the effort went into logs/metrics/dashboard/alerting instead.

**Q: Why one EC2 instance instead of two (one per service)?**
A: Lets order-service call inventory-service over `localhost` instead of the network — simpler security group (only one port needs to be public), no service discovery needed, and it's still enough to demonstrate a real multi-service architecture with correlation IDs across a network-equivalent boundary.

**Q: Why SSM Session Manager instead of SSH?**
A: No key to manage or lose, no port 22 exposed to the internet, and access is IAM-authenticated and logged. It's the more current AWS-native pattern.

**Q: How did you choose your alarm thresholds?**
A: Pulled real baseline data from CloudWatch first (`get-metric-statistics`), then set thresholds at a large multiple of baseline — e.g. CPU baseline ~0.3%, threshold 80% (~250x headroom). Verified against real load in the incidents, not just configured and hoped.

**Q: What would you do differently for production?**
A: Add the missing request timeout on the inventory-service call (found in Incident #2); consider a circuit breaker; add an Elastic IP or a load balancer so the address doesn't change on instance restart; consider `CPUCreditBalance` alarm for the burstable instance type; move the dashboard into Terraform for full IaC coverage (it's currently deployed via CLI, though the JSON is version-controlled).

**Q: How do you know your metrics/logs are actually correct and not just configured?**
A: Every metric and alarm in this project was verified against real triggered data, not just deployed — three failure injection tests, each with a captured screenshot and a real received email, documented in `INCIDENTS.md`.

**Q: What was the hardest part of this project?**
A: Two real debugging stories worth telling: (1) the CloudWatch Agent's StatsD listener defaulted to an IPv6-only bind, silently dropping every metric sent to `localhost` until traced with a manual UDP test; (2) discovering the agent auto-adds a `metric_type` dimension never configured, which broke a naive hardcoded-dimension dashboard design and led to using `SEARCH()` expressions instead.

**Q: Why 8 metrics instead of the minimum 5?**
A: Wanted genuine coverage of both RED (rate/errors/duration) and business impact (revenue, stock levels) without padding — every metric on the instrumentation slide has a distinct, named use in either the dashboard or an incident investigation.

**Q: Is this actually production-ready?**
A: No, and the Learnings slide says so explicitly — missing request timeout, no auto-scaling, no Elastic IP, dashboard outside Terraform. The project's stated goal was observability depth over production completeness, and that's where the effort went.
