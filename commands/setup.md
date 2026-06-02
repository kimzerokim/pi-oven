---
name: pi-oven-setup
description: Configure pi-oven agent model routing — Profile A (release default) or Profile B (Anthropic opt-in)
argument-hint: [--status | --reset | --import <file> | --apply --profile A|B] [--validate smoke|full|none] [--override <role>=<model>] [--isolate | --no-isolate]
---

# /pi-oven:setup

You are guiding the user through pi-oven setup. The actual logic runs in the `pi-oven-setup.ts` script (resolved per the note below). You drive the conversation; the script runs in batch.

## Resolve the plugin script dir first

pi-oven may be installed globally, so the script does NOT live under the user's project cwd. Before dispatching any `bun` command, resolve the plugin script dir once and reuse `$PI_OVEN_DIR` for every dispatch (dev cwd → `installed_plugins.json` `installPath` → cache glob):

```bash
PI_OVEN_DIR="$PWD"
if [ ! -f "$PI_OVEN_DIR/scripts/pi-oven-setup.ts" ]; then
  PI_OVEN_DIR="$(jq -r '.plugins["pi-oven@pi-oven"][0].installPath // empty' "$HOME/.omp/plugins/installed_plugins.json" 2>/dev/null)"
  [ -z "$PI_OVEN_DIR" ] && PI_OVEN_DIR="$(ls -d "$HOME"/.omp/plugins/cache/plugins/pi-oven___pi-oven___*/ 2>/dev/null | sort -V | tail -1)"
fi
```

Every dispatch below uses `bun "${PI_OVEN_DIR%/}/scripts/pi-oven-setup.ts" <args>` — never a bare `bun scripts/pi-oven-setup.ts` (that breaks on global installs where cwd ≠ plugin dir).

## What to do

Parse the user's intent from their initial request:

- If they say "status" or "show config" → run `bun "${PI_OVEN_DIR%/}/scripts/pi-oven-setup.ts" --status` and relay the output.
- If they say "reset" or "clear" → confirm with the user first, then run `bun "${PI_OVEN_DIR%/}/scripts/pi-oven-setup.ts" --reset`.
- If they say "import" with a file path → run `bun "${PI_OVEN_DIR%/}/scripts/pi-oven-setup.ts" --import <file>`.
- Otherwise (first-time setup or profile change) → walk through the apply flow below.

## Apply flow (first-time or profile change)

### Step 0 — Primary language

Before anything else, ask the user which language setup and the agents should use. Call the `pi-oven_ask` tool with two options, each carrying a description (the `pi-oven_ask` UI automatically adds an "Other (type your own)" option):

- Option 1 — label: `한국어 (Korean)`, description: `셋업 대화와 이후 에이전트 응답을 한국어로`
- Option 2 — label: `English`, description: `Setup dialog and agent responses in English`

The user may instead pick "Other (type your own)" and enter any plain language name (examples: `Español`, `日本語`, `Français`). A free-form name must be a plain language label: letters, spaces, and `()-.` only, up to 40 characters — the script rejects anything else (newlines, backticks, `<>`, `#`, `;`, etc.) because the value is injected verbatim into the agent system prompt.

After the user picks, persist the choice by dispatching the resolved script with the matching flag:

```bash
bun "${PI_OVEN_DIR%/}/scripts/pi-oven-setup.ts" --language ko    # if 한국어 (Korean) was chosen
bun "${PI_OVEN_DIR%/}/scripts/pi-oven-setup.ts" --language en    # if English was chosen
bun "${PI_OVEN_DIR%/}/scripts/pi-oven-setup.ts" --language "<the exact name the user typed>"   # if "Other" was chosen, e.g. --language "Español"
```

This writes the per-project default language to `<cwd>/.pi-oven/config.json` (machine-local, gitignored); the pi-oven extension injects it at runtime so agents respond in the chosen language. Canonical `ko`/`en` carry rich directives; any other accepted name gets a generic directive that simply names the language.

Then conduct ALL remaining steps (Steps 1–6 below) IN the chosen language — render every prompt, summary, and report in Korean if `한국어 (Korean)` was picked, in the named language if a custom one was typed, otherwise in English.

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
Apply profile defaults to all 22 roles? [Y/n]:
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
  Profile: <A|B>
  Roles with custom override: <N>
  Provider: <anthropic enabled | anthropic not used>

Ready to persist model overrides to config.yml task.agentModelOverrides. Proceed? [Y/n]:
```

On confirmation, dispatch via Bash (using the resolved `$PI_OVEN_DIR`):

```
bun "${PI_OVEN_DIR%/}/scripts/pi-oven-setup.ts" --profile <A|B> --validate=smoke
```

If there are per-role overrides, add one `--override <role>=<model>` flag per override:

```
bun "${PI_OVEN_DIR%/}/scripts/pi-oven-setup.ts" --profile A --override executor=anthropic/claude-opus-4-8 --validate=smoke
```

Do not add `--validate=none` unless the user explicitly asked to skip validation.

The script writes model overrides to `~/.omp/agent/config.yml` (`task.agentModelOverrides`, keyed by colon name `pi-oven:<role>`). This is user-global and machine-local — it is NOT committed to the repo. The wizard MUST NOT modify `agents/pi-oven-*.md` files; those are committed PROFILE_A baseline artifacts and are read-only from the wizard's perspective.

The script handles persist (config.yml write) and smoke validation in a single batch call. Do not invoke it more than once for the same flow.

### Step 6 — Report results

Relay the full script output to the user. Surface:

- Setup complete + active profile.
- Any validation warnings (roles that fell back to alternates).
- Any validation failures (UNVERIFIED roles).

If the script exits with code 1 (one or more UNVERIFIED roles), do NOT auto-retry. Present the UNVERIFIED role list and ask the user how to proceed:

```
One or more roles are UNVERIFIED. Options:
  1. Reconfigure  — run /pi-oven:setup again with a different profile or overrides
  2. Diagnose     — run: bun "${PI_OVEN_DIR%/}/scripts/pi-oven-setup.ts" --validate=full
  3. Reset        — run: bun "${PI_OVEN_DIR%/}/scripts/pi-oven-setup.ts" --reset
```

Auto-retry risks repeated billing charges for failing smoke pings.

### Step 7 — Optional: isolate omp from the `~/.claude` layer

After model routing is set, ask whether omp should run as a clean pi-oven-only environment:

```
Make omp ignore the global ~/.claude Claude-Code layer (omc + pi-oven)?
omp will then load ONLY the pi-oven plugin and inject this repo's root CLAUDE.md.
Your ~/.claude on disk is untouched — real Claude Code sessions keep working. [y/N]:
```

If the user agrees, dispatch (combinable in the same call as Step 5, e.g. `--profile A --isolate`):

```
bun "${PI_OVEN_DIR%/}/scripts/pi-oven-setup.ts" --isolate
```

This writes `disabledProviders: [claude, claude-plugins]` to `~/.omp/agent/config.yml`. Tell the user to restart omp for it to take effect. To undo later: `--no-isolate`.

## Flag reference (for dispatching the batch script)

| Flag | Behavior |
|---|---|
| `--profile A` | Apply Profile A (release default). |
| `--profile B` | Apply Profile B (Anthropic opt-in). Requires anthropic auth detected. |
| `--override <role>=<model>` | Override a specific role's model in config.yml task.agentModelOverrides. Repeatable. |
| `--validate=smoke` | (Default) Ping 7 MUST-tier roles after persist. |
| `--validate=full` | Ping all 22 roles. |
| `--validate=none` | Skip validation. |
| `--status` | Show current profile and resolved model per role (reads config.yml overrides + agent frontmatter). |
| `--reset` | Remove all `pi-oven:*` keys from config.yml task.agentModelOverrides. Does not touch agent files. |
| `--import <file>` | Import JSON config file (schema: §7.1). |
| `--language <ko\|en\|name>` | Persist the per-project default language to `.pi-oven/config.json`. Accepts `ko`/`en` or any plain language name (letters, spaces, `()-.`; ≤ 40 chars). Set in Step 0. |
| `--isolate` | Make omp IGNORE the entire `~/.claude` Claude-Code layer (omc + pi-oven): writes `disabledProviders: [claude, claude-plugins]` to `~/.omp/agent/config.yml` (user-global, machine-local, preserves sibling providers). pi-oven keeps loading and injects the repo-root `CLAUDE.md`. omp-only — never touches `~/.claude` on disk. Restart omp to apply. Combinable with `--profile`/`--apply` (runs after). |
| `--no-isolate` | Undo `--isolate`: remove `claude` + `claude-plugins` from `disabledProviders` (preserves any other providers). |

The 7 MUST-tier roles for smoke validation are: executor, explorer, verifier, critic, planner, code-reviewer, debugger.

All `omp plugin config` operations use the plugin name `pi-oven` (bare). Do NOT pass `pi-oven@pi-oven` to `omp plugin config` calls — that form is only for `omp plugin install` / `omp plugin uninstall`.

## Important rules

- Do NOT run the `pi-oven-setup.ts` script from inside this prompt template — you (the LLM) dispatch it via the Bash tool based on user input collected in conversation.
- Do NOT mutate `agents/pi-oven-*.md` manually — only via the script.
- Do NOT commit. The user reviews before any commit.
- Do NOT use `omp plugin config` calls directly — the script handles all persistence.
- Do NOT pipe anything into the `pi-oven-setup.ts` script — it is batch-only and reads no stdin.
- Always resolve `$PI_OVEN_DIR` (see "Resolve the plugin script dir first") and dispatch `bun "${PI_OVEN_DIR%/}/scripts/pi-oven-setup.ts"` — never a bare `bun scripts/pi-oven-setup.ts`.

## Known limitations (surface if relevant)

- **Parent session fallback hole**: When a pi-oven subagent's primary model is unauthed, omp falls back to the parent session model (not the next array entry). Profile B is safe only when Anthropic auth is active and stable. This is an omp internal behavior that pi-oven cannot override (Spec A §6.3).
