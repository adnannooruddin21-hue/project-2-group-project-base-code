variable "aws_region" {
  description = "AWS region to deploy into"
  type        = string
  default     = "eu-north-1"
}

variable "project_name" {
  description = "Prefix used to tag/name every resource this project creates"
  type        = string
  default     = "p2-order-inventory"
}

variable "instance_type" {
  description = "EC2 instance type running both services"
  type        = string
  default     = "t3.micro"
}

variable "app_port" {
  description = "Port order-service listens on and exposes publicly"
  type        = number
  default     = 3000
}

variable "app_ingress_cidr" {
  description = "CIDR allowed to reach app_port (0.0.0.0/0 = whole internet)"
  type        = string
  default     = "0.0.0.0/0"
}

variable "iam_user_name" {
  description = "IAM user that needs SSM Session Manager permissions to connect to the instance"
  type        = string
  default     = "AdnanTest"
}

variable "alert_email" {
  description = "Email address subscribed to the SNS alarm topic"
  type        = string
  default     = "adnan.nooruddin21@gmail.com"
}
