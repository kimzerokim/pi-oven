# 2026-07-05 pi-oven remediation detailed survey

## Scope
- Topic: pi-oven remediation wave survey for runtime proof/gate behavior, deep-interview parity, native parallel runtime, model-routing surfaces, and legacy compatibility residue.
- Deliverable intent: implementation-facing survey only. No code changes in this document.
- Evidence inputs:
  - `agent://DetailedSurvey`
  - `agent://CodexRoutingResearch`
  - `agent://CodexDocs`
  - `agent://FreshVerifier`
  - live repo state under `~/work/personal/pi-oven`
- Non-goals:
  - deciding every implementation detail of the remediation wave
  - re-running the entire external harness comparison
  - restating already-settled background unrelated to remediation

## Executive summary

### Current reality
1. **The control-plane front door is already code-enforced.** Autonomous code-write is blocked unless the branch contract exists and every matched pi-oven skill is proven by an exact plugin-owned `SKILL.md` read, not by aliases or bootstrap prose (`.omp/extensions/pi-oven-runtime/gate.ts:435-480`, `.omp/extensions/pi-oven-runtime/gate-handler.ts:262-276`, `.omp/extensions/pi-oven-runtime/skill-keyword-loader.ts:430-452`, `tests/extensions/pi-oven-runtime/gate.test.ts:559-653`, `tests/extensions/pi-oven-runtime/gate-handler.test.ts:632-710`).
2. **Deep-interview primitives exist, but parity is incomplete.** `pi-oven_ask`, deep-interview runtime/state, and persisted approval handoff are live (`.omp/extensions/pi-oven-runtime/pi-oven-ask.ts:36-42,143-164,349-509`, `.omp/extensions/pi-oven-runtime/deep-interview-runtime.ts:108-213`, `.omp/extensions/pi-oven-runtime/deep-interview-state.ts:3-68,244-394`), yet gajae-style threshold/topology/render/closure/workflow-gate behavior is still only partially represented (`.omp/extensions/pi-oven-runtime/deep-interview-render.ts:11-37`; comparison target at `docs/harness/surveys/2026-07-04-external-harness-comparison.md:105-125`).
3. **The native parallel runtime is dependency-aware, but not fully parallel.** Lane classification and collision rejection exist, and batch-local worker spawn is parallelized, but pane reservation, worktree ensure, and outer batch sequencing are still serial (`scripts/pi-oven-team/lane-policy.ts:79-139,167-209`, `scripts/pi-oven-team/task-file-ops.ts:99-145`, `scripts/pi-oven-team/runtime-v2.ts:141-266,268-323`).
4. **Codex-only routing already has a reproducible template in `PROFILE_B`, but the release default and surrounding docs/tests still describe a mixed-provider world.** The codebase currently keeps heterogeneous `PROFILE_A`, Anthropic `PROFILE_C`, and opencode-zen `PROFILE_D` live alongside the Codex-only profile (`scripts/pi-oven-setup/profiles.ts:300-532`, `README.md:231-270`, `CLAUDE.md:7-11,50-71`, `commands/setup.md:124-210,294-308`).
5. **Legacy compatibility paths are still executable and tested.** `--isolate`, `--suppress-sibling-skills`, `disabledProviders`, `skills.ignoredSkills`, and `~/.claude`-relative compatibility logic remain in the shipping setup path (`scripts/pi-oven-setup.ts:184-342`, `scripts/pi-oven-setup/config-yml.ts:636-645,699-764,766-913`, `scripts/pi-oven-setup/isolate.ts:1-59`). Fresh verification called this a blocking gap, not historical residue (`agent://FreshVerifier`).

### Remediation priority signal
- **P0**: codex-only routing cutover + ask-driven effort approval + deep-interview parity gaps that block reproducible routing decisions.
- **P1**: legacy compatibility surface retirement and documentation/spec/research evidence enforcement.
- **P2**: parallel-runtime throughput improvements and remaining control-plane/doc cleanup after P0/P1 contracts are locked.

## 1. Working-state snapshot

### Branch and state markers
- Current branch contract is already explicit and project-local: `.pi-oven/state/branch-contract.json` declares `destination: "branch"`, `branch: "feature/harness-overhaul"`, `pr_mode: "direct"` (`.pi-oven/state/branch-contract.json:1-5`).
- Current autonomous state shows the new deep-interview state shape living inside the persisted runtime envelope, even while top-level `active` is `false`. The stored interview is still `approval_pending`, with `decisionKey: "approve-option-c"`, `summary: "Implement Option C after approval"`, and a durable round record keyed as `di-1::rid:topology` (`.pi-oven/state/autonomous.json:1-55`).

### Why this matters
The remediation wave is not starting from zero. Two critical invariants are already true:
1. branch/approval/runtime state is file-backed and recoverable; and
2. the runtime already knows how to carry deep-interview identity across turns.

That means the missing work is mostly **parity, enforcement coverage, and policy cutover**, not invention of a new storage substrate.

## 2. Control-plane front door and proof gate

### What is already enforced in code
The runtime now treats skill loading as a proof surface, not a suggestion.

- `buildKeywordMatchedSkillsPrompt()` tells the parent session that the exact plugin-owned `SKILL.md` target is the only valid front door, and explicitly says bootstrap injection and tool remap are not control-plane paths (`.omp/extensions/pi-oven-runtime/skill-keyword-loader.ts:430-452`).
- `gate.ts` blocks code-write whenever the branch contract is absent, a required skill has no owned proof target, or an owned proof target has not yet been read exactly (`.omp/extensions/pi-oven-runtime/gate.ts:435-480`).
- `gate-handler.ts` only credits skill reads when the read target matches an allowed proof target exactly; `skill://autonomous-loop` and `skill://pi-oven:autonomous-loop` are not sufficient if the owned target is a concrete plugin path (`.omp/extensions/pi-oven-runtime/gate-handler.ts:105-114,262-276`).
- The parent extension injects reminders for missing branch contracts and unread proof targets before code-write, and conditionally appends the deep-interview contract prompt whenever the `deep-interview` capability tag includes `ask` (`.omp/extensions/pi-oven.ts:896-923,925-965`).

### Test-backed proof
- `decideGate` tests prove that branch-contract absence blocks `edit` and `ast_edit`, the branch-contract file itself is bootstrap-exempt, and exact owned targets must be in `skillReads` before code-write is allowed (`tests/extensions/pi-oven-runtime/gate.test.ts:559-653`).
- `gate-handler` tests prove that bare and namespaced skill reads do **not** unlock the gate, while the plugin-owned path does (`tests/extensions/pi-oven-runtime/gate-handler.test.ts:663-710`).

### Survey conclusion
The proof/gate surface is already strong enough to anchor the remediation wave. The missing part is **policy breadth**: the runtime knows how to enforce exact-skill ownership, but it does not yet enforce the new “detailed survey / code-grounded research / ask-driven effort approval / codex-only routing” policy set.

## 3. Deep-interview runtime: implemented surface vs parity gap

### Implemented surface
The current code already ships a real deep-interview bundle:

- `pi-oven_ask` carries `recommended` and `deepInterview` metadata, seeds the runtime before showing the UI, and records the answer after selection/cancel/custom input (`.omp/extensions/pi-oven-runtime/pi-oven-ask.ts:36-42,143-164,349-509`).
- `deep-interview-runtime.ts` persists both pending questions and answered rounds into the project-local state store. Approval questions can transition directly to `ready_to_resume` without a second runtime hop (`.omp/extensions/pi-oven-runtime/deep-interview-runtime.ts:139-210`).
- `deep-interview-state.ts` defines stable stage/phase enums, durable round identity, round hashes, approval handoff state, normalization, and merge semantics (`.omp/extensions/pi-oven-runtime/deep-interview-state.ts:3-68,244-394`).
- `deep-interview-render.ts` injects a lightweight runtime contract plus persisted resume state (`.omp/extensions/pi-oven-runtime/deep-interview-render.ts:11-37`).
- The parent extension reloads persisted deep-interview state from the runtime store and re-injects it into the system prompt (`.omp/extensions/pi-oven.ts:880-892,954-964`).

### Persisted-state proof
The checked-in runtime state already contains a pending approval handoff with durable identifiers (`.pi-oven/state/autonomous.json:3-41`). This is stronger than prompt-only evidence: the current branch proves that deep-interview state survives outside the immediate model turn.

### Test-backed proof
- Runtime tests cover seed → persist → reload, direct approval close to `ready_to_resume`, and cancellation lifecycle (`tests/extensions/pi-oven-runtime/deep-interview-runtime.test.ts:11-169`).
- State tests cover round-key derivation, canonical normalization, and merge behavior preserving approval handoff state (`tests/extensions/pi-oven-runtime/deep-interview-state.test.ts:9-129`).

### Confirmed parity gaps
The primitive bundle is real, but the richer gajae-style behavior is still incomplete.

External comparison identified these target behaviors as transferable and desirable:
- stable threshold banner
- dedicated topology screen
- per-round stable header with component/dimension/ambiguity
- weakest-dimension targeting
- closure/restate gate
- headless `workflow_gate`
- richer render middleware (`docs/harness/surveys/2026-07-04-external-harness-comparison.md:105-125`)

The current pi-oven render layer only emits three rules plus an optional resume summary (`.omp/extensions/pi-oven-runtime/deep-interview-render.ts:11-37`). No local code evidence currently shows:
- threshold parsing/render blocks,
- topology/closure-specific UI surfaces,
- workflow-gate routing,
- or weakest-dimension selection logic.

Fresh verification therefore correctly described parity as **partial**, not complete (`agent://FreshVerifier`).

## 4. Native parallel runtime: what is real today

### Lane policy is explicit
The runtime already has a typed lane matrix:
- `survey`, `research`, `comparison`, `verification`, and `documentation` are all read-only lanes with explicit reducer contracts.
- `owned_write` is the only exclusive-write lane and requires explicit persistence claims (`scripts/pi-oven-team/lane-policy.ts:79-139`).
- `classifyLaneForTask()` maps known roles into those lane types, while `assertLaneBatchIsIndependent()` rejects empty or colliding owned-write claims (`scripts/pi-oven-team/lane-policy.ts:167-209`).

### Batching is dependency-aware and conservative
- `buildDependencyAwareBatches()` rejects anything outside `read_only` or `owned_write`, fails on cycles, and runs collision checks before fan-out (`scripts/pi-oven-team/task-file-ops.ts:99-145`).
- This is a real policy engine, not a prompt convention.

### Where parallelism actually starts and where it still stops
- `planStartupWorkerBatches()` builds dependency-aware batch groups from startup plans (`scripts/pi-oven-team/runtime-v2.ts:141-163`).
- `executeStartupWorkerBatches()` parallelizes worker spawn **inside** a batch via `Promise.all`, but still reserves panes one by one before the parallel spawn phase (`scripts/pi-oven-team/runtime-v2.ts:181-230`).
- `startTeamV2()` still ensures worktrees and builds startup plans in a serial `for` loop before any batch execution (`scripts/pi-oven-team/runtime-v2.ts:286-323`).

### Test-backed proof
- Startup tests prove that independent verification lanes fan out before the first dispatch and persist latency evidence including `fanoutLatencyMs`, `sequentialComparableLatencyMs`, and `startupImprovementRatio` (`tests/scripts/pi-oven-team/runtime-v2.test.ts:117-158`).
- Scale-up tests prove the same fan-out evidence for expansion and also reject colliding owned-write lanes before worker spawn (`tests/scripts/pi-oven-team/scaling.test.ts:168-249`).

### Survey conclusion
pi-oven already has the **shape** of independence-gated parallel execution. The missing work is throughput polish and deeper integration, not lane-policy invention.

## 5. Model-routing surfaces and current codex-only readiness

### Current SoT layers
The routing system is spread across a small set of code-owned layers:

1. **Role/profile SoT** — `scripts/pi-oven-setup/profiles.ts`
   - `PROFILE_A` remains the release-default heterogeneous map.
   - `PROFILE_B` already defines a full Codex-only role matrix.
   - `PROFILE_C` and `PROFILE_D` keep all-Anthropic and all-opencode-zen routing live.
   - orchestrator roles and fallback chains are declared alongside the profiles (`scripts/pi-oven-setup/profiles.ts:300-532`).
2. **Apply/persist path** — `scripts/pi-oven-setup/apply.ts`
   - Profile B persists `model:thinkingLevel` selectors via `modelOverrideValue()`.
   - global scope writes `modelRoles` and `retry.fallbackChains`, and writes all 24 per-role overrides only for B/C/D.
   - project scope writes all 24 per-role overrides for **every** profile, including A (`scripts/pi-oven-setup/apply.ts:80-216`).
3. **Global vs project writers**
   - `config-yml.ts` owns strict read-merge-write for `~/.omp/agent/config.yml` (`scripts/pi-oven-setup/config-yml.ts:132-423`).
   - `project-settings.ts` owns deep-merge + prune/remove behavior for `<cwd>/.omp/settings.json` (`scripts/pi-oven-setup/project-settings.ts:194-363`).
4. **User override and import paths**
   - `override.ts` validates exact role ids and exact model ids before writing overrides (`scripts/pi-oven-setup/override.ts:33-129`).
   - `import.ts` still allows `opencode-zen/` and conditional `anthropic/` prefixes in addition to `openai-codex/` (`scripts/pi-oven-setup/import.ts:14-16,64-69,121-217`).
5. **Load-time provider boundary**
   - `getAllowedPrefixes()` and `validateAgentRegistry()` in `.omp/extensions/pi-oven.ts` still treat `opencode-zen`, `openai-codex`, and `anthropic` as acceptable live prefixes (`.omp/extensions/pi-oven.ts:238-364`).

### Codex-only readiness that already exists
`PROFILE_B` is not speculative; it already defines a reproducible codex-only matrix:
- orchestrator default: `openai-codex/gpt-5.4:high`
- orchestrator title: `openai-codex/gpt-5.4:medium`
- `gpt-5.5:xhigh`: verifier, critic, planner, code-reviewer, debugger, security-reviewer, code-simplifier, tracer, analyst, architect, oracle, deep-researcher
- `gpt-5.5:high`: executor, test-engineer, metis
- `gpt-5.4:high`: designer, qa-tester, data-runner
- `gpt-5.4:medium`: explorer, writer, git-master, document-specialist, librarian, multimodal-looker
- fallback chains: empty for both orchestrator roles (`scripts/pi-oven-setup/profiles.ts:305-332,361-532`)

Tests already lock this intent:
- every `PROFILE_B` primary must be `openai-codex/*`
- every alternate remains `opencode-zen/*`
- no mini/nano models are used in the Profile B matrix
- fallback chains stay empty (`tests/scripts/pi-oven-setup/profiles.test.ts:243-343`)

### What still keeps the repo mixed-provider by default
- README still describes heterogeneous Profile A as the release default and still documents Profile C and D as first-class routes (`README.md:231-270`).
- repo-local `CLAUDE.md` still presents heterogeneous Profile A and mixed-provider core design as the current baseline (`CLAUDE.md:7-11,50-71`).
- `/pi-oven:setup` still detects three provider families and presents A/B/C/D as live setup choices (`commands/setup.md:124-210,294-308`; `scripts/pi-oven-setup/auth-detect.ts:13-88`).
- `validateAgentRegistry()` and its tests still assume Anthropic is valid when present in agent frontmatter (`.omp/extensions/pi-oven.ts:246-364`; `tests/extensions/pi-oven.test.ts:141-153,176-233`).
- `lint-agents.ts` still enforces that agent frontmatter matches `PROFILE_A`, not a codex-only release baseline (`scripts/lint-agents.ts:167-214`).

## 6. Legacy compatibility surfaces that remain live

### CLI-level toggles
`/pi-oven:setup` still exposes and dispatches two explicit compatibility toggles:
- `--isolate` / `--no-isolate`
- `--suppress-sibling-skills` / `--no-suppress-sibling-skills`

These are described in the code itself as legacy compatibility toggles and still run after the primary profile action (`scripts/pi-oven-setup.ts:184-342`).

### Config-writing residue
- `PI_OVEN_SIBLING_SKILL_GLOBS` still hard-codes `superpowers:*` and `oh-my-claudecode:*` into `skills.ignoredSkills` management (`scripts/pi-oven-setup/config-yml.ts:636-645,699-764`).
- `disabledProviders` compatibility mode still manages `claude` and heals historical `claude-plugins` state (`scripts/pi-oven-setup/config-yml.ts:766-913`).
- `isolate.ts` still explains itself in terms of hiding the `~/.claude` home layer while leaving `claude-plugins` enabled (`scripts/pi-oven-setup/isolate.ts:1-59`).

### Public docs drift
These compatibility paths coexist awkwardly with the public “temporary compatibility boundary” language that now names only the vendored native worker runtime under `scripts/pi-oven-team/*`:
- `README.md:313-317`
- `commands/doctor.md:79-87`

Fresh verification correctly flagged this mismatch: the runtime still ships broader compatibility behavior than the docs now admit (`agent://FreshVerifier`).

## 7. Verifier depth and runtime trace surfaces

### Current control-plane observability
The runtime already exposes high-level trace primitives and a typed verifier policy:
- `RUNTIME_TRACE_PRIMITIVES` = `trace_function`, `summarize_failure_path`, `set_breakpoint_at_symbol`, `list_changed_runtime_state` (`.omp/extensions/pi-oven-runtime/trace-primitives.ts:1-18`).
- `classifyMutationScope()` distinguishes `docs_only`, `agent_surface`, `setup_surface`, `team_runtime`, and `runtime_contract`, which feeds verification depth decisions (`.omp/extensions/pi-oven-runtime/trace-primitives.ts:110-126`).
- `decideVerifierDepth()` elevates runtime-contract and team-runtime edits to deep verification, always requires fresh evidence, and applies a tighter autonomous hard cap for deep verification (`.omp/extensions/pi-oven-runtime/verifier-depth-policy.ts:3-83`).

### Survey conclusion
The runtime already knows how to decide **how much** verification a change deserves. What it still lacks is remediation-specific policy telling it that:
- codex-only routing is the new release baseline,
- effort approval must be collected through the deep-interview runtime,
- and survey/research artifacts must be detailed and code-grounded enough to qualify as implementation inputs.

## 8. Spec/plan workflow enforcement: what exists and what does not

### Existing workflow controls
- `spec-and-review` already requires a fresh survey before drafting and forces a Draft → Critic → Synthesize → Gate loop (`skills/spec-and-review/SKILL.md:24-109`).
- `writing-plans` already fixes the required `## Goal / ## Architecture / ## Tech Stack` header, bans placeholders such as `TBD` and `implement later`, and requires exact file paths (`skills/writing-plans/SKILL.md:24-118`).
- `pi-oven:planner` already requires verified file paths and symbols, a full-sweep survey for plugin-surface planning, and rejection of sampled surveys across core directories (`agents/pi-oven-planner.md:23-47`).

### Missing enforcement for this remediation wave
What is **not** yet reproducible in code:
- no validator today distinguishes a metadata-only survey from a code-grounded survey;
- no validator today requires research docs to include official-source links plus exact local change surfaces;
- no runtime or setup path currently forces a deep-interview approval flow before persisting per-agent effort/routing decisions;
- no release-facing doc/test path currently treats codex-only as the default policy.

This is the main documentation/control-plane gap that the remediation spec and plan need to close.

## 9. Remediation priorities from the current code state

### P0 — must land to make the new policy real
1. **Codex-only routing cutover**
   - Why P0: `PROFILE_B` is already implemented, but the repo-wide default, frontmatter baseline, setup flow, docs, and tests still describe a mixed-provider release (`scripts/pi-oven-setup/profiles.ts:300-532`, `README.md:231-270`, `CLAUDE.md:7-11,50-71`).
2. **Ask-driven per-agent effort approval flow**
   - Why P0: the deep-interview persistence substrate exists (`.omp/extensions/pi-oven-runtime/pi-oven-ask.ts:349-509`, `.omp/extensions/pi-oven-runtime/deep-interview-runtime.ts:139-210`), but no product path yet uses it to collect and store role-level routing/effort approval.
3. **Detailed-survey / code-grounded research enforcement**
   - Why P0: survey and plan skills already demand some rigor, but nothing currently guarantees that future remediation artifacts contain the detail level requested by the user (`skills/spec-and-review/SKILL.md:24-109`, `agents/pi-oven-planner.md:45-47`).

### P1 — strongly recommended after P0
1. **Retire legacy compatibility front doors**
   - Why P1: they are still active and tested, and they conflict with the newer “temporary compatibility boundary” narrative (`scripts/pi-oven-setup.ts:184-342`, `scripts/pi-oven-setup/isolate.ts:1-59`, `README.md:313-317`).
2. **Deep-interview parity uplift beyond basic state persistence**
   - Why P1: the state/runtime bundle is real, but richer topology/closure/render/headless parity is still absent (`.omp/extensions/pi-oven-runtime/deep-interview-render.ts:11-37`, `docs/harness/surveys/2026-07-04-external-harness-comparison.md:105-125`).

### P2 — follow after the control plane is aligned
1. **Further parallel-runtime throughput work**
   - Why P2: the lane-policy and batching core already exist; the remaining work is mostly serial bottleneck removal and broader reducer adoption (`scripts/pi-oven-team/runtime-v2.ts:181-323`).
2. **Residual documentation/prose cleanup in agent bodies and setup/doctor text**
   - Why P2: these are important for coherence, but they should follow the routing and approval cutover rather than precede it.

## Explicit unknowns
- Whether the final codex-only release should **delete** Profiles C/D outright or keep them behind a clearly unsupported/internal-only compatibility boundary is not yet locked in code.
- Whether effort approval UX should ask strictly one role at a time or allow grouped approval with per-role overrides remains a product decision, although the persisted state should still be per-role.
- Whether a future documentation validator should live in runtime verification, a standalone lint script, or both remains an implementation choice.

## Bottom line
The current branch already contains enough hard infrastructure to support the remediation wave: exact-skill proof gating, persisted deep-interview state, typed lane policy, and a fully specified codex-only routing matrix. The remaining work is to **promote those existing primitives into the default product path**, eliminate contradictory compatibility surfaces, and add code-backed enforcement that future survey/research/spec/plan artifacts meet the new detail standard.