---
name: aws
version: 0.1.0
description: "Read this skill for consent-gated AWS infrastructure inspection, production-state queries, and cloud ops debugging across S3, CloudFront, EC2, ECR, Route53, and CloudWatch."
---

# aws

## Purpose

Provide a safe AWS connector for UC5 operations dogfooding. Direct AWS execution defaults to refusal unless the latest user message grants explicit natural-language external execution consent. Under that active consent, one matching direct AWS read may use local credential files already on the machine, but any direct AWS mutation may proceed only within the explicitly approved scope and only while the exact valid temporary credential bundle explicitly consented in the latest user message remains unexpired.

## Dispatch discipline (main orchestrates, subagents do the work)

Do NOT do this skill's substantive work in the main context. Main's direct-action budget is narrow: 1-2 file simple edits (≤30 LoC) or operational commands (git status / ls / install). ANY multi-file change, 3+ file reads, 200+ LoC, or multi-step investigation/implementation MUST be dispatched to a subagent — main only dispatches, synthesizes, and reviews, never implements inline (see `large-task-delegation` + `subagent-driven-development`). Route by model-fit AND role-fit: multi-step infra changes → `pi-oven:executor`; IAM / security review → `pi-oven:security-reviewer`. Temporary-bundle mutation path: under active consent, matching AWS commands may run in the parent or a delegated subagent only when the runtime enforces reuse of the same validated bundle/fingerprints for that approved scope until `Expiration`/`expiresAt`; subagents must not widen scope or fall back to local or ambient credentials.

## Credential source (active consent only)

After confirming latest-turn explicit natural-language external execution consent, choose the credential source that matches the allowed operation:
That latest-message approval must name the direct-exec scope in plain language. `read` / `access` may use local credential files already on the machine; `mutation` / `all` require the full temporary bundle in the same latest user message. For example: `You may use my local credentials for one direct AWS read command.` or `You may run direct AWS mutation commands using this temporary AWS credential bundle until it expires: ...`.

1. If the latest user message explicitly provides a valid temporary AWS bundle for an approved mutation scope (`AccessKeyId`, `SecretAccessKey`, `SessionToken`, and an expiry such as `Expiration` / `expiresAt`), direct AWS mutation commands may proceed only within that approved scope and only while the bundle is still unexpired. Every such command must use that exact bundle. Do not silently fall back to local credential files, a different profile, or ambient credentials.
2. Otherwise, for a single consented direct read, use the first existing file from this precedence list:
   1. `.external-credentials`
   2. `.external_certificate`
   3. `.external_cerficate`

Expected section:

```ini
[aws]
profile=<aws-profile>
region=<aws-region>
```

If the chosen credential source is missing required fields, report the exact missing key(s) and stop. Without active consent, do not inspect local credential files. Without a valid explicitly consented temporary bundle, do not run direct AWS mutations; with one, run only matching in-scope commands until expiry, otherwise use the script/CI path instead.

## Safety

- Direct AWS reads and mutations default to refusal unless the latest user message grants explicit natural-language external execution consent.
- Local credential files already on the machine may be used only under active latest-message consent, and they are never enough by themselves to authorize a direct mutation or `all` scope.
- Pasted inline AWS credentials are blocked by default. The only exception is a latest-turn explicit natural-language consent for an approved mutation or `all` scope plus a valid temporary bundle (`AccessKeyId` / `SecretAccessKey` / `SessionToken` + expiry). Matching AWS commands within that scope may use that bundle only until expiry and only when the runtime enforces the same-bundle requirement. Permanent AKIA-style material remains forbidden, and credentials must never be created, rotated, exposed, repeated verbatim, or wrapped in `export` commands.

## Required flow

1. If the user pasted inline AWS credentials, allow only the narrow temporary-bundle exception: the latest user message must explicitly consent the mutation or `all` scope in natural language, the bundle must be valid temporary AWS credentials, and any direct AWS mutation commands must stay within that scope, remain before expiry, and use that matching bundle with no local or ambient fallback. Otherwise refuse immediately, do not echo the secret back, and do not suggest `export AWS_*` shell snippets.
2. If no allowed inline temporary-bundle exception applies, check whether latest-turn explicit natural-language external execution consent is active.
3. For a consented direct read or access command, read the credentials file and parse `[aws]` values. For a direct mutation, require the explicitly consented valid temporary bundle instead of local credentials.
4. Execute only directly requested AWS reads/access calls or approved-scope AWS mutations. If a temporary bundle was consented, every direct mutation command must use that exact bundle; if a command would fall outside the approved scope, pass expiry, or resolve to local credentials or a different bundle instead, stop.
5. If the user's requested single command is identity verification, `aws sts get-caller-identity --profile <profile> --region <region>` may be that one command when the local-file/profile flow is allowed.
6. If broader verification or a health check would require multiple direct reads, ask for fresh consent per command or switch to a user-run script/CI path instead of chaining local-credential direct calls under one consent use. For temporary-bundle mutations, additional direct commands are allowed only while they remain inside the explicitly approved scope and expiry window.

## Mutation redirection

If the user requests `s3 rm`/`cp`/`sync`, `cloudfront create-invalidation`/`update-distribution`, `ec2 start`/`stop`/`terminate`/`reboot`, `ecr delete`, `route53 change-resource-record-sets`, or `cloudwatch` alarm update, the default no-consent path is to author an idempotent Terraform/CloudFormation/bash script in `scripts/prod/` and run it via CI. Under active explicit natural-language external execution consent, one matching direct read may use local credential files already on the machine, but direct mutation commands may run only within the explicitly approved scope and only until the exact valid temporary bundle explicitly consented in the latest user message expires; pasted inline permanent or non-matching credentials remain forbidden.

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
