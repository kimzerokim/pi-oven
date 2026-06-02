---
name: aws
version: 0.1.0
description: AWS production read connector for UC5. Use for read-only AWS inventory, deployment-state inspection, and CloudFront/S3/ECR/EC2/CloudWatch checks tied to ops debugging.
trigger: "AWS, aws, cloud infra, S3, CloudFront, EC2, ECR, Route53, CloudWatch, prod read, 프로덕션 조회, 운영 인프라 조회, AWS 상태 확인"
alwaysApply: false
---

# aws

## Purpose

Provide a safe AWS connector for UC5 operations dogfooding. This skill is optimized for **read-only production inspection** and must follow the production-access boundary.

## Dispatch discipline (main orchestrates, subagents do the work)

Do NOT do this skill's substantive work in the main context. Main's direct-action budget is narrow: 1-2 file simple edits (≤30 LoC) or operational commands (git status / ls / install). ANY multi-file change, 3+ file reads, 200+ LoC, or multi-step investigation/implementation MUST be dispatched to a subagent — main only dispatches, synthesizes, and reviews, never implements inline (see `large-task-delegation` + `subagent-driven-development`). Route by model-fit AND role-fit: multi-step infra changes → `pi-oven:executor`; IAM / security review → `pi-oven:security-reviewer`.

## Credential source

Use the first existing file from this precedence list:

1. `.external-credentials`
2. `.external_certificate`
3. `.external_certificate`

Expected section:

```ini
[aws]
profile=<aws-profile>
region=<aws-region>
```

If no file/section exists, report the exact missing key(s) and stop.

## Safety

- Read-only calls are allowed when explicitly requested.
- Any write/mutation command is forbidden in this skill.
- Never create, rotate, or expose credentials.

## Required flow

1. Read credentials file and parse `[aws]` values.
2. Verify identity with `aws sts get-caller-identity --profile <profile> --region <region>`.
3. Run only read-only commands requested by the user.
4. Return concise evidence tables and command outputs.

## Mutation redirection

If the user requests `s3 rm`/`cp`/`sync`, `cloudfront create-invalidation`/`update-distribution`, `ec2 start`/`stop`/`terminate`/`reboot`, `ecr delete`, `route53 change-resource-record-sets`, or `cloudwatch` alarm update, reply that mutations must be authored as an idempotent Terraform/CloudFormation/bash script in `scripts/prod/` and run via CI; never execute directly. Prefer temporary STS (`ASIA`) single-use credentials; refuse permanent `AKIA` keys.

## Allowed read-only command patterns

- `aws sts get-caller-identity`
- `aws s3 ls`, `aws s3api head-object`, `aws s3api get-bucket-policy`, `aws s3api get-bucket-website`
- `aws cloudfront get-distribution`, `aws cloudfront get-distribution-config`, `aws cloudfront list-invalidations`
- `aws ec2 describe-instances`, `aws ec2 describe-instance-status`
- `aws ecr describe-images`, `aws ecr describe-repositories`
- `aws route53 list-hosted-zones`, `aws route53 list-resource-record-sets`
- `aws logs describe-log-groups`, `aws logs get-log-events`
- `aws cloudwatch describe-alarms`

## Default health check (when user gives no subcommand)

1. Identity check (`sts get-caller-identity`)
2. S3 access check for explicitly named bucket(s)
3. CloudFront distribution status check for explicitly named distribution ID(s)
4. Return a pass/fail summary with failing command and stderr excerpt
