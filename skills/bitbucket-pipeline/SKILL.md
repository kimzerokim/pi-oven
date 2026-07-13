---
name: pov:bitbucket-pipeline
version: 0.1.0
description: "Read this skill for Bitbucket Pipelines CI/CD runs, build failures, step diagnostics, logs, and repository variable inspection. Provides deterministic connector for Bitbucket Cloud UC5 operations."
---

# bitbucket-pipeline

## Purpose

Provide a deterministic Bitbucket Cloud connector for UC5 operations dogfooding.

## Dispatch discipline (main orchestrates, subagents do the work)

ENFORCEMENT: do NOT do this skill's substantive work in the main context. Main's direct-action budget is narrow — 1-2 file simple edits (≤ 30 LoC) or operational commands (`git status`, `ls`, install). ANY multi-file change, 3+ file reads, 200+ LoC, or multi-step investigation/implementation MUST be dispatched to a subagent; main only dispatches, synthesizes, and reviews — never implements inline. RIGHT-AGENT ROUTING (model-fit + role-fit is first-class): pipeline authoring / multi-step changes → `pov:executor`. See `large-task-delegation` + `subagent-driven-development`. Parent-session-only exception: under active consent, the one direct Bitbucket API action must be executed by the parent session itself because the runtime consumes consent only there; subagents may assist only with read-only investigation, script authoring, or planning.

## Credential source (active consent only)

Only after confirming latest-turn explicit external execution consent is active, use the first existing file from this precedence list:

1. `.external-credentials`
2. `.external_certificate`
3. `.external_cerficate`

Expected section:

```ini
[bitbucket]
workspace=<workspace>
repo_slug=<repo>
email=<atlassian-email>
api_token=<api-token>
```

If any field is missing, report missing keys and stop. Without active consent, do not inspect local credential files and use the user-run/script path instead.

The `api_token` should be read-only scoped by default. Direct Bitbucket API execution is blocked unless the latest user message grants explicit external execution consent; local credential files already on the machine may be used only under active consent, pasted inline secrets remain forbidden, and any mutation that needs broader scope must call that out before continuing.

## Token parsing rule

Do not split on `=` for `api_token`. Strip only the `api_token=` prefix so checksum suffixes remain intact.

## Required flow

1. Check whether latest-turn explicit external execution consent is active.
2. If consent is active, read the credentials file and parse `[bitbucket]` values.
3. If consent is active, build the API base URL: `https://api.bitbucket.org/2.0/repositories/<workspace>/<repo_slug>`.
4. With that one active consent use, have the parent session itself execute exactly one directly requested Bitbucket API action and return evidence.
5. If broader verification would require a separate auth probe or additional API calls, ask for fresh consent per command or fall back to the user-run/script path without chaining direct calls under one consent use.

## Read-only operations

- Recent pipelines list
- Single pipeline detail by UUID
- Pipeline step list
- Step log retrieval
- Pipelines config read
- Repository variable list (values may be masked)

## Write operations

Mutations (create/update/delete variables, pipeline triggers) are not the default path. Without latest-turn explicit external execution consent, instruct the user to author an idempotent script in `scripts/prod/` (or edit `bitbucket-pipelines.yml`), commit + push, and let CI execute. With matching active consent, one direct mutation may use the local credential file already on the machine, but pasted inline secrets remain forbidden.

## Default output (no subcommand)
If consent is active and the user gives no narrower subcommand, the single direct action may be to return a table of the latest pipeline runs:
- build number
- state/result
- selector/ref
- commit short hash
- created timestamp
