> Historical; do not copy runtime syntax examples from this document.
> Historical architecture; implementation removed in vNext; OMP task is current dispatch seam
> Superseded by [the runtime contract remediation implementation plan](../../plans/2026-07-13-pi-oven-runtime-contract-remediation-implementation-plan.md).

# 2026-07-06 workflow parallelism optimization survey

## Scope
- Topic: pi-oven task execution, agent dispatch, workflow gating, issue-finding/review fan-out, verification routing, background/native worker handling, and brainstorming/deep-interview orchestration.
- Goal: identify evidence-backed speed, parallelism, and orchestration optimization opportunities for a later spec/plan.
- Non-goals:
  - no code changes
  - no speculative roadmap beyond observed implementation surfaces
  - no external-harness comparison rerun
- Primary evidence set:
  - runtime entry + gate stack: `.omp/extensions/pi-oven.ts:718-1162`, `.omp/extensions/pi-oven-runtime/gate-handler.ts:150-224,263-347,380-550`, `.omp/extensions/pi-oven-runtime/gate.ts:97-121,328-521`, `.omp/extensions/pi-oven-runtime/gate-state.ts:32-87,145-167,297-546`
  - keyword/skill routing: `.omp/extensions/pi-oven-runtime/skill-keyword-loader.ts:14-232,303-318,322-368,422-455`, `.omp/extensions/pi-oven-runtime/rules-injector.ts:204-231`
  - verification routing: `.omp/extensions/pi-oven-runtime/verifier-depth-policy.ts:3-91`, `.omp/extensions/pi-oven-runtime/autonomous-stop-guard.ts:188-273`, `skills/fresh-verifier/SKILL.md:21-140`, `agents/pi-oven-verifier.md:1-49,109-170`
  - native worker runtime: `scripts/pi-oven-team/index.ts:83-155,174-219`, `scripts/pi-oven-team/runtime-v2.ts:148-331,333-527`, `scripts/pi-oven-team/lane-policy.ts:79-177`, `scripts/pi-oven-team/task-file-ops.ts:99-145,278-325`, `scripts/pi-oven-team/team-config.ts:131-199`, `scripts/pi-oven-team/types.ts:7-45,77-174`
  - spec/review + planning skills: `skills/spec-and-review/SKILL.md:20-35,52-86,117-135`, `skills/spec-and-review/references/pattern-loop.md:7-18,63-188`, `skills/large-task-delegation/SKILL.md:19-48,58-67,75-97`, `skills/subagent-driven-development/SKILL.md:19-40,96-108`, `skills/autonomous-loop/SKILL.md:160-209`
  - brainstorming + native deep-interview: `skills/brainstorming/SKILL.md:20-40,42-52,73-82`, `skills/brainstorming/references/checklist.md:22-35,45-84`, `.omp/extensions/pi-oven-runtime/deep-interview-state.ts:9-30,38-79,215-246,266-323,350-556`, `.omp/extensions/pi-oven-runtime/deep-interview-runtime.ts:24-39,65-130,170-209,211-427`, `.omp/extensions/pi-oven-runtime/deep-interview-render.ts:11-101`, `.omp/extensions/pi-oven-runtime/pi-oven-ask.ts:32-50,146-175,214-260,358-487,497-548`
  - model/profile/setup surfaces: `scripts/pi-oven-setup/profiles.ts:96-112,113-352,354-733`, `scripts/pi-oven-setup/apply.ts:123-258`, `scripts/pi-oven-setup/status.ts:48-137`, `.omp/extensions/pi-oven.ts:241-254,318-364`
  - tests: `tests/extensions/pi-oven-runtime/gate-handler.test.ts:679-845`, `tests/extensions/pi-oven-runtime/gate.test.ts:88-105,197-223,498-520`, `tests/extensions/pi-oven-runtime/skill-keyword-loader.test.ts:55-221`, `tests/extensions/pi-oven-runtime/deep-interview-runtime.test.ts:13-107,166-344,392-537`, `tests/extensions/pi-oven-runtime/deep-interview-state.test.ts:54-159,222-267`, `tests/scripts/pi-oven-team/runtime-v2.test.ts:75-96,126-290`, `tests/scripts/pi-oven-setup/profiles.test.ts:87-194`, `tests/extensions/pi-oven.test.ts:154-243`, `tests/plugin/autonomous-delegation.test.ts:9-43`

### Step 0.5 — tool/index availability
- `ast_grep`: available and used for structural discovery.
- `lsp`: `typescript-language-server` was configured and started on demand through `symbols`, `references`, and `hover`.
- Context7: available. Used `/oven-sh/bun` to confirm `Bun.file(...).text()` and `Bun.YAML.parse()` API shape.
- code-review-graph: available enough for `get_hub_nodes` and `get_impact_radius`; `semantic_search_nodes` ran in keyword mode and a broad workflow query returned 0 hits, so precise workflow mapping fell back to `ast_grep` + `lsp` + targeted reads.

### CRG availability snapshot (observed)
```text
semantic_search_nodes("workflow task dispatch gate verifier background monitoring parallel subagent runtime skill routing")
→ search_mode="keyword", 0 results

get_hub_nodes(top_n=12)
→ high-degree hubs include decideGate, createGateHandler, piOvenPi, runScenario

get_impact_radius([...gate/runtime/deep-interview files...], max_depth=2)
→ risk="high", impacted_file_count=50-75 depending on slice
```

## Recent churn snapshot
- Gate/runtime surfaces: `0a6cd3f fix(pi-oven): complete harness remediation wave`, `88c9586 feat: overhaul pi-oven meta control plane`, `5b02bed feat(pi-oven): cut over native worker runtime`.
- Deep-interview surfaces: `0a6cd3f`, `9ea1a5e feat(pi-oven): speed up autonomous runtime and tighten temp creds`, `6ca1947 fix(skills): colon-namespace in-body skill:// refs + enforce in lint`.
- Spec/review skills: `0a6cd3f`, `88c9586`, `ffbde67 feat(pi-oven): scale fan-out and fix push consent`, `ea38a20 feat(runtime): gate external execution on explicit consent`.

## Workflow map
1. **Runtime entrypoint / parent-session control plane** — `piOvenPi()` wires `tool_call`, `before_agent_start`, `session_start`, `turn_start`, and `turn_end`, owns project-instruction injection, keyword-skill loading, state-store mutation, and stop-guard continuation (`.omp/extensions/pi-oven.ts:718-1162`).
2. **Gate stack** — `createGateHandler()` composes normalization + state reads + pure decisions + consent consumption under a 1500 ms self-deadline; `decideGate()` is the pure policy kernel; `GateStateStore` is the single-writer file-backed control-plane store (`.omp/extensions/pi-oven-runtime/gate-handler.ts:380-550`, `.omp/extensions/pi-oven-runtime/gate.ts:328-521`, `.omp/extensions/pi-oven-runtime/gate-state.ts:297-546`).
3. **Runtime keyword/skill routing** — `SKILL_KEYWORD_WHITELIST`, `loadSkillKeywordIndexReport()`, `matchSkillsForText()`, and `buildKeywordMatchedSkillsPrompt()` derive the exact plugin-owned SKILL.md proof surface (`.omp/extensions/pi-oven-runtime/skill-keyword-loader.ts:14-232,303-318,322-368,422-455`).
4. **Verification routing** — `decideVerifierDepth()` computes light/deep policy; `decideStopGuardOnTurnEnd()` queues verifier-pending continuations for deep autonomous exits (`.omp/extensions/pi-oven-runtime/verifier-depth-policy.ts:44-91`, `.omp/extensions/pi-oven-runtime/autonomous-stop-guard.ts:188-273`).
5. **Native worker runtime** — `resolveNativeWorkerRuntimeStatus()` exposes the launcher boundary; `startTeamV2()` + `executeStartupWorkerBatches()` perform dependency-aware fan-out; `lane-policy` and `task-file-ops` define independence and collision rules (`scripts/pi-oven-team/index.ts:83-155,174-219`, `scripts/pi-oven-team/runtime-v2.ts:148-527`, `scripts/pi-oven-team/lane-policy.ts:79-177`, `scripts/pi-oven-team/task-file-ops.ts:99-145`).
6. **Plan/review workflows** — `spec-and-review`, `large-task-delegation`, `subagent-driven-development`, `fresh-verifier`, and `autonomous-loop` define the higher-level orchestration contracts that runtime code later enforces or steers (`skills/spec-and-review/SKILL.md:20-35,52-86,117-135`, `skills/large-task-delegation/SKILL.md:19-48,58-67`, `skills/subagent-driven-development/SKILL.md:19-40,96-108`, `skills/fresh-verifier/SKILL.md:21-140`, `skills/autonomous-loop/SKILL.md:160-209`).
7. **Brainstorming / deep-interview** — `brainstorming` owns the interactive question loop; `pi-oven_ask` + deep-interview state/runtime/render persist question/answer/approval state into the runtime store (`skills/brainstorming/SKILL.md:30-40,42-52`, `.omp/extensions/pi-oven-runtime/pi-oven-ask.ts:358-487,497-548`, `.omp/extensions/pi-oven-runtime/deep-interview-runtime.ts:211-427`).

## Findings

### 1. The code-write control plane is already exact-proof gated, but every parent-session write lane still pays serialized state I/O.
**Current behavior**
- `turn_start` rewrites `requiredSkills`, `ownedSkillReadTargets`, `skillReads`, `explicitForeignAgents`, and external-consent state into the file-backed FSM on every parent turn (`.omp/extensions/pi-oven.ts:1053-1113`).
- `decideForCodeWrite()` then re-reads the FSM and branch contract for each `write`/`edit`/`ast_edit`, and `observeSkillRead()` mutates the store again when an exact plugin-owned read target is observed (`.omp/extensions/pi-oven-runtime/gate-handler.ts:263-347`).
- `GateStateStore` serializes all parent writes through one promise-chain mutex, including proof logging and consent consumption (`.omp/extensions/pi-oven-runtime/gate-state.ts:408-545`).
- The pure gate intentionally blocks code-write until the branch contract exists and every `ownedSkillReadTarget` has been read exactly; aliases do not count (`.omp/extensions/pi-oven-runtime/gate.ts:435-480`).
- Tests confirm the exact-read requirement and bootstrap exemption (`tests/extensions/pi-oven-runtime/gate-handler.test.ts:679-845`, `tests/extensions/pi-oven-runtime/skill-keyword-loader.test.ts:134-221`).

**Why it matters**
- This is correctness-first and already strong, but it means the parent orchestrator’s code-write path is fundamentally serialized around repeated filesystem reads and tiny state mutations.

**Optimization opportunity**
- Future implementation should preserve the proof model but reduce hot-path I/O: cache the branch-contract/proof snapshot per turn, coalesce exact-read credits before persisting, or carry the `turn_start` snapshot into `gateHandler` so code-write checks avoid redundant reads. The safe boundary is the existing pure `decideGate()` contract (`.omp/extensions/pi-oven-runtime/gate.ts:328-521`).

### 2. The native worker runtime already fans out inside dependency-safe batches, but startup still contains three explicit serialization barriers.
**Current behavior**
- `buildDependencyAwareBatches()` groups ready tasks by dependency resolution, rejects cycles, and enforces collision-free persistence claims (`scripts/pi-oven-team/task-file-ops.ts:99-145`).
- `planStartupWorkerBatches()` maps startup plans into those batches using lane metadata from `classifyLaneForTask()` (`scripts/pi-oven-team/runtime-v2.ts:148-170`, `scripts/pi-oven-team/lane-policy.ts:79-177`).
- `executeStartupWorkerBatches()` parallelizes reservation promises per batch and parallelizes `spawnV2Worker()` across settled reservations with `Promise.all`, but keeps an outer `for (const batch of args.batches)` barrier and a split-target dependency chain (`scripts/pi-oven-team/runtime-v2.ts:188-331`).
- `startTeamV2()` parallelizes worktree creation with `Promise.allSettled`, then performs serial result passes to build worker metadata, persists task files/config before startup, and only then executes the batches (`scripts/pi-oven-team/runtime-v2.ts:368-518`, `scripts/pi-oven-team/team-config.ts:131-199`).
- Tests prove real fan-out and evidence capture, including `startupImprovementRatio` and pre-dispatch split overlap (`tests/scripts/pi-oven-team/runtime-v2.test.ts:126-290`).

**Where parallelism already exists**
- Worktree ensure is parallel.
- Pane reservations overlap inside a batch.
- Worker dispatch/startup overlaps inside a batch.

**Where it is still blocked**
- Batches are strictly sequential.
- Pane splitting still follows a predicted-target chain.
- Task-state/config persistence is ordered before startup fan-out.

**Optimization opportunity**
- The best future gains are likely in overlapping pre-start persistence with startup prep, reducing the split-target chain, and measuring whether batch barriers are overly conservative for read-only/verification lanes that already declare `shared_state_policy: "read_only"` (`scripts/pi-oven-team/types.ts:11-45`, `scripts/pi-oven-team/lane-policy.ts:110-128`).

### 3. Issue-finding/review fan-out exists, but it is still hardcoded around Codex + Zen and contradictory model guidance.
**Current behavior**
- `spec-and-review` explicitly defines `Draft → Critic (multi-provider fan-out) → Synthesize → Gate`, and the critic lane is written as a mandatory Codex + Zen pair (`skills/spec-and-review/SKILL.md:52-86`).
- The reference loop hardcodes `task(model="codex")` and `task(model="zen")`, verdict headers `Critic: codex + zen`, and the routing diagram shows exactly two critics (`skills/spec-and-review/references/pattern-loop.md:7-18,102-175`).
- `pi-oven:critic` repeats the same two-stage model-specific fan-out recipe in-agent (`agents/pi-oven-critic.md:113-121`).
- `receiving-code-review` and keyword routing also treat “codex review” / cross-vendor codex as first-class phrases (`skills/receiving-code-review/SKILL.md:11,48-50,92-96`, `.omp/extensions/pi-oven-runtime/skill-keyword-loader.ts:177-194`).
- Meanwhile `large-task-delegation` says critic/verifier/planner should omit `model` and inherit the parent version (`skills/large-task-delegation/SKILL.md:36-48`), but `autonomous-loop` still hardcodes `model="opus"` for exit verification (`skills/autonomous-loop/SKILL.md:181-198`).

**Why it matters**
- This is both an orchestration cost and a future-maintenance cost: the workflow is paying for mandatory multi-provider disagreement checks even when the requested change is to stay inside the current session provider/model family.
- The current docs/skills disagree on whether verification should inherit the session model, promote to a named model, or use provider-pair fan-out.

**Optimization opportunity**
- A future implementation plan should remove provider names from skill contracts and instead require fresh-agent revalidation using the current session provider family only, with optional same-provider multi-lane disagreement checks when risk justifies it. Exact change surfaces are `skills/spec-and-review/SKILL.md`, `skills/spec-and-review/references/pattern-loop.md`, `skills/autonomous-loop/SKILL.md`, `skills/fresh-verifier/SKILL.md`, `skills/large-task-delegation/SKILL.md`, `skills/receiving-code-review/SKILL.md`, `.omp/extensions/pi-oven-runtime/skill-keyword-loader.ts`, and `agents/pi-oven-critic.md`.

### 4. Verification depth is runtime-driven, but verifier wording/model policy is internally inconsistent.
**Current behavior**
- The runtime policy is coherent: `decideVerifierDepth()` elevates autonomous material edits and runtime/team mutations to deep verification, and `decideStopGuardOnTurnEnd()` queues a `pi-oven:verifier/deep` continuation before exit (`.omp/extensions/pi-oven-runtime/verifier-depth-policy.ts:44-91`, `.omp/extensions/pi-oven-runtime/autonomous-stop-guard.ts:235-273`).
- `gate-handler` threads verifier depth into commit/code-write gating and uses it to decide whether regression proof is required (`.omp/extensions/pi-oven-runtime/gate-handler.ts:118-133,295-325,436-550`).
- `fresh-verifier` then says targeted verifier = Sonnet baseline and heavy verifier = Opus, with the sentence “The `agents/pi-oven-verifier.md` profile defaults to `model: sonnet`” (`skills/fresh-verifier/SKILL.md:121-127`).
- But the actual shipped verifier agent frontmatter is `openai-codex/gpt-5.5` with `opencode-zen/gpt-5.5` alternate (`agents/pi-oven-verifier.md:1-10,59-78`).
- The same mismatch exists at the orchestration layer: `autonomous-loop` explicitly asks for `model="opus"`, while `large-task-delegation` forbids explicit `model="opus"` and prefers inherited versions (`skills/autonomous-loop/SKILL.md:181-198`, `skills/large-task-delegation/SKILL.md:36-48`).

**Why it matters**
- This is a real workflow bottleneck for future automation work: a plan cannot safely standardize verification routing until the repo has one authoritative rule for model selection.

**Optimization opportunity**
- Keep the depth/risk matrix, but collapse wording to “same-provider fresh agent with deeper evidence requirements” unless a repo-level routing profile overrides it. Likely future change surfaces: `skills/fresh-verifier/SKILL.md`, `skills/autonomous-loop/SKILL.md`, `agents/pi-oven-verifier.md`, `scripts/pi-oven-setup/profiles.ts`, `scripts/pi-oven-setup/status.ts`, and the runtime tests that currently lock profile/model assumptions (`tests/scripts/pi-oven-setup/profiles.test.ts:87-194`, `tests/extensions/pi-oven.test.ts:154-243`).

### 5. Brainstorming already mandates a long convergence interview, but the native deep-interview schema is still too small for the requested gajae-style flow.
**Current behavior**
- `brainstorming` requires a 15–100 question, one-question-per-turn convergence loop, and keeps ownership of approval before `writing-plans` (`skills/brainstorming/SKILL.md:30-40,42-52`, `skills/brainstorming/references/checklist.md:22-35,72-84`).
- The runtime-side deep-interview contract currently persists only: stage (`topology|round|closure|approval`), component, dimension, ambiguity, approval handoff, and routing approval (`.omp/extensions/pi-oven-runtime/deep-interview-state.ts:9-30,38-79`).
- `pi-oven_ask` exposes only `question`, `options`, `recommended`, and that same `deepInterview` metadata schema (`.omp/extensions/pi-oven-runtime/pi-oven-ask.ts:497-548`).
- `buildDeepInterviewContractPrompt()` renders topology, closure/restate gate, and approval progress, but nothing about clarity buckets, ontology/topology taxonomies beyond one stage label, next-target selection, milestone state, or ambiguity percentages as named UI buckets (`.omp/extensions/pi-oven-runtime/deep-interview-render.ts:11-101`).
- Tests prove the current runtime can persist topology rounds, approval handoff, routing-approval buckets, and resume state (`tests/extensions/pi-oven-runtime/deep-interview-runtime.test.ts:166-344,392-537`, `tests/extensions/pi-oven-runtime/deep-interview-state.test.ts:54-159,222-267`).

**Gap against requested direction**
- There is no current local field or reducer for:
  - clarity buckets / weakest-dimension targeting
  - ontology/topology taxonomy beyond a freeform `component` + `dimension`
  - next target
  - milestone / progress markers inside the deep-interview state
  - richer ambiguity UI than a raw `0..1` float

**Optimization opportunity**
- The shortest viable path is evolutionary, not greenfield: extend `DeepInterviewAskMetadata`, `DeepInterviewRoundRecord`, `DeepInterviewState`, `normalize/merge` logic, `buildDeepInterviewContractPrompt()`, and `pi-oven_ask`’s zod schema/rendering rather than inventing a separate workflow store. The highest-confidence change surfaces are:
  - `skills/brainstorming/SKILL.md` and `skills/brainstorming/references/checklist.md`
  - `.omp/extensions/pi-oven-runtime/deep-interview-state.ts`
  - `.omp/extensions/pi-oven-runtime/deep-interview-runtime.ts`
  - `.omp/extensions/pi-oven-runtime/deep-interview-render.ts`
  - `.omp/extensions/pi-oven-runtime/pi-oven-ask.ts`
  - `.omp/extensions/pi-oven.ts:935-975` and `.omp/extensions/pi-oven-runtime/rules-injector.ts:204-231`
  - tests under `tests/extensions/pi-oven-runtime/deep-interview-*.test.ts`

### 6. Setup/profile/runtime SoT still exposes a multi-provider world even though the release-default routing matrix is already codex-first and reproducible.
**Current behavior**
- `PROFILE_CODEX_RELEASE_DEFAULT` / `PROFILE_A` / `PROFILE_B` are already the same Codex-first routing map, but every entry still carries an `opencode-zen` registry alternate (`scripts/pi-oven-setup/profiles.ts:96-112,113-352`).
- `PROFILE_C` and `PROFILE_D` remain first-class shipped surfaces with Anthropic-only and opencode-zen-only matrices (`scripts/pi-oven-setup/profiles.ts:337-345,354-733`).
- `runApply()` persists orchestrator models, fallback chains, and all 24 per-role overrides from those profiles into project/global config (`scripts/pi-oven-setup/apply.ts:123-258`).
- `runStatus()` reports effective models by reading project overrides, global overrides, and frontmatter defaults (`scripts/pi-oven-setup/status.ts:48-137`).
- The runtime registry validator still pins allowed prefixes to `openai-codex` + `opencode-zen` and requires at least one `openai-codex` model (`.omp/extensions/pi-oven.ts:241-254,318-364`).
- Tests still actively lock the presence of Anthropic and opencode-zen profiles and alternates (`tests/scripts/pi-oven-setup/profiles.test.ts:87-194,229-424`, `tests/extensions/pi-oven.test.ts:154-243`).

**Why it matters**
- Any future “current session provider only” or “remove provider-specific wording” change will fail unless setup/profile/status/test surfaces are updated together. Right now the provider model policy is distributed, not singular.

**Optimization opportunity**
- Future work should centralize provider/materialization policy at the profile/runtime boundary and make skills consume that policy symbolically rather than embedding provider names in prose. Likely implementation surfaces: `scripts/pi-oven-setup/profiles.ts`, `scripts/pi-oven-setup/apply.ts`, `scripts/pi-oven-setup/status.ts`, `.omp/extensions/pi-oven.ts`, `.omp/extensions/pi-oven-runtime/model-routing-approval.ts`, `agents/pi-oven-*.md` frontmatter and execution-context headers, plus the corresponding setup/runtime tests.

## External dependency notes
- `package.json` declares `@oh-my-pi/pi-coding-agent` as the runtime dependency and `bun-types` + `typescript` as dev dependencies (`package.json:18-21`).
- Local source additionally imports `@oh-my-pi/pi-tui` in `pi-oven_ask` (`.omp/extensions/pi-oven-runtime/pi-oven-ask.ts:5-23`).
- Native worker startup depends on `tmux` being present and treats missing tmux as a runtime prerequisite failure (`scripts/pi-oven-team/index.ts:158-171`).
- Context7 source used: `/oven-sh/bun` for `Bun.YAML.parse()` and `Bun.file(...).text()`; no external-library semantics materially changed the conclusions because the optimization opportunities are internal orchestration/policy issues, not Bun API gaps.

## Env-var findings
- No `.env.example` exists in this repo, so there is no single env-contract file to cross-check. Env findings below are therefore “used in code/docs but undocumented in env-example form.”
- Runtime gate vars in active code:
  - `PI_BLOCKED_AGENT` toggles parent vs subagent session behavior (`.omp/extensions/pi-oven.ts:792`).
  - `PI_OVEN_PUSH_CONSENT` and `PI_OVEN_GATE_BYPASS` drive push/commit recovery behavior (`.omp/extensions/pi-oven-runtime/gate.ts:37-39,409-417,487-520`, `.omp/extensions/pi-oven-runtime/gate-handler.ts:291-293,428-433`).
  - `PI_OVEN_EXTERNAL_EXEC:` is parsed from user text for external execution consent (`.omp/extensions/pi-oven.ts:619-679`).
- Native runtime env:
  - `PI_OVEN_SHELL_READY_TIMEOUT_MS` tunes tmux pane readiness waits (`scripts/pi-oven-team/tmux-session.ts:116-137`).
- Setup/eval/test-isolation env:
  - `PI_OVEN_AGENTS_DIR`, `PI_OVEN_MOCK_SPAWN`, `PI_OVEN_VALIDATE_MODE` (`scripts/pi-oven-setup.ts:9-13,83-85,122-125`)
  - `PI_OVEN_DOCTOR_PROJECT_ROOT` (`scripts/pi-oven-doctor.ts:776`)
  - `PI_OVEN_EVAL_MODEL` (`scripts/run-eval.ts:69-73,116-123`)
- Skill-documented gate-bypass envs without `.env.example` coverage:
  - `PI_OVEN_CYCLE_EXIT_VERIFIED`, `PI_OVEN_CYCLE_EXIT_SKIP` (`skills/fresh-verifier/SKILL.md:130-136`)
  - `PI_OVEN_GATE05_SKIP`, `PI_OVEN_GATE35_SKIP`, `PI_OVEN_GATE35_DISABLE`, `PI_OVEN_GATE4_SKIP`, `PI_OVEN_GATE45_SKIP`, `PI_OVEN_GATE5_SKIP` (`skills/pre-commit-gate/SKILL.md:24-34,59-66`)

## Unknowns
- CRG is callable but the available search surface was not rich enough to replace direct source inspection for this survey; no CRG embeddings/query-graph path was available here, so graph-level ranking quality is unknown.
- This survey did not measure live end-to-end latency of a real omp session. Performance opportunities are grounded in implementation shape and tests, not production timings.
- The actual runtime/provider concurrency ceiling under the current user’s authenticated environment is not observable from repo code alone; only pi-oven’s documented ceiling/target (`nativeWorkers.maxWorkers`, “8-12 siblings”) is observable.
- The requested gajae-style deep-interview target behavior was inferred from the user’s requested feature set and existing pi-oven local code, not from an in-repo copy of gajae-code.

## Likely change surfaces for a future implementation plan
### A. Provider-agnostic spec/review + verifier routing
- `skills/spec-and-review/SKILL.md`
- `skills/spec-and-review/references/pattern-loop.md`
- `skills/autonomous-loop/SKILL.md`
- `skills/fresh-verifier/SKILL.md`
- `skills/large-task-delegation/SKILL.md`
- `skills/receiving-code-review/SKILL.md`
- `agents/pi-oven-critic.md`
- `agents/pi-oven-verifier.md`
- `agents/pi-oven-planner.md`
- `.omp/extensions/pi-oven-runtime/skill-keyword-loader.ts`

### B. Profile/setup/runtime provider policy SoT
- `scripts/pi-oven-setup/profiles.ts`
- `scripts/pi-oven-setup/apply.ts`
- `scripts/pi-oven-setup/status.ts`
- `.omp/extensions/pi-oven.ts` (`getAllowedPrefixes`, `validateAgentRegistry`)
- `.omp/extensions/pi-oven-runtime/model-routing-approval.ts`
- tests: `tests/scripts/pi-oven-setup/profiles.test.ts`, `tests/extensions/pi-oven.test.ts`, `tests/scripts/pi-oven-setup/status.test.ts`

### C. Brainstorming + native deep-interview parity
- `skills/brainstorming/SKILL.md`
- `skills/brainstorming/references/checklist.md`
- `.omp/extensions/pi-oven-runtime/deep-interview-state.ts`
- `.omp/extensions/pi-oven-runtime/deep-interview-runtime.ts`
- `.omp/extensions/pi-oven-runtime/deep-interview-render.ts`
- `.omp/extensions/pi-oven-runtime/pi-oven-ask.ts`
- `.omp/extensions/pi-oven-runtime/rules-injector.ts`
- `.omp/extensions/pi-oven.ts` (`before_agent_start` deep-interview contract injection)
- tests: `tests/extensions/pi-oven-runtime/deep-interview-runtime.test.ts`, `tests/extensions/pi-oven-runtime/deep-interview-state.test.ts`

### D. Native worker throughput / batch startup
- `scripts/pi-oven-team/runtime-v2.ts`
- `scripts/pi-oven-team/index.ts`
- `scripts/pi-oven-team/lane-policy.ts`
- `scripts/pi-oven-team/task-file-ops.ts`
- `scripts/pi-oven-team/team-config.ts`
- `scripts/pi-oven-team/types.ts`
- tests: `tests/scripts/pi-oven-team/runtime-v2.test.ts`, `tests/scripts/pi-oven-team/scaling.test.ts`

### E. Gate hot-path I/O reduction without weakening proof semantics
- `.omp/extensions/pi-oven-runtime/gate-handler.ts`
- `.omp/extensions/pi-oven-runtime/gate-state.ts`
- `.omp/extensions/pi-oven-runtime/gate.ts`
- `.omp/extensions/pi-oven.ts` (`turn_start` state snapshotting)
- tests: `tests/extensions/pi-oven-runtime/gate-handler.test.ts`, `tests/extensions/pi-oven-runtime/gate.test.ts`, `tests/extensions/pi-oven-runtime/skill-keyword-loader.test.ts`
