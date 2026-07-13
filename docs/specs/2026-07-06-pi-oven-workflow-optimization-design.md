> Historical; do not copy runtime syntax examples from this document.
> Historical architecture; implementation removed in vNext; OMP task is current dispatch seam
> Superseded by [the runtime contract remediation implementation plan](../plans/2026-07-13-pi-oven-runtime-contract-remediation-implementation-plan.md).

# 2026-07-06 pi-oven workflow optimization + gajae-style deep-interview redesign

## Document status
- Status: Approved design, ready for implementation planning and tranche execution
- Scope: workflow optimization, provider-agnostic fresh-agent verification/routing language, gajae-style brainstorming/deep-interview parity, `pi-oven_ask` UI/schema redesign
- Non-scope for this document: this document does not itself execute runtime code changes; it defines the runtime/docs/test cutover plan, excludes the critic verdict artifact itself, and forbids dual-path compatibility shims
- Source repo: `~/work/personal/pi-oven`
- Primary evidence:
  - `docs/harness/surveys/2026-07-06-workflow-parallelism-optimization-survey.md`
  - `docs/harness/surveys/2026-07-06-gajae-deep-interview-flow-survey.md`

## Goals
1. Provider-specific `codex/zen/opus` wording을 workflow/verification/agent guidance에서 제거하고, **현재 세션 provider family 기반** contract로 단일화한다.
2. fresh-agent verification과 high-risk review fan-out을 **same-provider family only** 규칙으로 재정의한다.
3. `brainstorming` / native deep-interview를 gajae의 구조에 최대한 가깝게 확장하되, pi-oven의 explicit approval handoff를 유지하는 **hybrid** 모델로 정렬한다.
4. deep-interview의 completion boundary를 **spec file persistence**로 고정하고, 그 이전에는 edit/write/`ast_edit`를 gate 차원에서 차단한다.
5. `pi-oven_ask`를 image-style TUI로 재설계하고, per-option description·`Other`·`Ask about these choices`·context headers를 1급 contract로 승격한다.
6. gate hot-path와 native worker startup에서 관측 가능한 상대 성능 개선 목표와 benchmark 증거 계약을 도입한다.
7. staged cutover로 구현해, 새 contract가 들어오는 tranche에서 기존 의미를 즉시 퇴역시키고 장기 dual-path를 남기지 않는다.

## Non-goals
1. external harness의 deep-interview runtime 전체를 wholesale import하지 않는다.
2. 새로운 workflow store를 greenfield로 만들지 않는다. 현재 `.pi-oven/state/autonomous.json` 기반 control-plane 위에서 진화시킨다.
3. `pi-oven_ask`를 multi-select/general form engine으로 확장하는 작업은 이번 범위가 아니다.
4. planner / verifier / critic routing을 provider family 밖으로 fan-out하는 fallback 계층은 이번 설계의 정상 경로가 아니다.
5. native worker throughput 개선을 이유로 lane collision rule, dependency-aware batch semantics, or proof gate correctness를 약화하지 않는다.

## Approved decisions
1. skills/reference docs/agent guidance/runtime help 전반에서 provider-specific `codex/zen/opus` wording을 제거하고, 현재 세션 provider family 기준으로 서술한다.
2. provider choice의 실행 SoT는 runtime이다. setup/profile/status는 guard/visibility 계층이며 실행 주체가 아니다.
3. high-risk review는 여러 fresh agent로 fan-out할 수 있지만, 같은 provider family 내부에서만 허용한다.
4. gajae ambiguity math와 round-complete output shape는 가능한 한 축소 없이 복제한다.
5. deep-interview는 spec/handoff까지 수렴한 뒤 explicit pi-oven approval handoff로 넘어가는 hybrid 모델을 택한다.
6. spec file persistence가 deep-interview completion boundary다.
7. brainstorming/deep-interview active state는 적절한 boundary 전까지 edit/write/`ast_edit`를 block해야 한다.
8. `pi-oven_ask`는 image-style TUI를 채택하고, per-option description·`Other`·`Ask about these choices`를 first-class affordance로 제공한다.
9. ask UI context headers는 공통 `pi-oven_ask` schema에 포함되며, 데이터 모델은 structured metadata + markdown body의 혼합형으로 설계한다.
10. speed track은 gate hot-path와 native worker startup 둘 다 포함하며, 상대 개선 목표와 benchmark evidence를 요구한다.
11. rollout은 staged cutover이며, 오래 남는 dual-path shim을 허용하지 않는다.

## Current-state evidence

### 1. Provider-family policy와 workflow wording이 분리돼 있다
- workflow survey는 `spec-and-review` / `pattern-loop` / `pi-oven:critic` / `autonomous-loop` / `fresh-verifier`가 각각 Codex/Zen/Opus/Sonnet wording을 서로 다르게 고정하고 있음을 보여준다 (`docs/harness/surveys/2026-07-06-workflow-parallelism-optimization-survey.md:89-116`).
- 실제 runtime validator는 release-default allowlist를 `openai-codex` + `opencode-zen`으로 고정하고 있고, `captureSessionModel()`은 parent session model을 별도로 기록한다 (`.omp/extensions/pi-oven.ts:241-364`, `:376-387`, `:727-728`, `:1036-1039`).
- 즉, 실행 현실은 runtime에 있고, workflow prose만 provider-specific 관성을 끌고 있는 상태다.

### 2. Deep-interview는 persisted primitive가 있지만, gajae parity에 필요한 state가 없다
- current pi-oven state는 `stage`, `phase`, `component`, `dimension`, `ambiguity`, `approvalHandoff`, `routingApproval` 정도만 저장한다 (`.omp/extensions/pi-oven-runtime/deep-interview-state.ts:9-79`).
- `createDeepInterviewRuntime()`는 question seed / answer record / approval pending / ready-to-resume만 처리한다 (`.omp/extensions/pi-oven-runtime/deep-interview-runtime.ts:24-39`, `:211-429`).
- workflow survey도 topology / ontology / weakest-target / milestone / richer ambiguity UI field가 없음을 명시한다 (`docs/harness/surveys/2026-07-06-workflow-parallelism-optimization-survey.md:118-143`).
- gajae survey는 반대로 threshold, nested envelope, answered→scored lifecycle, topology state, trigger validation, ontology snapshots, spec persistence, mutation guard를 모두 runtime-owned contract로 갖고 있음을 보여준다 (`docs/harness/surveys/2026-07-06-gajae-deep-interview-flow-survey.md:130-257`, `:261-309`, `:313-424`, `:585-645`, `:649-757`).

### 3. `pi-oven_ask`는 이미 deep-interview-aware지만 UI/schema가 너무 얕다
- current `pi-oven_ask` payload는 `question`, `options`, `recommended`, `deepInterview`만 공개한다 (`.omp/extensions/pi-oven-runtime/pi-oven-ask.ts:351-356`, `:489-554`).
- render path는 plain title + one-line deep-interview summary + options list 정도만 보여준다 (`.omp/extensions/pi-oven-runtime/pi-oven-ask.ts:214-343`).
- workflow survey는 이것이 gajae-style richer contract를 담기엔 부족하다고 지적한다 (`docs/harness/surveys/2026-07-06-workflow-parallelism-optimization-survey.md:120-142`).
- gajae survey는 structured ask metadata가 authoritative stage-state이며, regex parsing은 compatibility fallback일 뿐이라고 정리한다 (`docs/harness/surveys/2026-07-06-gajae-deep-interview-flow-survey.md:438-494`).

### 4. Deep-interview mutation boundary는 현재 gate에 없다
- current gate stack은 branch contract / skill proof / external consent / verifier-depth에 집중되어 있고, code-write gate는 `write`/`edit`/`ast_edit`만 공통 처리한다 (`.omp/extensions/pi-oven-runtime/gate.ts:77-91`, `:328-521`, `.omp/extensions/pi-oven-runtime/gate-handler.ts:280-347`).
- `turn_start`는 `deepInterview` state를 유지하지만 code-write 허용 여부에 반영하지 않는다 (`.omp/extensions/pi-oven.ts:893-975`, `:1053-1113`).
- gajae는 deep-interview active 동안 mutation guard를 별도 runtime/tooling contract로 둔다 (`docs/harness/surveys/2026-07-06-gajae-deep-interview-flow-survey.md:649-757`).

### 5. Throughput는 이미 부분 fan-out이 있지만 두 병목이 남아 있다
- native worker runtime은 batch 내부 parallelism이 있으나 outer batch barrier, split-target chain, startup 전 ordered persistence가 남아 있다 (`docs/harness/surveys/2026-07-06-workflow-parallelism-optimization-survey.md:68-87`, `:219-226`).
- gate hot path는 parent-session write lane마다 file-backed FSM read/write를 반복한다 (`docs/harness/surveys/2026-07-06-workflow-parallelism-optimization-survey.md:54-67`, `:228-233`).

## Architecture changes

### 1. Execution SoT split: runtime owns provider family, setup/profile/status mirror it
도입 구조는 다음과 같다.

- **Runtime execution layer**
  - current session model prefix에서 `sessionProviderFamily`를 도출한다.
  - fresh-agent verification, critic fan-out, routing approval recommendation materialization은 이 family를 기준으로 동작한다.
  - primary surfaces: `.omp/extensions/pi-oven.ts`, `.omp/extensions/pi-oven-runtime/model-routing-approval.ts`, `.omp/extensions/pi-oven-runtime/skill-keyword-loader.ts`.
- **Profile/setup/status layer**
  - `scripts/pi-oven-setup/profiles.ts`, `apply.ts`, `status.ts`는 available family matrix와 visibility/reporting만 담당한다.
  - runtime이 선택한 family와 충돌하는 wording이나 fallback folklore를 제공하지 않는다.
- **Skill/agent prose layer**
  - `skills/spec-and-review/SKILL.md`, `skills/spec-and-review/references/pattern-loop.md`, `skills/fresh-verifier/SKILL.md`, `skills/autonomous-loop/SKILL.md`, `skills/large-task-delegation/SKILL.md`, `skills/receiving-code-review/SKILL.md`, `agents/pi-oven-critic.md`, `agents/pi-oven-verifier.md`, `agents/pi-oven-planner.md`에서 provider names를 symbolic contract로 교체한다.

### 2. Hybrid brainstorming/deep-interview pipeline
새 pipeline은 gajae의 `clarify -> spec -> handoff` 구조를 따르되, pi-oven의 explicit approval handoff를 분리된 runtime state로 유지한다.

1. `brainstorming`가 topology/ambiguity/closure loop를 진행한다.
2. completion boundary는 자유로운 임의 write가 아니라 **runtime-owned sanctioned completion action** 이다. 이 action은 final `docs/specs/...` persistence와 `deepInterview -> approvalFlow` state transition을 한 경계 이벤트로 수행한다.
3. 그 sanctioned completion action이 성공하면 deep-interview는 completion boundary에 도달한다.
4. 그 직후 runtime은 **separate approval handoff state**를 seed한다.
5. approval handoff는 `writing-plans`, `refine further`, `routing approval`, or other repo-sanctioned next step을 묻는 explicit `pi-oven_ask` flow로 이어진다.
6. deep-interview 자체는 approval pending을 소유하지 않는다.

이것은 gajae의 “deep-interview는 handoff까지만, pending approval은 후속 phase가 소유” 패턴을 복제하되, pi-oven에서 approval handoff를 native ask/runtime 계층으로 유지하는 intentional divergence다 (`docs/harness/surveys/2026-07-06-gajae-deep-interview-flow-survey.md:573-645`, `:769-807`). 동시에 mutation guard deadlock을 피하기 위해, spec persistence는 일반 write 예외가 아니라 **하나의 canonical completion path** 로만 허용한다.

### 3. One canonical ask contract for both interview and approval flows
`pi-oven_ask`는 더 이상 “single-select + note” 수준의 thin wrapper가 아니다. deep-interview, approval handoff, routing approval, and user-owned decision UX의 canonical UI bridge가 된다.

### 4. Two independent speed lanes
- **Lane A — gate hot-path I/O reduction**: proof semantics는 유지하되 turn-local snapshot reuse / coalesced persistence / mutation guard integration으로 code-write latency를 낮춘다.
- **Lane B — native worker startup throughput**: lane independence를 유지한 채 startup barriers를 줄인다.

## State model changes

### 1. DeepInterview state는 V2 envelope로 승격한다
현재 flat-ish shape 대신 gajae-style nested envelope를 채택한다. 구현 surface는 `.omp/extensions/pi-oven-runtime/deep-interview-state.ts`, `.omp/extensions/pi-oven-runtime/deep-interview-runtime.ts`, `.omp/extensions/pi-oven-runtime/deep-interview-render.ts`, `.omp/extensions/pi-oven.ts`, `tests/extensions/pi-oven-runtime/deep-interview-state.test.ts`, `deep-interview-runtime.test.ts`, `wiring.test.ts`다.

```ts
interface DeepInterviewStateV2 {
  version: 2;
  interviewId: string;
  active: boolean;
  phase: "idle" | "interviewing" | "handoff" | "complete";
  threshold?: number;
  thresholdSource?: "session" | "project" | "user" | "default";
  spec?: {
    path: string;
    sha256: string;
    persistedAt: string;
    stage: "draft" | "final";
  };
  state: {
    initialIdea?: string;
    rounds: DeepInterviewRoundRecordV2[];
    establishedFacts: DeepInterviewEstablishedFact[];
    topology?: DeepInterviewTopology;
    ontologySnapshots: DeepInterviewOntologySnapshot[];
    currentAmbiguity?: number;
    milestone?: "initial" | "progress" | "refined" | "ready";
    nextTarget?: {
      componentId: string;
      dimension: "goal" | "constraints" | "criteria" | "context";
      rationale: string;
    };
  };
}
```

### 2. Round lifecycle는 `answered -> scored` enrichment를 지원해야 한다
현재 lifecycle은 `pending | answered | cancelled`뿐이다 (`.omp/extensions/pi-oven-runtime/deep-interview-state.ts:9-12`, `:444-479`).
V2에서는 다음으로 바꾼다.

```ts
type DeepInterviewRoundLifecycle = "pending" | "answered" | "scored" | "cancelled";
```

`DeepInterviewRoundRecordV2`는 아래 필드를 추가한다.
- `scores: Partial<Record<"goal" | "constraints" | "criteria" | "context", number>>`
- `ambiguityAtAsk?: number`
- `ambiguity?: number`
- `triggers?: DeepInterviewTrigger[]`
- `topologySummary?: string`
- `ontologySummary?: string`
- `milestone?: "initial" | "progress" | "refined" | "ready"`
- `nextTarget?: { componentId: string; dimension: string; rationale: string }`

이 수치는 skill prose가 계산하고 runtime이 validate/persist하는 split을 유지한다. 즉, **math는 `skills/brainstorming/SKILL.md`**, validation/merge는 runtime이 담당한다 (`docs/harness/surveys/2026-07-06-gajae-deep-interview-flow-survey.md:313-391`, `:723-767`).

### 3. Approval state는 deepInterview에서 분리한다
현재 `approvalHandoff`와 `routingApproval`은 `deepInterview` 내부 상태다 (`.omp/extensions/pi-oven-runtime/deep-interview-state.ts:69-79`). 이 설계는 spec persistence completion boundary와 충돌한다. 따라서 root control-plane state에 별도 `approvalFlow`를 추가한다.

```ts
interface ApprovalFlowState {
  version: 1;
  active: boolean;
  kind: "spec-handoff" | "routing-bucket" | "routing-role";
  source: "brainstorming" | "setup" | "status" | "manual";
  decisionKey: string;
  summary: string;
  status: "pending" | "approved" | "rejected" | "cancelled";
  recommended?: unknown;
  resolved?: unknown;
  pendingQuestion?: PiOvenAskPendingQuestion;
  resumedFrom?: { interviewId?: string; specPath?: string };
  requestedAt: string;
  resolvedAt?: string;
}
```

구현 surface:
- `.omp/extensions/pi-oven-runtime/gate-state.ts` — root persisted schema
- `.omp/extensions/pi-oven-runtime/deep-interview-runtime.ts` — sanctioned spec persistence 시 handoff seed
- `.omp/extensions/pi-oven-runtime/model-routing-approval.ts` — routing approval materialization/result expansion
- `.omp/extensions/pi-oven-runtime/deep-interview-render.ts` — resume/contract 출력의 approval ownership cutover
- `.omp/extensions/pi-oven-runtime/pi-oven-ask.ts` — approval metadata 소비와 resume-safe action result
- `.omp/extensions/pi-oven.ts` — prompt injection / resume wiring
- tests: `tests/extensions/pi-oven-runtime/deep-interview-runtime.test.ts`, `deep-interview-state.test.ts`, `pi-oven-ask.test.ts`, `trace-primitives.test.ts`, `wiring.test.ts`, `gate-state.test.ts`
- **Mutation-guard carve-out:** `deepInterview.active === true` 상태에서도 boundary-clearing action 하나는 예외로 허용해야 한다. 구체적으로는 runtime-owned final spec persistence (`docs/specs/...`)와 그 직후의 `deepInterview -> approvalFlow` state mutation만 허용하고, 그 외 `write`/`edit`/`ast_edit`는 계속 차단한다.
- **No partial cutover:** approval ownership을 옮기는 tranche가 끝나면 runtime render/ask/resume consumer 어디에서도 `deepInterview.approvalHandoff` / `deepInterview.routingApproval`를 canonical path로 읽지 않는다.

### 4. Migration rule
- old `deepInterview.approvalHandoff` / `deepInterview.routingApproval`는 **read-time migration only**로 받아들인다.
- 단, rollout sequencing상 T2-A 단계에서는 이 legacy nested approval payload를 lossless pass-through로 유지한다. 즉, T2-B approvalFlow extraction이 landing하기 전까지는 V2 canonical persist가 그 payload를 드롭하면 안 된다.
- T2-B가 완료된 다음 persist부터 canonical write는 `approvalFlow` + `DeepInterviewStateV2`로만 수행한다.
- long-lived dual writer는 금지한다.
- migration safety는 `normalizeDeepInterviewState()` / new `normalizeApprovalFlowState()` tests로 잠근다.

## Ask UI contract

### 1. Payload schema
`pi-oven_ask`는 아래 mixed structured+markdown input을 canonical contract로 채택한다.

```ts
interface PiOvenAskContextHeader {
  title: string;
  value?: string;
  tone?: "info" | "accent" | "warning" | "success";
}

interface PiOvenAskContextSection {
  title: string;
  bodyMarkdown?: string;
  bullets?: string[];
}

interface PiOvenAskOption {
  label: string;
  description?: string;
  detailMarkdown?: string;
}

interface PiOvenAskPayload {
  question: string;
  contextHeaders?: PiOvenAskContextHeader[];
  contextSections?: PiOvenAskContextSection[];
  options: PiOvenAskOption[];
  recommended?: number;
  affordances?: {
    other?: boolean;
    askAboutChoices?: boolean;
  };
  deepInterview?: DeepInterviewAskMetadataV2;
  approval?: ApprovalFlowAskMetadata;
}
```

### 2. Result schema
결과는 단순 `selected/customInput`에서 다음으로 확장한다.

```ts
interface PiOvenAskResult {
  mode: "single";
  question: string;
  action: "selected" | "other" | "ask_about_choices" | "deferred" | "cancelled";
  selected?: string;
  customInput?: string;
  recommended?: number;
  deepInterview?: DeepInterviewAskMetadataV2;
  approval?: ApprovalFlowAskMetadata;
}
```

- title/layout은 image-style tool UI와 같은 hierarchy를 사용한다: **tool title → context headers → markdown question/context → options → outcome**.
- `Other (type your own)`는 hidden fallback이 아니라 explicit row다.
- `Ask about these choices`는 selection과 별개의 first-class row다. 이 action은 새로운 explanatory ask를 열거나 기존 context를 확장하는 branch로 연결된다.
- `affordances.other` / `affordances.askAboutChoices`는 단순 힌트가 아니라 **row visibility + action validity contract** 다. 값이 false면 해당 row/action은 UI/headless 양쪽에서 나타나지 않고, trace/result에도 그 action이 기록되지 않는다.
- recommended option은 suffix만 붙이는 현재 동작을 유지하되, header chip / option description / result summary에도 일관되게 반영한다.
- per-option `description`은 유지하고, 긴 설명은 `detailMarkdown`으로 확장한다.
- runtime render는 text-first summary도 남기되, structured headers가 authoritative다.
- UI path와 headless approval/workflowGate path는 동일한 `selected | other | ask_about_choices | deferred | cancelled` action semantics를 가져야 한다.

### 4. File and test surfaces
- `.omp/extensions/pi-oven-runtime/pi-oven-ask.ts`
- `.omp/extensions/pi-oven-runtime/deep-interview-render.ts`
- `.omp/extensions/pi-oven-runtime/deep-interview-runtime.ts`
- `.omp/extensions/pi-oven.ts`
- `tests/extensions/pi-oven-runtime/pi-oven-ask.test.ts`
- `tests/extensions/pi-oven-runtime/deep-interview-runtime.test.ts`
- `tests/extensions/pi-oven-runtime/deep-interview-state.test.ts`
- `tests/extensions/pi-oven-runtime/wiring.test.ts`

## Provider-routing contract

### 1. Current-session provider family is the only execution default
- runtime은 current parent session model prefix를 `sessionProviderFamily`로 해석한다.
- critic / verifier / planner / review fan-out wording은 모두 “same-provider fresh agent”로 바뀐다.
- explicit model name은 profile/setup/status/reporting layer에서만 나타난다.

### 2. Same-family multi-agent review rule
- 기본 path: single fresh agent in current provider family.
- high-risk path: 2개 이상 fresh agent fan-out 허용.
- 단, 모두 같은 provider family여야 한다.
- family 내부 selector variation은 runtime/provider policy가 정한다. family에 대체 selector가 하나뿐이면 동일 selector의 독립 fresh context fan-out도 허용한다.

### 3. Routing materialization contract
`model-routing-approval.ts`는 더 이상 `PROFILE_B` hardcode만을 기준으로 하지 않는다 (`.omp/extensions/pi-oven-runtime/model-routing-approval.ts:1-105`).
대신 다음 입력을 받는다.
- runtime family (`openai-codex`, `anthropic`, `opencode-zen`, etc.)
- release-default role matrix
- optional project/global override visibility

출력은 계속 role별 recommended selector + bucket grouping + approval expansion이지만, family는 runtime SoT를 따른다.

### 4. Documentation/runtime help cutover surfaces
- `skills/spec-and-review/SKILL.md`
- `skills/spec-and-review/references/pattern-loop.md`
- `skills/fresh-verifier/SKILL.md`
- `skills/autonomous-loop/SKILL.md`
- `skills/large-task-delegation/SKILL.md`
- `skills/receiving-code-review/SKILL.md`
- `.omp/extensions/pi-oven-runtime/skill-keyword-loader.ts`
- `agents/pi-oven-critic.md`
- `agents/pi-oven-verifier.md`
- `agents/pi-oven-planner.md`
- `agents/pi-oven-*.md` execution-context headers that still assert provider-specific fan-out lore
- `scripts/pi-oven-setup/profiles.ts`, `apply.ts`, `status.ts`
- `.omp/extensions/pi-oven.ts` (`getAllowedPrefixes`, `validateAgentRegistry`, session model capture consumers)
- tests: `tests/extensions/pi-oven.test.ts`, `tests/scripts/pi-oven-setup/profiles.test.ts`, `tests/scripts/pi-oven-setup/status.test.ts`
- provider-routing test matrix에는 unsupported family와 “current session family does not map to a supported release path” negative-path를 포함해, runtime이 fail-open wording이 아니라 명시적 refusal/diagnostic을 내는지 검증한다.

## Performance contract

### 1. Gate hot-path target
Scope surfaces:
- `.omp/extensions/pi-oven-runtime/gate-handler.ts`
- `.omp/extensions/pi-oven-runtime/gate-state.ts`
- `.omp/extensions/pi-oven-runtime/gate.ts`
- `.omp/extensions/pi-oven.ts` (`turn_start` snapshotting / reminder wiring)
- tests: `tests/extensions/pi-oven-runtime/gate-handler.test.ts`, `gate.test.ts`, optionally a new focused benchmark test if current suites are too indirect

Required contract:
- exact proof semantics are unchanged: branch contract, owned skill read target proof, external consent, and mutation guard decisions must remain byte-for-byte equivalent for the same state.
- same-turn repeated code-write checks should reuse turn-local snapshot/state where safe.
- relative goal: **≥25% reduction** in median synthetic same-turn code-write gate latency, or equivalent measurable reduction in state-store read/write count, with benchmark evidence checked into tests.

### 2. Native worker startup target
Scope surfaces:
- `scripts/pi-oven-team/runtime-v2.ts`
- `scripts/pi-oven-team/task-file-ops.ts`
- `scripts/pi-oven-team/team-config.ts`
- `tests/scripts/pi-oven-team/runtime-v2.test.ts`
- `tests/scripts/pi-oven-team/scaling.test.ts`
- `tests/scripts/pi-oven-team/lane-policy.test.ts`
- `tests/scripts/pi-oven-team/task-file-ops.test.ts`

Unchanged supporting surfaces:
- `scripts/pi-oven-team/index.ts`
- `scripts/pi-oven-team/lane-policy.ts`

Required contract:
- dependency-aware batches and collision rejection remain intact.
- launcher boundary and lane classification semantics remain unchanged; throughput work stays inside startup batching/persistence execution.
- read-only / verification lanes에 대해 outer batch barrier를 줄일 수 있는지 검증한다.
- relative goal: existing batch-start benchmark 대비 **≥20% wall-clock improvement** 또는 `startupImprovementRatio` equivalent uplift를 테스트 증거로 남긴다.
- startup barrier 완화는 기존 independent-lane benchmark만으로 승인하지 않는다. 최소한 “dependency-bearing writer lane + read-only/verification lane” 혼합 batch에서 ordering/collision semantics가 유지되는 correctness case를 `tests/scripts/pi-oven-team/runtime-v2.test.ts` 또는 동급 suite에 추가해야 한다.
- performance evidence는 “faster in theory”가 아니라 persisted/observable benchmark output이어야 한다.

## Rollout

### Tranche 1 — provider-family wording + runtime SoT cutover
이 tranche가 끝나면 spec/review/verifier/planner contract에서 provider-specific wording이 사라지고, runtime family가 execution SoT가 된다.

### Tranche 2 — deep-interview V2 envelope + spec persistence boundary + approvalFlow extraction
이 tranche가 끝나면 `approval_pending`는 deep-interview phase가 아니라 separate approvalFlow state로 이동한다. spec persistence가 deep-interview completion boundary로 고정되고, 이를 수행하는 sanctioned completion path와 approval resume consumer가 함께 cutover된다.

### Tranche 3 — brainstorming parity port + mutation guard
이 tranche가 끝나면 topology/ambiguity/closure/round-complete grammar가 gajae-style로 포팅되고, sanctioned completion path를 제외한 active brainstorming/deep-interview code-write gate가 차단된다.

### Tranche 4 — `pi-oven_ask` schema/TUI redesign + routing approval integration
이 tranche가 끝나면 ask UI가 image-style layout, context headers, `Other`, `Ask about these choices`, approval/deep-interview mixed schema를 모두 지원하고, UI/headless affordance semantics가 일치한다.

### Tranche 5 — speed lane implementation + benchmark proof
gate hot-path와 native worker startup 개선을 독립 verification lane으로 마무리한다.

### Rollout rule
각 tranche는 **cutover**여야 한다. 예:
- 새 `approvalFlow` writer가 들어온 뒤 old `deepInterview.approvalHandoff` writer를 유지하지 않는다.
- same-provider family contract가 들어온 뒤 Codex+Zen/Opus/Sonnet wording을 병행 유지하지 않는다.
- 새 ask schema가 canonical이 된 뒤 old prompt-only conventions를 계속 blessed path로 두지 않는다.

## Risks
1. **State migration regression** — 기존 `approval_pending` / routing approval resume 세션이 손상될 수 있다.
   - Mitigation: read-time migration tests + canonical rewrite-on-persist.
2. **Prompt/runtime boundary confusion** — ambiguity math를 runtime으로 옮기려는 과잉 구현 위험이 있다.
   - Mitigation: formulas/triggers는 `skills/brainstorming/SKILL.md`가 소유하고, runtime은 validation/persistence만 담당한다고 명시.
3. **Mutation guard over-blocking** — spec write 이후에도 불필요하게 edit/write가 막힐 수 있다.
   - Mitigation: guard boundary를 “spec persisted + deep-interview inactive”로 고정하고 tests로 잠근다.
4. **Provider family inference drift** — setup/status/profile prose와 runtime family inference가 다시 벌어질 수 있다.
   - Mitigation: `captureSessionModel()` consumer + status tests + validator wording tests를 함께 수정.
5. **Performance optimization correctness regression** — I/O reduction 또는 startup overlap이 proof semantics / collision safety를 깨뜨릴 수 있다.
   - Mitigation: 기존 correctness suite green + benchmark assertions added, never benchmark-only.

## Test strategy

### 1. Provider-routing / verifier contract
- `tests/extensions/pi-oven.test.ts`
- `tests/scripts/pi-oven-setup/profiles.test.ts`
- `tests/scripts/pi-oven-setup/status.test.ts`
- targeted prose/skill tests that currently pin `codex + zen`, `sonnet`, `opus` wording
- `bun run lint:agents`
- `bun run lint:skills`
- provider-family contract tests는 supported family뿐 아니라 unsupported/current-session family negative-path도 검증한다.

### 2. Deep-interview / approval / ask runtime
- `tests/extensions/pi-oven-runtime/deep-interview-state.test.ts`
- `tests/extensions/pi-oven-runtime/deep-interview-runtime.test.ts`
- `tests/extensions/pi-oven-runtime/pi-oven-ask.test.ts`
- `tests/extensions/pi-oven-runtime/wiring.test.ts`
- `tests/extensions/pi-oven-runtime/trace-primitives.test.ts`
- `tests/extensions/pi-oven-runtime/gate-state.test.ts`
- add explicit migration tests for old `approval_pending` state and new `approvalFlow` state
- add example-based round-complete rendering tests modeled after gajae output grammar
- add sanctioned completion-path tests: active interview에서 일반 `write`는 막히고, canonical final spec persistence action만 허용되며, 같은 assertion에서 `approvalFlow` seed receipt까지 검증해야 한다

### 3. Mutation guard / gate integration
- `tests/extensions/pi-oven-runtime/gate-handler.test.ts`
- `tests/extensions/pi-oven-runtime/gate.test.ts`
- `tests/extensions/pi-oven-runtime/gate-state.test.ts`
- new cases:
  - active brainstorming/deep-interview + no spec persisted => `write`/`edit`/`ast_edit` blocked
  - sanctioned final spec persistence action => allowed once and paired state transition receipt persisted
  - spec persisted + approvalFlow pending => deep-interview guard lifted, existing gates still apply
  - resumed legacy state migrates before gate evaluation

### 4. Performance evidence
- `tests/scripts/pi-oven-team/runtime-v2.test.ts`
- `tests/scripts/pi-oven-team/scaling.test.ts`
- `tests/scripts/pi-oven-team/lane-policy.test.ts`
- `tests/scripts/pi-oven-team/task-file-ops.test.ts`
- focused gate hot-path benchmark assertions in existing gate tests or a new narrow performance suite
- benchmark assertions must compare relative improvement against checked-in baseline semantics, not anecdotal local timings
- `tests/scripts/pi-oven-team/runtime-v2.test.ts` 또는 동급 narrow startup suite에는 read-only lane과 dependency-bearing lane이 섞인 startup scenario correctness case를 포함한다.
- gate/runtime startup benchmark assertions는 synthetic clock 또는 deterministic counter 기반이어야 하며, flaky wall-clock anecdote를 근거로 삼지 않는다.
- final tranche-close verification에는 `bun run check`를 포함해 V2 state + approvalFlow + ask contract cutover의 타입 일관성을 고정한다.

## Bottom line
이번 설계의 핵심은 “provider names를 지우는 문서 정리”가 아니다. runtime을 execution SoT로 격상하고, deep-interview를 gajae처럼 **semantic skill + validating runtime + ask bridge** 구조로 재편하며, `pi-oven_ask`를 그 공통 인터페이스로 승격하고, 마지막으로 성능 최적화를 correctness-preserving benchmark 계약으로 묶는 것이다. 구현은 staged cutover로 진행하되, deep-interview completion boundary는 spec persistence, approval은 separated handoff, review/verifier fan-out은 same-provider family only라는 세 축을 끝까지 유지해야 한다.
