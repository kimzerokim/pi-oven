# Plan — /pi-oven:setup language selection + per-project default language

> Branch: main. Feature for the next release (bump decided with user after verify).
> Goal: `/pi-oven:setup` asks primary language (KO/EN) FIRST, conducts the rest of setup in that
> language, and persists a per-project default language that pi-oven agents honor at runtime.

## Design (verified against current arch)

**Flow (commands/pi-oven-setup.md):** insert **Step 0 — primary language** before the current Step 1.
- Use the **`pi-oven_ask`** tool (shipped 0.1.0) with two options, each with a description:
  - `한국어 (Korean)` — "셋업 대화 + 이후 에이전트 응답을 한국어로"
  - `English` — "Setup dialog + agent responses in English"
  - recommended index = whichever; user picks.
- Persist via a new dispatch: `bun scripts/pi-oven-setup.ts --language <ko|en>`.
- **Conduct Steps 1–6 in the chosen language** (the LLM renders all prompts/summaries in KO or EN).

**Persistence (per-project, machine-local):** `<cwd>/.pi-oven/config.json`
```json
{ "language": "ko" | "en" }
```
- Mirrors the existing `.pi-oven/state/` (FSM) the extension already roots at `repoRoot/.pi-oven`.
- Ensure `.pi-oven/` is gitignored (machine-local, like model overrides — not committed).
- This is the **project default language** for the project where setup runs.

**Consumption (runtime injection):** `.omp/extensions/pi-oven.ts` reads `<repoRoot>/.pi-oven/config.json`
at load → `injector.setLanguage(lang)`. `RulesInjector` injects a language directive into the
system prompt every turn via the existing `before_agent_start` path (separate dedup key from the
discipline block).
- **KO directive:** "주요 응답 언어는 한국어입니다. 모든 사용자 대면 출력/메시지/설명/피드백을 한국어로. 코드/식별자/문자열 리터럴/로그는 원문 유지."
- **EN directive:** "Primary response language is English. All user-facing output in English; code/identifiers/string literals stay as-is."
- **CRITICAL refinement (do NOT impose a default):** if `.pi-oven/config.json` is ABSENT or has no
  valid `language`, inject **NOTHING** for language (respect the project/global ambient setting, e.g.
  a user's own CLAUDE.md "respond in Korean"). Only inject when explicitly set via setup.

## Exact edits

### 1. `scripts/pi-oven-setup/project-config.ts` (NEW)
- `export type ProjectLanguage = "ko" | "en";`
- `setProjectLanguage(lang: ProjectLanguage, opts?: { cwd?: string }): Promise<void>` — writes `{language}` to `<cwd>/.pi-oven/config.json` (mkdir -p; preserve any other keys if file exists by read-merge).
- `readProjectLanguage(opts?: { cwd?: string }): Promise<ProjectLanguage | null>` — returns the language or `null` if absent/invalid. (Pure-ish, testable.)
- Normalize input: accept `ko/KO/korean/한국어` → `"ko"`, `en/EN/english` → `"en"`; else throw.

### 2. `scripts/pi-oven-setup.ts`
- Add `--language` to `parseArgs` options (`{ type: "string" }`).
- Add a dispatch branch: if `values.language` set → validate ∈ {ko,en} (after normalize) → `await setProjectLanguage(lang)` → print confirmation; exit 0. (Place before/independent of the profile-apply path so `--language` can run standalone.)

### 3. `.omp/extensions/pi-oven-runtime/rules-injector.ts`
- Add private `#language: ProjectLanguage | null = null;` + `setLanguage(lang: ProjectLanguage | null): void`.
- `buildLanguageDirective(): string | null` — returns the KO/EN directive block tagged with dedup key `pi-oven:language` (NOT version-keyed, so re-injection dedups), or `null` when `#language` is null.
- `applyToSystemPrompt`: after the discipline block, if `buildLanguageDirective()` is non-null AND no existing `pi-oven:language` marker present → append it. (Keep discipline-block behavior unchanged.)

### 4. `.omp/extensions/pi-oven.ts`
- At load (near `const injector = new RulesInjector()`), read `<repoRoot>/.pi-oven/config.json` sync (fail-open): parse `language`; if `"ko"|"en"` → `injector.setLanguage(lang)`; else leave null. Log at debug.
- No change to the `before_agent_start` handler shape (it already calls `injector.applyToSystemPrompt`).

### 5. Docs
- `commands/pi-oven-setup.md`: add Step 0 + the `--language` dispatch + note "conduct remaining steps in chosen language"; add `/pi-oven:setup` reference row if a table exists.
- `README.md`: `/pi-oven:setup` section — mention Step 0 language pick + per-project default-language behavior. (No skill/agent count change.)
- `CHANGELOG.md`: prepend the next-version entry (version TBD with user).

### 6. Tests
- NEW `tests/scripts/pi-oven-setup/project-config.test.ts`: set→read symmetry; absent→null; invalid→throw; normalize variants; preserve other keys.
- Append to `tests/extensions/pi-oven-runtime/rules-injector.test.ts`: KO directive contains 한국어 + dedup key; EN directive English; null language → no language block injected; dedup (no double-inject); coexists with discipline block.
- Append to `tests/scripts/pi-oven-setup-cli.test.ts`: `--language ko` writes `.pi-oven/config.json` with `"ko"`; invalid language → non-zero exit.

## Constraints / guardrails
- Skill/agent bodies stay English-only (this sets RESPONSE language, not body language).
- Additive + fail-open (absent config → no behavior change). Smallest viable diff.
- `.pi-oven/` gitignored (no machine-local config committed).

## ALSO FIX — command script-path bug (global install)

**Bug (user-reported):** commands dispatch `bun scripts/<x>.ts` with a path RELATIVE to cwd. When pi-oven
is installed globally, `/pi-oven:setup` runs in the user's project (cwd ≠ plugin dir) → `Module not found
"scripts/pi-oven-setup.ts"`. The script lives at `~/.omp/plugins/cache/plugins/pi-oven___pi-oven___<version>/scripts/`.
omp does NOT substitute a plugin-root var into command templates, so the fix is in the command text:
resolve the plugin script dir robustly (dev repo OR global install).

**Affected:** commands/pi-oven-setup.md (many), pi-oven-doctor.md (pi-oven-doctor.ts, run-eval.ts), pi-oven-release.md
(pi-oven-release/index.ts), pi-oven-autonomous.md (lint-skills.ts) — every bare `bun scripts/...` ref.

**Fix — canonical resolver each command instructs the LLM to use (dev cwd → installed_plugins.json → cache glob):**
```bash
PI_OVEN_DIR="$PWD"
if [ ! -f "$PI_OVEN_DIR/scripts/pi-oven-setup.ts" ]; then
  PI_OVEN_DIR="$(jq -r '.plugins["pi-oven@pi-oven"][0].installPath // empty' "$HOME/.omp/plugins/installed_plugins.json" 2>/dev/null)"
  [ -z "$PI_OVEN_DIR" ] && PI_OVEN_DIR="$(ls -d "$HOME"/.omp/plugins/cache/plugins/pi-oven___pi-oven___*/ 2>/dev/null | sort -V | tail -1)"
fi
bun "${PI_OVEN_DIR%/}/scripts/pi-oven-setup.ts" <args>
```
Replace every bare `bun scripts/<x>.ts` dispatch with `bun "${PI_OVEN_DIR%/}/scripts/<x>.ts"` (define PI_OVEN_DIR
once per command). Keep the batch-only / "don't run from inside the prompt" guidance. Markdown-only.

## Verification
0. Commands contain NO bare `bun scripts/<x>.ts` dispatch — every dispatch uses resolved `$PI_OVEN_DIR`; resolver works dev + global.
1. `bun run build` + `bun run check` clean; `bun test` all pass (new tests included).
2. `bun run lint:agents` + `lint:skills` clean.
3. `.pi-oven/config.json` not tracked (gitignored). No real config committed.
4. Confirm: with `{language:"ko"}` the injector emits the KO directive; with no config it emits NO language block (ambient respected).
