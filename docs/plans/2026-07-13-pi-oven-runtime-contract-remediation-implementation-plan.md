> Historical; do not copy runtime syntax examples from this document.

# pi-oven + OMP Runtime Contract Remediation Implementation Plan

> 작성일: 2026-07-13<br>
> 상태: 구현 준비 완료<br>
> 대상: pi-oven v0.2.4 / OMP 15.5.3<br>
> 근거 문서: [2026-07-13 pi-oven OMP harness improvement audit](./2026-07-13-pi-oven-omp-harness-improvement-plan.html)<br>
> 구현 독자: GPT-5.4 수준의 코딩 에이전트와 리뷰어<br>
> 명시적 제외: OpenTelemetry 도입, Temporal/LangGraph/Mastra 런타임 의존성 도입, 새 역할 추가

## Goal

pi-oven의 문서, shipped skills, agent registry, runtime gate, skill router, eval harness, setup, autonomous recovery, release pipeline이 **하나의 실행 계약**을 공유하도록 만든다. 완료 상태에서는 다음이 동시에 참이어야 한다.

1. 정상 실행 표면에서 agent namespace는 오직 등록된 `pov:<role>` 24개다.
2. slash command는 manifest에 실제로 존재하는 `/pi-oven:setup`, `/pi-oven:doctor`, `/pi-oven:release`만 참조한다.
3. 모든 authored `task` 예제와 실제 gate 입력은 OMP 15.5.3의 canonical schema를 따른다.
4. 명시적으로 호출된 skill은 keyword index 순서나 cap 때문에 사라지지 않는다.
5. benchmark는 prompt가 작아졌다는 사실보다 selection correctness를 먼저 증명한다.
6. positive eval은 의미 없는 `"ok"` 응답으로 통과할 수 없다.
7. setup은 부분 적용을 성공처럼 남기지 않고, 실패 시 원상복구하거나 명시적 복구 상태를 남긴다.
8. unit/integration test는 사용자의 실제 HOME, OMP 설치, credential과 격리된다.
9. production caller가 없는 vendored tmux scheduler는 제거하고 OMP `task`를 단일 dispatch Interface로 사용한다.
10. autonomous parent run은 crash 이후 lease, transition, effect receipt를 통해 결정적으로 재개 또는 격리된다.
11. 알 수 없는 mutation capability는 prompt 지시가 아니라 runtime policy에서 fail-closed 처리된다.
12. release는 exact dependency, immutable source ref, 검증된 tag, checksum과 provenance를 갖는다.

이 계획의 목표는 기능 수를 늘리는 것이 아니다. 현재 pi-oven이 잘하는 approval, gate, resume, routing 규율을 **실제로 믿을 수 있는 깊은 Module**로 만드는 것이다.

## Architecture

핵심 구조는 아래 여덟 Module과 명시적 Interface로 정리한다.

```text
Authored surfaces (skills / agents / commands / evals)
                         │
                         ▼
               RuntimeContract Module
       roster · namespaces · task schema · commands
          │              │               │
          ▼              ▼               ▼
   static compiler   runtime gate   registry assertion
          │              │               │
          └─────── contract receipts ─────┘
                         │
                         ▼
             Explicit-first Skill Router
                         │
                         ▼
                  Prompt Compositor
                         │
                         ▼
                 OMP canonical task
                         │
                         ▼
              Autonomous Run Ledger
      lease · transition · effect receipt · recovery
```

### Module boundaries

| Module | Interface | Implementation | 숨기는 복잡성 | 소비자 |
|---|---|---|---|---|
| RuntimeContract | `ROLE_NAMES`, `TaskDispatchSchema`, namespace/command helpers | Zod strict schemas + immutable constants | 24-role roster, OMP task shape, legacy/command 구분 | gate, lint, registry, eval, docs generator |
| AuthoredSurfaceCompiler | `inspectAuthoredSurfaces()` | Markdown scanner + manifest-aware validation | prose/code fence의 legacy token, stale command, invalid example 탐지 | CI, release prepare |
| SkillSelection | `selectSkillsForTurn()` | explicit resolver → keyword match → ranking → implicit cap | 명시 호출, priority, deferred obligation, deterministic ordering | extension turn-start |
| PromptCompositor | `composeRuntimePrompt()` | audience/priority/budget 기반 fragment compositor | parent/worker 중복, 안전 fragment 보존, receipt | before-agent-start |
| SetupTransaction | `applySetupTransaction()` / `recoverSetupTransactions()` | journaled saga + durable atomic file adapter | multi-target snapshot, compensation, validation, recovery | setup/reset/status/doctor |
| RunLedger | `RunLedger` | `bun:sqlite` WAL Implementation | lease, fencing, idempotency, ambiguous effect reconciliation | autonomous stop/resume/gate |
| CapabilityPolicy | `decideCapability()` | versioned allowlist + argument validators | tool별 위험도와 default-deny | tool-call gate |
| EvalEvidence | `ScenarioSession` / `EvidenceEvent` | OMP SDK event adapter | args, usage, terminal state, hard/observational assertion | offline tests, live canary, nightly eval |

### 선택한 구조적 결정

#### D1. RuntimeContract는 하나의 깊은 Module이다

`profiles.ts`, `lint-skills.ts`, `lint-agents.ts`, `gate-handler.ts`, registry validation, eval YAML이 각자 namespace와 task 규칙을 재정의하지 않는다. `.omp/extensions/pi-oven-runtime/runtime-contract.ts`가 public contract의 source of truth가 되고 다른 파일은 Adapter가 된다.

#### D2. OMP `task`가 유일한 worker dispatch seam이다

`scripts/pi-oven-team/*`은 많은 내부 코드와 테스트를 갖지만 production launcher callsite가 없다. 파일 존재를 `ACTIVE`로 해석하는 현재 상태는 Interface가 실제로 연결되지 않은 Implementation이다. 이 계획은 해당 vendored scheduler를 제거한다.

- 동일 agent의 독립 작업: 한 번의 `task({ agent, tasks: [...] })` 호출.
- 동일 agent 내부 의존성: task item의 `blockedBy` 사용.
- 서로 다른 agent: agent별 별도 `task` 호출을 같은 turn에 제출.
- 실제 동시성: OMP의 `async.enabled`와 `task.maxConcurrency`가 소유.
- cross-call dependency: 첫 call 결과를 받은 뒤 다음 call. `blockedBy`를 call 경계 너머로 꾸미지 않는다.

별도 tmux scheduler가 꼭 필요한 제품 요구가 나중에 생기면 새 ADR에서 semantic ready receipt, epoch, heartbeat, lease, reconciler를 갖춘 새 Integration으로 검토한다. 현재 dead code를 보존하기 위해 그 복잡성을 먼저 만들지 않는다.

#### D3. 내구성은 실제 autonomous parent run에 넣는다

durable state의 Leverage가 가장 큰 곳은 현재 실제 wiring이 있는 autonomy/gate/resume 경로다. SQLite ledger는 worker scheduler가 아니라 parent run과 external effect receipt를 기록한다. 파일 기반 approval state는 즉시 전면 폐기하지 않고 migration Adapter 뒤에서 단계적으로 이동한다.

#### D4. correctness가 optimization보다 앞선다

skill selection correctness가 실패하면 prompt byte 감소율은 무효다. benchmark와 release gate는 다음 lexicographic order를 사용한다.

1. contract validity
2. explicit recall
3. required selection recall
4. forbidden selection precision
5. deterministic ordering
6. 그 다음에만 bytes, latency, cost 비교

#### D5. 외부 라이브러리는 좁게 사용한다

- `zod@4.4.3`: task/scenario/receipt strict schema와 JSON Schema 산출.
- `fast-check`: router, state transition, setup transaction의 property/model-based test 전용 dev dependency.
- `bun:sqlite`: Bun 내장 Implementation. 별도 database package 없음.
- Temporal/LangGraph는 설계 참고 자료일 뿐 설치하지 않는다.

## Tech Stack

- Runtime: Bun 1.3.14
- Language: TypeScript, strict typecheck
- OMP SDK: `@oh-my-pi/pi-coding-agent` 15.5.3 exact pin
- Schema: Zod 4.4.3 exact pin, strict object parsing, JSON Schema Draft 2020-12 export
- Property tests: fast-check, 설치 시 `bun add --dev --exact fast-check`
- Durable state: `bun:sqlite`, WAL, `foreign_keys=ON`, `busy_timeout`, `synchronous=FULL`
- Tests: `bun:test`, hermetic preload, fake clock/fault injection
- CI/release: GitHub Actions, full-SHA actions, immutable `vX.Y.Z` source ref, artifact attestations
- Documentation: Markdown source + generated runtime contract reference

## Baseline and failure inventory

### 반드시 RED로 고정할 현재 실패

| 영역 | 현재 증거 | 왜 위험한가 | 목표 |
|---|---:|---|---:|
| Legacy agent role | shipped skills/reference 239회 | runtime은 차단하고 lint는 allowlist로 통과 | 0 |
| Stale autonomous command | `/pi-oven:autonomous` 2회 | manifest에 command가 없음 | 0 |
| Invalid task examples | 실행형 예제 11개 | OMP가 받지 않는 필드와 agent 누락 | 0 |
| Provider-tier prose | sonnet/haiku 16회 | Codex-only routing과 충돌 | 0 |
| Explicit skill recall | `pov:autonomous-loop`, `$autonomous-loop`, `/autonomous-loop` 모두 0 match | explicit 판정이 keyword 후보 뒤에만 실행 | 100% |
| Skill cap correctness | `autonomous-loop`가 index 11에서 소실 | cap이 classification/priority보다 먼저 적용 | 0 dropped explicit |
| Gate roster validation | `pov:phantom`, bare `phantom`, missing agent 허용 | message와 Implementation 불일치 | 100% block |
| Eval discrimination | fake session이 `"ok"`만 반환해도 78/78 PASS | positive assertion이 telemetry | positive suite 100% reject |
| Benchmark truthfulness | 잘못된 selection으로 77.97% 절감 PASS | correctness 없는 optimization | correctness 선행 |
| Test isolation | 기본 HOME에서 11 fail + 1 error, 격리 HOME에서 1,095 pass | 개인 상태 의존 | 외부 write 0 |
| Native team readiness | production caller 0인데 ACTIVE 주장 | 존재와 연결을 혼동 | dead layer 제거 |
| Setup transaction | validation 실패 후 partial config 잔류 | 원자 write만 있고 원자 apply 없음 | rollback/recovery |
| Eval usage | `token_in/out` 항상 0 | 비용·회귀 비교 불가 | real usage delta |

### 239개 legacy role inventory

다음 파일은 healthy-path `pi-oven:<role>`을 모두 `pov:<role>`로 전환한다. `/pi-oven:<command>`와 `pi-oven@kzk`는 다른 namespace이므로 기계적 전체 치환을 금지한다.

| 파일 | 건수 |
|---|---:|
| `skills/autonomous-loop/SKILL.md` | 59 |
| `skills/improve-codebase-architecture/SKILL.md` | 22 |
| `skills/large-task-delegation/SKILL.md` | 21 |
| `skills/spec-and-review/SKILL.md` | 18 |
| `skills/systematic-debugging/SKILL.md` | 14 |
| `skills/brainstorming/SKILL.md` | 13 |
| `skills/deep-init/SKILL.md` | 12 |
| `skills/html-research-orchestrator/SKILL.md` | 11 |
| `skills/pre-commit-gate/SKILL.md` | 9 |
| `skills/code-quality-discipline/SKILL.md` | 7 |
| `skills/codebase-survey/SKILL.md` | 7 |
| `skills/subagent-driven-development/SKILL.md` | 7 |
| `skills/tdd-strict/SKILL.md` | 7 |
| `skills/git-workflow/SKILL.md` | 6 |
| `skills/memory-discipline/SKILL.md` | 6 |
| `skills/html-spec-decision-maker/SKILL.md` | 5 |
| `skills/receiving-code-review/SKILL.md` | 5 |
| `skills/large-task-delegation/references/dispatch-anatomy.md` | 3 |
| `skills/aws/SKILL.md` | 2 |
| `skills/brainstorming/references/checklist.md` | 2 |
| `skills/bitbucket-pipeline/SKILL.md` | 1 |
| `skills/cloudflare/SKILL.md` | 1 |
| `skills/pre-commit-gate/references/gate-detail.md` | 1 |

이미 legacy role이 없는 `deep-dive`, `fresh-verifier`, `writing-plans`도 task/model/selection contract 검사의 대상이다.

### 11개 invalid task example migration map

| 현재 파일/위치 | 현재 문제 | canonical 교체 |
|---|---|---|
| `agents/pov-metis.md:111` | `subagent_type` + `prompt` | `agent: "pov:explorer"`, one-item `tasks` |
| `agents/pov-metis.md:113` | `subagent_type` + `prompt` | `agent: "pov:librarian"`, one-item `tasks` |
| `skills/codebase-survey/SKILL.md:49` | agent/tasks 없음, direct `model` | `pov:explorer`, `SurveyTopic` task, model 삭제 |
| `skills/subagent-driven-development/references/prompts.md:10` | prose task payload | `pov:executor` canonical call |
| 같은 파일 `:49` | verifier payload가 schema 아님 | Stage 1 `pov:verifier` canonical call |
| 같은 파일 `:81` | reviewer payload가 schema 아님 | Stage 2 `pov:code-reviewer` canonical call |
| `skills/spec-and-review/references/pattern-loop.md:23` | prompt-only call | `pov:planner` draft task |
| 같은 파일 `:41` | prompt-only call | `pov:planner` revision task |
| `skills/large-task-delegation/references/dispatch-anatomy.md:99` | prompt + background field | executor tasks A/B 중 A |
| 같은 파일 `:104` | 두 번째 잘못된 executor call | 첫 executor call의 tasks B로 병합 |
| 같은 파일 `:115` | prompt + background field | 별도 `pov:verifier` call |

추가 prose 교정 대상은 `deep-dive`의 이종 agent same-call 주장, `deep-init`과 `systematic-debugging`의 병렬 의미, `autonomous-loop`의 `run_in_background`다. Bash 장기 실행이 실제로 background를 지원하면 tool schema의 `async: true`를 사용한다.

## Non-goals and hard constraints

- OpenTelemetry 관련 package, exporter, trace setup을 추가하지 않는다.
- Temporal, LangGraph, Mastra를 production dependency로 추가하지 않는다.
- 24-role roster를 늘리지 않는다.
- historical spec의 과거 결정을 조용히 rewrite하지 않는다. 실행 지침과 archive를 구분한다.
- foreign user-explicit agent 지원을 없애지 않는다. 다만 exact allowlist receipt가 있을 때만 유지한다.
- runtime safety fragment를 prompt budget 때문에 truncate하지 않는다.
- live provider credential이 없는 fork PR을 실패시키지 않는다. 대신 offline contract gate는 항상 실행한다.
- 기존 사용자 config의 unrelated key를 setup/reset이 삭제하지 않는다.

## Implementation sequence

아래 순서는 의도적이다. Contract와 RED test 없이 239개를 먼저 치환하면 slash command와 install identity까지 망가뜨릴 수 있다. 반대로 runtime fail-closed를 authored surface 정리 전에 켜면 정상 작업 전체가 막힌다.

---

## Task 0 — Freeze the baseline and add remediation commands

### Files

- Modify: `package.json`
- Create: `scripts/check-remediation-baseline.ts`
- Create: `tests/plugin/remediation-baseline.test.ts`
- Create: `docs/runtime-contracts/remediation-baseline.json`

### RED tests

`tests/plugin/remediation-baseline.test.ts`에 현재 결함을 숫자로 고정한다.

```ts
expect(report.legacyHealthyAgentRefs).toBe(239);
expect(report.staleSlashCommands).toBe(2);
expect(report.invalidTaskExamples).toBe(11);
expect(report.providerTierAliases).toBe(16);
```

이 테스트는 최종 상태에서 숫자가 0이 되도록 바로 수정하는 테스트가 아니다. migration 동안 예상치 못한 표면이 늘지 않았는지 보여주는 snapshot이다. 최종 Task에서 baseline artifact를 `before/after` 형식으로 갱신한다.

### Implementation

`package.json`에 다음 command surface를 추가한다.

```json
{
  "scripts": {
    "contract:check": "bun scripts/pi-oven-contract/check.ts",
    "contract:generate": "bun scripts/pi-oven-contract/generate.ts",
    "test:hermetic": "bun test",
    "test:contract": "bun test tests/plugin/runtime-contract-static.test.ts tests/extensions/pi-oven-runtime/runtime-contract.test.ts",
    "check:coverage": "bun scripts/check-coverage.ts"
  }
}
```

### Acceptance

- baseline report가 deterministic JSON을 출력한다.
- 파일 순서나 locale에 따라 count가 바뀌지 않는다.
- 기존 `bun run check`, `bun run build`, `bun run lint:*` 동작은 유지된다.

### Commit

`test(contract): freeze runtime contract remediation baseline`

---

## Task 1 — Build the RuntimeContract source of truth

### Files

- Create: `.omp/extensions/pi-oven-runtime/runtime-contract.ts`
- Create: `tests/extensions/pi-oven-runtime/runtime-contract.test.ts`
- Modify: `scripts/pi-oven-setup/profiles.ts`
- Modify: `package.json`
- Modify: `bun.lock`

### RED tests

1. 24개 role이 중복 없이 존재한다.
2. `canonicalAgentName("executor") === "pov:executor"`다.
3. `pov:phantom`, `pi-oven:executor`, empty agent는 canonical registry member가 아니다.
4. canonical task payload만 strict parse된다.
5. top-level `prompt`, `model`, `subagent_type`, `run_in_background`는 reject된다.
6. item의 unknown key도 reject된다.
7. `blockedBy`가 자기 자신, 없는 id, cycle을 만들면 reject된다.
8. `/pi-oven:setup|doctor|release`만 registered command다.

### Interface

```ts
export const ROLE_NAMES = [/* existing 24 roles */] as const;
export type RoleName = (typeof ROLE_NAMES)[number];

export const RuntimeAgentNameSchema = z.enum(
  ROLE_NAMES.map((role) => `pov:${role}`) as [string, ...string[]]
);

export const TaskItemSchema = z.strictObject({
  id: z.string().min(1),
  description: z.string().min(1),
  assignment: z.string().min(1),
  blockedBy: z.array(z.string().min(1)).optional(),
});

export const TaskDispatchSchema = z.strictObject({
  agent: RuntimeAgentNameSchema,
  context: z.string().min(1).optional(),
  schema: z.string().min(1).optional(),
  tasks: z.array(TaskItemSchema).min(1),
  isolated: z.boolean().optional(),
}).superRefine(validateTaskDag);
```

### Implementation

- `zod: "4.4.3"`을 direct exact dependency로 선언한다. transitive dependency에 기대지 않는다.
- `profiles.ts`의 기존 role array는 삭제하거나 `export const ROLES = ROLE_NAMES` compatibility alias로 한 release만 유지한다.
- namespace를 다음처럼 타입으로 분리한다.

```ts
export const NAMESPACES = {
  agent: "pov",
  skill: "pov",
  command: "/pi-oven",
  install: "pi-oven@kzk",
} as const;
```

- OMP의 조건부 필드인 `context`, `schema`, `isolated`는 runtime schema에 허용하되 authored example의 universal subset 정책은 별도 compiler rule로 `agent + tasks`만 권장한다.

### Acceptance

- role/command/task 규칙을 다른 Module이 새 문자열 literal set으로 재정의하지 않는다.
- Zod JSON Schema export가 Draft 2020-12로 생성 가능하다.
- build size 증가를 기록하고 extension artifact 증가가 150 KiB를 넘으면 `zod/mini` 또는 tooling/runtime schema 분리 ADR을 작성한다.

### Commit

`feat(contract): add canonical runtime contract module`

---

## Task 2 — Add the AuthoredSurfaceCompiler before changing prose

### Files

- Create: `scripts/pi-oven-contract/check.ts`
- Create: `scripts/pi-oven-contract/generate.ts`
- Create: `scripts/pi-oven-contract/markdown-scanner.ts`
- Create: `scripts/pi-oven-contract/task-example-parser.ts`
- Create: `tests/plugin/runtime-contract-static.test.ts`
- Create: `docs/generated/runtime-contract.md`
- Create: `docs/generated/task-dispatch.schema.json`
- Modify: `scripts/lint-skills.ts`
- Modify: `scripts/lint-agents.ts`

### Compiler scope

`healthy execution surface`는 다음이다.

- `.claude-plugin/plugin.json`
- `agents/*.md`
- `skills/**/SKILL.md`
- `skills/**/references/*.md`
- `commands/*.md`
- `evals/**/*.yaml`
- `README.md`, `CLAUDE.md`, `docs/runtime-contracts/*.md`

`docs/specs`, `docs/baselines`, `docs/harness/surveys`, `docs/plans`, `docs/pre-decisions`는 archive/evidence surface다. 이 영역은 historical syntax를 허용하지만 각 stale 문서에는 `status` 또는 상단 banner로 “historical; do not copy runtime syntax”를 명시한다. blanket allowlist가 아니라 path classification이다.

### RED tests

- `all shipped healthy-path agent references use canonical pov names`
- `all shipped slash commands resolve to manifest command basenames`
- `shipped workflow prose contains no provider-tier aliases`
- `every tagged task example validates against the supported OMP task subset`
- `every shipped agent filename and frontmatter name belongs to ROLE_NAMES`
- `generated contract files are up to date`

### Implementation details

- legacy agent regex는 negative lookbehind로 slash command를 구분한다.
- `task` code example에는 `<!-- pi-oven-contract:task-example -->` marker를 붙인다.
- marker가 붙은 fenced block은 parser가 strict schema로 검증한다.
- marker 없이 `task(`를 포함한 실행형 code fence가 있으면 “unclassified task example”로 실패시킨다.
- provider alias 검사에서 agent frontmatter의 exact `openai-codex/...` model은 허용하고 prose의 `sonnet|haiku|opus` tier routing만 거부한다.
- `lint-skills.ts`의 20-skill legacy allowlist는 아직 제거하지 않는다. Task 3 migration이 green 된 직후 Task 4에서 제거한다.

### Acceptance

- compiler issue는 `{code,file,line,column,message,suggestion}` 구조다.
- 같은 입력은 같은 issue order를 만든다.
- generated files를 다시 만들고 `git diff --exit-code`로 drift를 확인할 수 있다.

### Commit

`feat(contract): compile authored surfaces against runtime schema`

---

## Task 3 — Cut over all authored execution surfaces

### Files

- Modify: 위 “239개 inventory”의 23개 파일
- Modify: `agents/pov-metis.md`
- Modify: `skills/subagent-driven-development/references/prompts.md`
- Modify: `skills/spec-and-review/references/pattern-loop.md`
- Modify: `skills/tdd-strict/references/anti-patterns.md`
- Modify: `skills/code-quality-discipline/references/principles.md`
- Modify: `skills/deep-dive/SKILL.md`
- Modify: relevant `evals/**/*.yaml`

### Migration rules

1. `pi-oven:<registered-role>` → `pov:<registered-role>`.
2. `/pi-oven:autonomous` → 자연어 autonomous activation 또는 `pov:autonomous-loop` skill invocation.
3. `/pi-oven:setup|doctor|release`는 그대로 둔다.
4. `pi-oven@kzk` install identity는 그대로 둔다.
5. `sonnet|haiku|opus` prose는 역할 기반 표현으로 교체한다. 예: “fresh `pov:executor`”; model은 `task.agentModelOverrides`가 결정한다.
6. 11개 task example은 Task 1 schema로 교체한다.
7. `run_in_background`는 task payload에서 삭제한다.
8. same-role parallel example은 하나의 `tasks[]`로 합친다.
9. heterogeneous agents는 별도 task calls로 분리한다.
10. retry 문구는 “same subagent 재사용”이 아니라 “same role의 fresh process에 prior verdict/context 재주입”으로 고친다.

### Semantic corrections

- `subagent-driven-development` stage order는 Stage 1 `pov:verifier`의 spec compliance, Stage 2 `pov:code-reviewer`의 code quality로 고정한다.
- `code-quality-discipline/references/principles.md`의 “executor sonnet 전용 before_agent_start 주입” 주장은 삭제한다. authored task assignment template이라고 정확히 표현한다.
- `deep-dive`의 tracer와 deep-researcher를 한 task call에 넣지 않는다.
- async가 꺼져 있으면 동시성을 보장하지 않는다고 명시한다.

### Verification

```bash
rg --pcre2 '(?<!/)pi-oven:[a-z][a-z0-9-]*' skills agents
rg '/pi-oven:autonomous' skills agents evals
rg -i '\b(sonnet|haiku|opus)\b' skills
bun run contract:check
```

모든 command는 zero result 또는 의도된 archive-only result를 반환해야 한다.

### Acceptance

- healthy surface legacy role 0.
- stale autonomous slash 0.
- shipped prose provider tier alias 0.
- old-form task snippets 0.
- 모든 tagged example strict parse PASS.

### Commit

`fix(contract): migrate authored surfaces to canonical OMP dispatch`

---

## Task 4 — Delete the lint escape hatch and fail closed on the exact roster

### Files

- Modify: `scripts/lint-skills.ts`
- Modify: `scripts/lint-agents.ts`
- Modify: `.omp/extensions/pi-oven-runtime/gate-handler.ts`
- Modify: `.omp/extensions/pi-oven.ts`
- Modify: `tests/scripts/lint-skills.test.ts`
- Modify: `tests/scripts/lint-agents.test.ts`
- Modify: `tests/extensions/pi-oven-runtime/gate-handler.test.ts`
- Modify: `tests/extensions/pi-oven.test.ts`
- Modify: `tests/extensions/pi-oven-runtime/wiring.test.ts`

### RED tests — task gate

- missing `agent` blocks.
- whitespace-only `agent` blocks.
- `pov:phantom` blocks as unregistered.
- bare `phantom` blocks instead of canonicalizing.
- every canonical ROLE_NAMES entry allows unchanged.
- every bare registered role canonicalizes to `pov:<role>`.
- legacy `pi-oven:<role>` remains blocked with migration feedback.
- exact user-explicit foreign allowlist behavior remains covered.
- invalid task shape blocks before ownership trace claims success.

### RED tests — registry

- exactly 24 shipped roles returns `{ok:true}`.
- one missing file returns `{ok:false}` with missing role.
- `pov-phantom.md` returns unknown-role error.
- legacy/canonical duplicate returns duplicate error.
- invalid registry prevents runtime handler wiring; logging alone is not sufficient.

### Implementation

- `classifyTaskAgent()`는 regex만 보지 말고 RuntimeContract membership을 확인한다.
- `decideForTaskDispatch()`는 `TaskDispatchSchema.safeParse(event.input)` 실패 시 block한다.
- error message는 secret/task assignment 전체를 echo하지 않고 issue path와 code만 반환한다.
- `validateAgentRegistry()`를 pure `inspectAgentRegistry(): AgentRegistryReport`와 throwing `assertAgentRegistry()`로 분리한다.
- extension entrypoint는 registry assert가 성공한 뒤에만 `tool_call` handler를 등록한다.
- `lint-agents.ts`의 `role === null` early continue 전에 unknown canonical filename을 오류로 만든다.
- `lint-skills.ts:41-201` legacy allowlist와 shipped-root bypass를 완전히 삭제한다.

### Acceptance

- missing/unknown task agent 100% block.
- 24-role canonical/bare matrix 100% expected behavior.
- invalid registry에서 runtime gate가 healthy하게 시작한 척하지 않는다.
- compatibility feedback는 runtime diagnostic과 tests에만 남고 shipped healthy prose에는 없다.

### Commit

`fix(runtime): enforce canonical task and exact agent roster`

---

## Task 5 — Replace cap-before-priority with explicit-first selection

### Files

- Modify: `.omp/extensions/pi-oven-runtime/skill-keyword-loader.ts`
- Create: `.omp/extensions/pi-oven-runtime/skill-selection.ts`
- Modify: `.omp/extensions/pi-oven.ts`
- Modify: `tests/extensions/pi-oven-runtime/skill-keyword-loader.test.ts`
- Create: `tests/extensions/pi-oven-runtime/skill-selection.property.test.ts`

### Interface

```ts
interface SkillSelectionReceipt {
  explicit: SelectedSkill[];
  implicitRoot: SelectedSkill[];
  deferred: SelectedSkill[];
  dropped: Array<SelectedSkill & { reason: string }>;
  maxImplicitRoots: number;
}

function selectSkillsForTurn(input: {
  latestUserText: string;
  index: SkillKeywordIndexEntry[];
  maxImplicitRoots: number;
}): SkillSelectionReceipt;
```

### Required algorithm

1. 전체 shipped registry에서 explicit aliases를 먼저 resolve한다.
2. keyword phrase match를 cap 없이 모두 수집한다.
3. 두 집합을 skill name으로 merge한다.
4. 각 candidate에 `explicit`, class, priority, specificity, manifestOrder를 붙인다.
5. explicit을 항상 root에 보존한다.
6. explicit count가 별도 safety ceiling을 넘으면 silent slice 대신 deterministic error를 낸다.
7. 남은 implicit budget에 root candidate를 priority → specificity → manifestOrder로 stable sort한다.
8. 나머지는 deferred obligation으로 보존한다.

현재 `rootNames`가 cap 이전 후보 전체를 담고 실제 root output만 나중에 자르는 문제도 함께 제거한다. 어떤 candidate도 root, deferred, explicit-overflow diagnostic 중 하나에 반드시 존재해야 하며 조용히 사라질 수 없다.

### Explicit aliases

- `pov:<skill>`
- `$<local-skill>`
- `/<local-skill>`

token boundary를 검사해 substring 오탐을 막는다. explicit detection은 keyword hit 여부에 의존하지 않는다.

### RED/property tests

- shipped 23개 skill 각각 세 alias recall 100%.
- worst autonomous fixture에서 `pov:autonomous-loop`가 root.
- 9개 이상 implicit match 뒤에서도 explicit 보존.
- index permutation에도 같은 semantic selection.
- 중복 phrase/alias dedupe.
- explicit safety ceiling 초과 시 deterministic error.
- selection receipt의 모든 candidate가 exactly one bucket에 존재.
- fast-check가 생성한 phrase order/whitespace/case variation에서 invariant 유지.

### Acceptance

- `matchSkillsForText()`에 `.slice(0, MAX_MATCHED_SKILLS)`가 없다.
- explicit recall 100%.
- required autonomous selection 누락 0.
- stable order가 seed와 process에 무관하다.

### Commit

`fix(routing): select explicit skills before implicit cap`

---

## Task 6 — Make runtime benchmark reject incorrect optimization

### Files

- Modify: `scripts/bench-runtime-injection.ts`
- Create: `scripts/lib/runtime-benchmark.ts`
- Create: `tests/scripts/runtime-benchmark.test.ts`
- Create: `benchmarks/runtime-injection-baseline.json`
- Modify: `package.json`

### Correctness gates

benchmark JSON은 다음을 performance보다 먼저 출력한다.

```ts
interface BenchmarkCorrectness {
  contractValid: boolean;
  explicitRecall: number;
  requiredRecall: number;
  forbiddenPrecision: number;
  deterministic: boolean;
  failures: string[];
}
```

하나라도 실패하면 process exit 1이고 byte reduction은 `accepted:false`다.

### Real work measurement

- `toolCall: timeMany(() => undefined)`를 삭제한다.
- handcrafted `old-sim` 문자열을 성능 denominator로 사용하지 않는다. corrected contract를 통과한 commit에서 checked-in baseline을 만들고 commit SHA, Bun/OMP version, fixture hash, contract version, selection receipt를 함께 저장한다.
- hermetic in-memory `GateStateStore`와 `createGateHandler()`를 사용해 최소 세 경로를 잰다.
  - read-only fast path
  - canonical task validation path
  - blocked legacy/unknown task path
- prompt 측정은 fragment별 bytes, total bytes, estimated tokens, parent/worker audience를 분리한다.
- p50/p95/p99는 warm-up 이후 측정한다.

### Acceptance thresholds

- correctness 전부 PASS.
- worst fixture worker prompt bytes는 corrected baseline 대비 최소 50% 감소 목표.
- gate read-only p95 regression은 corrected baseline 대비 10% 또는 0.05 ms 중 큰 값 이내.
- benchmark fixture가 required skill을 잃으면 절감률과 무관하게 FAIL.

### Commit

`fix(bench): gate prompt savings on selection correctness`

---

## Task 7 — Rebuild eval evidence so positive behavior is a hard gate

### Files

- Modify: `scripts/lib/scenario-schema.ts`
- Modify: `scripts/lib/eval-runner.ts`
- Modify: `scripts/run-eval.ts`
- Create: `scripts/lib/omp-eval-event-adapter.ts`
- Create: `scripts/check-eval-discrimination.ts`
- Modify: `tests/scripts/eval-runner.test.ts`
- Modify: `tests/scripts/run-eval.test.ts`
- Modify: `tests/scripts/eval-scenario-shape.test.ts`
- Create: `tests/scripts/eval-discrimination.test.ts`
- Create: `evals/manifest.yaml`
- Move: `evals/dogfood/**` → `evals/harness/dogfood/**`
- Move: `evals/eval-runner/**` → `evals/harness/eval-runner/**`
- Replace: `evals/team/**` → `evals/harness/task-dispatch/**`
- Modify: all `evals/**/*.yaml`

### Scenario contract

telemetry처럼 보이는 required field를 없앤다.

- `response_must_contain`: hard positive assertion.
- `response_must_not_contain`: hard negative assertion.
- `tool_call_required`: `{namePattern,args?}` hard assertion.
- `skill_activation_required`: exact skill selection/read receipt hard assertion.
- `observe_response_contains`, `observe_tool_call`: pass/fail에 영향 없는 관측 필드.
- positive scenario는 최소 하나의 hard positive assertion을 가져야 한다.
- pure negative scenario는 `kind: negative`를 명시한다.
- timeout/inconclusive는 release에서 pass가 아니다.

### Event Adapter

현재 assistant content의 `b.name`만 복원하는 Adapter를 교체한다. `EvidenceEvent`는 최소 다음을 보존한다.

```ts
type EvidenceEvent =
  | { type: "tool_start"; name: string; args: unknown; callId: string; at: number }
  | { type: "tool_end"; name: string; callId: string; outcome: "success" | "error" | "blocked" | "aborted"; result?: unknown; at: number }
  | { type: "assistant_end"; text: string; usage?: UsageDelta; at: number }
  | { type: "turn_end"; stopReason?: string; at: number }
  | { type: "terminal_error"; code: string; at: number };
```

- SDK direct tool event가 있으면 name과 args를 그대로 capture한다.
- `tool_start`와 `tool_end`를 `callId`로 연결하며 required tool은 기본적으로 successful completion까지 요구한다.
- message usage에서 input/output/cache/cost delta를 계산한다.
- task subagent usage가 detail에 포함되면 합산 규칙을 test fixture로 고정한다.
- `run-eval.ts`는 `if (import.meta.main) await main()` guard를 갖는다. import가 auth/log/DB I/O를 시작하면 안 된다.
- scenario-level `AbortController`가 active turn을 소유하고 deadline 시 실제 prompt를 abort한다.
- timer, abort listener, subscription은 성공/실패 모두 `finally`에서 해제한다.
- prompt error를 삼키지 않고 infrastructure failure evidence로 보존한다.
- `--strict`에서는 timeout, inconclusive, infrastructure error가 nonzero다.
- `--require-scenarios`에서는 filter 결과 0개가 nonzero다.
- trusted canary/release는 자동 fastest-model 선택 대신 exact provider/model을 pin하고 receipt에 기록한다.

### Mandatory negative control

모든 positive scenario를 다음 fake session에 실행한다.

```ts
const vacuousSession = sessionReturningOnly("ok");
```

각 positive scenario는 반드시 FAIL해야 한다. “78개 중 몇 개” threshold가 아니라 positive scenario 100% discrimination이 목표다.

### CI tiers

| Tier | Trigger | 내용 | 실패 처리 |
|---|---|---|---|
| Offline contract | every PR/push | schema, fixture event, fake-ok discrimination, static dispatch canary | hard fail |
| Trusted provider canary | main push, manual, same-repo PR with secret | canonical dispatch/selection 핵심 6 scenarios, fresh session | timeout 포함 hard fail |
| Nightly full eval | scheduled | 전체 78+ scenarios, seed/retry policy 기록 | hard fail + artifact |
| Release eval | tag candidate | regression/canary 전체, usage/cost artifact | publish block |

### Acceptance

- fake `"ok"` positive pass 0.
- hard positive assertion 없는 positive YAML 0.
- `token_in/out` 상수 0 코드 삭제.
- module import side effect 0.
- actual task args와 exact canonical agent를 assert 가능.
- skill directory와 harness suite 분류가 manifest에 명시됨.
- 성공 scenario가 deadline timer 때문에 process를 붙잡지 않음.
- scenario deadline이 background prompt/subscription을 남기지 않음.

### Commit

`fix(eval): require discriminating positive runtime evidence`

---

## Task 8 — Make tests hermetic and add coverage ratchets

### Files

- Create: `tests/preload/isolate-environment.ts`
- Create: `tests/helpers/home-paths.ts`
- Create: `bunfig.toml`
- Create: `scripts/check-coverage.ts`
- Create: `config/coverage-thresholds.json`
- Modify: `.github/workflows/ci.yml`
- Modify: home-dependent production modules under `.omp/extensions`, `scripts/pi-oven-setup`, `scripts/pi-oven-release`
- Add/modify: targeted low-coverage tests

### Hermetic preload

suite import 전에 unique root를 만들고 `HOME`, `XDG_CONFIG_HOME`, `XDG_CACHE_HOME`, `XDG_STATE_HOME`, `TMPDIR`, supported OMP home variable, `DO_NOT_TRACK=1`을 설정한다. provider credential env는 unit suite에서 제거한다.

모든 home path는 module-load constant가 아니라 late-bound `HomePaths` 또는 explicit `homeDir` dependency로 바꾼다.

### Tests

- actual HOME을 inaccessible하게 둔 subprocess에서 full suite.
- 서로 다른 HOME 두 번 호출해 cache path 고착 없음.
- workspace/isolation root 밖 write 감시.
- import-only test가 OMP log/auth DB를 만들지 않음.
- CI와 local `bun test`가 동일 count/result.

### Coverage ratchet

1. 즉시 global line 90%, function 90% floor.
2. high-risk per-file target을 테스트 추가 후 켠다.
   - release CLI modules: line/function 80% 이상.
   - `scripts/run-eval.ts`: 85% 이상.
   - setup transaction/atomic file: 90% 이상.
   - runtime contract/gate/selection: 95% 이상.
3. `config/coverage-thresholds.json`보다 threshold 감소를 CI가 거부한다.
4. deleted native-team modules는 coverage denominator에서도 제거한다.

### Acceptance

- workspace와 isolation root 밖 write 0.
- 개인 OMP plugin/config/credential 유무와 무관한 결과.
- 격리 HOME full suite PASS.
- threshold 하향 PR은 fail.

### Commit

`test(harness): isolate HOME and enforce coverage ratchets`

---

## Task 9 — Make setup and reset transactional

### Files

- Create: `scripts/lib/atomic-file.ts`
- Create: `scripts/pi-oven-setup/setup-transaction.ts`
- Create: `tests/scripts/pi-oven-setup/setup-transaction.test.ts`
- Modify: `scripts/pi-oven-setup/apply.ts`
- Modify: `scripts/pi-oven-setup/reset.ts`
- Modify: `scripts/pi-oven-setup/project-settings.ts`
- Modify: `scripts/pi-oven-setup/project-config.ts`
- Modify: `scripts/pi-oven-setup/config-yml.ts`
- Modify: `scripts/pi-oven-setup/status.ts`
- Modify: `scripts/pi-oven-setup/standalone-truth-surface.ts`
- Modify: `scripts/pi-oven-doctor.ts`

### Transaction journal

```ts
interface SetupTransactionJournal {
  schemaVersion: 1;
  txnId: string;
  scope: "project" | "global";
  operation: "apply" | "reset";
  phase:
    | "prepared"
    | "applying"
    | "validating"
    | "committed"
    | "rolling_back"
    | "rollback_failed";
  desiredHash: string;
  originals: Record<string, JsonValue | { absent: true }>;
  completedSteps: string[];
}
```

### Implementation

- project scope는 strict-read 한 번 → pure merge 한 번 → atomic replace 한 번.
- global scope는 모든 managed key의 value/ABSENT를 먼저 snapshot.
- compensation을 journal에 기록한 다음 forward action을 실행한다.
- validation 실패는 reverse compensation을 실행한다.
- success receipt는 live reread가 desired hash와 일치한 뒤에만 쓴다.
- setup/reset/status/doctor 진입 시 non-terminal journal을 감지하고 safe rollback을 기본 수행한다.
- concurrent setup은 transaction lock으로 하나만 허용한다.
- fixed `.tmp` 대신 PID+random suffix, file sync, rename, 가능한 플랫폼에서 parent directory sync를 사용한다.
- rollback이 CAS 불일치로 사용자의 concurrent edit를 덮을 가능성이 있으면 자동 overwrite하지 않고 `rollback_failed` + manual recovery diff를 남긴다.

### Fault matrix

table-driven test는 journal write, 각 global key write, project replace, validation, receipt write, 각 compensation 직후에 fault를 주입한다.

추가로 다음을 검증한다.

- process kill 후 next-run recovery.
- rollback 도중 kill 후 재복구.
- apply/apply, reset/reset idempotency.
- unrelated key preservation.
- absent key restoration.
- 두 setup lock 경쟁.

### Acceptance

- 어느 fault point에서도 partial desired state를 healthy로 보고하지 않는다.
- rollback 성공 후 original byte/value semantics 복원.
- rollback 실패는 숨기지 않는다.
- 같은 입력의 successful rerun hash가 동일하다.

### Commit

`feat(setup): add journaled apply and rollback transaction`

---

## Task 10 — Remove the unwired native-team scheduler and standardize on OMP task

### Files to delete

- `scripts/pi-oven-team/fs-utils.ts`
- `scripts/pi-oven-team/index.ts`
- `scripts/pi-oven-team/lane-policy.ts`
- `scripts/pi-oven-team/rollback.ts`
- `scripts/pi-oven-team/runtime-v2.ts`
- `scripts/pi-oven-team/scaling.ts`
- `scripts/pi-oven-team/state-paths.ts`
- `scripts/pi-oven-team/task-file-ops.ts`
- `scripts/pi-oven-team/team-config.ts`
- `scripts/pi-oven-team/tmux-session.ts`
- `scripts/pi-oven-team/types.ts`
- `tests/scripts/pi-oven-team/index.test.ts`
- `tests/scripts/pi-oven-team/lane-policy.test.ts`
- `tests/scripts/pi-oven-team/rollback.test.ts`
- `tests/scripts/pi-oven-team/runtime-v2.test.ts`
- `tests/scripts/pi-oven-team/scaling.test.ts`
- `tests/scripts/pi-oven-team/task-file-ops.test.ts`
- `tests/scripts/pi-oven-team/tmux-session.test.ts`

### Files to modify

- `scripts/pi-oven-setup/apply.ts`
- `scripts/pi-oven-setup/project-config.ts`
- `scripts/pi-oven-setup/standalone-truth-surface.ts`
- `scripts/pi-oven-setup/status.ts`
- `scripts/pi-oven-doctor.ts`
- `commands/setup.md`
- `commands/doctor.md`
- `README.md`
- `CLAUDE.md`
- `docs/runtime-contracts/pi-oven-meta-control-plane.md`
- relevant compatibility-boundary and doctor/status tests
- `skills/large-task-delegation/SKILL.md`
- `evals/manifest.yaml`

### Implementation

- `nativeWorkers.maxWorkers` config surface와 setup receipt를 제거한다.
- status/doctor의 `ACTIVE`, ownership, vendored launcher 문구를 제거한다.
- fan-out guidance는 `task.maxConcurrency`와 provider/runtime admission이 실제 ceiling이라고 표현한다.
- OMP task static canary를 추가한다.

```ts
// tests/plugin/task-dispatch-canary.test.ts
// 1. discover exactly 24 pov agents
// 2. validate canonical examples against local strict schema
// 3. where OMP exports its task schema, cross-check accepted subset
```

- opt-in live `scripts/canary-runtime-dispatch.ts`는 최소 역할 표본을 실제 dispatch하고 lifecycle started/completed와 exact agent를 확인한다. release artifact는 static PASS와 live PASS/NOT-RUN을 구분한다.

### Archive policy

과거 native-team 설계 문서는 삭제하지 않는다. 상단에 `Historical architecture; implementation removed in vNext; OMP task is current dispatch seam` banner와 superseding plan link를 추가한다.

### Acceptance

- `rg 'pi-oven-team|nativeWorkers.maxWorkers'`가 historical archive와 이 계획 외 active surface에서 0.
- setup/status/doctor가 존재하지 않는 launcher를 ACTIVE라고 말하지 않는다.
- canonical OMP task canary PASS.
- tmux dependency가 runtime prerequisite에서 사라진다.

### Commit

`refactor(runtime): remove unwired scheduler and use OMP task`

---

## Task 11 — Add a durable autonomous run ledger

### Files

- Create: `.omp/extensions/pi-oven-runtime/run-ledger.ts`
- Create: `.omp/extensions/pi-oven-runtime/sqlite-run-ledger.ts`
- Create: `.omp/extensions/pi-oven-runtime/run-ledger-migrations.ts`
- Create: `.omp/extensions/pi-oven-runtime/effect-reconciler.ts`
- Create: `.omp/extensions/pi-oven-runtime/gate-state-ledger-adapter.ts`
- Create: `tests/extensions/pi-oven-runtime/run-ledger.test.ts`
- Create: `tests/extensions/pi-oven-runtime/effect-reconciler.test.ts`
- Modify: `.omp/extensions/pi-oven-runtime/gate-state.ts`
- Modify: `.omp/extensions/pi-oven-runtime/autonomous-stop-guard.ts`
- Modify: `.omp/extensions/pi-oven.ts`
- Modify: doctor/status truth surfaces

### Interface

```ts
interface RunLedger {
  beginRun(input: BeginRun): RunRecord;
  acquireLease(runId: string, owner: string, ttlMs: number): Lease;
  heartbeat(runId: string, lease: Lease): Lease;
  appendTransition(input: TransitionInput, lease: Lease): void;
  beginEffect(input: EffectIntent, lease: Lease): EffectReceipt;
  completeEffect(input: EffectCompletion, lease: Lease): void;
  loadResume(runId: string): ResumeDecision;
  releaseLease(runId: string, lease: Lease): void;
}
```

### SQLite schema

- `schema_migrations(version, applied_at)`
- `runs(run_id, repo_root, branch, status, created_at, updated_at, contract_version)`
- `leases(run_id, owner_id, fence_token, heartbeat_at, expires_at)`
- `transitions(id, run_id, from_state, to_state, payload_json, created_at)`
- `effects(id, run_id, idempotency_key UNIQUE, kind, target, status, intent_json, result_json, created_at, updated_at)`

### Database configuration

- local filesystem only.
- `PRAGMA journal_mode=WAL`.
- `PRAGMA foreign_keys=ON`.
- `PRAGMA busy_timeout=5000`.
- `PRAGMA synchronous=FULL`.
- doctor가 network filesystem을 의심하면 WAL을 healthy로 주장하지 않고 실행을 막거나 rollback journal 모드로 명시 전환한다.

### Semantics

- lease에는 monotonic `fence_token`이 있다. 이전 owner의 늦은 write는 reject된다.
- heartbeat expiry는 새 owner가 takeover할 수 있다는 뜻이지 이전 external effect를 blind retry한다는 뜻이 아니다.
- external mutation은 `intent recorded → execute → completion recorded` 순서다.
- crash가 execute와 completion 사이에 나면 effect는 `ambiguous`다.
- git commit/push 등은 actual repo/ref 상태를 reconcile한 뒤 complete/retry/manual-review를 결정한다.
- idempotency key는 retry 간 동일하고 논리 effect 간 고유하다.

### Migration

1. 기존 JSON `gate-state`를 읽는 Adapter를 둔다.
2. feature flag 아래 shadow-write하고 state equivalence를 test한다.
3. ledger read를 primary로 전환한다.
4. 한 release 동안 JSON fallback read를 유지한다.
5. rollback은 ledger writer를 끄고 JSON Adapter로 돌아갈 수 있어야 한다.

### Tests

- lease acquire/renew/expire/fencing.
- 두 owner 경쟁에서 stale token reject.
- crash after intent / before effect.
- crash after effect / before receipt → ambiguous.
- idempotent retry no duplicate.
- invalid state transition reject.
- SQLite reopen recovery.
- WAL sidecar와 checkpoint lifecycle.
- JSON shadow equivalence.

### Acceptance

- 동일 run을 두 owner가 동시에 mutate하지 못한다.
- stale process write 100% reject.
- ambiguous external effect를 자동 성공/재실행으로 꾸미지 않는다.
- crash/reopen 후 resume decision이 deterministic하다.

### Commit

`feat(autonomy): persist leases transitions and effect receipts`

---

## Task 12 — Deepen capability-registry into an enforced fail-closed policy

### Files

- Modify: `.omp/extensions/pi-oven-runtime/capability-registry.ts`
- Create: `.omp/extensions/pi-oven-runtime/capability-policy.ts`
- Modify: `.omp/extensions/pi-oven-runtime/gate-handler.ts`
- Modify: `.omp/extensions/pi-oven-runtime/gate.ts`
- Modify: `scripts/lint-agents.ts`
- Modify: `tests/extensions/pi-oven-runtime/capability-registry.test.ts`
- Create: `tests/extensions/pi-oven-runtime/capability-policy.test.ts`

### Interface

```ts
interface CapabilityRule {
  toolName: string;
  capability: CapabilityId;
  risk: "read" | "local-write" | "external-read" | "external-mutation";
  audiences: Array<"parent" | "worker">;
  validateArgs(input: unknown): CapabilityArgsResult;
  approval: "none" | "state-proof" | "user-consent";
}
```

### Policy

- tool/action allowlist는 version-controlled code다.
- unknown tool은 autonomous mode에서 default deny.
- interactive mode의 unknown mutation도 block하고 명시적 사용자 action으로 policy update를 요구한다.
- known read-only tool은 최소 argument validation 후 allow.
- code write/external mutation은 existing approval/gate proof와 결합한다.
- agent frontmatter tool allowlist는 runtime capability policy의 subset이어야 한다.
- 새로운 tool은 registry entry, argument tests, risk classification 없이는 CI를 통과하지 못한다.
- pi-oven gate를 “sandbox”라고 부르지 않는다. OMP sandbox와 pi-oven policy mediation의 경계를 docs에 명시한다.

### Tests

- every shipped agent tool maps to a policy rule.
- unknown tool default deny.
- malformed args deny.
- safe read passes.
- external mutation without consent denies.
- same event with consent consumes exactly once.
- handler deadline/error remains fail-closed.

### Acceptance

- prompt instruction만으로 허용되는 mutation capability 0.
- unknown mutation tool allow 0.
- policy/agent roster drift CI failure.

### Commit

`feat(gate): enforce versioned capability allowlist`

---

## Task 13 — Add a prompt compositor and worker context capsules

### Files

- Create: `.omp/extensions/pi-oven-runtime/prompt-compositor.ts`
- Create: `.omp/extensions/pi-oven-runtime/context-capsule.ts`
- Modify: `.omp/extensions/pi-oven-runtime/rules-injector.ts`
- Modify: `.omp/extensions/pi-oven.ts`
- Modify: `CLAUDE.md`
- Create: `docs/maintainers/handbook.md`
- Create: `tests/extensions/pi-oven-runtime/prompt-compositor.test.ts`
- Modify: `scripts/bench-runtime-injection.ts`

### Fragment contract

```ts
interface PromptFragment {
  id: string;
  audience: "parent" | "worker" | "both";
  phase: "always" | "explore" | "plan" | "mutate" | "verify";
  priority: number;
  required: boolean;
  dedupKey: string;
  maxBytes?: number;
  render(): string;
}
```

### Implementation

- `CLAUDE.md`는 compact runtime contract만 남긴다.
- release ritual, maintainer generation, historical detail은 `docs/maintainers/handbook.md`로 이동한다.
- parent는 project instruction을 한 번 받는다.
- worker는 전체 CLAUDE가 아니라 다음 capsule만 받는다.
  - canonical namespace/roster invariant.
  - exact assignment and role.
  - selected skill exact read targets.
  - relevant branch/write/verification safety.
- composition receipt는 included/dropped/reason/hash/bytes를 기록한다.
- required safety fragment는 budget 대상이 아니다.
- optional fragment만 budget에서 drop하며 이유를 receipt에 남긴다.

### Tests

- parent/worker audience separation.
- duplicate dedupKey reject.
- required fragment never dropped.
- worker에 maintainer release ritual 없음.
- exact selected skill targets 있음.
- fragment order deterministic.
- worker overhead corrected baseline 대비 최소 50% 감소.

### Acceptance

- worker에게 13.8 KB root document verbatim 반복 주입 0.
- mandatory contract omission 0.
- prompt receipt로 bytes와 drop reason을 재현 가능.

### Commit

`refactor(prompt): compose minimal parent and worker contexts`

---

## Task 14 — Make dependency, version, and release surfaces reproducible

### Files

- Modify: `package.json`
- Modify: `bun.lock`
- Modify: `.claude-plugin/marketplace.json`
- Delete: root `marketplace.json`
- Modify: `.claude-plugin/plugin.json`
- Modify: `scripts/pi-oven-release/manifest-sync.ts`
- Modify: `scripts/pi-oven-release/index.ts`
- Modify: `scripts/pi-oven-release/release-publisher.ts`
- Create: `scripts/pi-oven-release/release-contract.ts`
- Create: `.github/workflows/release.yml`
- Modify: `.github/workflows/ci.yml`
- Create: `.github/dependabot.yml`
- Modify: `README.md`
- Modify: `CLAUDE.md`
- Modify: `scripts/pi-oven-doctor.ts`
- Modify: release and plugin tests

### Dependency pinning

- `@oh-my-pi/pi-coding-agent: "15.5.3"`.
- `bun-types: "1.3.14"`.
- TypeScript는 lock의 검증된 exact version으로 pin하고 upgrade는 별도 PR.
- `bun install --frozen-lockfile` 유지.
- new Zod/fast-check도 exact pin.

### Version source of truth

- `package.json.version`이 source.
- `.claude-plugin/plugin.json.version`, `.claude-plugin/marketplace.json.plugins[0].version`, marketplace `source.ref = v${version}`는 derived.
- root duplicate `marketplace.json`은 삭제한다.
- `CLAUDE.md`의 수동 current version과 README의 고정 test count badge를 제거한다.
- doctor `MIN_OMP_VERSION`은 RuntimeContract의 supported OMP version에서 파생한다.

### Prepare/publish split

local release CLI는 clean tree, version sync, changelog, full validation, release commit 준비까지만 수행한다. publish는 `v*` tag workflow만 수행한다.

release workflow 순서:

1. tag/version/ref parity.
2. frozen install.
3. contract check, typecheck, lint, build, hermetic full tests, coverage, release eval.
4. allowlist 기반 deterministic tarball.
5. shipped file manifest와 SHA-256.
6. artifact provenance attestation.
7. SPDX SBOM 생성 및 attestation은 repository/public availability가 지원될 때 적용.
8. GitHub Release publish.
9. fresh HOME install smoke.

### GitHub Actions hardening

- top-level `permissions: contents: read`.
- release job만 필요한 `id-token`, `attestations`, `contents` 권한 부여.
- checkout/setup-bun/attestation action은 full commit SHA로 pin하고 comment에 upstream tag를 기록.
- `concurrency`와 `timeout-minutes`를 설정.
- Dependabot은 npm/github-actions PR을 만들지만 자동 merge하지 않는다.

### Acceptance

- mutable marketplace branch ref 0.
- direct wildcard dependency 0.
- duplicate version catalog 0.
- test/check/lint/build 실패 시 publish 불가.
- artifact checksum과 attestation verification 가능.
- installed artifact의 manifest가 release artifact manifest와 일치.

### Commit

`build(release): pin supply chain and publish verified artifacts`

---

## Task 15 — Align doctor, status, docs, and migration reporting

### Files

- Modify: `scripts/pi-oven-doctor.ts`
- Modify: `scripts/pi-oven-setup/status.ts`
- Modify: `scripts/pi-oven-setup/standalone-truth-surface.ts`
- Modify: `commands/doctor.md`
- Modify: `commands/setup.md`
- Modify: `README.md`
- Modify: `CLAUDE.md`
- Modify: `docs/runtime-contracts/*.md`
- Modify: relevant doctor/status/snapshot tests

### Doctor checks

- RuntimeContract version and generated artifact parity.
- exact 24-role registry.
- healthy namespace and stale config migration count.
- setup transaction terminal/non-terminal state.
- run ledger schema, integrity check, active/stale lease.
- capability policy/agent tool parity.
- eval offline discrimination status and last live canary status.
- exact dependency/OMP supported version.
- marketplace immutable ref/version parity.
- native-team removal 상태는 “removed; OMP task owns dispatch”로 표현.

### Output rules

- `ACTIVE`는 파일 존재가 아니라 실제 Integration health에만 사용한다.
- `PASS`, `WARN`, `FAIL`, `NOT RUN`을 구분한다.
- live canary 미실행을 PASS로 표현하지 않는다.
- recovery command는 copy-paste 가능하고 destructive action은 자동 실행하지 않는다.

### Acceptance

- status와 doctor가 같은 source function을 소비한다.
- 같은 state에 상충하는 labels가 없다.
- historical native team, legacy namespace, eval telemetry를 healthy로 주장하는 문구가 없다.

### Commit

`docs(runtime): align truth surfaces with enforced contracts`

---

## Task 16 — Integrated release rehearsal and rollback proof

### Files

- Create: `scripts/rehearse-release.ts`
- Create: `tests/integration/runtime-contract-rehearsal.test.ts`
- Create: `docs/harness/reports/2026-07-13-runtime-contract-remediation-result.md`
- Modify: `.github/workflows/ci.yml`

### Rehearsal matrix

1. fresh isolated HOME, no prior plugin.
2. HOME with legacy `pi-oven:*` routing keys.
3. project config overriding global config.
4. setup validation fault and rollback.
5. corrupt/non-terminal setup journal recovery.
6. explicit autonomous skill after 9+ implicit matches.
7. canonical task, unknown task role, missing agent.
8. autonomous run crash before/after effect receipt.
9. provider canary available/unavailable paths.
10. tag artifact install and doctor.

### Final gates

```bash
bun install --frozen-lockfile
bun run contract:generate
git diff --exit-code
bun run contract:check
bun run check
bun run lint:agents
bun run lint:skills
bun run build
bun test --coverage
bun run check:coverage
bun run bench:runtime
bun scripts/check-eval-discrimination.ts
bun scripts/rehearse-release.ts
```

trusted environment에서는 추가로 live canary와 release eval을 실행한다.

### Rollback proof

- RuntimeContract migration: compatibility reader는 한 release 유지.
- setup transaction: journal compensation과 manual recovery diff.
- run ledger: feature flag로 JSON Adapter read fallback.
- prompt compositor: old injector를 한 release feature flag 뒤에 유지하되 correctness test는 양쪽 모두 통과해야 한다.
- release: publish 전 candidate artifact를 폐기할 수 있고 immutable tag 생성 후에는 동일 version 재사용을 금지한다.

### Acceptance

- isolated full suite green.
- contract count: legacy role 0, stale slash 0, invalid task example 0, provider tier prose 0.
- fake-ok positive pass 0.
- explicit skill recall 100%.
- task roster allow/block matrix 100%.
- setup fault matrix 전부 original 또는 explicit rollback_failed.
- release artifact 검증 및 fresh install doctor PASS.

### Commit

`test(release): prove end-to-end contract remediation and rollback`

## PR slicing and dependency graph

한 PR에 모두 넣지 않는다. 각 PR은 independently reviewable해야 하지만 중간 main이 깨지지 않도록 다음 순서를 지킨다.

| PR | 내용 | 선행 | merge gate |
|---|---|---|---|
| A | Task 0–2 Contract + compiler + RED | 없음 | 기존 behavior green, new issues visible |
| B | Task 3 authored migration | A | healthy stale count 0 |
| C | Task 4 runtime/registry fail-closed | B | 24-role matrix + full suite |
| D | Task 5–6 selection + benchmark | C | explicit recall 100%, correctness-first bench |
| E | Task 7 eval evidence | D | fake-ok positive pass 0 |
| F | Task 8 hermetic tests/coverage | E | external write 0 |
| G | Task 9 setup transaction | F | fault matrix/rollback |
| H | Task 10 native scheduler removal | C, F | OMP task canary |
| I | Task 11 run ledger | G, H | lease/effect crash tests |
| J | Task 12 capability policy | C, I | default deny matrix |
| K | Task 13 prompt compositor | D, J | correctness + 50% worker reduction |
| L | Task 14 release/supply chain | E, F, K | verified candidate artifact |
| M | Task 15–16 truth surfaces/rehearsal | all | full release rehearsal |

병렬 구현 가능 구간:

- PR D와 PR G의 research/test scaffolding은 병렬 가능하지만 merge는 표 순서를 따른다.
- PR H는 Contract PR 이후 별도 worktree에서 진행 가능하다.
- PR L의 workflow scaffold는 일찍 작성할 수 있지만 publish enable은 모든 gate가 green 된 뒤다.

## Review checklist for every PR

### Contract

- RuntimeContract를 재정의하는 local string set이 생기지 않았는가?
- healthy/compat/archive surface 구분이 명시적인가?
- error가 실제 accepted schema와 같은 말을 하는가?

### Tests

- RED가 기존 Implementation에서 정말 실패했는가?
- fake/fixture가 production Interface를 지나가는가?
- HOME, clock, filesystem, provider I/O가 주입 가능한가?
- negative control이 vacuous pass를 잡는가?

### Durability

- forward action 전에 compensation 또는 intent가 기록되는가?
- retry가 idempotent한가?
- ambiguous external effect를 자동 재실행하지 않는가?
- stale lease holder의 write가 fencing으로 거부되는가?

### Security

- unknown tool/action의 default가 deny인가?
- consent가 exact scope, TTL, single-use인가?
- error/log에 task assignment나 secret이 노출되지 않는가?
- GitHub token 권한이 job 최소치인가?

### Performance

- correctness가 통과한 결과만 비교하는가?
- benchmark의 tool path가 no-op가 아닌가?
- parent/worker prompt 비용이 분리되는가?
- required safety fragment가 절감 대상으로 잘리지 않는가?

## Quantitative definition of done

| Metric | Baseline | Required |
|---|---:|---:|
| healthy legacy role refs | 239 | 0 |
| stale autonomous slash refs | 2 | 0 |
| invalid authored task examples | 11 | 0 |
| shipped provider tier aliases | 16 | 0 |
| explicit skill alias recall | 0% for observed autonomous aliases | 100% for all shipped skills |
| fake `ok` positive eval pass | 78/78 total suite passed in control experiment | 0 positive passes |
| unknown/missing task agent allow | allowed | 0 |
| canonical 24-role allow | not roster-asserted | 100% |
| isolated tests | 1,095 pass | all pass, external write 0 |
| global line/function coverage | 91.61% / 92.65% | never below 90% / 90%, per-file ratchets met |
| worker prompt overhead | full project instruction repeated | corrected baseline 대비 ≥50% reduction |
| setup partial healthy state after fault | possible | 0 |
| direct wildcard dependencies | 2 | 0 |
| mutable marketplace refs | 2 catalogs on `main` | 0 |
| production native scheduler callers | 0 | scheduler removed |

## External best-practice references and how to apply them

이 절의 링크는 라이브러리 도입 명분이 아니라 구체적인 구현 규칙의 근거다.

### Schema and validation

- [Zod 4 JSON Schema](https://zod.dev/json-schema): `z.toJSONSchema`로 generated contract를 만들고 unrepresentable type은 기본 throw로 유지한다.
- [Zod metadata and registries](https://zod.dev/metadata): schema id, title, description, examples를 typed registry로 관리한다.
- [JSON Schema object keywords](https://json-schema.org/understanding-json-schema/reference/type): required/properties/additionalProperties를 명시해 stale top-level field를 허용하지 않는다.

### Property/model-based tests

- [fast-check property-based testing](https://fast-check.dev/docs/introduction/what-is-property-based-testing/): deterministic seed와 counterexample shrinking을 router invariants에 사용한다.
- [fast-check model-based testing](https://fast-check.dev/docs/advanced/model-based-testing/): setup transaction과 run ledger state transition은 단순화한 model과 real Implementation을 비교한다. model이 Implementation 복사본이 되지 않게 상태만 표현한다.

### Durable local state

- [Bun SQLite transactions and WAL](https://bun.sh/docs/runtime/sqlite): transaction callback의 throw rollback, WAL, nested savepoint를 사용한다.
- [SQLite WAL](https://www.sqlite.org/wal.html): WAL은 same-host filesystem 전제이며 checkpoint와 sidecar가 durable state의 일부라는 점을 doctor/backup에 반영한다.
- [Temporal saga compensation pattern](https://temporal.io/blog/compensating-actions-part-of-a-complete-breakfast-with-sagas): forward action 전에 compensation을 등록한다. Temporal package는 설치하지 않는다.
- [Temporal idempotency and durable execution](https://temporal.io/blog/idempotency-and-durable-execution): retry 간 동일하고 logical operation 간 고유한 idempotency key를 effect receipt에 적용한다.

### Test isolation and reproducibility

- [Bun test lifecycle](https://bun.sh/docs/test/lifecycle): preload에서 production module import 전에 환경을 격리한다.
- [Bun frozen install](https://bun.sh/docs/pm/cli/install): committed lockfile과 `--frozen-lockfile`을 release/CI 모두 사용한다.

### Capability and authorization

- [OWASP Authorization Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html): deny-by-default와 failed authorization의 safe exit를 runtime policy에 적용한다.
- [OWASP Agentic Safety Controls action allowlist](https://owasp.org/APTS/standard/2_Safety_Controls/): model prompt 외부의 version-controlled allowlist가 tool/action을 enforce하게 한다.

### CI and supply chain

- [GitHub minimum `GITHUB_TOKEN` permissions](https://docs.github.com/en/actions/tutorials/authenticate-with-github_token): workflow/job별 최소 권한.
- [GitHub full-length action SHA policy](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-github-actions-settings-for-a-repository): action을 immutable full SHA에 pin.
- [GitHub artifact attestations and SBOM](https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/use-artifact-attestations): release artifact와 SBOM의 signed provenance.
- [SLSA v1.2 Build Track](https://slsa.dev/spec/v1.2/build-track-basics): 우선 Build L1 provenance, hosted signed attestation으로 L2 성격을 점진 적용한다.
- [GitHub Actions concurrency](https://docs.github.com/en/actions/concepts/workflows-and-actions/concurrency): outdated CI와 중복 release run을 concurrency group으로 제어한다.

## Cold conclusion

현재 일반 SWE에서 순정 Codex가 더 믿을 만하다는 이전 감사 결론은 이 계획을 작성한 뒤에도 바뀌지 않는다. 이유는 모델 지능이 아니라 harness의 실행 계약 때문이다. pi-oven은 승인, gate, resume, 역할 분리라는 좋은 구조를 갖고 있지만, 지금은 authored instruction, lint, gate, registry, eval이 서로 다른 현실을 말한다. 이 상태에서 역할 수와 scheduler 기능을 더 늘리면 Codex 대비 격차가 커진다.

가장 효과적인 개선은 다음 다섯 가지다.

1. RuntimeContract 하나로 namespace, roster, task schema를 강제한다.
2. explicit-first routing과 discriminating eval로 “실제로 올바른 agent/skill이 실행됐는지”를 hard gate한다.
3. 사용되지 않는 native scheduler를 제거하고 OMP task에 집중한다.
4. setup transaction과 autonomous ledger로 crash/partial state를 결정적으로 처리한다.
5. prompt capsule과 verified release로 context tax와 공급망 불확실성을 줄인다.

이 순서가 완료되면 pi-oven은 Codex를 흉내 내는 별도 orchestration stack이 아니라, OMP 위에서 contract, approval, verification, recovery를 더 엄격하게 만드는 얇고 깊은 harness가 된다. 그때부터 Codex 대비 우열은 기능 목록이 아니라 동일 task set의 성공률, 재시도율, 비용, 복구율로 다시 측정할 수 있다.
