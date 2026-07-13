> Historical architecture; implementation removed in vNext; OMP task is current dispatch seam
> Superseded by [the runtime contract remediation implementation plan](../plans/2026-07-13-pi-oven-runtime-contract-remediation-implementation-plan.md).

# 2026-07-05 pi-oven remediation design

## Document status
- Status: Ready for implementation planning and subagent dispatch
- Scope: remediation-wave design only; no code changes in this document
- Source repo: `~/work/personal/pi-oven`
- Primary evidence:
  - `docs/harness/surveys/2026-07-05-pi-oven-remediation-detailed-survey.md`
  - `docs/research/2026-07-05-pi-oven-codex-only-routing-research.md`
  - `docs/harness/surveys/2026-07-04-external-harness-comparison.md`
  - `docs/research/2026-07-04-harness-loop-engineering-sota.md`
  - `agent://FreshVerifier`

## Problem statement
pi-oven의 현재 메타 제어면은 중요한 토대를 이미 갖고 있습니다. exact skill proof 기반 code-write gate, project-local branch contract, deep-interview persisted state, dependency-aware native-worker lane policy, 그리고 완성된 Codex-only `PROFILE_B` matrix가 모두 현재 코드 안에 존재합니다 (`docs/harness/surveys/2026-07-05-pi-oven-remediation-detailed-survey.md`, 이하 remediation survey).

하지만 이 토대는 아직 제품 기본 경로로 정렬되어 있지 않습니다.

1. release-default routing은 여전히 heterogeneous `PROFILE_A`와 mixed-provider 문서/테스트를 중심으로 서술됩니다 (`README.md:231-270`, `CLAUDE.md:7-11,50-71`, `scripts/lint-agents.ts:167-214`).
2. deep-interview primitive는 존재하지만, ask-driven routing approval flow와 richer parity surface는 아직 부분 구현입니다 (`.omp/extensions/pi-oven-runtime/pi-oven-ask.ts:36-42,349-509`, `.omp/extensions/pi-oven-runtime/deep-interview-render.ts:11-37`, `docs/harness/surveys/2026-07-04-external-harness-comparison.md:105-125`).
3. spec/plan workflow는 survey precondition과 placeholder 금지를 갖고 있으나, future survey/research artifacts가 “detailed + code-grounded”인지 검증하는 코드 기반 enforcement는 없습니다 (`skills/spec-and-review/SKILL.md:24-109`, `skills/writing-plans/SKILL.md:24-118`).
4. legacy compatibility toggles는 여전히 live path이며 fresh verification에서도 BLOCK 원인으로 남았습니다 (`scripts/pi-oven-setup.ts:184-342`, `scripts/pi-oven-setup/config-yml.ts:636-913`, `agent://FreshVerifier`).

이번 remediation wave의 목적은 새 기능을 임시 문구로 덧대는 것이 아니라, 이미 존재하는 control-plane primitives를 이용해 **새 운영 규칙을 코드로 재현 가능하게 잠그는 것**입니다.

## Goals
1. pi-oven의 release-default routing을 Codex-only baseline으로 정렬한다.
2. per-agent model/effort 결정이 `pi-oven_ask` + deep-interview state를 통한 승인 흐름을 거치도록 만든다.
3. future survey/research/spec/plan artifacts에 대해 “detailed + code-grounded” 기준을 코드와 테스트에서 재현 가능하게 만든다.
4. deep-interview parity를 최소한 routing approval / resume / approval handoff에 필요한 수준까지 끌어올린다.
5. legacy compatibility surface를 bounded compatibility 또는 제거 대상으로 명확히 재분류한다.
6. runtime/control-plane/doc/test가 동일한 remediation policy를 가리키도록 정렬한다.

## Non-goals
1. 이번 문서에서 remediation wave 전체 구현을 수행하지 않는다.
2. full gajae team runtime import를 추진하지 않는다.
3. Codex-only cutover와 동시에 mini/nano default experiment를 수행하지 않는다.
4. 병렬 runtime 전체를 즉시 재작성하지 않는다.
5. 모든 non-Codex provider path를 반드시 즉시 삭제한다고 여기서 확정하지 않는다. 다만 default 정책에서 제외하는 것은 확정한다.

## Constraints
- 모든 주장은 현재 repo code/file evidence 또는 official-source links로 뒷받침되어야 한다.
- deep-interview, routing, documentation-enforcement 변경은 prompt-only policy가 아니라 runtime/code/test/documentation alignment로 재현 가능해야 한다.
- remediation wave는 P0/P1/P2 우선순위를 명확히 나누어야 한다.
- `PROFILE_B` matrix는 출발점으로 사용하되, 최종 persist 전에 user approval surface를 거쳐야 한다.
- fresh verification의 두 BLOCKER(legacy compatibility path, deep-interview parity partial)는 계획에 직접 반영되어야 한다.

## Design principles
1. **Promote what already exists.** 이미 존재하는 primitive를 제품 기본 경로로 승격한다. 새 substrate를 불필요하게 발명하지 않는다.
2. **State over lore.** routing approval, effort selection, survey/research quality, and compatibility status는 persisted state / code-owned validation / tests로 남긴다.
3. **Codex-only default, not codex-only folklore.** Codex-only는 README 문구가 아니라 profile SoT, setup flow, registry validation, docs, tests에 동시에 반영되어야 한다.
4. **Approval before persistence.** recommended routing matrix는 자동 적용이 아니라 ask-driven approval 이후 persist된다.
5. **Detailed evidence is a product rule.** survey/research detail 수준을 사람 기억에 맡기지 않는다.
6. **Compatibility is explicit or gone.** legacy path를 남긴다면 bounded compatibility로 문서/코드/테스트가 동일하게 설명해야 한다.

## Locked decisions

### 1. Codex-only release default
Release-default routing은 현재 `PROFILE_B` matrix를 baseline으로 삼는 Codex-only 방향으로 전환합니다. 근거는 이미 코드에 구현되어 있고 테스트로 잠겨 있는 matrix가 존재한다는 점입니다 (`scripts/pi-oven-setup/profiles.ts:345-532`, `tests/scripts/pi-oven-setup/profiles.test.ts:243-343`).

### 2. Ask-driven per-agent effort approval is mandatory
Per-agent selector/effort는 recommended matrix를 바로 persist하지 않고 `pi-oven_ask`와 native deep-interview runtime을 통해 승인받습니다. 이유는:
- runtime이 already durable round identity / approval handoff / resume state를 보유하고 있고 (`.omp/extensions/pi-oven-runtime/deep-interview-state.ts:3-68,244-394`, `.omp/extensions/pi-oven-runtime/deep-interview-runtime.ts:173-210`),
- OpenAI guidance도 side-effecting actions 앞에 approval을 두는 방향과 정렬되기 때문입니다 ([Guardrails and approvals](https://developers.openai.com/api/docs/guides/agents/guardrails-approvals)).

### 3. Survey/research artifacts must be detailed and code-grounded
이 remediation wave 이후 survey/research artifacts는 다음을 만족해야 합니다.
- exact file/module/symbol surface
- current-state summary with code or test evidence
- explicit unknowns
- where external guidance matters, official-source links
- implementation-facing implications

이 기준은 skill prose에만 적지 않고, 코드 또는 validator/test path에서 재현 가능하게 만듭니다. 현재는 이 정도 강제력이 없으므로 remediation scope에 포함합니다 (`skills/spec-and-review/SKILL.md:24-109`, `skills/writing-plans/SKILL.md:24-118`).

### 4. Compatibility front doors are not part of the normal control plane
`--isolate`, `--suppress-sibling-skills`, `disabledProviders`, and sibling-skill globs는 normal control-plane 설명에서 제거하거나 bounded compatibility path로 강등합니다. 지금처럼 live code와 public boundary description이 서로 다른 상태는 허용하지 않습니다 (`scripts/pi-oven-setup.ts:184-342`, `scripts/pi-oven-setup/config-yml.ts:636-913`, `README.md:313-317`, `commands/doctor.md:79-87`).

## P0 / P1 / P2 scope

## P0 — routing cutover and approval control plane
P0는 이 remediation wave의 필수 범위입니다. P0가 끝나야 이후 작업이 같은 truth를 가리킵니다.

### P0-A. Promote the codex-only matrix to default product routing
#### Required outcome
- default routing story, setup story, registry validation, and baseline tests all point at the same Codex-only release baseline.

#### Required change surfaces
- `scripts/pi-oven-setup/profiles.ts`
- `scripts/pi-oven-setup/apply.ts`
- `.omp/extensions/pi-oven.ts`
- `scripts/lint-agents.ts`
- `agents/pi-oven-*.md` frontmatter
- `README.md`, `CLAUDE.md`, `commands/setup.md`, `commands/doctor.md`
- routing tests including `tests/scripts/pi-oven-setup/profiles.test.ts`, `tests/extensions/pi-oven.test.ts`, and apply/setup/doctor status suites

#### Design rule
Adopt the current `PROFILE_B` matrix as the starting recommendation, not a newly invented table. That preserves today’s working role decomposition while removing mixed-provider default ambiguity.

### P0-B. Add ask-driven per-agent effort approval
#### Required outcome
Before writing the approved selector matrix into global or project routing state, pi-oven must capture user approval through the native deep-interview path.

#### Required behavior
- The approval flow starts from a recommended matrix seeded from the Codex-only baseline.
- Approval state is stored durably, not implied from chat history.
- The final persisted routing record is derivable from approved state.
- Resume after interruption uses the persisted approval/deep-interview state, not prompt reconstruction.

#### Recommended interaction model
- Group questions by shared recommendation bucket for UX efficiency.
- Persist approval **per role** so later overrides remain precise.
- Support “approve bucket,” “review specific role,” and “reject/revisit” branches.
- Treat final routing persistence as the post-approval side effect.

### P0-C. Enforce detailed survey/research artifact quality in code
#### Required outcome
Future survey/research artifacts used to justify implementation must be structurally checkable.

#### Required enforcement
At minimum, the remediation wave must make it possible to reject artifacts that lack:
- concrete repo file paths and code/test line anchors,
- implementation-facing module inventory,
- explicit gaps/unknowns,
- official-source links where external guidance is referenced.

#### Acceptable implementation shapes
- a documentation validator script invoked by verifier/test flows,
- a runtime verification gate that parses artifact structure,
- or both.

The exact mechanism is not locked here; the requirement that the rule be **reproducible in code** is locked.

## P1 — parity and compatibility cleanup

### P1-A. Deep-interview parity beyond persistence
#### Required outcome
The native deep-interview surface must cover the specific routing-approval use case comfortably and close the most visible parity gaps called out by the comparison survey.

#### Minimum parity target for this wave
- recommended labels already exist and stay intact (`.omp/extensions/pi-oven-runtime/deep-interview-render.ts:3-8`)
- approval handoff and resume stay durable (`.omp/extensions/pi-oven-runtime/deep-interview-runtime.ts:173-210`)
- topology / closure / approval stages become first-class in the UX/render path, not merely type names (`.omp/extensions/pi-oven-runtime/deep-interview-state.ts:3-24`)
- headless or unattended approval routing has an explicit contract

#### Not required in this wave
- importing the full external harness interview runtime wholesale
- perfect visual parity with every gajae-code TUI affordance

### P1-B. Retire or strictly bound legacy compatibility paths
#### Required outcome
The repo must stop presenting legacy compatibility toggles as ordinary routing/setup behavior.

#### Allowed end states
1. **Removal:** delete the live path and its tests/docs.
2. **Bounded compatibility:** keep the path, but mark it as compatibility-only with the same scope, owner, and removal condition in code comments, setup output, README, doctor guidance, and tests.

#### Forbidden end state
Keeping the current split where code still ships broader compatibility behavior than the public boundary description.

### P1-C. Rewrite agent-body execution-context prose
#### Required outcome
Representative agent bodies must stop asserting non-Codex runtime assumptions once the release default becomes codex-only.

#### Reason
Frontmatter-only migration would leave the shipped agent prompts internally contradictory (`agents/pi-oven-critic.md:59-68`, `agents/pi-oven-designer.md:67-79`, `agents/pi-oven-multimodal-looker.md:43-52`).

## P2 — throughput and final coherence work

### P2-A. Parallel-runtime throughput improvements
P2 should remove the remaining serial bottlenecks around pane reservation, worktree ensure, and outer batch sequencing after the routing/approval/control-plane story is stable (`scripts/pi-oven-team/runtime-v2.ts:181-323`).

### P2-B. Final documentation and verifier coherence
P2 should finish any remaining doc/test/validator cleanup so that release docs, doctor output, verifier expectations, and routing code all tell the same story.

## Runtime/control-plane changes required by this spec

## 1. Routing control plane
- The runtime must have one unambiguous release-default routing baseline.
- Registry validation must reject provider assumptions that are no longer part of the default contract.
- Setup and import flows must not silently preserve mixed-provider defaults under a codex-only release narrative.

## 2. Approval control plane
- `pi-oven_ask` + deep-interview state becomes the sole blessed path for routing/effort approvals.
- Approval must survive interruption and resume.
- Persistence to `.omp/settings.json` / `config.yml` happens only after approval resolves.

## 3. Documentation quality control plane
- Survey/research artifacts become verifiable inputs, not narrative attachments.
- The verifier path must be able to distinguish thin metadata-only docs from implementation-usable docs.
- The planner/spec author path must refuse weak evidence for plugin-surface remediation.

## 4. Compatibility classification control plane
- Compatibility residue must be explicitly classified and surfaced consistently.
- If retained, it must no longer masquerade as a normal routing/setup path.

## Documentation and test changes required by this spec

### Documentation must change together with code
These docs are no longer secondary:
- `README.md`
- repo-local `CLAUDE.md`
- `commands/setup.md`
- `commands/doctor.md`
- remediation survey/research/spec/plan descendants

The routing cutover is incomplete if these documents still describe the old mixed-provider default after the code changes.

### Tests must become policy carriers
The following test families are policy-carrying, not incidental:
- routing/profile tests
- extension registry validation tests
- setup/doctor/auth/reporting tests
- deep-interview runtime/state tests
- any new documentation-quality validator tests

The remediation wave should treat them as contract tests for the new policy.

## Acceptance criteria
This spec is satisfied only when the implementation plan can point to concrete work that will produce all of the following:

1. **Codex-only default is real**
   - default routing SoT, setup flow, docs, and tests all agree on the same codex-only baseline.
2. **Per-agent effort approval is durable**
   - the recommended matrix is presented through ask/deep-interview, approved or overridden, and then persisted.
3. **Detailed evidence rules are code-backed**
   - survey/research artifact quality is checkable through code/test/verifier logic, not only prose.
4. **Compatibility drift is resolved**
   - legacy compatibility paths are either removed or consistently bounded.
5. **Deep-interview parity is sufficient for routing approval**
   - routing approval/resume/handoff no longer rely on prompt-only behavior.

## Residual open questions
1. Should non-Codex profiles remain available as explicit compatibility/dev-only profiles, or should they be removed entirely from the user-facing setup path?
2. Should effort approval be collected strictly role-by-role, or as bucket approvals with optional per-role drill-down? The persisted result should still be per-role in either case.
3. Should documentation-quality enforcement live only in verifier/test flows, or also fail earlier during spec/plan authoring?

## Bottom line
이번 remediation wave는 새 원칙을 설명하는 문서를 더 만드는 작업이 아닙니다. 현재 코드에 이미 존재하는 exact proof gate, deep-interview state, lane policy, and Codex-only matrix를 하나의 제품 기본 경로로 정렬하는 작업입니다. P0는 그 정렬을 routing + approval + artifact-quality enforcement에 적용하고, P1은 parity/compatibility 모순을 정리하며, P2는 throughput과 잔여 coherence를 마무리합니다.
