> Historical; do not copy runtime syntax examples from this document.

# Spec B: /pi-oven:setup Wizard

**Status**: Draft v4 — 2026-05-28 (cycle 4 revision)
**Scope**: `/pi-oven:setup` slash command, conversation-driven UX, Profile A/B configuration and persistence, omp plugin config integration, agent file in-place rewrite
**Spec A dependency**: `docs/specs/2026-05-28-pi-oven-agent-registry.md` (ACCEPTED cycle 4)
**Out-of-scope (Spec C)**: deep-init, deep-dive, team skill, SKILL.md rewrite

---

## §1 Goal

Spec A defines 23 pi-oven agent files each with a `model:` frontmatter array, supporting two provider profiles. **Profile A** (release default) uses opencode-zen + openai-codex models only. **Profile B** (Anthropic opt-in) switches each role to use an anthropic primary model when the user has direct Anthropic API authentication.

The problem: agent file `model:` arrays are fixed at build time. Switching to Profile B requires either manually editing 23 agent files or having a mechanism to rewrite them at setup time. `/pi-oven:setup` is the user-facing entry point for that mechanism.

Problems the wizard solves:

1. **Provider auth auto-detection**: Parse `omp --list-models` to identify which providers are authenticated and determine available profiles.
2. **Profile selection and per-role override**: Apply the entire profile at once, or specify per-role model overrides.
3. **Persistence**: Write chosen model map to `omp plugin config set pi-oven <key> <value>` and rewrite agent file `model:` arrays in-place (agent files are the source of truth; plugin config is wizard-state storage).
4. **Validation**: After persist, run smoke-ping dispatch for MUST-tier roles to confirm real connectivity.
5. **Auth-fallback hole notice**: Explicitly surface Spec A §6.3 known limitation — when a primary model is in the registry but unauthed, omp falls back to the parent session model (not the next array entry) — at Profile B selection time.

---

## §2 Wizard Surface

`/pi-oven:setup` is a slash command declared in `commands/pi-oven-setup.md`. This file is an English prompt template that instructs the Claude agent to conduct a conversation-driven setup flow and dispatch `bun scripts/pi-oven-setup.ts [--status|--reset|--import <file>|--validate=<smoke|full|none>]` via Bash tool. The actual wizard logic is batch-CLI-only; interactive Q&A happens inside the chat conversation (LLM asks questions, user answers in chat, LLM collects inputs and dispatches batch CLI commands between turns).

### 2.1 Subcommand table

| Invocation | Behavior |
|---|---|
| `/pi-oven:setup` | Conversation-driven setup flow (default). LLM runs auth detection, asks profile choice A/B, collects per-role overrides if desired, then dispatches batch `bun scripts/pi-oven-setup.ts` with collected inputs. |
| `/pi-oven:setup --import <file>` | Import JSON config file. Whitelist validation → persist → validation. |
| `/pi-oven:setup --status` | Output current profile and resolved model per role. "Profile not configured" if unset. Also checks if auth state has changed since last setup. |
| `/pi-oven:setup --reset` | Delete all `pi-oven.*` keys from plugin config and restore agent file `model:` arrays to Profile A defaults. |
| `/pi-oven:setup --reapply` | Rewrite agent files to match persisted plugin config. Use after `omp plugin upgrade` or drift warning. |

### 2.2 How it works

`commands/pi-oven-setup.md` is the entry point the user invokes as `/pi-oven:setup`. It is an English prompt template (markdown slash command loaded by omp's `discovery/builtin.ts`). The template instructs the Claude agent to:

1. Run `bun scripts/pi-oven-setup.ts --status` via Bash to read current state.
2. Ask the user conversation questions (auth detection results, profile choice, override preferences).
3. Collect answers across conversation turns.
4. Dispatch `bun scripts/pi-oven-setup.ts` with flags encoding the collected choices.

`scripts/pi-oven-setup.ts` is batch-only (CLI arguments, no stdin). It is never run as a stdin-interactive subprocess. Direct CLI usage:

```bash
bun scripts/pi-oven-setup.ts --status
bun scripts/pi-oven-setup.ts --reset
bun scripts/pi-oven-setup.ts --import config.json
bun scripts/pi-oven-setup.ts --profile B
bun scripts/pi-oven-setup.ts --profile A --validate=smoke
bun scripts/pi-oven-setup.ts --profile custom --override executor=anthropic/claude-opus-4-7
```

---

## §3 Auth Detection Flow

The first step in the setup flow. Parsing `omp --list-models` determines which providers are authenticated and which profiles are available.

### 3.1 Primary detection: omp --list-models parsing

```bash
omp --list-models 2>&1
```

Parse the "Provider models" section for native provider rows. Target regex/grep:

```
^anthropic\s+claude-
```

Applied line-by-line to the Provider models tabular output. A line matching this pattern means the native `anthropic` provider (direct Anthropic API key, not opencode-zen wrappers) is authed and registered. The table header row (`provider      model ...`) is implicitly excluded: the `claude-` requirement in the regex means the header never matches, so no explicit header-skip logic is needed.

Example output (live `omp --list-models` format):

```
Provider models
provider      model                       context  max-out  thinking   images
anthropic     claude-haiku-4-5            200K     64K      ...        yes
opencode-zen  claude-sonnet-4-6           1M       64K      ...        yes
...
```

Parsing logic: extract the first token from each data row as provider ID, deduplicate.

Detection results:
- `opencode-zen` present → opencode-zen authed
- `openai-codex` present → openai-codex authed
- `anthropic` present (with `^anthropic\s+claude-` match) → native Anthropic API authed (Profile B activation condition)

> **Important**: Models appearing as `anthropic/claude-sonnet-4-6` in the canonical model list are opencode-zen wrapper results — they are NOT evidence of direct Anthropic API auth. Only a dedicated `anthropic` provider row in the Provider models section confirms native auth.

### 3.2 Secondary detection: smoke ping (optional, --confirm-auth flag only)

Available only when `--confirm-auth` is passed. Executes a minimal completion call:

```bash
omp -p "Reply with the single word: pong" --model anthropic/claude-haiku-4-5 --no-tools --max-tokens 5 2>&1
```

> **Auth-fallback risk**: This ping CAN succeed when the parent session model is anthropic and Anthropic itself is unauthed (Spec A §6.3 known limitation). The native-provider parse (§3.1) is the only reliable signal. Smoke ping is a secondary confirmation only — it does not override a negative `--list-models` result.

### 3.3 Auth combination matrix

| opencode-zen | openai-codex | anthropic | Available profiles | Recommended |
|:---:|:---:|:---:|---|---|
| yes | yes | yes | A, B | B (Anthropic Pro-Max users) |
| yes | yes | no | A only | A |
| yes | no | yes | A (codex alternate inactive), B | B |
| yes | no | no | A (codex alternate inactive) | A |
| no | yes | no | Limited A (opencode-zen absent, fallback unstable) | Re-auth recommended |
| no | no | yes | Profile B only (opencode-zen absent) | B |
| no | no | no | Not configurable | Authenticate an omp provider first |

When opencode-zen is absent and Profile A is selected, Spec A §3.2 Outcome 2 applies: subagents fall back to parent session model. The wizard outputs a warning in this case.

---

## §4 Profile A — Release Default

Profile A is the benchmark-and-cost-optimized model map (2026-05-29 OPTIMIZED-MODEL revision). Three high-stakes advisory roles (critic, security-reviewer, oracle) use `anthropic/` as primary; planner uses `anthropic/claude-opus-4-7` primary with `openai-codex/gpt-5.4` as cross-vendor review alternate per user policy. Six coding/advisory roles (executor, debugger, test-engineer, scientist, architect, metis) use the `openai-codex/` subscription (gpt-5.3-codex / gpt-5.4) — `openai-codex/` is preferred over `anthropic/` whenever benchmark differences are within margin of error, since the OpenAI subscription marginal cost is near zero. The remaining roles use `opencode-zen/` direct (Kimi K2.6 / Gemini / GLM / GPT-5-nano) for cost-down without quality loss, justified by 2026-05 SWE-bench / agent / front-end benchmarks (see `OPTIMIZED-MODEL.md`).

Default fallback policy is the `opencode-zen/` wrapper of the same model id. Exception: planner falls back to `openai-codex/gpt-5.4` for codex-review cross-validation, not the same-model wrapper.

Provider mix: 4 anthropic (planner primary, critic, security-reviewer, oracle) / 6 openai-codex / 13 opencode-zen.

Complete 23-role Profile A model map (verified against live `omp --list-models` 2026-05-28):

| Role | primary | registry_alternate | thinkingLevel |
|---|---|---|---|
| executor | openai-codex/gpt-5.3-codex | opencode-zen/gpt-5.3-codex | high |
| explorer | opencode-zen/gemini-3-flash | opencode-zen/claude-haiku-4-5 | medium |
| verifier | opencode-zen/kimi-k2.6 | opencode-zen/claude-sonnet-4-6 | medium |
| critic | anthropic/claude-opus-4-8 | opencode-zen/claude-opus-4-8 | xhigh |
| planner | anthropic/claude-opus-4-8 | openai-codex/gpt-5.4 | high |
| code-reviewer | opencode-zen/kimi-k2.6 | opencode-zen/claude-sonnet-4-6 | high |
| debugger | openai-codex/gpt-5.3-codex | opencode-zen/gpt-5.3-codex | high |
| test-engineer | openai-codex/gpt-5.3-codex | opencode-zen/gpt-5.3-codex | high |
| security-reviewer | anthropic/claude-opus-4-8 | opencode-zen/claude-opus-4-8 | xhigh |
| writer | opencode-zen/gemini-3-flash | opencode-zen/claude-haiku-4-5 | medium |
| designer | opencode-zen/glm-5.1 | opencode-zen/claude-sonnet-4-6 | high |
| code-simplifier | opencode-zen/kimi-k2.6 | opencode-zen/claude-sonnet-4-6 | xhigh |
| qa-tester | opencode-zen/gemini-3.5-flash | opencode-zen/claude-haiku-4-5 | high |
| git-master | opencode-zen/gpt-5-nano | opencode-zen/claude-haiku-4-5 | minimal |
| document-specialist | opencode-zen/gemini-3-flash | opencode-zen/claude-haiku-4-5 | medium |
| tracer | opencode-zen/kimi-k2.6 | opencode-zen/claude-sonnet-4-6 | high |
| analyst | opencode-zen/kimi-k2.6 | opencode-zen/claude-sonnet-4-6 | xhigh |
| scientist | openai-codex/gpt-5.4 | opencode-zen/gpt-5.4 | xhigh |
| architect | openai-codex/gpt-5.4 | opencode-zen/gpt-5.4 | xhigh |
| librarian | opencode-zen/kimi-k2.6 | opencode-zen/claude-sonnet-4-6 | medium |
| multimodal-looker | opencode-zen/gemini-3-flash | opencode-zen/claude-sonnet-4-6 | medium |
| oracle | anthropic/claude-opus-4-8 | opencode-zen/claude-opus-4-8 | xhigh |
| metis | openai-codex/gpt-5.4 | opencode-zen/gpt-5.4 | xhigh |

`registry_alternate` activates only when the primary model is removed from the omp registry (Outcome 3). When primary is simply unauthed (Outcome 2), omp falls back to the parent session model — not the next array entry (Spec A §3.2 / §6.3). The `opencode-zen/` same-model wrapper alternate convention means that `anthropic/`-primary roles degrade to opencode-zen-billed access of the same Claude model when Anthropic auth lapses, and `openai-codex/`-primary roles degrade to opencode-zen-billed Codex access when the ChatGPT subscription is unavailable.

---

## §5 Profile B — Anthropic Opt-in

Profile B is the model map for users with direct Anthropic API authentication. Promotes Anthropic models to primary for reasoning-heavy roles while preserving `opencode-zen/glm-5` for context-heavy research roles (explorer, librarian) where the 1M token context window is the defining capability. Replacing glm-5 with 200K anthropic-haiku degrades large-repo workloads for those roles.

**Activation condition**: Only selectable when §3 auth detection confirms the native `anthropic` provider.

**Confirmed model IDs (live `omp --list-models`)**:
- `anthropic/claude-opus-4-7` — confirmed (1M ctx, 128K max-out, thinking supported)
- `anthropic/claude-sonnet-4-6` — confirmed (1M ctx, 64K max-out, thinking supported)
- `anthropic/claude-haiku-4-5` — confirmed (200K ctx, 64K max-out, thinking supported)
- `anthropic/claude-sonnet-4-7` — **not confirmed**: absent from live `omp --list-models`. See §12 Open Questions.

Profile B 23-role model map:

| Role | primary | registry_alternate | thinkingLevel |
|---|---|---|---|
| executor | anthropic/claude-sonnet-4-6 | opencode-zen/claude-sonnet-4-6 | high |
| explorer | opencode-zen/glm-5 | anthropic/claude-haiku-4-5 | medium |
| verifier | anthropic/claude-sonnet-4-6 | opencode-zen/claude-sonnet-4-6 | medium |
| critic | anthropic/claude-opus-4-7 | opencode-zen/claude-opus-4-7 | xhigh |
| planner | anthropic/claude-sonnet-4-6 | opencode-zen/claude-sonnet-4-6 | high |
| code-reviewer | anthropic/claude-opus-4-7 | opencode-zen/claude-opus-4-7 | high |
| debugger | anthropic/claude-sonnet-4-6 | opencode-zen/claude-sonnet-4-6 | high |
| test-engineer | anthropic/claude-sonnet-4-6 | opencode-zen/claude-sonnet-4-6 | high |
| security-reviewer | anthropic/claude-opus-4-7 | opencode-zen/claude-opus-4-7 | xhigh |
| writer | anthropic/claude-haiku-4-5 | opencode-zen/claude-haiku-4-5 | medium |
| designer | anthropic/claude-sonnet-4-6 | opencode-zen/claude-sonnet-4-6 | high |
| code-simplifier | anthropic/claude-opus-4-7 | opencode-zen/claude-opus-4-7 | xhigh |
| qa-tester | anthropic/claude-sonnet-4-6 | opencode-zen/claude-sonnet-4-6 | high |
| git-master | anthropic/claude-haiku-4-5 | opencode-zen/claude-haiku-4-5 | minimal |
| document-specialist | anthropic/claude-sonnet-4-6 | opencode-zen/claude-sonnet-4-6 | medium |
| tracer | anthropic/claude-sonnet-4-6 | opencode-zen/claude-sonnet-4-6 | high |
| analyst | anthropic/claude-opus-4-7 | opencode-zen/claude-opus-4-7 | xhigh |
| scientist | anthropic/claude-opus-4-7 | opencode-zen/claude-opus-4-7 | xhigh |
| architect | anthropic/claude-opus-4-7 | opencode-zen/claude-opus-4-7 | xhigh |
| librarian | opencode-zen/glm-5 | anthropic/claude-haiku-4-5 | medium |
| multimodal-looker | anthropic/claude-sonnet-4-6 | opencode-zen/claude-sonnet-4-6 | medium |
| oracle | anthropic/claude-opus-4-7 | opencode-zen/claude-opus-4-7 | xhigh |
| metis | anthropic/claude-opus-4-7 | opencode-zen/claude-opus-4-7 | xhigh |

**explorer and librarian rationale**: Profile B promotes Anthropic for reasoning-heavy roles (executor, critic, planner, etc.) while preserving `opencode-zen/glm-5` as primary for context-heavy research roles (explorer, librarian). The 1M token context window is the role-defining capability for these two roles; replacing with 200K anthropic-haiku would degrade large-repo workloads. Power users can override per-role via `--import` partial config (see §7 for sample).

**multimodal-looker**: Anthropic models support vision capability (`images: yes` confirmed in `omp --list-models`). Profile B uses `anthropic/claude-sonnet-4-6` for vision tasks.

**Auth-fallback hole notice (required)**: The wizard surfaces this notice before Profile B confirmation:

```
NOTICE: Auth-fallback limitation (Spec A §6.3)
When a pi-oven subagent's primary model is in the omp registry but unauthed,
omp falls back to the PARENT SESSION's active model — not the next item in
the model array. If your parent session runs an anthropic model, pi-oven
subagents may use Anthropic billing even when their primary model fails auth.
This is an omp internal behavior that pi-oven cannot override.
Profile B is safe when anthropic auth is active and stable.
Proceed with Profile B? [y/N]
```

---

## §6 Conversation-Driven UX Flow

`/pi-oven:setup` (invoked without flags) triggers the `commands/pi-oven-setup.md` prompt template. The LLM agent conducts the setup as a conversation: it asks questions in chat, collects answers across turns, then dispatches batch `bun scripts/pi-oven-setup.ts` CLI calls with the collected inputs. No stdin-interactive subprocess is used.

### Step a: Provider auth detection

The LLM dispatches:

```bash
omp --list-models 2>&1
```

Then summarizes auth state to the user in chat:

```
Detecting provider authentication...
  opencode-zen  authed  (32 models available)
  openai-codex  authed  (18 models available)
  anthropic     authed  (41 models available)

Available profiles: A (default), B (Anthropic opt-in)
```

If anthropic is not detected:

```
  anthropic     not detected

Available profiles: A only
Profile B requires direct Anthropic API authentication.
To enable: authenticate with the Anthropic provider in omp, then re-run /pi-oven:setup.
```

### Step a.5: Parent session model check

`omp --status` does NOT exist (verified: `omp --help` has no `--status` flag; `omp config` actions are `list|get|set|reset|path|init-xdg`). The active session model is available only via `ctx.getModel()` inside an extension event handler (`extensibility/extensions/types.d.ts:800`), not from a CLI script.

The parent session model is surfaced via a **session_start file capture** in the pi-oven extension (implemented in §9.6 alongside drift detection). The `session_start` handler writes `~/.omp/plugins/pi-oven-session-model.json` on every session start. The wizard CLI reads this file:

Two simultaneous omp sessions both writing `~/.omp/plugins/pi-oven-session-model.json` use last-write-wins; this is acceptable for a single-user setup.

Absent, stale (captured more than 1 hour ago), or corrupt (JSON.parse failure) all treated as "no parent model info" — graceful skip + info-level log. No data loss; warning skipped gracefully.

- If the file is absent, stale (captured more than 1 hour ago), or corrupt (JSON.parse failure): gracefully skip the parent-session check and emit an info-level message: `Parent session model check skipped (no recent session data).`
- If the file is present and fresh, and the model prefix is not in `ALLOWED_PREFIXES`: emit this warning before proceeding:

```
WARNING: parent session model "opencode-zen/glm-5" is not in the pi-oven whitelist.
Any pi-oven subagent with an unauthed primary will fall back to this model (Spec A §6.3 known limitation).
Recommendation: relaunch omp with --model opencode-zen/glm-5 before running /pi-oven:setup.
```

(The example uses `opencode-zen/glm-5` as the concrete recommended model for a whitelist-compliant session.)

### Step b: Profile selection

LLM asks in chat:

```
Select profile:
  [A] Profile A — Release default (opencode-zen + openai-codex)   (default)
  [B] Profile B — Anthropic opt-in (anthropic primary, opencode-zen fallback)

Enter choice [A]:
```

Selecting B triggers the auth-fallback hole notice from §5 as a chat message, and the LLM asks for confirmation before proceeding.

### Step c: Per-role override (optional)

LLM asks in chat:

```
Apply profile defaults to all 23 roles? [Y/n]:
```

`Y` or Enter: use selected profile defaults for all roles.

`n`: LLM collects per-role overrides through conversation. For each role, it accepts the profile default or a user-specified model string. Allowed prefixes are `opencode-zen/`, `openai-codex/`, and `anthropic/` (if Profile B AND anthropic detected). Model strings not matching allowed prefixes are rejected with a clear error, and the LLM asks again.

If zero overrides are specified, `pi-oven.profile` is set to `A` or `B`. If any override exists, `pi-oven.profile` is set to `custom`.

### Step d: Confirm + persist

LLM presents a summary in chat:

```
Summary:
  Profile: B
  Roles with custom override: 0
  Provider: anthropic enabled

Ready to persist to omp plugin config and rewrite agent files. Proceed? [Y/n]:
```

On confirmation, the LLM dispatches:

```bash
bun scripts/pi-oven-setup.ts --profile B --validate=smoke
```

This single batch call handles persist (both plugin config write and agent file in-place rewrite) and smoke validation.

### Step e: Validation output

The LLM relays the batch script output to the user:

```
Validating 7 MUST-tier roles (smoke mode)...
  executor      anthropic/claude-sonnet-4-6    verified
  explorer      opencode-zen/glm-5             verified
  verifier      anthropic/claude-sonnet-4-6    verified
  critic        anthropic/claude-opus-4-7      verified
  planner       anthropic/claude-sonnet-4-6    verified
  code-reviewer anthropic/claude-opus-4-7      verified
  debugger      anthropic/claude-sonnet-4-6    verified

Results: 7/7 verified
Setup complete. Profile B is active.
```

If one or more fail, the alternate is tried and result shown with `(alternate only)` consistently:

```
  verifier  anthropic/claude-sonnet-4-6   failed
  verifier  opencode-zen/claude-sonnet-4-6  verified (alternate only)

  executor  anthropic/claude-sonnet-4-6   failed
  executor  opencode-zen/claude-sonnet-4-6  failed — UNVERIFIED

Results: 5/7 verified, 1 alternate only, 1 UNVERIFIED

Roles marked UNVERIFIED will fall back to parent session model at dispatch time.
Run /pi-oven:setup to reconfigure, or /pi-oven:setup --reset to return to defaults.
```

---

## §7 Import UX

`/pi-oven:setup --import <file>` imports configuration from a JSON file. Power users can use this to share team config or automate setup in CI.

### 7.1 JSON schema

The example below shows 2 roles for brevity; the full config covers all 23 roles from Spec A §4 table.

```json
{
  "pi-oven": {
    "profile": "B",
    "models": {
      "executor": {
        "primary": "anthropic/claude-sonnet-4-6",
        "registry_alternate": "opencode-zen/claude-sonnet-4-6",
        "thinkingLevel": "high"
      },
      "explorer": {
        "primary": "opencode-zen/glm-5",
        "registry_alternate": "anthropic/claude-haiku-4-5",
        "thinkingLevel": "medium"
      }
    },
    "provider": {
      "anthropic": {
        "enabled": true
      }
    }
  }
}
```

`profile` allowed values: `"A"`, `"B"`, `"custom"`.

`models` object: top-level keys are role names. Only a subset of the 23 roles needs to be specified; remaining roles use the selected `profile` defaults.

`primary` and `registry_alternate` fields are whitelist-validated. `thinkingLevel` is range-validated against allowed values.

Sample partial-override JSON showing how to restore `opencode-zen/glm-5` as librarian primary under Profile B:

```json
{
  "pi-oven": {
    "profile": "B",
    "models": {
      "librarian": {
        "primary": "opencode-zen/glm-5",
        "registry_alternate": "anthropic/claude-haiku-4-5",
        "thinkingLevel": "minimal"
      }
    },
    "provider": {
      "anthropic": { "enabled": true }
    }
  }
}
```

### 7.2 Validation rules

All of the following must pass before import proceeds:

1. **JSON parse succeeds**: Parse failure outputs error and exits immediately.
2. **profile value allowed**: Must be `"A"`, `"B"`, or `"custom"`.
3. **Role name validation**: All keys in the `models` object must be one of the 23 recognized role names: executor, explorer, verifier, critic, planner, code-reviewer, debugger, test-engineer, security-reviewer, writer, designer, code-simplifier, qa-tester, git-master, document-specialist, tracer, analyst, scientist, architect, librarian, multimodal-looker, oracle, metis. Unknown role names are rejected:
   ```
   Unknown role "my-role" in models.
   Allowed roles: executor, explorer, verifier, critic, planner, code-reviewer, debugger,
     test-engineer, security-reviewer, writer, designer, code-simplifier, qa-tester,
     git-master, document-specialist, tracer, analyst, scientist, architect, librarian,
     multimodal-looker, oracle, metis
   ```
4. **Provider prefix whitelist**: All `primary` and `registry_alternate` model strings must start with an allowed prefix.
   - Always allowed: `opencode-zen/`, `openai-codex/`
   - Conditionally allowed: `anthropic/` — only when import file has `provider.anthropic.enabled: true` AND §3 detection confirms native anthropic auth.
   - All others rejected:
   ```
   "executor.primary" = "gpt-4o" rejected.
   Provider "gpt-4o" is not in the allowed list: opencode-zen/, openai-codex/, anthropic/
   ```
5. **thinkingLevel range**: When specified, must be one of `minimal`, `low`, `medium`, `high`, `xhigh`.

After validation passes, the same persist + §8 validation flow as §6 Step d-e runs.

### 7.3 Partial override behavior

When `models` specifies only some roles, remaining roles are filled from the `profile` default map:

```
Import file specifies 3 roles (executor, critic, architect).
Remaining 20 roles will use Profile B defaults.
```

When `profile` is `"custom"` and some roles are unspecified, Profile A defaults fill the gaps.

---

## §8 Validation Gate

Runs after persist in both §6 Step e and §7 import flow. Controlled via `--validate=<smoke|full|none>`.

### 8.1 Validate flag

| Flag | Behavior |
|---|---|
| `--validate=smoke` | Default. Ping only the 7 MUST-tier roles: executor, explorer, verifier, critic, planner, code-reviewer, debugger. |
| `--validate=full` | Opt-in. Ping all 23 roles. |
| `--validate=none` / `--no-validate` | Skip validation entirely. |

### 8.2 Smoke ping method

For each role being validated, run a minimal completion call against the primary model:

```bash
omp -p "Reply with the single word: ok" \
    --model <primary-model> \
    --no-tools \
    --max-tokens 5 \
    2>&1
```

Text response with no error = `verified`. Error = try `registry_alternate`.

### 8.3 Cost reference

| Scenario | Estimated cost |
|---|---|
| Profile A smoke (7 roles, glm-5/haiku tier) | < $0.001 |
| Profile B smoke (7 roles, haiku/sonnet tier) | < $0.02 |
| Profile B full (23 roles, opus/sonnet/haiku mix) | ~$0.05–$0.10 |

### 8.4 Failure handling

| Result | Verdict | Output |
|---|---|---|
| primary verified | VERIFIED | `verified` |
| primary failed, alternate verified | ALTERNATE-OK | `verified (alternate only)` |
| primary failed, alternate failed | UNVERIFIED | `UNVERIFIED` |

Any UNVERIFIED role causes exit code 1 and prompts reconfiguration.

All roles VERIFIED or ALTERNATE-OK = exit code 0.

**LLM-vs-batch failure contract**: When `bun scripts/pi-oven-setup.ts` exits with code 1, the LLM (reading the Bash tool output) treats this as a terminal failure for the current wizard flow. The LLM MUST NOT auto-retry the batch call. Instead, it presents the UNVERIFIED role list to the user and asks how to proceed (reconfigure, reset, or skip validation). Auto-retry risks silent repeated billing charges for failing smoke pings.

### 8.5 No rollback on validation failure

Validation failure does not auto-roll back persist. The user runs `/pi-oven:setup --reset` to reset explicitly, or diagnoses and re-runs after fixing auth. This preserves partial success state so the user can investigate per-role failures.

---

## §9 Persistence

The mechanism and key namespace for recording wizard choices.

### 9.1 Storage API

Uses `omp plugin config set`:

```
Usage: omp plugin config <list|get|set|delete|validate> <plugin> [key] [value]
```

Plugin name for all `omp plugin config` operations: **`pi-oven`** (matches `plugin.json` `"name"` field, matches `manager.list()` return value).

> **IMPORTANT**: Marketplace install operations use `pi-oven@pi-oven` (e.g., `omp plugin install pi-oven@pi-oven`). All `omp plugin config <verb>` operations use bare `pi-oven`. Do NOT pass `pi-oven@pi-oven` to `omp plugin config`.

Example commands:

```bash
omp plugin config set pi-oven pi-oven.profile B
omp plugin config set pi-oven "pi-oven.models.executor.primary" "anthropic/claude-sonnet-4-6"
omp plugin config set pi-oven "pi-oven.models.executor.registry_alternate" "opencode-zen/claude-sonnet-4-6"
omp plugin config set pi-oven "pi-oven.models.executor.thinkingLevel" "high"
omp plugin config set pi-oven pi-oven.provider.anthropic.enabled true
```

Storage location: `~/.omp/plugins/omp-plugins.lock.json`, `settings["pi-oven"]` object (confirmed via `manager.ts` `setPluginSetting` implementation).

### 9.2 Config key schema

```
pi-oven.profile                              "A" | "B" | "custom"
pi-oven.models.<role>.primary                "<provider>/<model-id>"
pi-oven.models.<role>.registry_alternate     "<provider>/<model-id>"
pi-oven.models.<role>.thinkingLevel          "minimal"|"low"|"medium"|"high"|"xhigh"
pi-oven.provider.anthropic.enabled           true | false
```

`<role>` is one of the 23 role names: executor, explorer, verifier, critic, planner, code-reviewer, debugger, test-engineer, security-reviewer, writer, designer, code-simplifier, qa-tester, git-master, document-specialist, tracer, analyst, scientist, architect, librarian, multimodal-looker, oracle, metis.

### 9.3 Reading config

At plugin runtime:

```bash
omp plugin config get pi-oven pi-oven.profile
omp plugin config get pi-oven "pi-oven.models.executor.primary"
omp plugin config list pi-oven
```

In `pi-oven.ts` extension code: do NOT use `pi.getPluginSettings("pi-oven")` — this method does not exist on `ExtensionAPI` (verified: `extensibility/extensions/types.d.ts:522-668`). The Layer 1 validator determines whether `anthropic/` prefix is allowed by reading the agent files themselves (§10.5 agent-file-presence signal): if any loaded agent file's `model:` array contains an `anthropic/` entry, Profile B is active and `anthropic/` is included in `ALLOWED_PREFIXES`. Plugin config can be read directly from `~/.omp/plugins/omp-plugins.lock.json` via `Bun.file()` + JSON parse when needed outside the extension context.

### 9.4 Schema declaration not required for per-role keys

`cli/plugin-cli.ts:756-772` confirms that un-schema'd keys flow through to `manager.setPluginSetting` without rejection. The `if (schema) { validate... }` block only runs when a schema declaration exists; absent schema = raw string stored directly. Spec B does NOT require declaring all 23×3 per-role keys in `plugin.json`.

`plugin.json` may optionally declare 2 top-level keys for TUI display:

```json
{
  "settings": {
    "pi-oven.profile": {
      "type": "string",
      "description": "Active provider profile (A, B, or custom)",
      "default": "A"
    },
    "pi-oven.provider.anthropic.enabled": {
      "type": "boolean",
      "description": "Enable direct Anthropic API usage (Profile B)",
      "default": false
    }
  }
}
```

The §12.1 open question regarding schema validation is resolved: un-schema'd keys are accepted.

> **Note**: The "Plugin not found" error seen in live testing (`omp plugin config list pi-oven` returns error) indicates `pi-oven` is not yet installed via `omp plugin install pi-oven@pi-oven`. Resolution: run `omp plugin install pi-oven@pi-oven` to register in the runtime config, then retry. Alternative persistence path: if `omp plugin config` API remains unavailable, fall back to direct write of `~/.omp/plugins/pi-oven-config.json` via `Bun.write`.

### 9.5 --reset behavior

`/pi-oven:setup --reset` execution:

```typescript
// Illustrative TS (actual impl in reset.ts)
await deletePluginConfig("pi-oven.profile");
await deletePluginConfig("pi-oven.provider.anthropic.enabled");

// 3 keys × 23 roles = 69 delete calls
const ROLES = [
  "executor", "explorer", "verifier", "critic", "planner", "code-reviewer",
  "debugger", "test-engineer", "security-reviewer", "writer", "designer",
  "code-simplifier", "qa-tester", "git-master", "document-specialist",
  "tracer", "analyst", "scientist", "architect", "librarian",
  "multimodal-looker", "oracle", "metis",
];
for (const role of ROLES) {
  await deletePluginConfig(`pi-oven.models.${role}.primary`);
  await deletePluginConfig(`pi-oven.models.${role}.registry_alternate`);
  await deletePluginConfig(`pi-oven.models.${role}.thinkingLevel`);
}
```

After config delete, the script also rewrites all 23 agent files back to Profile A defaults (§9.6 source-of-truth rule applies on reset too).

Completion output:

```
Config cleared. Agent files restored to Profile A defaults.
Run /pi-oven:setup to reconfigure, or /pi-oven:setup --status to verify.
```

### 9.6 Agent file in-place rewrite (source of truth)

**Source of truth: `agents/pi-oven-<role>.md` `model:` array.** omp's subagent discovery reads agent file frontmatter to determine which model to dispatch. The CI lint (`lint-agents.ts`) and Layer 1 validator also read agent files. Plugin config is wizard-state storage only — it records the user's last choice so the wizard can re-apply it.

**Wizard flow**: After `omp plugin config set` writes the per-role config, the wizard also rewrites each agent file's `model:` array to match the chosen profile. This is what makes Profile B take dispatch effect.

**File location**:
- Install cache: `~/.omp/plugins/cache/plugins/pi-oven___pi-oven___<version>/agents/pi-oven-<role>.md`
- Dev mode (`--plugin-dir`): `agents/pi-oven-<role>.md` in the working repo

The wizard detects which path applies and writes both if both exist.

**Idempotency**: The `omp plugin upgrade pi-oven@pi-oven` command overwrites cache files with repo defaults, reverting Profile B rewrites. `pi.on("plugin_upgraded", ...)` does NOT exist in the omp plugin API (verified: `extensibility/extensions/types.d.ts:531-569` lists all 39 events; no `plugin_upgraded`). The mitigation is **session_start drift detection** — on every session start, the extension reads the current agent file `model:` arrays and compares against the persisted plugin config. If they diverge, a warning is emitted. No silent rewrite is performed; the user must explicitly run `/pi-oven:setup --reapply`:

```typescript
pi.on("session_start", async (_event, ctx) => {
  // Capture active session model for CLI parent-session check (§10.5 / BLOCKER #5 fix)
  const activeModel = ctx.getModel();
  if (activeModel) {
    await fs.writeFile(
      path.resolve(os.homedir(), ".omp/plugins/pi-oven-session-model.json"),
      JSON.stringify({ model: activeModel.id, capturedAt: Date.now() }, null, 2),
    );
  }

  // Drift detection: compare agent file model arrays against plugin config
  const config = await readPluginConfig();  // reads omp-plugins.lock.json directly
  const agentFiles = await readAgentFiles(agentsDir);
  const drift = detectDrift(config, agentFiles);
  if (drift.hasDrift) {
    pi.logger.warn(
      `pi-oven: agent files drifted from plugin config. ` +
      `Run /pi-oven:setup --reapply to sync. Details: ${drift.summary}`
    );
  }
});
```

**JSON file corruption**: The `readPluginConfig()` call above treats `JSON.parse` failure as "absent" (same code path as missing file). No data loss; warning skipped gracefully.

**Drift detection algorithm**: For each of the 23 roles, hash-compare the `model:` array entries in the agent file against `pi-oven.models.<role>.primary` + `pi-oven.models.<role>.registry_alternate` in the persisted plugin config. Drift is defined as at least one role where the agent file values differ from the stored config values. The `session_start` warning fires on every pi-oven plugin load where drift exists. No auto-rewrite — user runs `/pi-oven:setup --reapply` explicitly.

**Source-of-truth rule**: plugin config write is NOT sufficient to activate Profile B. The agent file rewrite is required. Profile B is considered active only when both conditions are true:
1. `pi-oven.provider.anthropic.enabled = true` in plugin config
2. All 23 `agents/pi-oven-<role>.md` `model:` arrays reflect Profile B values

---

## §10 Implementation Details

### 10.1 File structure

```
pi-oven/
  commands/
    pi-oven-setup.md              <- slash command entry point (English prompt template)
  scripts/
    pi-oven-setup.ts              <- batch CLI (no stdin; CLI args only)
    pi-oven-setup/
      detect-auth.ts          <- parse omp --list-models, detect providers
      profiles.ts             <- Profile A/B default maps as constants (§4/§5 tables)
      whitelist.ts            <- model string whitelist validation
      persist.ts              <- omp plugin config set/delete calls + agent file rewrite
      validate.ts             <- smoke ping execution, result aggregation
      agent-rewriter.ts       <- in-place model: array update in agent files
      import.ts               <- --import <file> flow: parse, validate, apply
      status.ts               <- --status flow
      reset.ts                <- --reset flow
      apply.ts                <- --profile / --reapply flow
  tests/
    scripts/
      pi-oven-setup.test.ts       <- TDD test file (new, AC#8)
```

### 10.2 commands/pi-oven-setup.md content

`commands/pi-oven-setup.md` is an English prompt template that instructs the Claude agent to conduct the conversation-driven setup flow. The agent runs auth detection via Bash, asks the user questions in chat, collects answers, and dispatches batch CLI calls. Example template structure:

```markdown
---
name: pi-oven-setup
description: Setup wizard — provider auth detection, profile selection (A/B), per-role model override, persistence, validation
---

# /pi-oven:setup

You are running the pi-oven setup wizard. Follow these steps:

1. Run `omp --list-models 2>&1` via Bash and parse the Provider models section to detect authed providers.
2. If omp exposes active session model info, check if the parent session model prefix is in the allowed list.
3. Present auth detection results to the user in chat. Ask which profile they want (A or B). Only offer B if native `anthropic` provider was detected.
4. If Profile B selected, display the auth-fallback limitation notice and ask for confirmation.
5. Ask if the user wants per-role overrides. If yes, collect them in conversation.
6. Summarize the chosen configuration and ask for final confirmation.
7. Dispatch: `bun scripts/pi-oven-setup.ts --profile <A|B|custom> [--override <role>=<model> ...] --validate=smoke`
8. Relay the script output to the user.

For status check: run `bun scripts/pi-oven-setup.ts --status`.
For reset: run `bun scripts/pi-oven-setup.ts --reset`.
For import: run `bun scripts/pi-oven-setup.ts --import <file>`.
```

### 10.3 scripts/pi-oven-setup.ts structure

TypeScript, runs via bun. Batch-only — no stdin reads. All interaction happens in the LLM chat conversation; this script receives final decisions as CLI arguments.

```typescript
// scripts/pi-oven-setup.ts

import { parseArgs } from "node:util";
import { runImport } from "./pi-oven-setup/import.ts";
import { runStatus } from "./pi-oven-setup/status.ts";
import { runReset } from "./pi-oven-setup/reset.ts";
import { runApply } from "./pi-oven-setup/apply.ts";

const { values } = parseArgs({
  options: {
    import: { type: "string" },
    status: { type: "boolean" },
    reset: { type: "boolean" },
    profile: { type: "string" },
    override: { type: "string", multiple: true },
    validate: { type: "string", default: "smoke" },
    "no-validate": { type: "boolean" },
    "confirm-auth": { type: "boolean" },
    reapply: { type: "boolean" },
  },
  strict: false, // allows --override <role>=<model> repeated (multiple: true)
});

const validateMode = values["no-validate"] ? "none" : (values.validate as string);

// Dispatch precedence: --status > --reset > --import > default --apply (--profile / --reapply)
if (values.status) {
  await runStatus();
} else if (values.reset) {
  await runReset();
} else if (values.import) {
  await runImport(values.import, validateMode);
} else if (values.profile || values.reapply) {
  await runApply({ profile: values.profile, overrides: values.override, validateMode });
} else {
  console.error("No action specified. Use --profile, --status, --reset, --import, or --reapply.");
  process.exit(1);
}
```

Key internal modules:

- `pi-oven-setup/detect-auth.ts` — parse `omp --list-models`, detect providers
- `pi-oven-setup/profiles.ts` — Profile A/B default maps as constants (§4/§5 tables in code)
- `pi-oven-setup/whitelist.ts` — model string whitelist validation
- `pi-oven-setup/persist.ts` — `omp plugin config set/delete` calls + agent file rewrite
- `pi-oven-setup/validate.ts` — smoke ping execution, result aggregation
- `pi-oven-setup/agent-rewriter.ts` — in-place `model:` array update in agent files

### 10.4 omp plugin config call pattern

`persist.ts` uses child process calls:

```typescript
import { spawnSync } from "node:child_process";

export function setPluginConfig(key: string, value: string): void {
  const result = spawnSync("omp", ["plugin", "config", "set", "pi-oven", key, value], {
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf-8",
  });
  if (result.status !== 0) {
    throw new Error(`omp plugin config set failed: ${result.stderr}`);
  }
}

export function deletePluginConfig(key: string): void {
  const result = spawnSync("omp", ["plugin", "config", "delete", "pi-oven", key], {
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf-8",
  });
  if (result.status !== 0) {
    throw new Error(`omp plugin config delete failed: ${result.stderr}`);
  }
}
```

### 10.5 pi-oven.ts Layer 1 modification required

> **Note**: §10.6 below documents the Spec A packaging prerequisite that must be completed before the §10.5 agent-file-presence signal can function for installed users.



**Current state**: `.omp/extensions/pi-oven.ts` lines 6-10 unconditionally include `"anthropic/"` in `ALLOWED_PREFIXES`. This contradicts Spec A §6.2 hard whitelist (anthropic is opt-in only).

**Required change**: Spec B implementation MUST modify `pi-oven.ts` to compute `ALLOWED_PREFIXES` dynamically. `pi.getPluginSettings` does NOT exist on `ExtensionAPI` (verified: `extensibility/extensions/types.d.ts:522-668`). Instead, use the **agent-file-presence signal** (option c): read the agent files that `pi-oven.ts` already has access to, and check whether any `model:` array entry already starts with `anthropic/`. If yes, Profile B is active by definition — the wizard writes agent files first, so files are the ground truth (§9.6 source-of-truth rule).

```typescript
// .omp/extensions/pi-oven.ts (validator logic)
async function getAllowedPrefixes(agentFiles: AgentFileEntry[]): Promise<string[]> {
  const base = ["opencode-zen/", "openai-codex/"];
  // If ANY agent file already has anthropic/* in its model array, Profile B is active.
  // Agent file is canonical per §9.6; plugin config is secondary wizard-state storage.
  const anthropicEnabled = agentFiles.some(a =>
    a.modelArray.some(m => m.startsWith("anthropic/"))
  );
  return anthropicEnabled ? [...base, "anthropic/"] : base;
}
```

The `validateAgentRegistry` function passes the loaded agent file entries to `getAllowedPrefixes`. The validator is effectively "agent files define their own validity": the allowed-prefix set is computed per-load from the files themselves, not from a plugin config read. Before `/pi-oven:setup` activates Profile B (which rewrites agent files), no `anthropic/` entries exist, so `ALLOWED_PREFIXES` correctly excludes `anthropic/`. After Profile B activation, agent files contain `anthropic/` entries and the prefix is automatically permitted.

If Profile B is not yet active, agent files referencing `anthropic/`-prefixed model strings emit "WHITELIST VIOLATION" errors in validation. This is the intended behavior.

This acknowledged contradiction with the currently-committed `pi-oven.ts` is fixed during Spec B implementation.

### Race window analysis (during --reset rewrite)

The Profile B → Profile A rewrite is per-file. If `getAllowedPrefixes` runs mid-rewrite (e.g., a parallel session loading the plugin), it observes some files with `anthropic/*` and some without. Result: prefix list is the SUPERSET ([base, anthropic]). This is **self-consistent**: anthropic prefix only relaxes validation, never tightens. A partial-rewrite race window never produces false WHITELIST VIOLATION errors.

### Extension code path for agentFiles

The extension entrypoint resolves agents dir via `path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "agents")`. In dev mode (`--plugin-dir`), this is `<repo-root>/agents/`. In claude-plugin install mode, this is `<cache-path>/agents/` (e.g., `~/.omp/plugins/cache/plugins/pi-oven___pi-oven___0.1.0/agents/`). Spec A §13.3 `validateAgentRegistry` already implements this resolution; Spec B reuses it.

### 10.6 Spec A packaging prerequisite (BLOCKER #3 / #4 fix)

### Precondition: install cache populated

omp install (`extensibility/plugins/marketplace/cache.ts:79`) copies the entire plugin tree recursively via `fs.cp(sourcePath, stagingPath, { recursive: true })`. Agent discovery follows directory convention: `task/discovery.ts:100` reads `<plugin.path>/agents/*.md` directly. `.claude-plugin/plugin.json` has NO `agents` field (verified `discovery/claude-plugins.ts:31-35`).

After the b4b5407 commit (which added 23 `agents/pi-oven-*.md` files to the repo), users must reinstall to populate their cache:

```bash
omp plugin install pi-oven@pi-oven --force
```

Wizard precondition `checkAgentsCachePopulated()` (below) gates this — if the cache `agents/` directory contains fewer than the expected count (read from `EXPECTED_AGENT_COUNT` in `pi-oven-setup/profiles.ts`, NOT hardcoded), the wizard refuses with a clear remediation message.

**Cross-spec note**: Spec A's `.claude-plugin/plugin.json` line 18 `"agents": []` is INERT (no schema field exists). It should be REMOVED in a subsequent Spec A cleanup, but its presence has no functional effect; this Spec B revision treats removal as out-of-scope NIT for Spec A.

**Wizard precondition check** (runs at startup in `scripts/pi-oven-setup.ts`):

`pi-oven-setup/profiles.ts` declares the expected agent count as a named constant (single SoT):

```typescript
// pi-oven-setup/profiles.ts
export const EXPECTED_AGENT_COUNT = 23;  // matches Spec A §4 taxonomy
```

```typescript
import { EXPECTED_AGENT_COUNT } from "./pi-oven-setup/profiles.ts";

async function checkAgentsCachePopulated(): Promise<{ ok: boolean; cachePath: string }> {
  const cacheRoot = path.resolve(os.homedir(), ".omp/plugins/cache/plugins");
  const dirs = await fs.readdir(cacheRoot).catch(() => [] as string[]);
  const piOvenCacheDir = dirs.find(d => d.startsWith("pi-oven___pi-oven___"));
  if (!piOvenCacheDir) return { ok: false, cachePath: "(no pi-oven install cache)" };
  const agentsPath = path.join(cacheRoot, piOvenCacheDir, "agents");
  const files = await fs.readdir(agentsPath).catch(() => [] as string[]);
  const piOvenAgents = files.filter(f => f.startsWith("pi-oven-") && f.endsWith(".md"));
  return { ok: piOvenAgents.length >= EXPECTED_AGENT_COUNT, cachePath: agentsPath };
}
```

If the check fails, the wizard outputs and exits:

```
pi-oven plugin agent files not in install cache (found <N> at <path>).
Run: omp plugin install pi-oven@pi-oven --force
Or use dev mode: omp --plugin-dir /path/to/pi-oven
```

**Version discovery algorithm** (BLOCKER #4 fix): The cache version segment changes on every `omp plugin upgrade`. The wizard uses glob-and-sort rather than a hardcoded version:

```typescript
function compareSemver(a: string, b: string): number {
  const pa = a.split(".").map((n) => parseInt(n, 10));
  const pb = b.split(".").map((n) => parseInt(n, 10));
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const va = pa[i] ?? 0;
    const vb = pb[i] ?? 0;
    if (va !== vb) return va - vb;
  }
  return 0;
}
```

```typescript
async function resolveCacheAgentsDir(): Promise<string | null> {
  const cacheRoot = path.resolve(os.homedir(), ".omp/plugins/cache/plugins");
  const dirs = await fs.readdir(cacheRoot).catch(() => [] as string[]);
  const piOvenDirs = dirs.filter(d => d.startsWith("pi-oven___pi-oven___"));
  if (piOvenDirs.length === 0) return null;
  // Pick latest installed version by semver sort (descending)
  piOvenDirs.sort((a, b) => {
    const va = a.split("___")[2] ?? "0.1.0";
    const vb = b.split("___")[2] ?? "0.1.0";
    return compareSemver(vb, va);
  });
  return path.join(cacheRoot, piOvenDirs[0], "agents");
}
```

After every `omp plugin upgrade pi-oven@pi-oven`, the cache version segment changes and the new agent files revert to Profile A defaults. The `session_start` drift-detection handler (§9.6) emits a warning at the next session start. The user runs `/pi-oven:setup --reapply` to re-sync agent files with the persisted plugin config.

**AC#10** (new): After `omp plugin upgrade pi-oven@pi-oven` from v0.1.0 to a future version, the next omp session emits the drift warning (`pi-oven: agent files drifted from plugin config`). Running `/pi-oven:setup --reapply` restores Profile B agent file state. `/pi-oven:setup --status` confirms Profile B active with no drift.

---

## §11 Acceptance Criteria

Verifiable conditions for wizard implementation completion.

**AC#1**: `/pi-oven:setup --status` on a fresh install (no `pi-oven.*` keys in omp plugin config, plugin installed via `omp plugin install pi-oven@pi-oven`) outputs:
```
Profile not configured. Run /pi-oven:setup to initialize.
```
If `pi-oven` plugin is not found by `omp plugin config`, wizard handles "Plugin not found" gracefully with a clear message: `pi-oven plugin not registered. Run: omp plugin install pi-oven@pi-oven`.

**AC#2**: The conversation-driven flow (`/pi-oven:setup`) completes end-to-end. LLM asks profile question in chat, user answers, LLM dispatches `bun scripts/pi-oven-setup.ts --profile A --validate=smoke`. After completion, `bun scripts/pi-oven-setup.ts --status` shows Profile A active and 7 MUST-tier roles verified.

**AC#3**: `/pi-oven:setup --import <valid.json>` — a JSON file matching §7.1 schema passes whitelist validation, triggers persist + validation, and `/pi-oven:setup --status` accurately reflects the imported config.

**AC#4**: `/pi-oven:setup --import <invalid.json>` — a file with `"executor": { "primary": "gpt-4o" }` is rejected with an error listing allowed prefixes. Persist is not executed.

**AC#5**: `/pi-oven:setup --reset` followed by `omp plugin config list pi-oven` shows no `pi-oven.*` keys. `/pi-oven:setup --status` outputs "Profile not configured".

**AC#6**: After `/pi-oven:setup` selects Profile B and completes, `cat agents/pi-oven-executor.md | head` shows the `model:` array starting with `anthropic/claude-sonnet-4-6`. This confirms the agent file in-place rewrite (§9.6) is working.

**AC#7**: When Profile B is configured but `omp --list-models` no longer shows native `anthropic` provider, `/pi-oven:setup --status` outputs:
```
Profile B is configured but Anthropic auth is not detected.
Warning: pi-oven subagents using anthropic/* models will fall back to parent session model.
Run /pi-oven:setup to reconfigure, or /pi-oven:setup --reset to return to Profile A defaults.
```
Auth-state detection runs on every Step a auth-check (i.e., every `/pi-oven:setup` flow invocation and every `--status` call). `--status` is one of several triggers; the full `/pi-oven:setup` conversation flow also runs Step a auth detection at the start.

**AC#8**: `tests/scripts/pi-oven-setup.test.ts` covers:
- Profile A defaults exactly match §4 table (snapshot)
- Profile B defaults exactly match §5 table (snapshot) — including `explorer` and `librarian` as `opencode-zen/glm-5` primary
- `anthropic/` prefix model rejected when anthropic not authed (whitelist enforcement)
- Profile B selection without anthropic auth detected: wizard refuses and outputs clear error
- Role override input merges with profile defaults and sets `pi-oven.profile = "custom"`
- Smoke ping failure on primary + alternate: UNVERIFIED verdict + exit code 1
- `--reset` deletes all `pi-oven.*` keys and restores agent files to Profile A; `--status` returns "not configured"
- cache-empty precondition: when `agents/` cache directory is empty/missing, wizard exits with clear remediation message.
- session_start drift handler: agent file `model:` array != plugin config map → warning emitted at session start.
- `resolveCacheAgentsDir` empty: no `pi-oven___pi-oven___*` dir → returns null + wizard reports.
- `resolveCacheAgentsDir` multi-version: cache has `___0.1.0` + `___0.1.0` → picks `___0.1.0` (latest).

---

## §12 Open Questions / Risks

### §12.1 omp plugin config set — un-schema'd key behavior

**Resolved**: `cli/plugin-cli.ts:756-772` confirms un-schema'd keys are accepted. `manager.ts:438-458` `setPluginSetting` accepts arbitrary keys without schema validation. The 23×3 per-role config keys do not require `plugin.json` schema declaration.

**Remaining blocker**: Live testing shows "Plugin not found" when `omp plugin config list pi-oven` is run. Root cause: `pi-oven` plugin installed as claude-plugin (`~/.omp/plugins/installed_plugins.json`) but not in omp plugin manager's runtime config (`omp-plugins.lock.json`). Fix: `omp plugin install pi-oven@pi-oven` registers in runtime config. Note: marketplace install ops use `pi-oven@pi-oven`; all `omp plugin config <verb>` ops use bare `pi-oven`.

### §12.2 Slash command execution model

**Resolved** (from CRITICAL #1 fix): `commands/pi-oven-setup.md` is a markdown prompt template only. No subprocess stdin path exists for markdown slash commands. The interactive Q&A is LLM-driven (chat turns), not subprocess stdin. `scripts/pi-oven-setup.ts` is batch-only. This is the canonical UX documented in §2 and §6.

### §12.3 anthropic/claude-sonnet-4-7 model ID

**Known Limitation (resolved)**: `anthropic/claude-sonnet-4-7` is absent from live `omp --list-models`. This spec uses `anthropic/claude-sonnet-4-6` throughout Profile B for all roles that would otherwise use sonnet-4-7. This is a deliberate conservative choice: spec uses only confirmed live model IDs. When `claude-sonnet-4-7` becomes available in `omp --list-models`, upgrade executor, verifier, planner, debugger, test-engineer, designer, qa-tester, document-specialist, tracer, and multimodal-looker primaries accordingly.

### §12.4 Parent session model detection

**Resolved**: `omp --status` does not exist. `omp --help` has no `--status` flag. The active session model is accessible only via `ctx.getModel()` inside an extension event handler. The `session_start` handler (§9.6) writes `~/.omp/plugins/pi-oven-session-model.json` at each session start, and §6 Step a.5 reads that file. If absent or stale (>1 hour), the check is skipped gracefully. This is not a gap — parent session detection works automatically via the session_start file capture.

### §12.5 Plugin upgrade hook

**Resolved**: `pi.on("plugin_upgraded", ...)` does not exist. Verified: `extensibility/extensions/types.d.ts:531-569` lists all 39 `pi.on()` events; no `plugin_upgraded` event exists. Plugin upgrade runs out-of-band with no active session. The mitigation is the `session_start` drift detection in §9.6: the next session after an upgrade emits a warning and prompts the user to run `/pi-oven:setup --reapply`. No auto-rewrite is performed.
