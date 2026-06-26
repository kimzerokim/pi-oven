---
name: aws
version: 0.1.0
description: "Read this skill for consent-gated AWS infrastructure inspection, production-state queries, and cloud ops debugging across S3, CloudFront, EC2, ECR, Route53, and CloudWatch."
---

# aws

## Purpose

Provide a safe AWS connector for UC5 operations dogfooding. Direct AWS execution defaults to refusal unless the latest user message grants explicit external execution consent; under that active consent, one matching direct command may use local credential files already on the machine.

## Dispatch discipline (main orchestrates, subagents do the work)

Do NOT do this skill's substantive work in the main context. Main's direct-action budget is narrow: 1-2 file simple edits (≤30 LoC) or operational commands (git status / ls / install). ANY multi-file change, 3+ file reads, 200+ LoC, or multi-step investigation/implementation MUST be dispatched to a subagent — main only dispatches, synthesizes, and reviews, never implements inline (see `large-task-delegation` + `subagent-driven-development`). Route by model-fit AND role-fit: multi-step infra changes → `pi-oven:executor`; IAM / security review → `pi-oven:security-reviewer`. Parent-session-only exception: under active consent, the one direct AWS command must be executed by the parent session itself because the runtime consumes consent only there; subagents may assist only with read-only investigation, script authoring, or planning.

## Credential source (active consent only)

Only after confirming latest-turn explicit external execution consent is active, use the first existing file from this precedence list:

1. `.external-credentials`
2. `.external_certificate`
3. `.external_cerficate`

Expected section:

```ini
[aws]
profile=<aws-profile>
region=<aws-region>
```

If no file/section exists, report the exact missing key(s) and stop. Without active consent, do not inspect local credential files and use the script/CI path instead.

## Safety

- Direct AWS reads and mutations default to refusal unless the latest user message grants explicit external execution consent.
- Local credential files already on the machine may be used only under active consent.
- Pasted inline AKIA/secret/token literals remain forbidden, and credentials must never be created, rotated, exposed, repeated verbatim, or wrapped in `export` commands.

## Required flow

1. If the user pasted inline AWS credentials in the prompt, refuse immediately, do not echo the secret back, and do not suggest `export AWS_*` shell snippets; point them to the gitignored local credential file path instead.
2. Otherwise, check whether latest-turn explicit external execution consent is active.
3. If consent is active, read the credentials file and parse `[aws]` values.
4. With that one active consent use, have the parent session itself execute exactly one matching directly requested AWS command and return concise evidence tables and command output.
5. If the user's requested single command is identity verification, `aws sts get-caller-identity --profile <profile> --region <region>` may be that one command.
6. If broader verification or a health check would require multiple direct commands, ask for fresh consent per command or switch to a user-run script/CI path instead of chaining direct calls under one consent use.

## Mutation redirection

If the user requests `s3 rm`/`cp`/`sync`, `cloudfront create-invalidation`/`update-distribution`, `ec2 start`/`stop`/`terminate`/`reboot`, `ecr delete`, `route53 change-resource-record-sets`, or `cloudwatch` alarm update, the default no-consent path is to author an idempotent Terraform/CloudFormation/bash script in `scripts/prod/` and run it via CI. Under active explicit external execution consent, one matching direct command may use local credential files already on the machine, but pasted inline AKIA/secret/token literals remain forbidden.

## Common direct-read command patterns (under active consent)

- `aws sts get-caller-identity`
- `aws s3 ls`, `aws s3api head-object`, `aws s3api get-bucket-policy`, `aws s3api get-bucket-website`
- `aws cloudfront get-distribution`, `aws cloudfront get-distribution-config`, `aws cloudfront list-invalidations`
- `aws ec2 describe-instances`, `aws ec2 describe-instance-status`
- `aws ecr describe-images`, `aws ecr describe-repositories`
- `aws route53 list-hosted-zones`, `aws route53 list-resource-record-sets`
- `aws logs describe-log-groups`, `aws logs get-log-events`
- `aws cloudwatch describe-alarms`

## Default health check (when user gives no subcommand)
There is no implied multi-command direct health check under one consent use. If the user gives no subcommand, either:
1. run one explicitly requested AWS read as the single direct command (for example `sts get-caller-identity` or one named-resource check), or
2. provide a user-run multi-command health-check script for identity plus service checks.
