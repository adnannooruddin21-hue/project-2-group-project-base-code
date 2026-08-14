# Runbook

Practical troubleshooting steps for common problems. For alarm-specific first steps, see [ALERTING.md](../ALERTING.md); for full worked examples, see [INCIDENTS.md](../INCIDENTS.md).

## Connecting to the instance

No SSH key exists — access is via SSM Session Manager only.

```bash
aws ssm start-session --target i-0a73e6a486c1efbeb --region eu-north-1
```

Requires the `session-manager-plugin` installed locally (`brew install --cask session-manager-plugin` on macOS) and the connecting IAM user to have the SSM session permissions (see `aws_iam_user_policy.ssm_session_access` in `terraform/main.tf`).

**Known quirk:** SSM sessions often start in `/usr/bin`, which `ssm-user` can't write to. Run `cd ~` before any command that writes files (git clone, stress-ng, etc.).

## Checking service status

```bash
pm2 status
pm2 logs --lines 50 --nostream       # both services
pm2 logs order-service --lines 50    # just one
```

## Restarting a service

```bash
pm2 restart order-service
pm2 restart inventory-service
pm2 restart ecosystem.config.js      # both
```

## Deploying a code change

```bash
cd ~/app
git pull origin main
pm2 restart ecosystem.config.js
```

## Checking CloudWatch Agent health

```bash
sudo /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl -a status
sudo tail -50 /opt/aws/amazon-cloudwatch-agent/logs/amazon-cloudwatch-agent.log
```

If logs/metrics stop appearing in CloudWatch, this is the first thing to check — confirm `"status": "running"`.

Reapplying a changed agent config:
```bash
sudo /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl \
  -a fetch-config -m ec2 -s \
  -c file:/home/ssm-user/app/config/cloudwatch-agent-config.json
```

## Checking alarm state

```bash
aws cloudwatch describe-alarms --region eu-north-1 --alarm-name-prefix p2-order-inventory \
  --query "MetricAlarms[].{Name:AlarmName,State:StateValue}" --output table
```

For the *reason* an alarm is in its current state (includes the actual breaching datapoints):
```bash
aws cloudwatch describe-alarms --region eu-north-1 --alarm-names <alarm-name> \
  --query "MetricAlarms[0].{State:StateValue,Reason:StateReason}" --output json
```

## Tailing logs live

```bash
aws logs tail /p2-order-inventory/order-service --region eu-north-1 --since 5m --follow
aws logs tail /p2-order-inventory/inventory-service --region eu-north-1 --since 5m --follow
```

## Tracing one request across both services

Grab a `correlationId` from any log line, then in CloudWatch Logs Insights (or via `aws logs filter-log-events` on both log groups):
```
fields @timestamp, service, event, level, correlationId
| filter correlationId = "<the-id>"
| sort @timestamp asc
```

## Generating test traffic

```bash
./scripts/generate-traffic.sh http://13.60.31.126:3000 <requests> <delay-seconds>
```
Includes a mix of valid orders, a nonexistent SKU, and low-stock SKUs — produces a realistic spread of INFO/WARN log levels.

## Common issues

| Symptom | Likely cause | Fix |
|---|---|---|
| `git clone`/other file-write command fails with "Permission denied" | SSM session started in `/usr/bin` | `cd ~` first |
| `stress-ng: aborting: temp-path '.' must be readable and writeable` | Same as above | `cd ~` and/or pass `--temp-path /tmp` |
| New CloudWatch metrics don't show up | Agent config wasn't re-applied after a change | Run the `fetch-config` command above |
| Alarm stuck in `INSUFFICIENT_DATA` | Metric filter/StatsD metric is new and has no historical data yet, or no traffic has been generated recently | Generate traffic, wait ~2-3 minutes for 3 fresh 60s periods to accumulate |
| `terraform apply` hangs on `aws_instance` creation for a long time with no error | Observed once during this project (16+ min on one attempt, resolved on retry with a different AZ) — cause not fully confirmed, possibly transient AWS-side or IAM-instance-profile propagation delay | Add a `timeouts { create = "5m" }` block (already present) so it fails cleanly instead of hanging forever; retry, optionally in a different subnet/AZ |
| IAM policy change doesn't take effect immediately | IAM propagation delay (usually seconds, occasionally longer) | Use `aws iam simulate-principal-policy` to check the *current* effective permission before assuming something is broken |
| `AttachUserPolicy` fails with `LimitExceeded` | AWS's 10-managed-policies-per-user quota | Use an inline policy (`aws_iam_user_policy`) instead — doesn't count against the quota, and is more least-privilege than another blanket managed policy anyway |
