# 2026-07-05 pi-oven codex-only routing research

## Scope
- Topic: codex-only transition for pi-oven, grounded in the current repo and OpenAI official guidance.
- Inputs:
  - `agent://CodexRoutingResearch`
  - `agent://CodexDocs`
  - current repo code and docs under `~/work/personal/pi-oven`
- Deliverable type: implementation-facing research memo, not a final design spec.
- Non-goals:
  - implementing the routing cutover
  - re-evaluating non-Codex providers as first-class release options
  - drafting the full remediation plan here

## Executive summary

### Recommendation
Use the existing `PROFILE_B` matrix as the canonical codex-only baseline and promote it from optional profile to release-default routing. This is the most reproducible path because:
1. the role-by-role matrix already exists in code (`scripts/pi-oven-setup/profiles.ts:345-532`),
2. the apply path already persists `:<thinkingLevel>` selectors for Profile B (`scripts/pi-oven-setup/apply.ts:80-82,184-191`), and
3. the fallback chains are already intentionally empty so usage-limit retries do not leak to OpenCode Zen (`scripts/pi-oven-setup/profiles.ts:329-332`; `tests/scripts/pi-oven-setup/profiles.test.ts:304-311`).

### Key finding
The codex-only transition is **not** just a profile toggle. To make it the actual product default, pi-oven must change:
- profile SoT and agent frontmatter baseline,
- load-time provider validation,
- setup/doctor/auth/import messaging,
- mixed-provider public docs,
- representative agent-body execution-context prose,
- and the tests that currently lock heterogeneous or Anthropic-only behavior.

### Product implication
The routing cutover should be paired with an ask-driven per-agent effort approval flow built on `pi-oven_ask` + deep-interview state. The runtime already supports durable round ids, approval handoff, and persisted resume state; the missing piece is using that machinery to approve the codex-only selector matrix before persistence (`.omp/extensions/pi-oven-runtime/pi-oven-ask.ts:36-42,349-509`, `.omp/extensions/pi-oven-runtime/deep-interview-runtime.ts:139-210`, `.omp/extensions/pi-oven-runtime/deep-interview-state.ts:3-68,244-394`).

## 1. Official guidance that supports the cutover

### 1.1 Codex model guidance
OpenAI’s current Codex docs explicitly position the GPT-5.5 / GPT-5.4 family as the recommended foundation for Codex work:
- [Codex Models](https://developers.openai.com/codex/models) recommends `gpt-5.5` for complex coding, computer use, knowledge work, and research workflows in Codex, and `gpt-5.4` as the strong flagship alternative.
- The same page says: “For most tasks in Codex, start with `gpt-5.5`,” and also notes that Chat Completions support is deprecated in Codex.

### 1.2 Reasoning guidance
OpenAI’s current reasoning docs reinforce the same routing direction:
- [Reasoning models](https://developers.openai.com/api/docs/guides/reasoning) describes GPT-5.5 as the best model family for Codex CLI-style reasoning workflows and suggests `gpt-5.4` as the lower-cost alternative.
- The same guide says reasoning models work better with the [Responses API](https://developers.openai.com/api/docs/guides/migrate-to-responses), which matters for any future pi-oven routing/runtime work that touches long-running or tool-heavy paths.

### 1.3 Latest-model caveats that matter for routing policy
OpenAI’s latest model guide adds two constraints that pi-oven must carry into its remediation design:
- [Latest model guide](https://developers.openai.com/api/docs/guides/latest-model): higher reasoning effort is **not automatically better**; it can overthink when stopping criteria are weak.
- `gpt-5.5` and `gpt-5.4` do not share the same default effort semantics. Per the model pages, [GPT-5.5](https://developers.openai.com/api/docs/models/gpt-5.5) defaults `reasoning.effort` to `medium`, while [GPT-5.4](https://developers.openai.com/api/docs/models/gpt-5.4) documents `none` as the default.

### 1.4 Tool/state/runtime guidance that should shape the transition
The cutover is not only about model names.
- [Migrate to the Responses API](https://developers.openai.com/api/docs/guides/migrate-to-responses): Responses is recommended for all new projects, and GPT-5.4+ tool-calling behavior is better there than in Chat Completions.
- [Using tools](https://developers.openai.com/api/docs/guides/tools): `tool_search` requires `gpt-5.4` or later, which means a codex-only 5.4/5.5 baseline is compatible with newer tool-surface patterns.
- [Background mode](https://developers.openai.com/api/docs/guides/background): long-running reasoning tasks can run asynchronously, but background mode is not Zero Data Retention compatible.
- [Agents observability](https://developers.openai.com/api/docs/guides/agents/integrations-observability): tracing is the default path for model/tool/handoff/guardrail visibility.
- [Guardrails and approvals](https://developers.openai.com/api/docs/guides/agents/guardrails-approvals): side-effecting tools should pause for human approval.
- [Agents orchestration](https://developers.openai.com/api/docs/guides/agents/orchestration): use manager-owned specialist calls when the manager should keep reply ownership.

## 2. Current repo architecture for model routing

## 2.1 Source-of-truth layers

### Profile and orchestrator SoT
- `scripts/pi-oven-setup/profiles.ts` is the primary routing SoT. It defines `PROFILE_A`, `PROFILE_B`, `PROFILE_C`, `PROFILE_D`, orchestrator role pairs, and runtime fallback chains (`scripts/pi-oven-setup/profiles.ts:300-532`).
- `PROFILE_B` is already the codex-only candidate. It assigns every role a Codex primary and an OpenCode Zen alternate (`scripts/pi-oven-setup/profiles.ts:345-532`).

### Persist/apply path
- `modelOverrideValue()` adds the `:<thinkingLevel>` suffix only for Profile B (`scripts/pi-oven-setup/apply.ts:80-82`).
- Global `runApply()` writes `modelRoles` and `retry.fallbackChains` for every profile, but writes all 24 `task.agentModelOverrides` only for B/C/D. Profile A remains orchestrator-only at global scope (`scripts/pi-oven-setup/apply.ts:84-216`).
- Project `runApply()` writes all 24 per-role overrides, `modelRoles`, and `retry.fallbackChains` for every profile, including A (`scripts/pi-oven-setup/apply.ts:141-170`).

### Global vs project routing stores
- Global routing persistence lives in `~/.omp/agent/config.yml` through `config-yml.ts` strict read-merge-write helpers (`scripts/pi-oven-setup/config-yml.ts:132-423`).
- Project routing persistence lives in `<cwd>/.omp/settings.json` through `project-settings.ts` deep-merge and prune/remove logic (`scripts/pi-oven-setup/project-settings.ts:194-363`).

### User-facing override/import paths
- `override.ts` validates every role and exact model id before writing, and supports both global and project scope (`scripts/pi-oven-setup/override.ts:33-129`).
- `import.ts` still allows `opencode-zen/` and optionally `anthropic/` prefixes in imported routing files, which is incompatible with a strict codex-only release default unless changed (`scripts/pi-oven-setup/import.ts:14-16,64-69,121-217`).

### Load-time provider validation
- `.omp/extensions/pi-oven.ts` computes allowed prefixes dynamically from agent frontmatter, but the hardcoded known set still includes `opencode-zen`, `openai-codex`, and `anthropic` (`.omp/extensions/pi-oven.ts:246-260`).
- `validateAgentRegistry()` logs errors for unknown providers, but not for Anthropic when Anthropic models are present in agent files (`.omp/extensions/pi-oven.ts:324-364`).

## 2.2 What is already codex-only in practice
The current `PROFILE_B` grouping is internally coherent and already test-backed:

| Selector | Roles | Evidence |
| --- | --- | --- |
| `openai-codex/gpt-5.5:xhigh` | verifier, critic, planner, code-reviewer, debugger, security-reviewer, code-simplifier, tracer, analyst, architect, oracle, deep-researcher | `scripts/pi-oven-setup/profiles.ts:376-524`; `tests/scripts/pi-oven-setup/profiles.test.ts:257-323` |
| `openai-codex/gpt-5.5:high` | executor, test-engineer, metis | `scripts/pi-oven-setup/profiles.ts:361-417,511-517`; `tests/scripts/pi-oven-setup/profiles.test.ts:257-323` |
| `openai-codex/gpt-5.4:high` | designer, qa-tester, data-runner | `scripts/pi-oven-setup/profiles.ts:432-452,525-531`; `tests/scripts/pi-oven-setup/profiles.test.ts:257-323` |
| `openai-codex/gpt-5.4:medium` | explorer, writer, git-master, document-specialist, librarian, multimodal-looker | `scripts/pi-oven-setup/profiles.ts:369-373,425-430,454-465,489-502`; `tests/scripts/pi-oven-setup/profiles.test.ts:257-323` |
| orchestrator `openai-codex/gpt-5.4:high` / `openai-codex/gpt-5.4:medium` | default / title | `scripts/pi-oven-setup/profiles.ts:305-308`; `tests/scripts/pi-oven-setup/profiles.test.ts:294-343` |
| fallback chains `[]` / `[]` | default / title | `scripts/pi-oven-setup/profiles.ts:329-332`; `tests/scripts/pi-oven-setup/profiles.test.ts:304-311` |

This matters because the repo already contains a **coherent codex-only recommendation matrix**. The remediation wave does not need to invent one.

## 3. Recommended per-agent effort matrix

### Design rule
Adopt `PROFILE_B` as the initial codex-only release baseline, and treat it as the default recommendation matrix that the user can approve or override via an ask-driven flow.

### Matrix

| Role | Recommended selector | Why this bucket |
| --- | --- | --- |
| executor | `openai-codex/gpt-5.5:high` | implementation-heavy, but not every execution task needs `xhigh` |
| explorer | `openai-codex/gpt-5.4:medium` | broad read/search fan-out should stay faster and cheaper |
| verifier | `openai-codex/gpt-5.5:xhigh` | highest-confidence completion gate |
| critic | `openai-codex/gpt-5.5:xhigh` | spec/plan/code quality gate benefits from extra deliberation |
| planner | `openai-codex/gpt-5.5:xhigh` | complex decomposition and risk shaping |
| code-reviewer | `openai-codex/gpt-5.5:xhigh` | structured defect finding and severity judgment |
| debugger | `openai-codex/gpt-5.5:xhigh` | causal tracing + tool-heavy investigation |
| test-engineer | `openai-codex/gpt-5.5:high` | high-signal tests, but not usually policy/oracle-grade |
| security-reviewer | `openai-codex/gpt-5.5:xhigh` | false negatives are costly |
| writer | `openai-codex/gpt-5.4:medium` | documentation fan-out; speed matters more than maximal reasoning |
| designer | `openai-codex/gpt-5.4:high` | design synthesis benefits from more effort, but not the heaviest tier |
| code-simplifier | `openai-codex/gpt-5.5:xhigh` | deletion safety and semantic preservation |
| qa-tester | `openai-codex/gpt-5.4:high` | browser/visual verification without escalation to 5.5 by default |
| git-master | `openai-codex/gpt-5.4:medium` | mostly mechanical, light judgment |
| document-specialist | `openai-codex/gpt-5.4:medium` | source lookup over deep architectural reasoning |
| tracer | `openai-codex/gpt-5.5:xhigh` | deep causal investigation |
| analyst | `openai-codex/gpt-5.5:xhigh` | evidence-heavy metric and log analysis |
| architect | `openai-codex/gpt-5.5:xhigh` | high-cost structural tradeoffs |
| librarian | `openai-codex/gpt-5.4:medium` | source reading and citation work |
| multimodal-looker | `openai-codex/gpt-5.4:medium` | current Profile B keeps vision on full `gpt-5.4`, not mini |
| oracle | `openai-codex/gpt-5.5:xhigh` | hardest strategic/debug consults |
| metis | `openai-codex/gpt-5.5:high` | requirements clarification without full verifier cost |
| deep-researcher | `openai-codex/gpt-5.5:xhigh` | synthesis across many sources |
| data-runner | `openai-codex/gpt-5.4:high` | evaluation/benchmark/data tasks need more than medium but less than 5.5 |
| orchestrator `default` | `openai-codex/gpt-5.4:high` | 1M context default, tool-capable, good manager baseline |
| orchestrator `title` | `openai-codex/gpt-5.4:medium` | fast/light title generation and metadata work |

### Why not switch to mini by default
OpenAI’s Codex docs do recommend `gpt-5.4-mini` for lighter coding tasks and subagents, but the current repo deliberately excludes mini/nano from Profile B (`tests/scripts/pi-oven-setup/profiles.test.ts:284-291`). Keeping the first codex-only release on `gpt-5.4` / `gpt-5.5` only is the safer migration choice because it changes **one axis** (provider family and effort policy) without adding a second axis (new lightweight default family) during the same remediation wave.

## 4. Exact code/doc/test change surfaces

## 4.1 Routing source of truth and persistence

| Surface | Why it must change | Evidence |
| --- | --- | --- |
| `scripts/pi-oven-setup/profiles.ts` | release-default baseline must move from heterogeneous `PROFILE_A` semantics toward codex-only defaults, or an equivalent new SoT | `scripts/pi-oven-setup/profiles.ts:300-532` |
| `scripts/pi-oven-setup/apply.ts` | global/project write behavior and profile semantics must align with the new default | `scripts/pi-oven-setup/apply.ts:80-216` |
| `scripts/pi-oven-setup/config-yml.ts` | routing writes stay here; import/legacy compatibility logic likely narrows | `scripts/pi-oven-setup/config-yml.ts:132-423,636-913` |
| `scripts/pi-oven-setup/project-settings.ts` | project-scope routing writes already support the target shape and need updated expectations/tests, not removal | `scripts/pi-oven-setup/project-settings.ts:194-363` |
| `scripts/pi-oven-setup/override.ts` | per-role override path is the natural destination for approved deviations from the recommended matrix | `scripts/pi-oven-setup/override.ts:33-129` |
| `scripts/pi-oven-setup/import.ts` | import whitelist must stop accepting non-Codex provider prefixes if the release becomes codex-only | `scripts/pi-oven-setup/import.ts:14-16,64-69,121-217` |
| `scripts/pi-oven-setup/auth-detect.ts` | setup auth summary and available-profile logic must stop treating Anthropic/opencode-zen release profiles as first-class defaults | `scripts/pi-oven-setup/auth-detect.ts:13-88` |

## 4.2 Load-time validation and agent frontmatter

| Surface | Why it must change | Evidence |
| --- | --- | --- |
| `.omp/extensions/pi-oven.ts` | allowed provider prefixes and registry validation must reflect codex-only release policy | `.omp/extensions/pi-oven.ts:246-364` |
| `scripts/lint-agents.ts` | currently enforces `PROFILE_A` frontmatter equality; baseline must move with the routing SoT | `scripts/lint-agents.ts:167-214` |
| `agents/pi-oven-*.md` frontmatter | committed fallback/default models must align with the new codex-only baseline | representative examples at `agents/pi-oven-critic.md:1-10`, `agents/pi-oven-planner.md:1-10`, `agents/pi-oven-multimodal-looker.md:1-10` |

## 4.3 Agent-body execution-context drift
The migration is not only frontmatter. Several agent bodies still narrate non-Codex execution contexts:

| File | Current drift | Evidence |
| --- | --- | --- |
| `agents/pi-oven-critic.md` | explicit Claude Opus execution context text | `agents/pi-oven-critic.md:59-68` |
| `agents/pi-oven-planner.md` | explicit “Claude Opus 4.8 at high reasoning” planner context | `agents/pi-oven-planner.md:42-47` |
| `agents/pi-oven-designer.md` | GLM-5.1 execution-context prose | `agents/pi-oven-designer.md:67-79` |
| `agents/pi-oven-code-reviewer.md` | GLM-5.1 review-context prose | `agents/pi-oven-code-reviewer.md:61-79` |
| `agents/pi-oven-git-master.md` | Claude Haiku-specific git-execution prose | `agents/pi-oven-git-master.md:42-50` |
| `agents/pi-oven-multimodal-looker.md` | Gemini Flash execution-context prose despite Codex primary | `agents/pi-oven-multimodal-looker.md:21-22,43-52` |
| `agents/pi-oven-document-specialist.md` | frontmatter is entirely OpenCode Zen today | `agents/pi-oven-document-specialist.md:1-10` |
| `agents/pi-oven-oracle.md` | explicit Opus reasoning context | `agents/pi-oven-oracle.md:41-45` |
| `agents/pi-oven-analyst.md` | GLM-5.1 execution-context prose | `agents/pi-oven-analyst.md:31-43` |

If the product becomes codex-only by default, these bodies must stop promising model-specific behavior that no longer matches the committed routing baseline.

## 4.4 Setup, doctor, README, repo-local guidance

| Surface | Why it must change | Evidence |
| --- | --- | --- |
| `commands/setup.md` | still teaches 3-provider auth detection and presents A/B/C/D as first-class profile choices | `commands/setup.md:124-210,294-308` |
| `commands/doctor.md` | provider-auth health still assumes `opencode-zen / openai-codex / anthropic` all matter equally | `commands/doctor.md:94-123` |
| `README.md` | still describes heterogeneous Profile A as release default and documents Profile C/D as regular user-facing options | `README.md:231-270` |
| `CLAUDE.md` | still names heterogeneous models and mixed-provider identity as the current baseline | `CLAUDE.md:7-11,50-71` |

## 4.5 Approval-flow and documentation-enforcement surfaces

| Surface | Why it must change | Evidence |
| --- | --- | --- |
| `.omp/extensions/pi-oven-runtime/pi-oven-ask.ts` | already supports `recommended` and `deepInterview`; should collect routing/effort approvals instead of only generic clarification | `.omp/extensions/pi-oven-runtime/pi-oven-ask.ts:36-42,349-509` |
| `.omp/extensions/pi-oven-runtime/deep-interview-runtime.ts` | already persists approval handoff and resume state; should become the durable store for effort approvals | `.omp/extensions/pi-oven-runtime/deep-interview-runtime.ts:173-210` |
| `.omp/extensions/pi-oven-runtime/deep-interview-state.ts` | already has round/stage/approval types; should extend to per-role approval records or a role-scoped equivalent | `.omp/extensions/pi-oven-runtime/deep-interview-state.ts:3-68,244-394` |
| `skills/spec-and-review/SKILL.md` | current survey precondition does not yet enforce “detailed, code-grounded” remediation artifacts | `skills/spec-and-review/SKILL.md:24-109` |
| `skills/writing-plans/SKILL.md` | current plan discipline is good, but does not yet require role-effort approval or research-doc quality gates | `skills/writing-plans/SKILL.md:24-118` |
| `agents/pi-oven-planner.md` | already rejects sampled surveys for plugin-surface planning; a remediation wave can tighten this into a reusable artifact-quality rule | `agents/pi-oven-planner.md:23-47` |

## 4.6 Tests that will need deliberate rewrites

| Test surface | Why it must change | Evidence |
| --- | --- | --- |
| `tests/scripts/pi-oven-setup/profiles.test.ts` | currently locks Profile B, C, D, and heterogeneous expectations separately | `tests/scripts/pi-oven-setup/profiles.test.ts:243-400` |
| `tests/extensions/pi-oven.test.ts` | currently treats Anthropic as a legitimate frontmatter/provider case | `tests/extensions/pi-oven.test.ts:141-153,176-233` |
| `tests/scripts/pi-oven-setup/apply.test.ts` | apply-path expectations will change when release-default routing semantics change | cited by `agent://CodexRoutingResearch` |
| `tests/plugin/pi-oven-doctor.test.ts` / setup-status tests | user-facing health/reporting strings and status semantics will change with the routing default | cited by `agent://FreshVerifier` and `commands/doctor.md:94-123` |

## 5. Ask-driven per-agent effort approval flow: research direction

### Why this is the right mechanism
OpenAI’s guardrail/approval guidance favors human approval before side effects, and pi-oven already has a durable question/answer/approval substrate. That makes the existing deep-interview runtime a better foundation than inventing a second approval mechanism.

### What the code already gives us
- durable round identity (`deriveRoundKey`) and merge semantics (`mergeDeepInterviewState`) (`.omp/extensions/pi-oven-runtime/deep-interview-state.ts:244-394`)
- persisted approval handoff metadata (`decisionKey`, `summary`, `status`) (`.omp/extensions/pi-oven-runtime/deep-interview-state.ts:8-29`)
- approval closure to `ready_to_resume` in the runtime (`.omp/extensions/pi-oven-runtime/deep-interview-runtime.ts:179-210`)
- `recommended` option support in the ask tool (`.omp/extensions/pi-oven-runtime/pi-oven-ask.ts:349-354,412-442`)

### Recommended approval model
1. **Persist approval per role**, even if the UX groups roles by shared recommendation bucket.
2. **Seed the recommended matrix from `PROFILE_B`**.
3. **Ask in buckets first, override per role second**:
   - wave 1: approve the recommended bucket as-is;
   - wave 2: if rejected, branch into role-level overrides;
   - final approval: persist exact chosen selector per role through the existing project/global routing writers.
4. **Keep the product answerable in code**: the persisted approval state should be readable independently of prompt history.

### Why not skip approval and just write the matrix
The user’s requirement is not simply “ship Profile B.” It is “make the codex-only routing and effort policy reproducible in code.” A user-facing approval record is part of that reproducibility, because it turns the recommended matrix into an explicit, persisted contract rather than an invisible default.

## 6. Caveats the remediation spec must carry forward

1. **Do not treat high effort as universally better.** OpenAI explicitly warns against that; effort should stay role- and task-sensitive.
2. **Do not reintroduce Chat Completions as the primary reasoning/tool fallback.** OpenAI’s current guidance points new reasoning/tool-heavy work to Responses instead.
3. **Do not silently preserve mixed-provider fallbacks in a codex-only release default.** If non-Codex routes remain, they must be called compatibility or internal modes, not part of the default policy.
4. **Do not forget agent-body prose.** Frontmatter-only cutover would leave contradictory execution-context instructions in the shipped agent definitions.
5. **Do not mix the routing cutover with a mini/nano default experiment in the same wave unless explicitly decided.** The current repo already excludes mini/nano from the codex-only matrix; preserving that constraint reduces migration risk.

## 7. Recommended sequence for the remediation wave

### P0
- Lock codex-only default routing around the current `PROFILE_B` matrix.
- Implement ask-driven per-agent effort approval on top of `pi-oven_ask` + deep-interview state.
- Update routing SoT, setup/doctor/auth/import logic, registry validation, docs, and core tests together.

### P1
- Rewrite agent-body execution-context prose to match the new codex-only baseline.
- Add documentation-quality enforcement so future survey/research/spec/plan outputs must be code-grounded and citation-rich.
- Retire or sharply demote legacy compatibility routing surfaces.

### P2
- Revisit optional lighter-weight Codex tiers only after the default cutover is stable.
- Use the newly stabilized routing and approval control plane as the base for broader runtime/parallel improvements.

## Explicit unknowns
- This research does not yet prove whether the routing-approval UX should ask by shared selector bucket first or by individual role first.
- This research does not yet prove whether non-Codex profiles should remain user-visible compatibility modes or move behind maintainer-only paths.

## Bottom line
The repo already contains a solid codex-only matrix and most of the persistence machinery needed to make it user-approvable. The real work is **systemic alignment**: promoting `PROFILE_B` from “available option” to “release-default truth,” removing contradictory mixed-provider messaging and tests, and binding the effort matrix to the existing deep-interview approval substrate. That gives pi-oven a codex-only routing story that is both officially defensible and reproducible in code.