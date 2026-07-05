# 2026-07-04 pi-oven meta-improvement design

## Document status
- Status: Draft for approval
- Scope: Design-spec authoring only
- Source repo: `/Users/kimzerokim/work/personal/pi-oven`
- Primary evidence:
  - `docs/harness/surveys/2026-07-04-pi-oven-meta-improvement-survey.md`
  - `docs/harness/surveys/2026-07-04-external-harness-comparison.md`
  - `docs/research/2026-07-04-harness-loop-engineering-sota.md`
  - `docs/pre-decisions/2026-07-04-pi-oven-meta-improvement-v1.html`

## Problem statement
pi-oven의 현재 메타 계층은 이미 자체 제어면의 핵심을 갖고 있지만, 중요한 경계가 아직 prompt lore와 외부 하네스 잔재에 걸쳐 있습니다. `docs/harness/surveys/2026-07-04-pi-oven-meta-improvement-survey.md`는 현재 제어면이 `.omp/extensions/pi-oven.ts`, `skill-keyword-loader.ts`, `rules-injector.ts`, `gate.ts`, `gate-handler.ts`, `autonomous-stop-guard.ts`에 집중되어 있다고 정리하면서도, 다음 공백을 함께 지적합니다.

1. deep interview를 뒷받침하는 typed ask/state primitive 부재
2. 병렬 worker spawn/scale의 순차 병목
3. OMC / superpowers 기원 개념의 잔존
4. verification / continuation 판단의 구조적 분리 부족
5. project-local 상태와 machine-global 기본값의 경계 문서화 부족

이 상태로 기능을 덧붙이면, pi-oven-first 재설계가 선언에 머물고 실제 동작은 prompt 규약, bootstrap 관성, 설치 캐시 관찰에 계속 의존하게 됩니다. 이번 설계의 목적은 runtime code를 바로 바꾸는 것이 아니라, pi-oven 메타 개선의 경계·계약·우선순위를 승인 가능한 수준으로 고정하는 것입니다.

## Source-of-truth clarification

### Authoritative change target
이번 설계와 후속 구현의 source of truth는 현재 cwd repo인 `/Users/kimzerokim/work/personal/pi-oven`입니다. 이 점은 `docs/harness/surveys/2026-07-04-pi-oven-meta-improvement-survey.md`의 Source-root determination에 명시되어 있습니다.

### Reference-only snapshots
다음 경로들은 관찰과 비교를 위한 참조 스냅샷일 뿐, 이번 변경의 타깃이 아닙니다.

- installed runtime snapshot: `/Users/kimzerokim/.omp/plugins/cache/plugins/kzk___pi-oven___0.1.23`
- marketplace cache: `/Users/kimzerokim/.omp/plugins/cache/marketplaces/kzk`
- external comparison repos under `/Users/kimzerokim/work/personal/external_harness`

### Design consequence
- 설계 문서, 상태 모델, 검증 기준, 릴리스 동기화 경계는 모두 cwd repo 중심으로 기술합니다.
- installed/cache 경로는 현재 런타임 동작을 설명하는 observational evidence로만 인용합니다.
- 구현 단계에서 cache를 직접 수정하는 방식은 허용하지 않습니다.

## Confirmed decisions locked by this spec
이 문서는 아래 결정을 그대로 잠급니다.

1. **pi-oven-first redesign**
2. **contract 1:1 / implementation pi-oven-native for deep interview**
3. **immediate hard cutover of OMC/superpowers remnants**
4. **policy → continuation marker → scheduler sequence**
5. **full harness revalidation + performance baselines**
6. **native ask/state primitive**
7. **project-local state + global defaults split**
8. **explicit capability policy instead of sibling suppression/isolation**
9. **structure-only borrowing, pi-oven-native terminology**
10. **stronger gates centered on autonomous mode**
11. **first-wave parallelism includes read-only + owned write lanes**
12. **high-level trace/breakpoint primitives**
13. **worker fan-out latency as primary KPI**
14. **release/install sync locked in this wave**
15. **wholesale gajae team-runtime import is a non-goal**

## Goals
1. pi-oven의 메타 개선 대상을 cwd/source repo 기준으로 고정한다.
2. deep interview를 prompt 문구가 아니라 pi-oven-native ask/state capability로 재정의한다.
3. OMC / superpowers 잔재를 우회 호환층이 아니라 명시적 컷오버 대상으로 취급한다.
4. 병렬 런타임을 독립성 규약과 write ownership 기준으로 정의한다.
5. autonomous mode를 중심으로 completion gate와 continuation gate를 강화한다.
6. project-local 상태와 machine-global 기본값의 책임 분리를 명시한다.
7. 구현 전후 성능/안정성 비교가 가능하도록 재검증 및 baseline 전략을 고정한다.
8. release artifact와 install cache의 동기화 경계를 이번 wave에서 설계 수준으로 잠근다.

## Non-goals
1. 구현 계획 작성
2. runtime code 수정
3. gajae team runtime 전체 이식
4. OMC / superpowers bootstrap 방식 재사용
5. cache 경로 직접 수정
6. 최종 수치 튜닝 고정
7. 모든 future capability의 상세 API 확정
8. 이번 문서에서 전체 로드맵의 세부 작업 분해까지 확정

## Constraints
- 설계 대상은 cwd repo 기준이다.
- HTML 및 모든 산출물은 repo 내부에 남아야 한다.
- evidence-first 서술을 유지하고, 직접 근거가 없는 주장은 `[INFERENCE]`로 표시한다.
- installed plugin cache와 marketplace cache는 reference snapshot일 뿐 변경 타깃이 아니다.
- formatters, linters, project-wide test suites는 이번 작업 범위 밖이다.
- 승인 아티팩트로 바로 검토 가능해야 하며, 추가 재탐색 없이는 빈칸이 남지 않아야 한다.

## Design principles
1. **Native first**: 기능 명세와 용어는 pi-oven-native로 정의한다.
2. **Borrow structure, not branding**: 외부 하네스에서 가져오는 것은 구조와 검증된 패턴뿐이다.
3. **Control plane before ergonomics**: 숨은 bootstrap/remap보다 명시적 제어면을 먼저 세운다.
4. **State over lore**: continuation, ask, approval, verification 상태는 prompt가 아니라 구조화된 상태로 남긴다.
5. **Parallelism only with independence proof**: 공유 write surface가 있으면 기본값은 병렬 금지다.
6. **Autonomous mode gets the strongest gates**: 루프 지속과 완료 판정은 분리하고, autonomous 경로에 가장 강한 검증을 둔다.
7. **Source repo drives release reality**: source, packaged release, installed cache의 동기화 경계를 명시적으로 관리한다.

## Chosen approaches and rejected alternatives

### Chosen approaches

#### 1. pi-oven-first redesign
`docs/harness/surveys/2026-07-04-pi-oven-meta-improvement-survey.md`와 `docs/pre-decisions/2026-07-04-pi-oven-meta-improvement-v1.html`은 모두 현재 방향을 `pi-oven-first 재설계`로 고정합니다. 따라서 외부 하네스는 구조 참고 대상으로만 남고, 최종 계약과 용어는 pi-oven이 소유합니다.

#### 2. Deep interview contract 1:1, implementation pi-oven-native
`docs/harness/surveys/2026-07-04-external-harness-comparison.md`는 gajae-code에서 실질 migration unit이 ask UX + render middleware + runtime seed/persist + canonical state merge의 4부 묶음이라고 정리합니다. `docs/pre-decisions/2026-07-04-pi-oven-meta-improvement-v1.html`은 이 4부 묶음을 native primitive로 옮기는 Option C를 권고합니다. 따라서 기능 계약은 1:1로 유지하되, 구현은 pi-oven-native로 재작성합니다.

#### 3. Immediate hard cutover of OMC/superpowers remnants
`docs/pre-decisions/2026-07-04-pi-oven-meta-improvement-v1.html`의 DP-02는 bootstrap message injection과 tool remap을 즉시 끊고, pi-oven control plane을 source of truth로 승격하는 방향을 권고합니다. `docs/harness/surveys/2026-07-04-external-harness-comparison.md`도 superpowers식 bootstrap injection과 OMC식 dual plugin/runtime coupling을 피해야 한다고 정리합니다.

#### 4. Policy → continuation marker → scheduler sequence
`docs/pre-decisions/2026-07-04-pi-oven-meta-improvement-v1.html`의 DP-03은 lane matrix와 write-surface ownership을 먼저 정의하고, explicit continuation marker를 파생 상태로 올린 뒤, 마지막에 scheduler를 교체해야 한다고 잠급니다. 이 순서는 본 설계의 병렬 런타임 원칙입니다.

#### 5. Full harness revalidation + performance baselines
`docs/pre-decisions/2026-07-04-pi-oven-meta-improvement-v1.html`의 DP-04와 `docs/research/2026-07-04-harness-loop-engineering-sota.md`는 fresh evidence, material-edit revalidation, hard cap, verifier lane을 함께 두어야 한다고 정리합니다. 따라서 메타 개선은 부분 smoke check가 아니라 전체 harness flow 재검증과 baseline 비교를 포함합니다.

#### 6. Native ask/state primitive
Survey는 현재 typed elicitation primitive 부재를 핵심 공백으로 적시합니다. External comparison과 pre-decision은 ask/state가 prompt 규약이 아니라 native capability여야 한다는 결론으로 수렴합니다.

#### 7. Project-local state + global defaults split
Survey는 `.pi-oven`와 `~/.omp/agent/config.yml`처럼 프로젝트 로컬 상태와 머신 전역 기본값이 분리되어야 할 층이 있음을 보여 줍니다. 사용자 최신 결정에 따라 `.omc`는 앞으로 무시하며 이번 설계 범위 밖의 historical/deprecated context로만 취급합니다. 이번 설계는 project-local 상태와 machine-global 기본값을 분리된 층으로 잠급니다.

#### 8. Explicit capability policy instead of sibling suppression/isolation
Survey는 현재 sibling suppression globs와 claude-layer isolation 예외를 residual foreign-layer leakage로 분류합니다. 따라서 앞으로의 경계는 legacy sibling 이름 차단이 아니라 capability policy로 표현해야 합니다.

#### 9. Structure-only borrowing with pi-oven-native terminology
External comparison은 stage naming, lane-matrix reasoning, interview contract, verification discipline을 transferable structure로 보지만, bootstrap integration과 vendor terminology 재사용은 피해야 한다고 정리합니다. 본 설계는 pi-oven-native 용어를 사용합니다.

#### 10. Stronger gates centered on autonomous mode
SOTA 문서는 autonomous loops를 finite-state system과 hard exit gate로 모델링해야 한다고 제안하고, pre-decision DP-04는 completion gate와 continuation gate 분리를 권고합니다. 따라서 가장 강한 gate는 autonomous mode 기준으로 설계합니다.

#### 11. First-wave parallelism includes read-only + owned write lanes
DP-03은 survey/research/writer/verification 같은 비공유 write-surface lane을 초기 fan-out 대상으로 제시합니다. 여기에 owned write lane을 포함하되, ownership이 명시된 경우만 허용합니다.

#### 12. High-level trace/breakpoint primitives
`docs/research/2026-07-04-harness-loop-engineering-sota.md`는 raw line-by-line debugger transcript보다 function-level trace, breakpoint, failure path 요약 같은 고수준 primitive를 선호해야 한다고 제안합니다. 이는 메타 개선의 관찰 가능성 설계에 포함됩니다.

#### 13. Worker fan-out latency as primary KPI
Survey는 현재 병목이 `runtime-v2.ts`와 `scaling.ts`의 순차 spawn/scale에 있다고 밝힙니다. 따라서 첫 번째 성능 KPI는 토큰 수나 추상 만족도가 아니라 worker fan-out latency입니다.

#### 14. Release/install sync locked in this wave
Survey가 source repo와 installed cache를 명시적으로 구분한 만큼, 이번 wave에서 source change → release artifact → installed cache의 동기화 경계를 설계 수준으로 잠급니다.

### Rejected alternatives

#### Rejected: prompt-only or skill-prose-only deep interview parity
DP-01 Option A/B는 상태 저장, 재개, canonical merge가 비어 있어 반쪽 패리티로 남습니다. 따라서 채택하지 않습니다.

#### Rejected: wholesale gajae team-runtime import
External comparison은 gajae의 팀 런타임이 deep interview보다 훨씬 무겁고, 첫 wave 이식 대상으로 부적절하다고 정리합니다. 이는 명시적 non-goal입니다.

#### Rejected: gradual shim-heavy cutover
DP-02 Option A는 dual coupling을 연장하고 디버깅/문서화 복잡도를 유지합니다. 따라서 채택하지 않습니다.

#### Rejected: broad fan-out before lane policy
DP-03 Option C/D는 shared write surface 문제를 조기에 확대합니다. 정책보다 scheduler를 앞세우는 방향은 채택하지 않습니다.

#### Rejected: shallow verification or universal heavy verification
DP-04 Option A/B는 loop bounds가 약하고, Option D는 모든 흐름을 과검증합니다. 따라서 위험도 기반 이중 게이트만 채택합니다.

## Runtime/control-plane design direction

### Target control plane
pi-oven의 유일한 제어면은 cwd source repo에서 관리되는 pi-oven-native runtime/control-plane 계약입니다. 현재 관찰된 control points인 다음 범주는 유지·재구성 대상입니다.

- skill matching / owned skill proof
- rules injection / conduct selection
- gate evaluation / gate evidence
- autonomous continuation / stop guard
- subagent orchestration contract
- ask/state/approval primitives

### Direction
1. control plane을 prompt/bootstrap 중심이 아니라 typed runtime contracts 중심으로 재정렬한다.
2. `requiredSkills`, `ownedSkillReadTargets`, branch contract, external execution consent와 같은 proof surface를 operator-visible contract로 승격한다.
3. sibling suppression이나 claude-layer isolation 같은 legacy-relative 규칙을 capability policy로 치환한다.
4. control plane은 worker runtime과 분리되더라도, 상태 계약은 공유된 단일 truth surface를 갖는다.

### Expected control-plane surfaces
- capability registry
- ask/state/approval contract
- continuation marker contract
- lane ownership policy
- verifier depth policy
- release/install sync contract

## Deep-interview design direction

### Locked direction
딥 인터뷰는 `contract 1:1 / implementation pi-oven-native`로 설계합니다.

### Migration unit
다음 4개를 하나의 migration unit으로 취급합니다.
1. ask UX
2. render middleware
3. runtime seed/persist
4. canonical state merge

### Required pi-oven-native primitives
- native ask primitive
- native interview state primitive
- approval-gated handoff primitive
- deep-interview metadata schema
- structured round/decision persistence

### Contract expectations
- ambiguity-triggered interview가 가능해야 한다.
- topology/round/closure/approval 단계가 구조화된 상태로 남아야 한다.
- unattended/headless 경로도 동일 contract를 사용해야 한다.
- handoff와 resume는 prompt 재해석이 아니라 persisted state 기반이어야 한다.

### Terminology rule
용어는 pi-oven-native로 정의합니다. 외부 구현의 명칭을 그대로 들여오지 않고, 필요한 경우 구조적 유사성만 설명합니다.

## Parallel-runtime design direction

### Locked direction
병렬 런타임은 **policy → continuation marker → scheduler** 순서로 엽니다.

### First-wave lane policy
초기 wave에서 병렬 fan-out을 허용하는 lane은 아래 두 종류입니다.

1. **Read-only lanes**
   - survey
   - research
   - comparison
   - verification without mutation
   - documentation lanes

2. **Owned write lanes**
   - 단일 소유권이 명시된 파일/영역만 수정하는 lane
   - reducer 또는 merge contract가 사전에 정의된 lane

### Explicit exclusions in wave 1
- shared mutable write surface를 동시에 건드리는 coding lanes
- ownership이 모호한 refactor fan-out
- imported team-runtime semantics에 기대는 병렬화

### Scheduler direction
scheduler는 lane independence, shared_state_policy, output_schema, reducer를 아는 구조여야 합니다. 이는 `docs/research/2026-07-04-harness-loop-engineering-sota.md`가 정리한 independence-gated parallelism과 정렬됩니다.

### Primary KPI
- primary KPI: worker fan-out latency
- supporting KPIs:
  - continuation resume success rate
  - lane collision rate
  - verifier-triggered rollback/retry visibility
  - end-to-end harness revalidation pass rate

## Gate/capability policy direction

### Core policy shift
정책은 sibling suppression이나 isolation 예외가 아니라 explicit capability policy로 정의합니다.

### Capability categories
최소한 다음 capability 축을 정책 표면으로 둡니다.
- code write
- owned write lane
- shared write lane
- external read
- external mutation
- ask / elicitation
- autonomous continuation
- verification / completion
- debug / trace / breakpoint
- release/install sync operations

### Gate direction
1. destructive/external/code-write 경로는 blocking gate를 사용한다.
2. autonomous continuation은 completion gate와 별개로 판정한다.
3. proof surface는 machine-readable state로 남긴다.
4. verifier depth는 mode/risk/lane 기준으로 조절한다.

## State model direction

### State split
상태 모델은 **project-local state + global defaults split**을 기본 원칙으로 둡니다.

#### Project-local state
프로젝트에 귀속되는 상태:
- branch/approval context
- continuation markers
- lane ownership state
- deep-interview round/decision state
- project-scoped runtime evidence
- project-specific release/install sync state

#### Global defaults
머신 전역 기본값:
- agent/runtime global config defaults
- ambient binary assumptions
- user-level capability defaults that are not project-owned

### State-model requirements
1. project-local state는 repo 관점에서 설명 가능해야 한다.
2. global defaults는 project-local state를 덮어쓰는 숨은 source of truth가 되어서는 안 된다.
3. state transition은 approval, continuation, verification, release sync를 모두 설명할 수 있어야 한다.
4. state merge semantics는 deep interview와 parallel runtime 둘 다 지원해야 한다.

### Continuation marker
continuation marker는 prompt 속 문구가 아니라 구조화된 파생 상태입니다. lane 재개, autonomous loop 재개, verifier pending 상태를 모두 이 표식으로 설명해야 합니다.

## Verification and baseline strategy

### Locked direction
이번 wave는 **full harness revalidation + performance baselines**를 포함합니다.

### Baseline categories
1. control-plane baseline
   - skill proof, gate proof, ask/state flow, continuation marker state
2. deep-interview baseline
   - ambiguity entry, structured round persistence, approval handoff, resume behavior
3. parallel-runtime baseline
   - worker fan-out latency
   - sequential 대비 fan-out improvement
   - ownership collision absence
4. autonomous-mode baseline
   - completion gate behavior
   - continuation gate behavior
   - hard-cap and revalidation enforcement
5. release/install baseline
   - source repo changes가 release/install 경계에서 어떻게 반영되는지의 일관성

### Revalidation rules
- material edit 이후에는 해당 영역 baseline을 다시 확인해야 한다.
- completion evidence와 continuation evidence는 분리해 기록한다.
- risk가 높은 lane만 deeper verifier lane을 거친다.
- trace/debug evidence는 raw transcript보다 구조화된 trace surface를 우선한다.

### Verification posture
이 설계는 전체 하네스 재검증을 요구하지만, 정확한 수치 임계값은 구현 전용 문서에서 정합니다. 수치 자체는 아직 잠그지 않습니다.

## Release/install-cache synchronization boundary

### Locked direction
release/install sync는 이번 wave의 설계 범위에 포함되며, source repo와 installed cache 사이의 경계를 명시적으로 잠급니다.

### Boundary definition
1. **Source repo**: 설계와 구현의 유일한 authoring target
2. **Release artifact**: source repo에서 생성되는 배포 단위
3. **Installed cache**: release 결과가 반영되는 소비자 측 스냅샷

### Policy implications
- installed cache는 디버깅·관찰에는 유용하지만, 패치 대상이 아니다.
- release 이전의 설계/구현 검증은 source repo 기준으로 수행한다.
- release 이후 installed cache 관찰은 sync verification 용도로만 사용한다.
- source/release/install이 어긋나면, cache를 직접 고치는 대신 release/install sync 경로를 수정해야 한다.

## High-level trace and breakpoint primitives
`docs/research/2026-07-04-harness-loop-engineering-sota.md`의 debugger/tooling 근거에 따라, pi-oven은 raw transcript 중심 진단 대신 다음과 같은 고수준 primitive를 목표로 삼습니다.

- `trace_function`
- `summarize_failure_path`
- `set_breakpoint_at_symbol`
- `list_changed_runtime_state`
- `validate_patch_against_trace`

이 primitive들은 deep interview, autonomous gate, verifier lane, parallel runtime debugging 모두에서 공통 observability surface로 작동해야 합니다.

## Risks and mitigations

### Risk 1. Cutover scope expands too early
- Risk: native ask/state, gate reform, continuation marker, scheduler redesign가 한 번에 뒤엉킬 수 있다.
- Mitigation: policy → continuation marker → scheduler 순서를 고정한다.

### Risk 2. Parallelism outruns ownership design
- Risk: worker fan-out은 빨라졌지만 write collision과 merge ambiguity가 늘어날 수 있다.
- Mitigation: first-wave는 read-only + owned write lanes만 허용한다.

### Risk 3. Deep interview becomes prompt polish again
- Risk: UX만 좋아지고 persisted state가 비어 있을 수 있다.
- Mitigation: 4부 묶음을 단일 migration unit으로 잠근다.

### Risk 4. Legacy policy leaks survive under new names
- Risk: sibling suppression/isolation이 capability policy로 재명명만 되고 실제론 남을 수 있다.
- Mitigation: policy surface를 capability 중심으로 다시 정의하고, legacy-relative rule은 rejected alternative로 명시한다.

### Risk 5. Verification cost overwhelms low-risk work
- Risk: 모든 lane에 heavy verification을 붙이면 처리량이 급격히 떨어질 수 있다.
- Mitigation: autonomous mode 중심의 risk-based verifier depth를 사용한다.

## Explicit open questions
현재 승인 전제로 남길 수 있는 open question은 아래뿐입니다.

1. project-local state의 구체 파일 배치와 직렬화 포맷
2. lane ownership/reducer schema의 구체 타입 정의
3. autonomous mode별 hard cap 수치
4. verifier lane depth를 나누는 정량/정성 기준
5. release artifact 생성 시 source→package→install sync를 증명하는 최소 증거 세트

위 질문들은 구현 계획에서 풀 문제이며, 본 설계의 방향성 자체를 다시 열지는 않습니다.

## Approval checklist
- [ ] 이 문서가 cwd repo를 source of truth로 명확히 고정한다.
- [ ] deep interview가 prompt 개선이 아니라 pi-oven-native ask/state primitive로 정의되어 있다.
- [ ] OMC / superpowers 잔재 컷오버가 즉시 hard cutover 방향으로 잠겨 있다.
- [ ] 병렬 런타임 순서가 policy → continuation marker → scheduler로 명시되어 있다.
- [ ] first-wave parallelism 범위가 read-only + owned write lanes로 제한되어 있다.
- [ ] autonomous mode 중심의 stronger gates와 revalidation 방향이 명확하다.
- [ ] project-local state + global defaults split이 분명하다.
- [ ] release/install-cache synchronization boundary가 이번 wave 범위로 잠겨 있다.
- [ ] gajae team-runtime wholesale import가 non-goal로 명시되어 있다.
- [ ] 이 문서만으로 구현 계획 작성 승인 여부를 판단할 수 있다.
