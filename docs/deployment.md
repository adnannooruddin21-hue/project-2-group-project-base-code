# Deployment

This describes the actual sequence used to deploy this project, in order. Every command here was run and verified during development — nothing hypothetical.

## Prerequisites

- AWS CLI configured with credentials that have EC2, IAM, CloudWatch, CloudWatchLogs, SNS, and VPC permissions.
- Terraform >= 1.5.
- `session-manager-plugin` installed locally (for SSM access — no SSH key is used).
- `gh` CLI (optional, used for PR-based workflow during development).

## 1. Provision infrastructure (Terraform)

```bash
cd terraform
terraform init
terraform validate
terraform plan -out=tfplan
# review the plan, then:
terraform apply tfplan
```

Creates: EC2 instance (t3.micro, Amazon Linux 2023), security group (port 3000 only, no SSH), IAM role + instance profile (`CloudWatchAgentServerPolicy` + `AmazonSSMManagedInstanceCore`), an inline IAM policy granting the operator's IAM user SSM session permissions, SNS topic + email subscription, 2 CloudWatch Logs metric filters, and 6 CloudWatch alarms.

**Note:** during actual deployment, the initial `aws_instance` creation hung for 16+ minutes with no error on one attempt (cause not fully confirmed — possibly a transient AWS-side issue or IAM instance-profile propagation delay). A `timeouts { create = "5m" }` block was added to fail cleanly on retry instead of hanging indefinitely; the second attempt (in a different subnet/AZ) succeeded in the normal ~1-2 minutes. See [docs/runbook.md](runbook.md) if this recurs.

**Manual step — SNS email confirmation:** AWS sends a confirmation email immediately after `apply`. Alarms will not reach the inbox until that link is clicked. Verify with:
```bash
aws sns list-subscriptions-by-topic --region eu-north-1 \
  --topic-arn $(terraform output -raw sns_topic_arn) \
  --query "Subscriptions[].{Endpoint:Endpoint,Status:SubscriptionArn}" --output table
```
A real ARN in the `Status` column (not the literal string `PendingConfirmation`) means it's confirmed.

## 2. Connect to the instance

```bash
aws ssm start-session --target <instance-id> --region eu-north-1
```
(Get `<instance-id>` from `terraform output instance_id`.)

## 3. Install the runtime

```bash
cd ~   # SSM sessions can start in /usr/bin, which isn't writable
sudo dnf update -y
sudo dnf install -y nodejs git
sudo npm install -g pm2
```

## 4. Deploy the application

```bash
git clone https://github.com/<your-username>/<your-repo>.git app
cd app
cd inventory-service && npm ci && cd ..
cd order-service && npm ci && cd ..
pm2 start ecosystem.config.js
pm2 status
```

`npm ci` (not `npm install`) installs exactly what's in the committed `package-lock.json` files — no version drift between local dev and the deployed instance.

## 5. Install and configure the CloudWatch Agent

```bash
sudo dnf install -y amazon-cloudwatch-agent
sudo /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl \
  -a fetch-config -m ec2 -s \
  -c file:/home/ssm-user/app/config/cloudwatch-agent-config.json
sudo /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl -a status
```
Expect `"status": "running"`. This single agent handles log shipping, CPU/memory/disk metrics, and the StatsD listener for custom app metrics.

## 6. Deploy the dashboard

```bash
# from your local machine, not the instance
aws cloudwatch put-dashboard --region eu-north-1 \
  --dashboard-name P2-Order-Inventory \
  --dashboard-body file://config/dashboard.json
```

## Verification checklist

Run these after every deploy to confirm the full pipeline actually works end-to-end, not just that commands succeeded:

```bash
# 1. Health checks
curl http://<public-ip>:3000/health
curl -X POST http://<public-ip>:3000/orders -H "Content-Type: application/json" \
  -d '{"sku":"SKU-001","quantity":1,"customerId":"verify"}'

# 2. Logs actually reaching CloudWatch
aws logs tail /p2-order-inventory/order-service --region eu-north-1 --since 5m

# 3. Custom metrics actually reaching CloudWatch (allow ~90s after generating traffic)
aws cloudwatch list-metrics --region eu-north-1 --namespace P2OrderInventory --query "Metrics[].MetricName" --output table

# 4. Alarms exist and are evaluating (not stuck in INSUFFICIENT_DATA indefinitely)
aws cloudwatch describe-alarms --region eu-north-1 --alarm-name-prefix p2-order-inventory \
  --query "MetricAlarms[].{Name:AlarmName,State:StateValue}" --output table
```

## Redeploying a code change

```bash
# on the instance, via SSM
cd ~/app
git pull origin main
pm2 restart ecosystem.config.js
```

## Updating the CloudWatch Agent config

If `config/cloudwatch-agent-config.json` changes (e.g. adding a new log file or metric):
```bash
cd ~/app && git pull origin main
sudo /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl \
  -a fetch-config -m ec2 -s \
  -c file:/home/ssm-user/app/config/cloudwatch-agent-config.json
```

## Updating the dashboard

```bash
aws cloudwatch put-dashboard --region eu-north-1 \
  --dashboard-name P2-Order-Inventory \
  --dashboard-body file://config/dashboard.json
```
Check the response for an empty `DashboardValidationMessages` array — non-empty means something in the widget JSON is malformed.

## Tearing down

To stop billing when not actively working:
```bash
aws ec2 stop-instances --instance-ids <instance-id> --region eu-north-1
```
To remove everything entirely:
```bash
cd terraform
terraform destroy
```
(The dashboard, being outside Terraform state, would need separate manual deletion via `aws cloudwatch delete-dashboards`.)
