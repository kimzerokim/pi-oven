---
name: pi-oven-doctor
description: Install health check — runs the pi-oven 10-check matrix (omp version, bun, git, provider auth, MCP, skills, agents, state dir, eval runner, UC5 ops connector)
---

# /pi-oven:doctor

You are running a read-only install-health diagnostic for the pi-oven omp plugin. The actual checks run in `bun scripts/pi-oven-doctor.ts`. You dispatch that script via Bash, then interpret its 10-check report and give the user fix guidance.

This command is purely diagnostic. It NEVER mutates configuration, agent files, skills, or git state. The only filesystem touch is a create+write probe of the gitignored `.pi-oven/` state dir (check #8), which removes its own probe file.

## What to do

### Step 1 — Run the diagnostic

Dispatch via Bash:

```
bun scripts/pi-oven-doctor.ts
```

The script gathers all environment facts (spawns `omp`/`bun`/`git`, reads `.pi/mcp.json`, counts skills/agents, probes the state dir, enumerates eval scenarios) and prints a report shaped like:

```
pi-oven doctor — install health

[PASS] omp version: omp 15.5.10 (>= 15.0.0)
[PASS] bun: bun 1.3.14 present
...
Summary: 10 PASS / 0 WARN / 0 FAIL — overall PASS
```

Exit code: `0` when there are no FAILs (WARNs are acceptable), `1` when any check FAILs.

### Step 2 — Interpret the report

Relay the report to the user, then walk each non-PASS line:

- **FAIL** — a hard blocker. Surface the `fix:` hint from that line and tell the user this must be resolved before pi-oven works correctly. If multiple checks FAIL, list them in priority order (binaries/git first, then skills/agents, then eval).
- **WARN** — non-blocking, but worth noting. Explain what is degraded (e.g. eval cannot run live, MCP not configured) and the optional remediation.
- **PASS** — no action; only mention in the summary count.

If `overall PASS` or `overall WARN`, tell the user the install is healthy (or healthy-with-warnings). If `overall FAIL`, tell them the install needs attention and summarize the failing checks.

### Step 3 — Surface eval-key onboarding when provider auth WARNs

The `provider auth` check WARNs when no whitelisted provider (`opencode-zen` / `openai-codex` / `anthropic`) is authenticated. When you see that WARN, explicitly tell the user:

```
Live eval (bun scripts/run-eval.ts) needs a provider API key. No whitelisted
provider is currently authed, so the eval runner can enumerate scenarios but
cannot execute them. To enable live eval: authenticate a provider in omp
(opencode-zen is the release default), then re-run /pi-oven:doctor.
```

This is the onboarding bridge to the gated real-eval pipeline.

## The 10-check reference

| # | Check | PASS | WARN | FAIL |
|---|---|---|---|---|
| 1 | omp version | omp present and `>= 15.0.0` | omp CLI absent locally (skills/eval can't be exercised) | omp present but older than min |
| 2 | bun | bun on PATH | — | bun not found |
| 3 | git | git present AND inside a repo | — | git absent, or present but not inside a git work tree |
| 4 | provider auth | ≥1 of opencode-zen / openai-codex / anthropic authed | none authed (live eval + dispatch will fail) | — |
| 5 | mcp servers | ≥1 server in `.pi/mcp.json` or `omp mcp list` | none configured (informational; pi-oven requires none) | — |
| 6 | skills | `skills/*/SKILL.md` count == `plugin.json` skills[] length | — | count mismatch |
| 7 | agents | `agents/pi-oven-*.md` count == 22 AND `lint:agents` clean | — | count mismatch, or count OK but lint drift |
| 8 | state dir | `.pi-oven/` creatable + writable | — | not writable |
| 9 | eval runner | `scripts/run-eval.ts` present AND ≥1 smoke-tagged scenario enumerable | runner present but 0 smoke scenarios | runner script absent |
| 10 | UC5 ops connector | `skills/aws`, `skills/bitbucket-pipeline`, `skills/cloudflare` present + any credential file (`.external-credentials` / `.external_certificate` / `.external_cerficate`) detected | skill files present but no credential file | any connector skill file missing |

Checks 4 and 5 can only WARN (never FAIL) — auth and MCP are environmental, not install-integrity, defects. Check 10 WARN is also environmental (credential file not yet onboarded). Checks 6, 7, 9-runner-absent, and 10-missing-skills are install-integrity FAILs. The script's exit code reflects only FAILs.

## Important rules

- **Read-only diagnostic.** This command never mutates config, `agents/pi-oven-*.md`, skills, or git. Do not "fix" anything yourself — only relay the `fix:` hints from the report and let the user decide.
- Dispatch `bun scripts/pi-oven-doctor.ts` via the Bash tool. Do NOT pipe anything into it — it reads no stdin and runs batch-only.
- Do NOT run it more than once per request unless the user changes their environment and asks to re-check.
- When `provider auth` WARNs, always surface the eval-key onboarding note (Step 3) — live eval needs keys.
- Do NOT commit. This command produces no committable artifacts (`.pi-oven/` is gitignored).
- For setup or profile changes (model routing), point the user to `/pi-oven:setup` — doctor only diagnoses, it does not configure.
