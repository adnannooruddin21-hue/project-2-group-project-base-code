# ---------------------------------------------------------------------------
# Data sources: look up the default VPC/subnet and the latest Amazon Linux
# 2023 AMI instead of hardcoding IDs that go stale.
# ---------------------------------------------------------------------------

data "aws_vpc" "default" {
  default = true
}

data "aws_subnets" "default" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.default.id]
  }
}

data "aws_ami" "al2023" {
  most_recent = true
  owners      = ["amazon"]

  filter {
    name   = "name"
    values = ["al2023-ami-2023.*-x86_64"]
  }

  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }
}

# ---------------------------------------------------------------------------
# Security group: only the app port is open to the internet. No SSH port —
# instance access is via SSM Session Manager (IAM-authenticated, no keys).
# ---------------------------------------------------------------------------

resource "aws_security_group" "app" {
  name        = "${var.project_name}-sg"
  description = "Allow inbound app traffic; all other access via SSM"
  vpc_id      = data.aws_vpc.default.id

  ingress {
    description = "order-service (public API)"
    from_port   = var.app_port
    to_port     = var.app_port
    protocol    = "tcp"
    cidr_blocks = [var.app_ingress_cidr]
  }

  egress {
    description = "all outbound (package installs, CloudWatch, SSM, GitHub)"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name    = "${var.project_name}-sg"
    Project = var.project_name
  }
}

# ---------------------------------------------------------------------------
# IAM role for the EC2 instance profile. Two AWS-managed policies:
#   - CloudWatchAgentServerPolicy: lets the CloudWatch Agent push logs and
#     custom metrics, and read its own config from SSM Parameter Store.
#   - AmazonSSMManagedInstanceCore: required for Session Manager access.
# No access keys are ever stored on the instance.
# ---------------------------------------------------------------------------

resource "aws_iam_role" "ec2_role" {
  name = "${var.project_name}-ec2-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ec2.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })

  tags = {
    Project = var.project_name
  }
}

resource "aws_iam_role_policy_attachment" "cloudwatch_agent" {
  role       = aws_iam_role.ec2_role.name
  policy_arn = "arn:aws:iam::aws:policy/CloudWatchAgentServerPolicy"
}

resource "aws_iam_role_policy_attachment" "ssm_core" {
  role       = aws_iam_role.ec2_role.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_instance_profile" "ec2_profile" {
  name = "${var.project_name}-ec2-profile"
  role = aws_iam_role.ec2_role.name
}

# ---------------------------------------------------------------------------
# Inline policy (not a managed-policy attachment - the account is already at
# the 10-managed-policy-per-user quota) granting the human IAM user just the
# actions needed to start an SSM Session Manager shell on the instance.
# ---------------------------------------------------------------------------

resource "aws_iam_user_policy" "ssm_session_access" {
  name = "${var.project_name}-ssm-session-access"
  user = var.iam_user_name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "ssm:StartSession",
        "ssm:TerminateSession",
        "ssm:ResumeSession",
        "ssm:DescribeSessions",
        "ssm:GetConnectionStatus",
        "ssm:DescribeInstanceInformation",
        "ec2:DescribeInstances",
      ]
      Resource = "*"
    }]
  })
}

# ---------------------------------------------------------------------------
# The EC2 instance itself. No user_data bootstrap on purpose — Node.js, pm2,
# the CloudWatch Agent, and the app deployment are done manually via SSM in
# the next step, so each piece can be explained and verified individually.
# ---------------------------------------------------------------------------

# Pinned to a specific subnet/AZ (not ids[0]) after ids[0]'s AZ repeatedly
# hung on RunInstances with no resulting instance and no error - trying a
# different AZ to rule out an AZ-scoped capacity/backend issue.
resource "aws_instance" "app" {
  ami                    = data.aws_ami.al2023.id
  instance_type          = var.instance_type
  subnet_id              = data.aws_subnets.default.ids[1]
  vpc_security_group_ids = [aws_security_group.app.id]
  iam_instance_profile   = aws_iam_instance_profile.ec2_profile.name

  root_block_device {
    volume_size = 10
    volume_type = "gp3"
  }

  tags = {
    Name    = "${var.project_name}-ec2"
    Project = var.project_name
  }

  timeouts {
    create = "5m"
  }
}
