---
name: bitbucket-pipeline
version: 0.1.0
description: "Read this skill WHEN working with Bitbucket Pipelines — CI/CD runs, build failures, step diagnostics, logs, or repository variable inspection (triggers: Bitbucket, pipeline, 비트버킷 파이프라인, 파이프라인 실패, 빌드 실패). Provides deterministic connector for Bitbucket Cloud UC5 operations."
---

# bitbucket-pipeline

## Purpose

Provide a deterministic Bitbucket Cloud connector for UC5 operations dogfooding.

## Dispatch discipline (main orchestrates, subagents do the work)

ENFORCEMENT: do NOT do this skill's substantive work in the main context. Main's direct-action budget is narrow — 1-2 file simple edits (≤ 30 LoC) or operational commands (`git status`, `ls`, install). ANY multi-file change, 3+ file reads, 200+ LoC, or multi-step investigation/implementation MUST be dispatched to a subagent; main only dispatches, synthesizes, and reviews — never implements inline.
RIGHT-AGENT ROUTING (model-fit + role-fit is first-class): pipeline authoring / multi-step changes → `pi-oven:executor`. See `large-task-delegation` + `subagent-driven-development`.

## Credential source

Use the first existing file from this precedence list:

1. `.external-credentials`
2. `.external_certificate`
3. `.external_certificate`

Expected section:

```ini
[bitbucket]
workspace=<workspace>
repo_slug=<repo>
email=<atlassian-email>
api_token=<api-token>
```

If any field is missing, report missing keys and stop.

The `api_token` must be read-only scoped in Bitbucket Cloud. Mutations are never executed directly in this skill.

## Token parsing rule

Do not split on `=` for `api_token`. Strip only the `api_token=` prefix so checksum suffixes remain intact.

## Required flow

1. Read credentials file and parse `[bitbucket]` values.
2. Build API base URL: `https://api.bitbucket.org/2.0/repositories/<workspace>/<repo_slug>`.
3. Verify auth with a lightweight read endpoint.
4. Execute requested read-only action and return evidence.

## Read-only operations

- Recent pipelines list
- Single pipeline detail by UUID
- Pipeline step list
- Step log retrieval
- Pipelines config read
- Repository variable list (values may be masked)

## Write operations

Mutations (create/update/delete variables, pipeline triggers) must NEVER be executed directly in this skill under any condition. If the user requests one, instruct them to author an idempotent script in `scripts/prod/` (or edit `bitbucket-pipelines.yml`), commit + push, and let CI execute.

## Default output (no subcommand)

Return a table of the latest pipeline runs:

- build number
- state/result
- selector/ref
- commit short hash
- created timestamp
