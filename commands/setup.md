---
name: pi-oven-setup
description: Configure pi-oven agent model routing — the codex-only default profile
argument-hint: "[--status | --reset [--full] | --repair-prereqs | --import <file> | --apply] [--validate smoke|full|none] [--override <role>=openai-codex/<model>[:effort]] [--scope global|project]"
---

# /pi-oven:setup

You are guiding the user through pi-oven setup. The actual logic runs in the `pi-oven-setup.ts` script (resolved per the note below). You drive the conversation; the script runs in batch.

Namespace contract for every explanation in this flow: runtime agents and skills are `pov:*`; slash commands stay `/pi-oven:*`; install/uninstall identity stays `pi-oven@kzk`.
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
- If they say "reset" or "clear" → confirm with the user first, then run `bun "${PI_OVEN_DIR%/}/scripts/pi-oven-setup.ts" --reset`. If they ask for a complete reset before uninstall (a clean "new user" state), add `--full` to also reset `modelRoles`, `retry.fallbackChains`, and `setupVersion` to omp defaults.
- If they say "repair prerequisites", "fix memory", or they only need the global mnemopi/LSP/tool prerequisites restored without touching routing → run `bun "${PI_OVEN_DIR%/}/scripts/pi-oven-setup.ts" --repair-prereqs`. This path is **global-only**; if they explicitly ask for project scope, explain that repair writes `~/.omp/agent/config.yml` only and cannot run under `--scope project`.
- If they say "import" with a file path → run `bun "${PI_OVEN_DIR%/}/scripts/pi-oven-setup.ts" --import <file>`.
- Otherwise (first-time setup or routing refresh) → walk through the apply flow below.

## Apply flow (first-time setup or routing refresh)

### Step 0 — Primary language

Before anything else, ask the user which language will be the **default response language going forward** — this is a global preference, not just for the current project. Call the `pi-oven_ask` tool with the question string, the two listed `options`, `recommended: 0`, and `affordances: { other: true, askAboutChoices: false }`. This step is plain preference capture, not a deep-interview / approval handoff, so omit `deepInterview` / `approval` metadata here. Read the outcome from `details.action`: `selected` populates `details.selected`, `other` populates `details.customInput`; if the action is cancelled/deferred or neither field is present, treat it as a cancel and stop — do NOT silently re-ask. Keep the current question/context spacing, but render each option on the very next line without an extra blank spacer between options.

Use a question framing like: "pi-oven 셋업 — 앞으로의 기본 응답 언어를 무엇으로 할까요?" (or in English: "pi-oven setup — what should be the default response language going forward?")

Exact option set:

- Option 1 — label: `한국어 (Korean)`, description: `셋업 대화와 이후 에이전트 응답을 한국어로`
- Option 2 — label: `English`, description: `Setup dialog and agent responses in English`

The user may instead pick "Other (type your own)" and enter any plain language name (examples: `Español`, `日本語`, `Français`). A free-form name must be a plain language label: letters, spaces, and `()-.` only, up to 40 characters — the script rejects anything else (newlines, backticks, `<>`, `#`, `;`, etc.) because the value is injected verbatim into the agent system prompt.

Do NOT persist the language yet — the write is deferred to Step 0.5 so it can be paired with the chosen `--scope`.

### Step 0.5 — Setup scope

Right after the language choice, ask whether this setup applies **globally** (the default for every project) or **only to this project**. Call `pi-oven_ask` with the question string, the two listed `options`, `recommended: 0`, and `affordances: { other: false, askAboutChoices: false }`. Scope is a closed set here, so do NOT expose free-text or the clarification affordance. Read the outcome the same way as Step 0 (`details.action` + `details.selected`); if the action is cancelled/deferred or no selection is present, treat it as a cancel and stop.

Question framing: "이번 셋업을 글로벌(모든 프로젝트 기본값)로 적용할까요, 이 프로젝트에만 적용할까요?" (or in English: "Apply this setup globally (default for all projects) or to this project only?")

Exact option set:

- Option 1 — label: `글로벌 (모든 프로젝트 기본값)`, description: `~/.pi-oven + 글로벌 config.yml`
- Option 2 — label: `이 프로젝트만`, description: `.omp/settings.json + .pi-oven/config.json (이 레포에서만)`

Map the choice to `<scope>`: Option 1 → `global` (today's behavior), Option 2 → `project`. Reuse `<scope>` for EVERY remaining dispatch in this flow.

**What scope changes:**

- **`global` (default)** — codex-only DEFAULT_PROFILE overrides for all 24 runtime-visible `pov:*` roles plus the workflow-skill ownership filter `skills.includeSkills = ["pov:*"]`, `modelRoles`, and empty `retry.fallbackChains` go to the user-global `~/.omp/agent/config.yml`; language + setup receipt metadata (`setupCompletedAt`) + `nativeWorkers.maxWorkers` go to `~/.pi-oven/config.json`. Readiness is judged from live routing + machine-global prerequisites, not from the receipt alone. This workflow-skill filter ignores a populated `~/.claude/skills` workflow-skill source without deleting it, and it applies only to workflow skills (not commands, agents, hooks, or MCP). A global-scope run is also the only path that writes the machine-global tool flags plus the memory/async/LSP prerequisites that pi-oven uses for wide subagent fan-out.
- **`project`** — the same 24-role codex-only DEFAULT_PROFILE override record, plus `skills.includeSkills = ["pov:*"]`, `modelRoles`, and empty `retry.fallbackChains`, is written to `<cwd>/.omp/settings.json` (omp reads this at project level and it wins per-role over global). Language + setup receipt metadata (`setupCompletedAt`) + `nativeWorkers.maxWorkers` go to `<cwd>/.pi-oven/config.json`. Readiness is judged from live project routing, not from the receipt alone. Memory/async/LSP infra and tool enablement stay global-only and are NOT written under project scope. This project-local `.pi-oven/config.json` is the first ceiling source the vendored native worker launcher consults.

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

### Step 1 — Detect OpenAI Codex auth

Run via Bash:

```
omp models
```

Parse the "Provider models" section. A line matching `^openai-codex\s+` means the codex-only default profile can be activated. The setup wizard no longer offers non-Codex routing profiles.

Summarize to the user in chat:

```
Detecting provider authentication...
  openai-codex  authed  (N models available)

Default routing: codex-only DEFAULT_PROFILE
```

If `openai-codex` is not detected, say:

```
  openai-codex  not detected
```

If `openai-codex` is unavailable, tell the user to authenticate OpenAI Codex in omp first and stop. `/pi-oven:setup`, `/pi-oven:setup --status`, and `/pi-oven:doctor` remain visibility/guard layers. The visible runtime agent+skill namespace stays `pov:*`; `/pi-oven:*` stays the command surface and `pi-oven@kzk` stays the install identity.

### Step 2 — Parent session check

Read `~/.omp/plugins/pi-oven-session-model.json` (written by the pi-oven extension's `session_start` handler). This file looks like:

```json
{ "model": "openai-codex/gpt-5.4", "capturedAt": 1234567890000 }
```

- If the file is absent, older than 1 hour (`Date.now() - capturedAt > 3600000`), or cannot be parsed as JSON: skip this check silently.
- If the file is present and fresh, check whether the model prefix is `openai-codex/`. If it is not, warn the user but do not fail setup:

```
WARNING: Your current omp session is running on "<model>", outside pi-oven's
codex-only routing default. If a pi-oven subagent's primary model is unauthed,
omp may fall back to this parent model. Recommendation: relaunch omp with
--model openai-codex/gpt-5.4 before running this setup.
```

If the file is absent or stale, proceed without comment.

### Step 3 — Confirm the codex-only default profile

There is no profile selection question. Display this notice and ask for confirmation before proceeding:

```
NOTICE: Auth-fallback limitation (Spec A §6.3)
When a pi-oven subagent's primary model is in the omp registry but unauthed,
omp falls back to the PARENT SESSION's active model — not the next item in
the model array. If your parent session runs a subscription-provider model,
pi-oven subagents may incur unexpected billing if their primary model fails auth.
This is an omp internal behavior that pi-oven cannot override. pi-oven now
persists only the codex-only DEFAULT_PROFILE, so setup is safe only when
openai-codex auth is active and stable.
Proceed with codex-only DEFAULT_PROFILE? [y/N]:
```

In both scopes, setup writes all 24 `task.agentModelOverrides` entries for runtime-visible `pov:*` roles, refreshes `modelRoles.default` / `modelRoles.title`, and overwrites `retry.fallbackChains` with an empty record. Run `--reset` on the same scope to clear pi-oven routing overrides.

### Step 4 — Optional per-role override

Ask the user:

```
Apply codex-only defaults to all 24 roles? [Y/n]:
```

`Y` or Enter: use DEFAULT_PROFILE for all roles — proceed to Step 5.

`n`: collect per-role overrides through conversation. For each role the user wants to override, ask which model to use. Validate that the model string is an OpenAI Codex selector:

- Allowed: `openai-codex/<model>[:effort]`
- Examples: `openai-codex/gpt-5.5`, `openai-codex/gpt-5.5:high`, `openai-codex/gpt-5.4:medium`

Reject strings that do not match with a clear error and re-ask. When the user specifies at least one override, apply those explicit per-role overrides after profile selection.

### Step 5 — Confirm and persist

Show a summary in chat:

```
Summary:
  Profile: DEFAULT_PROFILE (codex-only)
  Scope: <global|project>
  Roles with custom override: <N>
  Routing target: <global config.yml all-role overrides for runtime `pov:*` roles + skills.includeSkills + modelRoles/retry.fallbackChains | project .omp/settings.json all-role overrides for runtime `pov:*` roles + skills.includeSkills + modelRoles/retry.fallbackChains>

Ready to persist pi-oven routing. Proceed? [Y/n]:
```

On confirmation, dispatch via Bash (using the resolved `$PI_OVEN_DIR`), threading the `<scope>` chosen in Step 0.5:

```
bun "${PI_OVEN_DIR%/}/scripts/pi-oven-setup.ts" --apply --scope <global|project> --validate=smoke
```

If there are per-role overrides, add one `--override <role>=<model>` flag per override:

```
bun "${PI_OVEN_DIR%/}/scripts/pi-oven-setup.ts" --apply --scope <global|project> --override executor=openai-codex/gpt-5.5 --validate=smoke
```

Do not add `--validate=none` unless the user explicitly asked to skip validation.

Under `--scope global` (default) the script writes model overrides to `~/.omp/agent/config.yml` as one per-role entry for the runtime-visible `pov:*` agents — user-global, machine-local, NOT committed. It also writes the workflow-skill ownership mainline `skills.includeSkills = ["pov:*"]`, which explicitly filters a populated `~/.claude/skills` workflow-skill source without deleting it; this is judged only on workflow-skill visibility and does not widen into commands, agents, hooks, or MCP exclusivity. Empty `~/.claude/skills` is not the target state, and legacy compatibility aids alone do not stop `claude-plugins` or namespaced marketplace workflow skills. It also **force-enables the 6 omp tool flags** (`inspect_image.enabled`, `web_search.enabled`, `lsp.enabled`, `astGrep.enabled`, `browser.enabled`, `debug.enabled`) so the agent body mandates have teeth. These flags are re-enabled on every global-scope run with no opt-out — this is intentional so a user toggle cannot silently neuter a mandated tool. `--reset --full` leaves these flags alone (they are omp-global infra, not pi-oven routing). Global scope is also where `/pi-oven:setup` writes the mnemopi + async + `task.enableLsp=true` prerequisites, and `/pi-oven:setup --repair-prereqs` is the narrow path that rewrites only those prerequisites plus the 6 tool flags without touching routing. `~/.pi-oven/config.json` keeps language + `nativeWorkers.maxWorkers` + setup receipt metadata, but the shared readiness summary now trusts live routing + prerequisites first.

Under `--scope project` it writes overrides to `<cwd>/.omp/settings.json` instead: all 24 codex-only per-role overrides for the runtime-visible `pov:*` roles, the same workflow-skill ownership filter `skills.includeSkills = ["pov:*"]`, `modelRoles`, and empty `retry.fallbackChains`. That project file is committable (share routing with a team) or gitignorable (machine-local). Project scope does NOT write the 6 tool flags or the memory/async/LSP prerequisites; the script now reports that separation explicitly (`Project scope kept ~/.omp/agent/config.yml untouched.` + `Run /pi-oven:setup --repair-prereqs on this machine...`). In both scopes the wizard MUST NOT modify the committed agent definition files under `agents/`; those are release-baseline artifacts and are read-only from the wizard's perspective. `<cwd>/.pi-oven/config.json` still stores language + `nativeWorkers.maxWorkers` + setup receipt metadata, but the shared readiness summary treats project routing itself as the source of truth.

The script handles persist (config.yml write) and smoke validation in a single batch call. Do not invoke it more than once for the same flow.

### Step 6 — Report results

Relay the full script output to the user. Surface:

- Setup complete + active DEFAULT_PROFILE.
- Any validation warnings.
- Any validation failures (UNVERIFIED roles).

If the script exits with code 1 (one or more UNVERIFIED roles), do NOT auto-retry. Present the UNVERIFIED role list and ask the user how to proceed:

```
One or more roles are UNVERIFIED. Options:
  1. Reconfigure  — run /pi-oven:setup again with different Codex overrides
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
| `--apply` | Apply DEFAULT_PROFILE. Requires openai-codex auth detected. Writes all 24 per-role `task.agentModelOverrides`, refreshes release-default `modelRoles`, writes `skills.includeSkills = ["pov:*"]`, and keeps `retry.fallbackChains` empty. Reversible via `--reset`. |
| `--profile <legacy>` | Accepted for backward compatibility and ignored; every value resolves to DEFAULT_PROFILE. Prefer `--apply` in new documentation and scripts. |
| `--override <role>=openai-codex/<model>[:effort]` | Override a specific runtime role's Codex model in `task.agentModelOverrides`. Repeatable. Other provider selectors are rejected. |
| `--validate=smoke` | (Default) Ping 7 MUST-tier roles after persist. |
| `--validate=full` | Ping all 24 roles. |
| `--validate=none` | Skip validation. |
| `--status` | Show the shared setup readiness summary first — global readiness from `~/.omp/agent/config.yml` routing + machine-global prerequisites, project readiness from `.omp/settings.json` routing — then show effective per-role models across project `.omp/settings.json`, global config.yml overrides, and agent frontmatter; project wins per role. Also appends the shared standalone truth surface: installed-topology evidence, the explicit control-plane front door, workflow-skill ownership classifications (`owned-surface active` / `compatibility aids only` / `ownership not established`), the secondary bootstrap-parity track, whether the vendored native-worker launcher (`scripts/pi-oven-team/index.ts` → `runtime-v2.ts`) is active, the effective workflow-skill ownership filter (`skills.includeSkills = ["pov:*"]` mainline), and the configured `nativeWorkers.maxWorkers` ceiling it will enforce. |
|  | Shared migration/install vocabulary surfaced by `--status`: `healthy single pov surface`, `old config keys`, `mixed migration state`, `dual plugin surface`, and `agent namespace drift`. |
| `--reset` | Clear pi-oven-managed routing overrides in the selected scope. Global scope removes the 24 per-role override entries from config.yml `task.agentModelOverrides`; project scope removes project `.omp/settings.json` pi-oven routing. Does not touch agent definition files. |
| `--reset --full` | Full reset for a clean uninstall: global scope also resets other pi-oven-managed keys (`modelRoles`, `retry.fallbackChains`, `setupVersion`) to omp type-defaults; project scope also clears project `modelRoles` and `retry.fallbackChains`. Never touches omp-internal keys. No-op-safe when keys are absent. |
| `--import <file>` | Import a JSON config with `primary` and optional `thinkingLevel` selectors, restricted to `openai-codex/<model>[:effort]`. Global-only today: the import path writes machine-global `task.agentModelOverrides` and rejects `--scope project`. |
| `--repair-prereqs` | GLOBAL-only repair path: write only `memory.backend=mnemopi`, `mnemopi.noEmbeddings=true`, `mnemopi.llmMode=none`, `async.enabled=true`, `task.enableLsp=true`, and the 6 gated tool flags in `~/.omp/agent/config.yml`. It does **not** write `modelRoles`, `task.agentModelOverrides`, `retry.fallbackChains`, project settings, or setup receipt metadata. Rejected under `--scope project`. |
| `--language <ko\|en\|name>` | Persist the default response language. With `--scope global` (default) writes to `~/.pi-oven/config.json` (machine-global); with `--scope project` writes the per-project override `<cwd>/.pi-oven/config.json` (which takes precedence when present). Accepts `ko`/`en` or any plain language name (letters, spaces, `()-.`; ≤ 40 chars). Set in Step 0/0.5. |
| `--scope global\|project` | WHERE this setup writes (default `global`). `global` = writes all 24 per-role overrides + the workflow-skill ownership filter `skills.includeSkills = ["pov:*"]` + `modelRoles` + empty `retry.fallbackChains` to `~/.omp/agent/config.yml`; language + setup receipt metadata + `nativeWorkers.maxWorkers` -> `~/.pi-oven/config.json`; machine-global tool flags + memory/async/`task.enableLsp` prerequisites are written here. Use `--repair-prereqs` when you only need to restore those prerequisites without touching routing. `project` = writes the same 24-role override record + workflow-skill ownership filter + `modelRoles` + empty `retry.fallbackChains` to `<cwd>/.omp/settings.json`, while language + setup receipt metadata + `nativeWorkers.maxWorkers` go to `<cwd>/.pi-oven/config.json`. Ownership success is judged by the effective `skills.includeSkills` surface, not by emptying `~/.claude/skills`. In both scopes, the shared readiness summary derives truth from live routing + prerequisites first rather than trusting `setupCompletedAt` alone. |

The 7 MUST-tier roles for smoke validation are: executor, explorer, verifier, critic, planner, code-reviewer, debugger.

Use the marketplace-qualified id `pi-oven@kzk` only for `omp plugin install` / `omp plugin uninstall`; setup persistence goes through the batch script, not ad-hoc config commands.

## Important rules

- Do NOT run the `pi-oven-setup.ts` script from inside this prompt template — you (the LLM) dispatch it via the Bash tool based on user input collected in conversation.
- Do NOT mutate `agents/pov-*.md` manually or reintroduce legacy `pi-oven-*.md` filenames / non-`pov:*` runtime names — only the script owns the healthy single `pov` surface.
- Do NOT commit. The user reviews before any commit.
- Do NOT use ad-hoc config commands directly — the script handles all persistence.
- Do NOT pipe anything into the `pi-oven-setup.ts` script — it is batch-only and reads no stdin.
- Always resolve `$PI_OVEN_DIR` (see "Resolve the plugin script dir first") and dispatch `bun "${PI_OVEN_DIR%/}/scripts/pi-oven-setup.ts"` — never a cwd-relative `bun` call against `scripts/pi-oven-setup.ts`.

## Known limitations (surface if relevant)

- **Parent session fallback hole**: When a pi-oven subagent's primary model is unauthed, omp falls back to the parent session model (not the next array entry). DEFAULT_PROFILE is safe only when openai-codex auth is active and stable. This is an omp internal behavior that pi-oven cannot override (Spec A §6.3).
