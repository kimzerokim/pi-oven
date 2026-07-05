---
name: pi-oven-setup
description: Configure pi-oven agent model routing — Profile A (release default), Profile B (openai-codex-only), Profile C (all-Anthropic), or Profile D (opencode-zen-only)
argument-hint: "[--status | --reset [--full] | --repair-prereqs | --import <file> | --apply --profile A|B|C|D] [--validate smoke|full|none] [--override <role>=<model>] [--scope global|project]"
---

# /pi-oven:setup

You are guiding the user through pi-oven setup. The actual logic runs in the `pi-oven-setup.ts` script (resolved per the note below). You drive the conversation; the script runs in batch.

## Skill usage

Never use another skill to proceed setup. Use only setup.md command to finish.

## Resolve the plugin script dir first

pi-oven may be installed globally, so the script does NOT live under the user's project cwd. Before dispatching any `bun` command, resolve the plugin script dir once and reuse `$PI_OVEN_DIR` for every dispatch (dev cwd → `installed_plugins.json` `installPath` → cache scan via `bun -e`):

```bash
PI_OVEN_DIR="$PWD"
if [ ! -f "$PI_OVEN_DIR/scripts/pi-oven-setup.ts" ]; then
  PI_OVEN_DIR="$(bun -e '
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const manifestPath = path.join(os.homedir(), ".omp/plugins/installed_plugins.json");
const cacheRoot = path.join(os.homedir(), ".omp/plugins/cache/plugins");
let resolved = "";

try {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  resolved = manifest?.plugins?.["pi-oven@kzk"]?.[0]?.installPath ?? "";
} catch {}

if (!resolved) {
  try {
    const entries = fs
      .readdirSync(cacheRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.startsWith("kzk___pi-oven___"))
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    resolved = entries.length ? path.join(cacheRoot, entries[entries.length - 1]) : "";
  } catch {}
}

process.stdout.write(resolved);
')"
fi
[ -n "$PI_OVEN_DIR" ] || { echo "pi-oven install not found" >&2; exit 1; }
```

Every dispatch below uses `bun "${PI_OVEN_DIR%/}/scripts/pi-oven-setup.ts" <args>` — never a cwd-relative `bun` call against `scripts/pi-oven-setup.ts` (that breaks on global installs where cwd ≠ plugin dir).

## What to do

Parse the user's intent from their initial request:

- If they say "status" or "show config" → run `bun "${PI_OVEN_DIR%/}/scripts/pi-oven-setup.ts" --status` and relay the output.
- If they say "reset" or "clear" → confirm with the user first, then run `bun "${PI_OVEN_DIR%/}/scripts/pi-oven-setup.ts" --reset`. If they ask for a complete reset before uninstall (a clean "new user" state), add `--full` to also reset `modelRoles`, `disabledProviders`, and `setupVersion` to omp defaults.
- If they say "repair prerequisites", "fix memory", or they only need the global mnemopi/LSP/tool prerequisites restored without touching routing → run `bun "${PI_OVEN_DIR%/}/scripts/pi-oven-setup.ts" --repair-prereqs`. This path is **global-only**; if they explicitly ask for project scope, explain that repair writes `~/.omp/agent/config.yml` only and cannot run under `--scope project`.
- If they say "import" with a file path → run `bun "${PI_OVEN_DIR%/}/scripts/pi-oven-setup.ts" --import <file>`.
- Otherwise (first-time setup or profile change) → walk through the apply flow below.

## Apply flow (first-time or profile change)

### Step 0 — Primary language

Before anything else, ask the user which language will be the **default response language going forward** — this is a global preference, not just for the current project. Call the `pi-oven_ask` tool with exactly two arguments — `question` (a string) and `options` (an array of `{ label, description }`). It takes no other arguments, and its UI automatically appends an "Other (type your own)" entry. Then read the user's choice from `details.selected` (the picked option's label) or `details.customInput` (free text), falling back to the visible `User selected:` / `User provided custom input:` line. If neither is present, treat it as a cancel and stop — do NOT silently re-ask.

Use a question framing like: "pi-oven 셋업 — 앞으로의 기본 응답 언어를 무엇으로 할까요?" (or in English: "pi-oven setup — what should be the default response language going forward?")

Exact option set:

- Option 1 — label: `한국어 (Korean)`, description: `셋업 대화와 이후 에이전트 응답을 한국어로`
- Option 2 — label: `English`, description: `Setup dialog and agent responses in English`

The user may instead pick "Other (type your own)" and enter any plain language name (examples: `Español`, `日本語`, `Français`). A free-form name must be a plain language label: letters, spaces, and `()-.` only, up to 40 characters — the script rejects anything else (newlines, backticks, `<>`, `#`, `;`, etc.) because the value is injected verbatim into the agent system prompt.

Do NOT persist the language yet — the write is deferred to Step 0.5 so it can be paired with the chosen `--scope`.

### Step 0.5 — Setup scope

Right after the language choice, ask whether this setup applies **globally** (the default for every project) or **only to this project**. Call the `pi-oven_ask` tool with exactly two arguments — `question` (a string) and `options` (an array of `{ label, description }`); it takes no other arguments. Read the user's choice the same way as Step 0 (`details.selected` / the visible `User selected:` line); if neither is present, treat it as a cancel and stop.

Question framing: "이번 셋업을 글로벌(모든 프로젝트 기본값)로 적용할까요, 이 프로젝트에만 적용할까요?" (or in English: "Apply this setup globally (default for all projects) or to this project only?")

Exact option set:

- Option 1 — label: `글로벌 (모든 프로젝트 기본값)`, description: `~/.pi-oven + 글로벌 config.yml`
- Option 2 — label: `이 프로젝트만`, description: `.omp/settings.json + .pi-oven/config.json (이 레포에서만)`

Map the choice to `<scope>`: Option 1 → `global` (today's behavior), Option 2 → `project`. Reuse `<scope>` for EVERY remaining dispatch in this flow.

**What scope changes:**

- **`global` (default)** — exactly today's behavior. Per-role overrides (profiles B/C/D) and `modelRoles`/`retry.fallbackChains` go to the user-global `~/.omp/agent/config.yml`; language + `setupCompletedAt` + `nativeWorkers.maxWorkers` go to `~/.pi-oven/config.json`. A global-scope run is also the only path that writes the machine-global tool flags plus the memory/async/LSP prerequisites that pi-oven uses for wide subagent fan-out, and it seeds the machine-global fallback ceiling that the vendored native worker launcher reads when no project override exists.
- **`project`** — per-role overrides for **EVERY profile (A, B, C, and D — all 24 roles)**, plus `modelRoles` and `retry.fallbackChains`, are written to `<cwd>/.omp/settings.json` (omp reads this at project level and it wins per-role over global). Language + `setupCompletedAt` + `nativeWorkers.maxWorkers` go to `<cwd>/.pi-oven/config.json`. Memory/async/LSP infra and tool enablement stay global-only and are NOT written under project scope. This project-local `.pi-oven/config.json` is the first ceiling source the vendored native worker launcher consults.

`.omp/settings.json` is **NOT auto-committed and NOT auto-gitignored**: commit it to share per-project routing with a team, or gitignore it for machine-local use. Tell the user both options. Launch omp from the **repo root** — project settings load from `<cwd>/.omp/` (no git-root ancestor walk).

Fan-out contract: setup tells pi-oven to pack dependency-ready work into the widest safe wave (default target 8-12 siblings). The active native-worker control path is `scripts/pi-oven-team/index.ts` → `scripts/pi-oven-team/runtime-v2.ts`; `nativeWorkers.maxWorkers` in the active `.pi-oven/config.json` is the ceiling that launcher enforces. If those vendored files are missing, pi-oven reports a degraded native-runtime state instead of implying upstream omp runtime ownership.

Now persist the language WITH the chosen scope by dispatching the resolved script:

```bash
bun "${PI_OVEN_DIR%/}/scripts/pi-oven-setup.ts" --language ko --scope <global|project>    # if 한국어 (Korean) was chosen
bun "${PI_OVEN_DIR%/}/scripts/pi-oven-setup.ts" --language en --scope <global|project>    # if English was chosen
bun "${PI_OVEN_DIR%/}/scripts/pi-oven-setup.ts" --language "<the exact name the user typed>" --scope <global|project>   # if "Other" was chosen, e.g. --language "Español"
```

Under `--scope global` this writes the **global** default language to `~/.pi-oven/config.json` (machine-global, never committed); under `--scope project` it writes a per-project override to `<cwd>/.pi-oven/config.json` (machine-local, gitignored), which takes precedence when present. The pi-oven extension injects the resolved language at runtime so agents respond in the chosen language. Canonical `ko`/`en` carry rich directives; any other accepted name gets a generic directive that simply names the language.

Then conduct ALL remaining steps (Steps 1–6 below) IN the chosen language — render every prompt, summary, and report in Korean if `한국어 (Korean)` was picked, in the named language if a custom one was typed, otherwise in English — and thread `--scope <scope>` into every later dispatch.

### Step 1 — Detect authed providers

Run via Bash:

```
omp models
```

Parse the "Provider models" section. Look for native provider rows:

- A line matching `^opencode-zen\s+` → opencode-zen is authed.
- A line matching `^openai-codex\s+` → openai-codex is authed. This is the Profile B activation condition.
- A line matching `^anthropic\s+claude-` → native Anthropic API is authed (direct API key, NOT opencode-zen wrappers). This is the Profile C activation condition.

Important: rows like `opencode-zen/claude-*` in the model ID column do NOT count as native Anthropic auth. Only a dedicated `anthropic` provider row in the Provider models table confirms native auth.

Summarize to the user in chat:

```
Detecting provider authentication...
  opencode-zen  authed  (N models available)
  openai-codex  authed  (N models available)
  anthropic     authed  (N models available)   ← only if detected

Available profiles: A (default), B (openai-codex-only), C (all-Anthropic), D (opencode-zen-only)
```

If neither openai-codex nor anthropic is detected, say:

```
  anthropic     not detected

Available profiles: A (default), D (opencode-zen-only).
Profile B requires openai-codex authentication; Profile C requires direct Anthropic API authentication.
To enable: authenticate with the relevant provider in omp, then re-run /pi-oven:setup.
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

- Profile A (release default, opencode-zen + openai-codex + anthropic advisory roles) — always available.
- Profile B (openai-codex-only) — only show this option if `openai-codex` auth was detected in Step 1.
- Profile C (all-Anthropic) — only show this option if native `anthropic` auth was detected in Step 1.
- Profile D (opencode-zen-only) — always available when `opencode-zen` auth was detected in Step 1.

If only Profile A is possible (no openai-codex, no anthropic), also offer Profile D if opencode-zen is authed. Otherwise, show the available profiles and ask:

```
Select profile:
  [A] Profile A — Release default (balanced routing; not the max-fan-out profile)   (default)
  [B] Profile B — openai-codex-only wide fan-out performance profile (gpt-5.5 high/xhigh, gpt-5.4 medium/high; writes 24 per-role model+effort overrides)   ← only if openai-codex authed
  [C] Profile C — All-Anthropic (opus-4-8 / sonnet-4-6, writes 24 per-role overrides)   ← only if anthropic authed
  [D] Profile D — opencode-zen-only wide fan-out profile (kimi-k2.6 / minimax-m2.5 / gemini-3-flash, writes 24 per-role overrides)   ← always if opencode-zen authed

Enter choice [A]:
```

If the user selects Profile B, C, or D, display this notice and ask for confirmation before proceeding:

```
NOTICE: Auth-fallback limitation (Spec A §6.3)
When a pi-oven subagent's primary model is in the omp registry but unauthed,
omp falls back to the PARENT SESSION's active model — not the next item in
the model array. If your parent session runs a subscription-provider model,
pi-oven subagents may incur unexpected billing if their primary model fails auth.
This is an omp internal behavior that pi-oven cannot override.
Profile B is safe only when openai-codex auth is active and stable.
Profile C is safe only when anthropic auth is active and stable.
Profile D is safe only when opencode-zen auth is active and stable.
Proceed with Profile <B|C|D>? [y/N]:
```

In global scope, Profiles B, C, and D each write all 24 `task.agentModelOverrides` entries (one per role) into `~/.omp/agent/config.yml`; Profile A only sets the main orchestrator model (`modelRoles`). In project scope, every profile writes all 24 per-role overrides plus `modelRoles` and `retry.fallbackChains` into `<project>/.omp/settings.json`. Run `--reset` on the same scope to clear pi-oven routing overrides.

If the goal is wide parallel pi-oven waves, prefer Profile B or D when that provider's auth is healthy; project-scope A also fully pins all 24 roles. This biases routing toward the 8-12-wide dependency-safe wave target; the vendored `scripts/pi-oven-team/index.ts` launcher enforces `nativeWorkers.maxWorkers` from the active `.pi-oven/config.json`, and reports a degraded native-runtime state if that vendored path is unavailable.

### Step 4 — Optional per-role override

Ask the user:

```
Apply profile defaults to all 24 roles? [Y/n]:
```

`Y` or Enter: use the selected profile defaults for all roles — proceed to Step 5.

`n`: collect per-role overrides through conversation. For each role the user wants to override, ask which model to use. Validate that the model string starts with an allowed prefix:

- Always allowed: `opencode-zen/`, `openai-codex/`
- Allowed when Profile C AND anthropic was detected: `anthropic/`

Reject strings that do not match with a clear error and re-ask. When the user specifies at least one override, apply those explicit per-role overrides after profile selection.

### Step 5 — Confirm and persist

Show a summary in chat:

```
Summary:
  Profile: <A|B|C|D>
  Scope: <global|project>
  Roles with custom override: <N>
  Routing target: <global config.yml modelRoles + B/C/D overrides | project .omp/settings.json all-role overrides>

Ready to persist pi-oven routing. Proceed? [Y/n]:
```

On confirmation, dispatch via Bash (using the resolved `$PI_OVEN_DIR`), threading the `<scope>` chosen in Step 0.5:

```
bun "${PI_OVEN_DIR%/}/scripts/pi-oven-setup.ts" --profile <A|B|C|D> --scope <global|project> --validate=smoke
```

If there are per-role overrides, add one `--override <role>=<model>` flag per override:

```
bun "${PI_OVEN_DIR%/}/scripts/pi-oven-setup.ts" --profile A --scope <global|project> --override executor=anthropic/claude-opus-4-8 --validate=smoke
```

Do not add `--validate=none` unless the user explicitly asked to skip validation.

Under `--scope global` (default) the script writes model overrides to `~/.omp/agent/config.yml` (`task.agentModelOverrides`, keyed by colon name `pi-oven:<role>`) — user-global, machine-local, NOT committed. It also **force-enables the 6 omp tool flags** (`inspect_image.enabled`, `web_search.enabled`, `lsp.enabled`, `astGrep.enabled`, `browser.enabled`, `debug.enabled`) so the agent body mandates have teeth. These flags are re-enabled on every global-scope run with no opt-out — this is intentional so a user toggle cannot silently neuter a mandated tool. `--reset --full` leaves these flags alone (they are omp-global infra, not pi-oven routing). Global scope is also where `/pi-oven:setup` writes the mnemopi + async + `task.enableLsp=true` prerequisites, and `/pi-oven:setup --repair-prereqs` is the narrow path that rewrites only those prerequisites plus the 6 tool flags without touching routing.

Under `--scope project` it writes overrides to `<cwd>/.omp/settings.json` instead — and under project scope **every profile (A/B/C/D) writes all 24 per-role overrides** there (so a project can fully diverge from the committed Profile-A frontmatter), plus `modelRoles` and `retry.fallbackChains`. That project file is committable (share routing with a team) or gitignorable (machine-local). Project scope does NOT write the 6 tool flags or the memory/async/LSP prerequisites; the script now reports that separation explicitly (`Project scope kept ~/.omp/agent/config.yml untouched.` + `Run /pi-oven:setup --repair-prereqs on this machine…`). In both scopes the wizard MUST NOT modify `agents/pi-oven-*.md` files; those are committed PROFILE_A baseline artifacts and are read-only from the wizard's perspective.

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

## Temporary compatibility boundary

- Scope: vendored native worker runtime under `scripts/pi-oven-team/*` only.
- Owner: pi-oven maintainers.
- Removal condition: remove this boundary once native worker startup/scale is owned end-to-end by the omp-native control plane and no runtime path depends on `scripts/pi-oven-team/*`.

## Flag reference (for dispatching the batch script)

| Flag | Behavior |
|---|---|
| `--profile A` | Apply Profile A (release default). |
| `--profile B` | Apply Profile B (openai-codex-only wide fan-out performance profile: gpt-5.5 for implementation/review/planning/deep research, gpt-5.4 for fan-out/docs/vision/git/data-runner; writes `:<thinkingLevel>` suffixes; no gpt-5.4-mini/nano). Requires openai-codex auth detected. Writes all 24 per-role `task.agentModelOverrides`. Reversible via `--reset`. |
| `--profile C` | Apply Profile C (all-Anthropic: opus-4-8 for high/xhigh roles, sonnet-4-6 for medium and for git-master + orchestrator title; haiku-4-5 is unavailable). Requires anthropic auth. Writes all 24 per-role `task.agentModelOverrides`. Reversible via `--reset`. |
| `--profile D` | Apply Profile D (opencode-zen-only wide fan-out profile: kimi-k2.6 for heavy/coding roles, minimax-m2.5 for mid/low, gemini-3-flash for vision). Requires opencode-zen auth. Writes all 24 per-role `task.agentModelOverrides`. Profile A is orchestrator-only (sets modelRoles, no per-role overrides); B, C, and D each write all 24. Reversible via `--reset`. |
| `--override <role>=<model>` | Override a specific role's model in config.yml task.agentModelOverrides. Repeatable. |
| `--validate=smoke` | (Default) Ping 7 MUST-tier roles after persist. |
| `--validate=full` | Ping all 24 roles. |
| `--validate=none` | Skip validation. |
| `--status` | Show effective per-role models across project `.omp/settings.json`, global config.yml overrides, and agent frontmatter; project wins per role. Also appends the shared standalone truth surface: installed-topology evidence, the explicit control-plane front door, whether the vendored native-worker launcher (`scripts/pi-oven-team/index.ts` → `runtime-v2.ts`) is active, and the configured `nativeWorkers.maxWorkers` ceiling it will enforce. |
| `--reset` | Clear pi-oven-managed routing overrides in the selected scope. Global scope removes `pi-oven:*` keys from config.yml `task.agentModelOverrides`; project scope removes project `.omp/settings.json` pi-oven routing. Does not touch agent files. |
| `--reset --full` | Full reset for a clean uninstall: global scope also resets other pi-oven-managed keys (`modelRoles`, `disabledProviders`, `setupVersion`) to omp type-defaults; project scope also clears project `modelRoles` and `retry.fallbackChains`. Never touches omp-internal keys. No-op-safe when keys are absent. |
| `--import <file>` | Import JSON config file (schema: §7.1). |
| `--repair-prereqs` | GLOBAL-only repair path: write only `memory.backend=mnemopi`, `mnemopi.noEmbeddings=true`, `mnemopi.llmMode=none`, `async.enabled=true`, `task.enableLsp=true`, and the 6 gated tool flags in `~/.omp/agent/config.yml`. It does **not** write `modelRoles`, `task.agentModelOverrides`, `retry.fallbackChains`, project settings, or setup markers. Rejected under `--scope project`. |
| `--language <ko\|en\|name>` | Persist the default response language. With `--scope global` (default) writes to `~/.pi-oven/config.json` (machine-global); with `--scope project` writes the per-project override `<cwd>/.pi-oven/config.json` (which takes precedence when present). Accepts `ko`/`en` or any plain language name (letters, spaces, `()-.`; ≤ 40 chars). Set in Step 0/0.5. |
| `--scope global\|project` | WHERE this setup writes (default `global`). `global` = today's behavior: per-role overrides (B/C/D), `modelRoles`, `retry.fallbackChains` → `~/.omp/agent/config.yml`; language + setup-complete marker + `nativeWorkers.maxWorkers` → `~/.pi-oven/config.json`; machine-global tool flags + memory/async/`task.enableLsp` prerequisites are written here. Use `--repair-prereqs` when you only need to restore those prerequisites without touching routing. `project` = writes all 24 per-role overrides + `modelRoles` + `retry.fallbackChains` to `<cwd>/.omp/settings.json`, while language + setup-complete marker + `nativeWorkers.maxWorkers` go to `<cwd>/.pi-oven/config.json`. The vendored native-worker launcher (`scripts/pi-oven-team/index.ts`) always prefers the project-local ceiling when present, otherwise the global one. |

The 7 MUST-tier roles for smoke validation are: executor, explorer, verifier, critic, planner, code-reviewer, debugger.

Use the marketplace-qualified id `pi-oven@kzk` only for `omp plugin install` / `omp plugin uninstall`; setup persistence goes through the batch script, not ad-hoc config commands.

## Important rules

- Do NOT run the `pi-oven-setup.ts` script from inside this prompt template — you (the LLM) dispatch it via the Bash tool based on user input collected in conversation.
- Do NOT mutate `agents/pi-oven-*.md` manually — only via the script.
- Do NOT commit. The user reviews before any commit.
- Do NOT use ad-hoc config commands directly — the script handles all persistence.
- Do NOT pipe anything into the `pi-oven-setup.ts` script — it is batch-only and reads no stdin.
- Always resolve `$PI_OVEN_DIR` (see "Resolve the plugin script dir first") and dispatch `bun "${PI_OVEN_DIR%/}/scripts/pi-oven-setup.ts"` — never a cwd-relative `bun` call against `scripts/pi-oven-setup.ts`.

## Known limitations (surface if relevant)

- **Parent session fallback hole**: When a pi-oven subagent's primary model is unauthed, omp falls back to the parent session model (not the next array entry). Profile B is safe only when openai-codex auth is active and stable; Profile C is safe only when anthropic auth is active and stable; Profile D is safe only when opencode-zen auth is active and stable. This is an omp internal behavior that pi-oven cannot override (Spec A §6.3).
