---
name: pov:cloudflare
version: 0.1.0
description: "Read this skill for Cloudflare DNS, zone, record, and propagation work. Provides a DNS connector for zone inspection, propagation checks, and DNS-to-origin diagnostics."
---

# cloudflare

## Purpose

Provide a Cloudflare DNS connector to close UC5 operations coverage for domain-layer diagnostics.

## Dispatch discipline (main orchestrates, subagents do the work)

ENFORCEMENT: Do NOT do this skill's substantive work in the main context. Main's direct-action budget is narrow (1-2 file simple edits ≤ 30 LoC, or operational commands like `git status` / `ls` / install). ANY multi-file change, 3+ file reads, 200+ LoC, or multi-step investigation/implementation MUST be dispatched to a subagent — main only dispatches, synthesizes, and reviews, never implements inline. (See `large-task-delegation` + `subagent-driven-development`.) RIGHT-AGENT ROUTING: Match the agent to the work (model-fit + role-fit is first-class) — multi-step config / deploy work → `pi-oven:executor`. Parent-session-only exception: under active consent, the one direct Cloudflare API call must be executed by the parent session itself because the runtime consumes consent only there; subagents may assist only with read-only investigation, script authoring, or planning.

## Credential source (active consent only)

Only after confirming latest-turn explicit external execution consent is active, use the first existing file from this precedence list:

1. `.external-credentials`
2. `.external_certificate`
3. `.external_cerficate`

Expected section:

```ini
[cloudflare]
account_id=<account-id>
zone_id=<zone-id>
api_token=<account-scoped-token>
```

If `account_id`/`zone_id` are absent but `zone` exists, do not auto-resolve the missing ID and then make another direct API call under the same consent use; ask for fresh consent for each direct call or use the user-run/script path instead. Without active consent, do not inspect local credential files and use the user-run/script path instead.

## Safety

- Read-oriented DNS/zone inspection is the default use case, but direct Cloudflare API execution still requires latest-turn explicit external execution consent.
- DNS mutation calls default to refusal; without consent, instruct the user to author an idempotent Terraform module or bash script in `scripts/prod/` and execute via CI/CD. With matching active consent, one direct mutation may use local credential files already on the machine.
- Treat the `api_token` as read-only scoped by default; if a requested direct mutation needs write scope or any extra verification call, warn about that broader scope before continuing.

## Required flow

1. Check whether latest-turn explicit external execution consent is active.
2. If consent is active, read the credentials file and parse `[cloudflare]` values.
3. With that one active consent use, have the parent session itself execute exactly one requested DNS/zone query or one matching direct mutation and return compact, human-readable evidence.
4. If the user's requested single call is token verification, `GET /accounts/<account_id>/tokens/verify` may be that one direct action.
5. If broader verification, zone-ID resolution, or health checks would require additional API calls, ask for fresh consent per call or fall back to the user-run/script path without chaining direct calls under one consent use.

## Read-only operations

- List DNS records for zone
- Filter records by name/type
- Get zone metadata
- Confirm record presence before deploy checks
- Correlate DNS target with CloudFront/origin endpoint

## Default health check (no subcommand)
There is no implied multi-call direct health check under one consent use. If the user gives no subcommand, either:
1. run one explicitly requested DNS/zone read as the single direct call, or
2. provide a user-run multi-call script for token verification plus zone/DNS checks.
