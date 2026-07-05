# External Harness Comparison for pi-oven (2026-07-04)

## Scope
Compared repositories under `/Users/kimzerokim/work/personal/external_harness`, excluding `oh-my-pi`, with emphasis on `gajae-code`, `oh-my-claudecode`, `oh-my-openagent`, `ECC`, `skills`, and `superpowers`.

- Strategic context: current fixed choice is `pi-oven-first 재설계`; this comparison only keeps evidence that informs that direction.

## Release context
| Repo | Newest observed tag | Release context | Manifest / runtime context |
| --- | --- | --- | --- |
| gajae-code | `v0.8.1` | `2026-07-04 chore: bump version to 0.8.1` | `packages/coding-agent/CHANGELOG.md` still starts at `0.6.1` (`/Users/kimzerokim/work/personal/external_harness/gajae-code/packages/coding-agent/CHANGELOG.md:1-6`) |
| oh-my-claudecode | `v4.15.2` | `2026-07-03 v4.15.2` | package version aligns (`/Users/kimzerokim/work/personal/external_harness/oh-my-claudecode/package.json:1-18`) |
| oh-my-openagent | `v4.15.1` | `2026-07-01 Merge pull request #5807 from code-yeongyu/release/v4.15.1-source-state` | package.json says `4.5.1` (`/Users/kimzerokim/work/personal/external_harness/oh-my-openagent/package.json:1-6`) |
| ECC | `v2.0.0` | `2026-06-09 ECC 2.0.0 — the agent harness operating system` | package version aligns (`/Users/kimzerokim/work/personal/external_harness/ECC/package.json:1-16`) |
| skills | `v1.0.1` | `2026-06-17 v1.0.1` | package version aligns (`/Users/kimzerokim/work/personal/external_harness/skills/package.json:1-14`) |
| superpowers | `v6.1.1` | `2026-07-02 Release v6.1.1` | plugin/runtime versions align (`/Users/kimzerokim/work/personal/external_harness/superpowers/.claude-plugin/plugin.json:1-10`) |

## Per-repo findings

### gajae-code
**Observations**
- Strongest directly transferable deep-interview stack.
- Deep interview is implemented as a coordinated skill + ask UI + render middleware + runtime/state model.
- Team runtime exists, but is much heavier than the interview UX/runtime pieces.

**Evidence**
- Contract: threshold resolution, Round 0 topology gate, weakest-dimension targeting, bidirectional ambiguity, closure/restatement gates, explicit approval handoff (`/Users/kimzerokim/work/personal/external_harness/gajae-code/packages/coding-agent/src/defaults/gjc/skills/deep-interview/SKILL.md:79-161`, `:181-307`, `:317-483`, `:486-696`).
- Ask UX: recommended option suffix, inline `Other`, question-local scroll via wheel/PgUp/PgDn, auto-select on timeout, headless `workflow_gate`, and structured `deepInterview` metadata (`/Users/kimzerokim/work/personal/external_harness/gajae-code/packages/coding-agent/src/tools/ask.ts:104-145`, `:202-420`, `:557-726`).
- Render middleware parses threshold, topology, round headers, and progress tables into specialized TUI blocks (`/Users/kimzerokim/work/personal/external_harness/gajae-code/packages/coding-agent/src/deep-interview/render-middleware.ts:1-140`).
- Runtime/state split: CLI seed + persist in `deep-interview-runtime.ts`; durable round identity and merge semantics in `deep-interview-state.ts` (`/Users/kimzerokim/work/personal/external_harness/gajae-code/packages/coding-agent/src/gjc-runtime/deep-interview-runtime.ts:171-229`, `:389-523`; `/Users/kimzerokim/work/personal/external_harness/gajae-code/packages/coding-agent/src/gjc-runtime/deep-interview-state.ts:18-223`).
- Residual ancestry still visible: `source: "forked from upstream deep-interview skill and rebranded for GJC"` and `PI_*` config fallbacks remain in runtime (`/Users/kimzerokim/work/personal/external_harness/gajae-code/packages/coding-agent/src/defaults/gjc/skills/deep-interview/SKILL.md:9`; `/Users/kimzerokim/work/personal/external_harness/gajae-code/packages/coding-agent/src/gjc-runtime/deep-interview-runtime.ts:200-229`).

**Candidate opportunities**
- Port the interview contract, ask metadata, and render model into pi-oven-native primitives.
- Do not port the 4k+ team runtime wholesale (`/Users/kimzerokim/work/personal/external_harness/gajae-code/packages/coding-agent/src/gjc-runtime/team-runtime.ts:1-300`).

### oh-my-claudecode
**Observations**
- Strong naming and loop engineering around orchestration stages.
- Operational surface is split across plugin and CLI/runtime tracks.

**Evidence**
- Canonical team pipeline: `team-plan → team-prd → team-exec → team-verify → team-fix` (`/Users/kimzerokim/work/personal/external_harness/oh-my-claudecode/CLAUDE.md:51-54`).
- Workflow registry and tool split (`/Users/kimzerokim/work/personal/external_harness/oh-my-claudecode/CLAUDE.md:33-49`).
- Dual-track install/update burden (`/Users/kimzerokim/work/personal/external_harness/oh-my-claudecode/package.json:1-31`; release-note text observed at `release-notes.md:3-17`).

**Candidate opportunities**
- Reuse stage naming and verify/fix-loop concepts.
- Avoid dual plugin + CLI dependency in pi-oven.

### oh-my-openagent
**Observations**
- Best compact model for persisted continuation state.
- Team mode is operationally practical, but config-gated and file-backed.

**Evidence**
- Team mode: 12 `team_*` tools, optional worktrees, optional tmux visualization, mailbox/task storage under `~/.omo/runtime/...` (`/Users/kimzerokim/work/personal/external_harness/oh-my-openagent/docs/guide/team-mode.md:11-151`).
- Derived continuation state from boulder, ralph-loop, hook, and background markers (`/Users/kimzerokim/work/personal/external_harness/oh-my-openagent/src/cli/run/continuation-state.ts:14-40`).
- Persisted loop state with iteration, max iterations, verification-pending, and ultrawork strategy (`/Users/kimzerokim/work/personal/external_harness/oh-my-openagent/src/hooks/ralph-loop/loop-state-controller.ts:22-63`, `:113-153`).
- `docs/superpowers/` still exists as an internal design-doc namespace (`/Users/kimzerokim/work/personal/external_harness/oh-my-openagent/docs/AGENTS.md:41-51`).

**Candidate opportunities**
- Give pi-oven a small, explicit continuation-marker model.
- Delay full `team_*` parity until pi-oven-native need is proven.

### ECC
**Observations**
- Broadest harness-OS surface; most useful transferable pieces are the decision/checklist skills.

**Evidence**
- Surface breadth: plugins, hooks, scripts, orchestration utilities, adapter compliance (`/Users/kimzerokim/work/personal/external_harness/ECC/package.json:43-112`, `:338-353`).
- `parallel-execution-optimizer` contributes a concise lane matrix and isolated write-surface discipline (`/Users/kimzerokim/work/personal/external_harness/ECC/skills/parallel-execution-optimizer/SKILL.md:8-54`).
- `loop-design-check` contributes a judgment-layer checklist for autonomous loops: decidable goals, damping, human-kept judgment, and Goodhart defenses (`/Users/kimzerokim/work/personal/external_harness/ECC/skills/loop-design-check/SKILL.md:1-143`).

**Candidate opportunities**
- Use ECC’s lane-matrix and loop-review checklists in pi-oven planning.
- Avoid ECC-scale platform sprawl.

### skills
**Observations**
- Valuable as a design pattern for interview entrypoints.

**Evidence**
- `grill-me` and `grill-with-docs` are intentionally tiny wrappers (`/Users/kimzerokim/work/personal/external_harness/skills/skills/productivity/grill-me/SKILL.md:1-7`; `/Users/kimzerokim/work/personal/external_harness/skills/skills/engineering/grill-with-docs/SKILL.md:1-7`).
- Shared `grilling` primitive explicitly exposed in changelog (`/Users/kimzerokim/work/personal/external_harness/skills/CHANGELOG.md:41-46`).

**Candidate opportunities**
- Keep pi-oven’s deep-interview core separate from docs-aware wrappers.

### superpowers
**Observations**
- Strong workflow philosophy, but integration is bootstrap-heavy and harness-specific.

**Evidence**
- Workflow shape: clarify → spec chunks → plan → subagent-driven development (`/Users/kimzerokim/work/personal/external_harness/superpowers/README.md:16-26`).
- Parallel/SDD/verification skills are useful shape references (`/Users/kimzerokim/work/personal/external_harness/superpowers/skills/dispatching-parallel-agents/SKILL.md:1-70`; `/Users/kimzerokim/work/personal/external_harness/superpowers/skills/subagent-driven-development/SKILL.md:1-92`; `/Users/kimzerokim/work/personal/external_harness/superpowers/skills/verification-before-completion/SKILL.md:1-48`).
- OpenCode plugin mutates `skills.paths` and injects a bootstrap message into the first user message (`/Users/kimzerokim/work/personal/external_harness/superpowers/.opencode/plugins/superpowers.js:55-133`).
- Pi extension injects a bootstrap message at session/context boundaries and maps missing skill/task/subagent affordances in prose (`/Users/kimzerokim/work/personal/external_harness/superpowers/.pi/extensions/superpowers.ts:16-96`).
- Kimi plugin hard-wires `sessionStart.skill=using-superpowers` plus `AskUserQuestion`/TodoList/Task remaps (`/Users/kimzerokim/work/personal/external_harness/superpowers/.kimi-plugin/plugin.json:22-29`).

**Candidate opportunities**
- Reuse workflow shapes only.
- Do not reuse bootstrap-message injection or runtime config mutation.

## gajae-code deep interview UX notes
### Question presentation
- Stable threshold banner is always first (`SKILL.md:90-107`; `render-middleware.ts:193-207`).
- Round 0 has a dedicated topology confirmation screen (`SKILL.md:192-199`; `render-middleware.ts:98-123`).
- Each scored round uses a stable header carrying round/component/targeting/why-now/ambiguity (`SKILL.md:292-301`; `render-middleware.ts:47-96`).

### Option UX
- Recommended option gets a suffix and timeout fallback (`ask.ts:104-145`, `:368-419`).
- `Other (type your own)` is inline, not a separate screen (`ask.ts:230-260`, `:389-405`).
- Long prompts remain visible with selector-local scroll (`ask.ts:236-246`).
- Deep-interview questions and choices are auto-numbered (`ask.ts:585-614`, `:817-860`).

### Ambiguity resolution loop
- Topology is locked before scoring (`SKILL.md:181-242`).
- Each round targets the globally weakest component/dimension pair and may raise ambiguity bidirectionally (`SKILL.md:262-341`, `:394-431`).
- Closure/acceptance audit and a one-sentence restate gate run before crystallization (`SKILL.md:486-495`).

### Artifacts and helpers
- Structured `deepInterview` metadata lets the runtime record rounds automatically (`ask.ts:471-498`, `:557-726`).
- Headless/unattended flows route through `workflow_gate` (`ask.ts:562-577`).
- Round records use durable keys, hashes, lifecycle state, and trigger metadata (`deep-interview-state.ts:18-72`, `:88-110`).

## Ranked transferable opportunities
1. **Adopt gajae-style deep-interview UX parity as pi-oven-native primitives.**
   - Evidence: `.../gajae-code/.../SKILL.md:181-307,486-696`; `.../ask.ts:202-420,557-726`; `.../render-middleware.ts:1-140`.
   - Requires: native ask API, native persisted interview state, native renderer/parser.
2. **Separate reusable interview engine from user-facing entrypoints.**
   - Evidence: `.../skills/.../grill-me/SKILL.md:1-7`; `.../grill-with-docs/SKILL.md:1-7`; `.../skills/CHANGELOG.md:41-46`.
3. **Adopt ECC-style lane-matrix planning for parallelism.**
   - Evidence: `.../ECC/skills/parallel-execution-optimizer/SKILL.md:8-54`.
4. **Persist continuation state as explicit markers, not prompt lore.**
   - Evidence: `.../oh-my-openagent/src/cli/run/continuation-state.ts:14-40`; `.../loop-state-controller.ts:22-63,113-153`.
5. **Keep verification as an explicit pre-completion gate.**
   - Evidence: `.../superpowers/skills/verification-before-completion/SKILL.md:1-48`.

## Patterns to avoid
- **Bootstrap-message injection as core integration** (`.../superpowers/.opencode/plugins/superpowers.js:89-133`; `.../.pi/extensions/superpowers.ts:55-96`).
- **Dual plugin/runtime tracks** (`.../oh-my-claudecode/package.json:1-31`; release-note text at `release-notes.md:3-17`).
- **Importing full tmux/worktree team runtimes before validating minimal need** (`.../gajae-code/.../team-runtime.ts:1-300`; `.../oh-my-openagent/docs/guide/team-mode.md:91-151`).
- **Relying on repo tags when manifests/changelogs drift** (`.../gajae-code/packages/coding-agent/CHANGELOG.md:1-6`; `.../oh-my-openagent/package.json:1-6`).

## Dependency cutover and migration risks
- Clean cutover requires replacing superpowers/OMC text shims with first-class pi-oven primitives for ask, state persistence, task/subagent orchestration, and verification.
- Interview parity is a **bundle migration unit**: ask UX + renderer + runtime seed/persist + state merge should land together.
- Overbuilding the parallel layer before re-validating the end-to-end harness flow risks unnecessary tmux/worktree complexity.
- [INFERENCE] gajae-code and oh-my-openagent tag/version drift suggests extra care in source-of-truth selection during migration.

## Unknowns
- I did not inspect every ECC skill or every OMC/OMO implementation file.
- I did not compare against `oh-my-pi` by request.
- [INFERENCE] Some newest observed tags in gajae-code and oh-my-openagent may reflect shared-history or source-state release tags rather than end-user package releases.
