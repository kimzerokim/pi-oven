# Plan — feature/simplify: safe off-spine prune (v0.1.0 → v0.1.0-dev)

> Status: in progress on `feature/simplify` (branched from `main` @ v0.1.0).
> Authority: `pi-oven-bloat-audit` workflow (run `wf_4d9a769e-e65`, 33 agents, adversarial-verified).
> Scope decision (user, 2026-05-29): **safe prune only** (~4 items) + **subtraction only** (gaps deferred). Push deferred.

## Why (audit bottom line)

The set is **less bloated than it feels**. A first-pass synthesis flagged ~13–16 cut/merge
candidates (~25–30%), but adversarial refutation against the **actual dispatch wiring** (spine
skills that name agents directly) knocked all aggressive cuts back to `keep`:
- `security-reviewer` — autonomous-loop Phase 4 mandatory approver + pre-commit-gate security gate.
- `code-simplifier` — dispatched by name from pre-commit-gate Gate 1 + autonomous-loop deslop.
- `oracle` — escalation target in 4 discipline skills; Bash-enabled hard-debug that `critic` (Bash-blocked) can't replace.
- `architect` — UC3 HTML deliverable (improve-codebase-architecture) + UC1 spec authoring (autonomous-loop).
- `librarian`/`document-specialist` — spec-and-review dispatches **both** as distinct agents in one flow.
- `tracer`/`analyst` — distinct output contracts wired into spine flows.
- `deep-dive`, `improve-codebase-architecture`, `receiving-code-review` — distinct, on UC spines.

Only **4 items** survived as genuinely safe to remove (no use-case spine, adversary conceded):

| Item | Action | Evidence |
|---|---|---|
| `caveman` (skill) | delete | token-compression UX; no use case depends on it (verdict: safe-to-cut) |
| `eval-runner` (skill) | delete | plugin-self-dev CI tooling, not an end-user workload (verdict: safe-to-cut) |
| `pi-oven:scientist` (agent) | fold into `pi-oven:analyst` | no use case requires an experiment deliverable (verdict: merge-ok) |
| `team` (skill) | delete (folded) | subagent-driven-development + autonomous-loop cover parallel dispatch (verdict: merge-ok) |

**The bigger finding is a coverage hole, not bloat** (deferred to a follow-up spec, NOT this branch):
- 🔴 UC5 (Bitbucket Pipelines + AWS prod read) ≈ 0% covered — no cloud/CI connector in-inventory.
- 🟡 UC4 release-orchestration (version bump / tag / changelog / multi-manifest SoT) — no agent verb.
- 🟡 UC3 general HTML deliverable generator; UC1/UC2 project-wide regression gate (tdd-strict = touched files only).

**Borderline, NOT cut** (adversary kept; revisit only if user confirms they never author UI):
`pi-oven:designer` + `pi-oven:multimodal-looker` (UI authoring — the 5 use cases only *verify* UI via Playwright).
`/pi-oven:setup` + `/pi-oven:doctor` kept (install tooling load-bearing for the heterogeneous-model config; doctor is a real 520-line impl, not a stub).

## Exact edit list

### A. Deletions
- `rm -rf skills/caveman/`
- `rm -rf skills/eval-runner/`   ← **skill dir ONLY**. KEEP the eval *infrastructure*: `scripts/lib/eval-runner.ts`, `scripts/run-eval.ts`, `tests/scripts/eval-runner.test.ts`, doctor check #9, `bun run eval` (all independently referenced).
- `rm -rf skills/team/`
- `rm agents/pi-oven-scientist.md`

### B. `scripts/pi-oven-setup/profiles.ts`
- ROLES array: remove `"scientist",` (line ~26).
- `EXPECTED_AGENT_COUNT`: `23` → `22`.
- PROFILE_A: remove the `scientist: { … }` entry (lines ~142–146).
- PROFILE_B: remove the `scientist: { … }` entry (lines ~266–270).
- Docstring line ~50: `scientist/architect/metis = gpt-5.4` → `architect/metis = gpt-5.4`.
- Docstring line ~54 provider mix: `openai-codex 6` → `openai-codex 5` (scientist was the gpt-5.4 codex primary). Re-verify the other counts after edit.

### C. `.claude-plugin/plugin.json`
- Remove these 3 entries from the `skills` array: `"./skills/caveman/SKILL.md"`, `"./skills/eval-runner/SKILL.md"`, `"./skills/team/SKILL.md"`. Result: **17** skills.

### D. `.claude-plugin/marketplace.json`
- Remove the `"team-mode"` tag from the `tags` array (no longer ships a team skill; parallel orchestration remains via sdd/autonomous-loop).

### E. `pi-oven:scientist` fold into `pi-oven:analyst`
- `agents/pi-oven-analyst.md` line ~19: drop `hypothesis-driven experimentation (pi-oven:scientist)` from the "NOT responsible for" list.
- `agents/pi-oven-analyst.md` line ~64: replace the `pi-oven:scientist's lane` exclusion with an **absorbed capability** — analyst may design falsifiable checks / state H₁ vs H₀ and flag what an experiment would confirm, in addition to descriptive analysis. Keep model-fit prose coherent (analyst = kimi-k2.6).
- `skills/spec-and-review/SKILL.md` line ~121: `dispatch \`pi-oven:scientist\`` → `dispatch \`pi-oven:analyst\`` (experiment-style falsifiability verification).

### F. Count-assertion tests (update to new baseline; TDD — adjust expected values, keep behavior assertions)
- `tests/plugin/skill-count.test.ts`: `toBe(20)` → `toBe(17)`.
- `tests/plugin/pi-oven-doctor.test.ts`: skills `20/20` → `17/17` (lines ~129/131); skill mismatch case `19/20` → `16/17` (lines ~135/137); agents `23/23` → `22/22` (lines ~147/148, ~159, ~264/265); agent mismatch case `22 vs 23` → `21 vs 22` (lines ~153/155).
- `tests/scripts/pi-oven-setup/profiles.test.ts`: `EXPECTED_AGENT_COUNT … toBe(23)` → `22`; "contains all 23 roles" → 22 (lines ~24, ~29, ~61).
- `tests/scripts/pi-oven-setup/agent-rewriter.test.ts`: `length).toBe(23)` → `22` (line ~231); "Only create 3 of the 23" → recompute `skipped.length` (22 total − 3 created = `19`) at line ~253; update the "23"/"20" prose.
- `tests/scripts/pi-oven-setup/import.test.ts`: "enumerates all 23 allowed roles" → 22 (lines ~119/135).
- `tests/scripts/pi-oven-setup/validate.test.ts`: "pings all 23 roles" / "23 pings" → 22 (lines ~105/114).
- Sweep `tests/` for any other `23`/`20` role/skill-count literal introduced by the registry; only adjust count expectations, never weaken behavior checks.

### G. Docs freshness (live docs only — do NOT edit historical cycle logs under `docs/harness/`)
- `CLAUDE.md`: Layout row "15 skills" → 17; agent count 23 → 22; PROFILE_A model-map table — remove `scientist` from the `gpt-5.4` row (leaving `architect, metis`); Commands "bun test # 195 pass" → current count; correct stale Status items (doctor is implemented, not a stub; Plan 3 runtime is implemented). Note the prune + deferred gaps.
- `README.md`: line 12 skills list (drop `team`, `eval-runner`; "15 skills" → 17); line 93 trigger row (drop `team`); line 172 skills table (drop `team` row); agent count 23 → 22; drop any `scientist` agent row.
- `docs/site/skill-flow.ko.html`: remove the `caveman` / `team` / `eval-runner` skill cards + nav entries; update the count badge. (Cosmetic site map — lower priority; fine to do in the same docs pass.)

## Verification (fresh agent, separate context)
1. `bun run check` → clean. `bun test` → all pass (was 336). `bun run lint:agents` + `bun run lint:skills` → clean. `bun run build` → succeeds.
2. Functional-dir grep returns **zero** refs to: `caveman`, the eval-runner **skill** (`skills/eval-runner`), the `scientist` **role**, the `team` **skill** (`skills/team`). (Eval *infra* refs — `scripts/lib/eval-runner`, `run-eval` — are expected and OK.)
3. `plugin.json` skills array length == 17; `profiles.ts` ROLES length == 22; no dangling `pi-oven:scientist` token in any `SKILL.md`.
4. No source file deletion beyond the 4 targets; eval infrastructure intact.

## Out of scope (deferred)
- UC5 ops connector (Bitbucket/AWS), UC4 release-orchestration, UC3 HTML generator, project-wide regression gate — separate spec.
- UI-authoring agents (`designer`, `multimodal-looker`) — kept; revisit on explicit user confirmation.
- PROFILE_B redefinition — still deferred (separate user decision).
