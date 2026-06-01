---
name: cloudflare
version: 0.1.0
description: Cloudflare DNS connector for UC5. Use for Cloudflare zone/DNS inspection, propagation checks, and DNS-to-origin diagnostics.
trigger: "Cloudflare, cloudflare, DNS, zone, CNAME, A record"
alwaysApply: false
---

# cloudflare

## Purpose

Provide a Cloudflare DNS connector to close UC5 operations coverage for domain-layer diagnostics.

## Credential source

Use the first existing file from this precedence list:

1. `.external-credentials`
2. `.external_certificate`
3. `.external_certificate`

Expected section:

```ini
[cloudflare]
account_id=<account-id>
zone_id=<zone-id>
api_token=<account-scoped-token>
```

If `account_id`/`zone_id` are absent but `zone` exists, resolve zone ID before continuing.

## Safety

- Read-only API calls are allowed.
- DNS mutation calls (POST/PUT/PATCH/DELETE) are forbidden in this skill. If the user requests record changes, instruct them to author an idempotent Terraform module or bash script in `scripts/prod/`, commit to git, and execute via CI/CD. The AI must NEVER execute POST/PUT/PATCH/DELETE directly.
- Verify the `api_token` is read-only scoped. If the token-verify response indicates write scope, warn the user and request a read-only token before continuing.

## Required flow

1. Read credentials file and parse `[cloudflare]` values.
2. Verify token using the account endpoint:
   `GET /accounts/<account_id>/tokens/verify`
3. Run requested read-only DNS/zone query.
4. Return compact, human-readable evidence.

## Read-only operations

- List DNS records for zone
- Filter records by name/type
- Get zone metadata
- Confirm record presence before deploy checks
- Correlate DNS target with CloudFront/origin endpoint

## Default health check (no subcommand)

1. Token verify status
2. Zone status
3. DNS record summary (name, type, content, proxied)
