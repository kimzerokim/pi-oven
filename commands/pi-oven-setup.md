---
name: pi-oven-setup
description: Configure pi-oven agent model routing — Profile A (release default) or Profile B (Anthropic opt-in)
argument-hint: [--status | --reset | --import <file> | --reapply | --apply --profile A|B] [--validate smoke|full|none] [--override <role>=<model>]
---

# /pi-oven:setup

You are guiding the user through pi-oven setup. The actual logic runs in `bun scripts/pi-oven-setup.ts`. You drive the conversation; the script runs in batch.

## What to do

Parse the user's intent from their initial request:

- If they say "status" or "show config" → run `bun scripts/pi-oven-setup.ts --status` and relay the output.
- If they say "reset" or "clear" → confirm with the user first, then run `bun scripts/pi-oven-setup.ts --reset`.
- If they say "import" with a file path → run `bun scripts/pi-oven-setup.ts --import <file>`.
- If they say "reapply" or mention a recent `omp plugin upgrade` → run `bun scripts/pi-oven-setup.ts --reapply`.
- Otherwise (first-time setup or profile change) → walk through the apply flow below.

## Apply flow (first-time or profile change)

### Step 1 — Detect authed providers

Run via Bash:

```
omp --list-models 2>&1
```

Parse the "Provider models" section. Look for native provider rows:

- A line matching `^opencode-zen\s+` → opencode-zen is authed.
- A line matching `^openai-codex\s+` → openai-codex is authed.
- A line matching `^anthropic\s+claude-` → native Anthropic API is authed (direct API key, NOT opencode-zen wrappers). This is the Profile B activation condition.

Important: rows like `opencode-zen/claude-*` in the model ID column do NOT count as native Anthropic auth. Only a dedicated `anthropic` provider row in the Provider models table confirms native auth.

Summarize to the user in chat:

```
Detecting provider authentication...
  opencode-zen  authed  (N models available)
  openai-codex  authed  (N models available)
  anthropic     authed  (N models available)   ← only if detected

Available profiles: A (default), B (Anthropic opt-in)
```

If anthropic is not detected, say:

```
  anthropic     not detected

Available profiles: A only.
Profile B requires direct Anthropic API authentication.
To enable: authenticate with the Anthropic provider in omp, then re-run /pi-oven:setup.
```

### Step 2 — Parent session check

Read `~/.omp/plugins/pi-oven-session-model.json` (written by the pi-oven extension's `session_start` handler). This file looks like:

```json
{ "model": "opencode-zen/glm-5", "capturedAt": 1234567890000 }
```

- If the file is absent, older than 1 hour (`Date.now() - capturedAt > 3600000`), or cannot be parsed as JSON: skip this check silently.
- If the file is present and fresh, check whether the model prefix is one of `opencode-zen/`, `openai-codex/`, or `anthropic/`. If it is NOT, warn the user:

```
WARNING: Your current omp session is running on "<model>", which is not in the
pi-oven whitelist. If any pi-oven subagent's primary model is unauthed, omp will fall
back to this parent model — bypassing the whitelist (Spec A §6.3 known
limitation). Recommendation: relaunch omp with --model opencode-zen/glm-5
before running this setup.
```

If the file is absent or stale, proceed without comment.

### Step 3 — Ask the user which profile

Present the options based on Step 1 findings:

- Profile A (release default, opencode-zen + openai-codex) — always available.
- Profile B (Anthropic opt-in) — only show this option if native `anthropic` auth was detected in Step 1.

If only Profile A is possible, default to it without asking. If both are available, ask:

```
Select profile:
  [A] Profile A — Release default (opencode-zen + openai-codex)   (default)
  [B] Profile B — Anthropic opt-in (anthropic primary, opencode-zen fallback)

Enter choice [A]:
```

If the user selects Profile B, display this notice and ask for confirmation before proceeding:

```
NOTICE: Auth-fallback limitation (Spec A §6.3)
When a pi-oven subagent's primary model is in the omp registry but unauthed,
omp falls back to the PARENT SESSION's active model — not the next item in
the model array. If your parent session runs an anthropic model, pi-oven
subagents may use Anthropic billing even when their primary model fails auth.
This is an omp internal behavior that pi-oven cannot override.
Profile B is safe when anthropic auth is active and stable.
Proceed with Profile B? [y/N]:
```

### Step 4 — Optional per-role override

Ask the user:

```
Apply profile defaults to all 23 roles? [Y/n]:
```

`Y` or Enter: use the selected profile defaults for all roles — proceed to Step 5.

`n`: collect per-role overrides through conversation. For each role the user wants to override, ask which model to use. Validate that the model string starts with an allowed prefix:

- Always allowed: `opencode-zen/`, `openai-codex/`
- Allowed when Profile B AND anthropic was detected: `anthropic/`

Reject strings that do not match with a clear error and re-ask. When the user specifies at least one override, the profile is treated as `custom`.

### Step 5 — Confirm and persist

Show a summary in chat:

```
Summary:
  Profile: <A|B|custom>
  Roles with custom override: <N>
  Provider: <anthropic enabled | anthropic not used>

Ready to persist to omp plugin config and rewrite agent files. Proceed? [Y/n]:
```

On confirmation, dispatch via Bash:

```
bun scripts/pi-oven-setup.ts --profile <A|B|custom> --validate=smoke
```

If there are per-role overrides, add one `--override <role>=<model>` flag per override:

```
bun scripts/pi-oven-setup.ts --profile custom --override executor=anthropic/claude-opus-4-7 --validate=smoke
```

Do not add `--validate=none` unless the user explicitly asked to skip validation.

The script handles persist (plugin config write + agent file in-place rewrite) and smoke validation in a single batch call. Do not invoke it more than once for the same flow.

### Step 6 — Report results

Relay the full script output to the user. Surface:

- Setup complete + active profile.
- Any validation warnings (roles that fell back to alternates).
- Any validation failures (UNVERIFIED roles).

If the script exits with code 1 (one or more UNVERIFIED roles), do NOT auto-retry. Present the UNVERIFIED role list and ask the user how to proceed:

```
One or more roles are UNVERIFIED. Options:
  1. Reconfigure  — run /pi-oven:setup again with a different profile or overrides
  2. Diagnose     — run: bun scripts/pi-oven-setup.ts --validate=full
  3. Reset        — run: bun scripts/pi-oven-setup.ts --reset
```

Auto-retry risks repeated billing charges for failing smoke pings.

## Flag reference (for dispatching the batch script)

| Flag | Behavior |
|---|---|
| `--profile A` | Apply Profile A (release default). |
| `--profile B` | Apply Profile B (Anthropic opt-in). Requires anthropic auth detected. |
| `--profile custom` | Apply with per-role overrides. Use with `--override` flags. |
| `--override <role>=<model>` | Override a specific role's primary model. Repeatable. |
| `--validate=smoke` | (Default) Ping 7 MUST-tier roles after persist. |
| `--validate=full` | Ping all 23 roles. |
| `--validate=none` | Skip validation. |
| `--status` | Show current profile and resolved model per role. |
| `--reset` | Delete all `pi-oven.*` plugin config keys and restore Profile A agent files. |
| `--import <file>` | Import JSON config file (schema: §7.1). |
| `--reapply` | Rewrite agent files to match persisted plugin config (use after `omp plugin upgrade`). |

The 7 MUST-tier roles for smoke validation are: executor, explorer, verifier, critic, planner, code-reviewer, debugger.

All `omp plugin config` operations use the plugin name `pi-oven` (bare). Do NOT pass `pi-oven@pi-oven` to `omp plugin config` calls — that form is only for `omp plugin install` / `omp plugin uninstall`.

## Important rules

- Do NOT run `bun scripts/pi-oven-setup.ts` from inside this prompt template — you (the LLM) dispatch it via the Bash tool based on user input collected in conversation.
- Do NOT mutate `agents/pi-oven-*.md` manually — only via the script.
- Do NOT commit. The user reviews before any commit.
- Do NOT use `omp plugin config` calls directly — the script handles all persistence.
- Do NOT pipe anything into `bun scripts/pi-oven-setup.ts` — the script is batch-only and reads no stdin.

## Known limitations (surface if relevant)

- **Install cache**: Profile B activation requires the install cache to be populated. If the script reports "agent files not in install cache", run: `omp plugin install pi-oven@pi-oven --force`
- **Plugin upgrade drift**: After every `omp plugin upgrade pi-oven@pi-oven`, agent files reset to repo defaults. The pi-oven extension emits a drift warning at the next session start. Re-run `/pi-oven:setup --reapply` to re-sync.
- **Dev mode**: When running from a working repo with `omp --plugin-dir`, the script rewrites `agents/pi-oven-*.md` in the repo directory directly. No cache rewrite is needed in dev mode.
- **anthropic/claude-sonnet-4-7 not yet available**: As of 2026-05-28, `anthropic/claude-sonnet-4-7` is absent from `omp --list-models`. Profile B uses `anthropic/claude-sonnet-4-6` (1M context) for all sonnet-tier roles until 4-7 ships.
- **Parent session fallback hole**: When a pi-oven subagent's primary model is unauthed, omp falls back to the parent session model (not the next array entry). Profile B is safe only when Anthropic auth is active and stable. This is an omp internal behavior that pi-oven cannot override (Spec A §6.3).
