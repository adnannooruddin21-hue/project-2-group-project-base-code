output "instance_id" {
  description = "EC2 instance ID"
  value       = aws_instance.app.id
}

output "public_ip" {
  description = "Public IP of the instance (order-service reachable at http://<this>:3000)"
  value       = aws_instance.app.public_ip
}

output "iam_role_name" {
  description = "IAM role attached to the instance"
  value       = aws_iam_role.ec2_role.name
}

output "security_group_id" {
  description = "Security group ID"
  value       = aws_security_group.app.id
}
