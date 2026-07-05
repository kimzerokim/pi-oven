## Goal

pi-oven의 메타 제어면을 cwd source repo 기준의 pi-oven-native 계약으로 재정렬하고, deep interview·parallel runtime·autonomous gate·state split·release/install sync를 현재 코드 현실에 맞는 migration 순서와 검증 경계로 고정한다.

## Architecture

- **Control-plane lane**: `.omp/extensions/pi-oven.ts`, `.omp/extensions/pi-oven-runtime/gate.ts`, `gate-handler.ts`, `gate-state.ts`, `rules-injector.ts`, `skill-keyword-loader.ts`, `pi-oven-ask.ts`가 capability proof, ask/state, continuation, verifier depth, external consent를 담당한다.
- **Deep-interview lane**: 기존 `pi-oven-ask.ts`를 출발점으로, deep-interview state/runtime/render를 pi-oven-native primitive로 추가한다.
- **Parallel-runtime lane**: `scripts/pi-oven-team/runtime-v2.ts`, `scaling.ts`, `team-config.ts`, `task-file-ops.ts`, `rollback.ts`, `fs-utils.ts`, `types.ts`가 lane policy·fan-out·rollback·persistence order를 담당한다.
- **State boundary lane**: project-local state는 repo 내부 `.pi-oven/state/`와 `.pi-oven/config.json`, `.omp/settings.json`에서 설명 가능해야 하며, machine-global defaults는 `~/.omp/agent/config.yml`과 `~/.pi-oven/config.json`을 read-only default로만 사용한다.
- **Release/install lane**: `scripts/pi-oven-release/*.ts`, `README.md`, `commands/release.md`, `docs/runtime-contracts/*`, `docs/baselines/*`가 source repo → release artifact → installed cache 경계를 문서와 dry-run evidence로 잠근다.

## Tech Stack

- TypeScript under `.omp/extensions/`, `.omp/extensions/pi-oven-runtime/`, `scripts/pi-oven-team/`, `scripts/pi-oven-setup/`, `scripts/pi-oven-release/`
- Bun test runner for targeted unit tests and release dry-run checks
- Markdown / HTML artifacts under `docs/specs/`, `docs/harness/surveys/`, `docs/research/`, `docs/pre-decisions/`, `docs/plans/`, `docs/runtime-contracts/`, `docs/baselines/`
- Git contract for this checkout: use the local `.git/` directory rooted at `/Users/kimzerokim/work/personal/pi-oven`

## Mandatory execution evidence protocol

이 plan의 모든 구현 task는 아래 규칙을 만족해야 한다. **citation만 적어두고 넘어가면 실패**다.

1. **Task 시작 전 reread 의무**
   - 각 task에 적힌 supporting-doc line range와 live-code line range를 실제로 다시 연다.
   - supporting docs 5종은 항상 포함한다:
     - `docs/specs/2026-07-04-pi-oven-meta-improvement-design.md`
     - `docs/harness/surveys/2026-07-04-pi-oven-meta-improvement-survey.md`
     - `docs/harness/surveys/2026-07-04-external-harness-comparison.md`
     - `docs/research/2026-07-04-harness-loop-engineering-sota.md`
     - `docs/pre-decisions/2026-07-04-pi-oven-meta-improvement-v1.html`
2. **Live-code reread 의무**
   - 각 task는 수정 전 관련 live code symbol/range를 다시 연다.
   - 이전 task 때문에 line number가 변했으면, **같은 symbol 기준으로 현재 range를 다시 잡고** 그 updated range를 작업 로그에 남긴 뒤 진행한다.
3. **Execution log 의무**
   - 각 task 시작 체크리스트에 최소 다음 두 줄을 남긴다.
     - `- [ ] supporting-doc ranges reopened and checked`
     - `- [ ] live-code ranges reopened and checked`
4. **No stale-plan execution**
   - task body에 적힌 range를 열어보지 않은 상태에서 코딩 금지.
   - supporting-doc decision과 live-code reality가 충돌하면, 코딩 전에 plan/task를 먼저 갱신한다.
5. **Verification breadth**
   - 새 테스트만 돌리는 것으로 충분하지 않다. 기존 affected suite를 같이 돌려 regression을 막아야 한다.

## Brainstorming / pre-decision coverage

이 plan은 긴 brainstorming의 핵심 결정을 아래처럼 execution task에 매핑한다. 아래 매핑이 무너지면 구현을 시작하지 않는다.

| Decision | Source | Required preservation in this plan |
| --- | --- | --- |
| **DP-01 Option C** — deep interview 4부 묶음(native ask UX + render + runtime seed/persist + canonical merge) | `docs/pre-decisions/2026-07-04-pi-oven-meta-improvement-v1.html:706-885` | Task 2를 `ask 확장 → deep-interview state/runtime/render → keyword/rules wiring` 순서로 분해하고, capability/tag registry-first 흐름을 Task 1/2에 명시한다. |
| **DP-02 Option B** — native control-plane 우선 cutover + thin temporary adapters only | `docs/pre-decisions/2026-07-04-pi-oven-meta-improvement-v1.html:918-1099` | Task 3에서 bootstrap/remap/suppression/isolation front door를 제거하되, 허용되는 임시 adapter 경계를 문서화한다. vendored worker runtime은 control-plane 뒤의 임시 adapter로만 존치 가능하다. |
| **DP-03 Option B** — policy → continuation marker → scheduler | `docs/pre-decisions/2026-07-04-pi-oven-meta-improvement-v1.html:1131-1305` | Task 4 → Task 5 → Task 6 순서를 고정하고, Task 4가 scheduler에 앞서 lane policy / persistence contract를 잠그게 한다. |
| **DP-04 Option C** — completion vs continuation split + hard-cap + material-edit revalidation | `docs/pre-decisions/2026-07-04-pi-oven-meta-improvement-v1.html:1337-1507` | Task 5와 Task 7에서 continuation state, completion evidence, verifier depth, hard-cap, material-edit revalidation을 분리한다. task-level reread / revalidation 규칙도 필수다. |

### Directionally preserved before this rewrite, now made explicit

- `pi-oven-first`, `policy → continuation marker → scheduler`, `deep interview = native capability`, `verification 강화`는 기존 plan에도 방향성은 있었다.
- 빠졌던 부분은 다음이다. 이 rewrite가 그 누락을 메운다.
  - DP-01의 **capability/tag registry first** step
  - DP-02의 **thin temporary adapter boundary**
  - DP-04의 **execution-time reread gate**와 **existing-suite regression proof**
  - current `autonomous.json` / `push-consent.json` / `branch-contract.json` migration path

## Dispatch preflight

### Task 0 — Verify source target, branch contract, and working surface

**Files**
- Create: none
- Modify: none
- Read: `.pi-oven/state/branch-contract.json`, `package.json`, `README.md`, `.omp/extensions/pi-oven.ts`, `.omp/extensions/pi-oven-runtime/gate.ts`, `.omp/extensions/pi-oven-runtime/gate-state.ts`, `scripts/pi-oven-team/runtime-v2.ts`, `scripts/pi-oven-team/scaling.ts`, `scripts/pi-oven-setup.ts`
- Test: none

**Required reread before coding**
- Supporting docs:
  - design `docs/specs/2026-07-04-pi-oven-meta-improvement-design.md:24-39,60-68,80-91,160-176,332-345`
  - survey `docs/harness/surveys/2026-07-04-pi-oven-meta-improvement-survey.md:10-30,52-55,177-202`
  - comparison `docs/harness/surveys/2026-07-04-external-harness-comparison.md:140-149`
  - sota `docs/research/2026-07-04-harness-loop-engineering-sota.md:21-24,91-94,146-149`
  - pre-decision HTML `docs/pre-decisions/2026-07-04-pi-oven-meta-improvement-v1.html:1085-1099`
- Live code:
  - `.pi-oven/state/branch-contract.json`
  - `.omp/extensions/pi-oven.ts:843-887,995-1033`
  - `.omp/extensions/pi-oven-runtime/gate.ts:75-114,433-477`

**Implementation contract**
- Source of truth는 항상 current cwd repo다.
- branch name은 spec-derived invariant가 아니다. **현재 세션의 branch contract**를 `.pi-oven/state/branch-contract.json`에서 읽고, 현재 브랜치가 그 값과 일치하는지 확인한다.
- 현재 세션은 `feature/harness-overhaul` 계약을 사용하지만, plan은 이를 artifact 고정값이 아니라 runtime contract 값으로 취급한다.

**Steps**
- [x] Re-open the required supporting-doc ranges and live-code ranges above.
- [x] Confirm `pwd` is `/Users/kimzerokim/work/personal/pi-oven`.
- [x] Confirm `.git/` exists and all core runtime/setup/team/release surfaces listed above exist.
- [x] Read `.pi-oven/state/branch-contract.json` and capture the expected branch name for this run.
- [x] Run `git branch --show-current` and confirm it matches the branch contract file.
- [x] Run `git status --short --branch` and confirm the branch line matches the branch contract.
- [x] Stop the lane immediately on any mismatch.

**Targeted commands**
- `test "$(pwd)" = "/Users/kimzerokim/work/personal/pi-oven"`
- `test -d .git && test -f package.json && test -f README.md && test -f .omp/extensions/pi-oven.ts && test -f .omp/extensions/pi-oven-runtime/gate.ts && test -f .omp/extensions/pi-oven-runtime/gate-state.ts && test -f scripts/pi-oven-team/runtime-v2.ts && test -f scripts/pi-oven-team/scaling.ts && test -f scripts/pi-oven-setup.ts`
- `git branch --show-current`
- `git status --short --branch`

**Expected outcomes**
- All checks exit `0`.
- The current branch equals the `branch` field in `.pi-oven/state/branch-contract.json`.
- Any mismatch blocks Task 1 through Task 8.

## Spec and decision coverage map

### Goals → tasks

- **Goal 1 — source repo 기준 고정** → Task 0, Task 8
- **Goal 2 — native ask/state deep interview** → Task 1, Task 2
- **Goal 3 — OMC / superpowers 잔재 hard cutover** → Task 3
- **Goal 4 — 병렬 런타임을 독립성/ownership 기준으로 정의** → Task 4, Task 6
- **Goal 5 — completion gate와 continuation gate 강화** → Task 5, Task 7
- **Goal 6 — project-local state와 global defaults split** → Task 1, Task 3
- **Goal 7 — 재검증 및 baseline 전략 고정** → Task 5, Task 7, Task 8
- **Goal 8 — release/install sync 경계 잠금** → Task 8

### Locked decisions → tasks

- **pi-oven-first redesign** → Task 0, Task 1, Task 3, Task 8
- **DP-01 Option C deep-interview bundle** → Task 1, Task 2
- **DP-02 Option B native control-plane cutover** → Task 3, Task 8
- **DP-03 Option B policy → continuation marker → scheduler** → Task 4, Task 5, Task 6
- **DP-04 Option C completion/continuation split + hard-cap/revalidation** → Task 5, Task 7
- **project-local state + global defaults split** → Task 1, Task 3
- **explicit capability policy instead of sibling suppression/isolation** → Task 1, Task 3, Task 4
- **first-wave parallelism = read-only + owned-write only** → Task 4, Task 6
- **high-level trace/breakpoint primitives** → Task 7
- **release/install sync locked in this wave** → Task 8

### Task 1 — Inventory live state, decide migration, then introduce capability registry

**Files**
- Create: `.omp/extensions/pi-oven-runtime/capability-registry.ts`
- Create: `.omp/extensions/pi-oven-runtime/project-state.ts`
- Create: `tests/extensions/pi-oven-runtime/capability-registry.test.ts`
- Create: `tests/extensions/pi-oven-runtime/project-state.test.ts`
- Modify: `.omp/extensions/pi-oven-runtime/gate.ts`
- Modify: `.omp/extensions/pi-oven-runtime/gate-state.ts`
- Read: `.omp/extensions/pi-oven.ts`, `scripts/pi-oven-setup/project-config.ts`, `scripts/pi-oven-setup/project-settings.ts`
- Test: `tests/extensions/pi-oven-runtime/capability-registry.test.ts`
- Test: `tests/extensions/pi-oven-runtime/project-state.test.ts`
- Test: `tests/extensions/pi-oven-runtime/gate-state.test.ts`
- Test: `tests/extensions/pi-oven-runtime/gate.test.ts`
- Test: `tests/extensions/pi-oven-runtime/gate-handler.test.ts`
- Test: `tests/extensions/pi-oven-runtime/wiring.test.ts`

**Required reread before coding**
- Supporting docs:
  - design `docs/specs/2026-07-04-pi-oven-meta-improvement-design.md:160-184,249-300,302-345`
  - survey `docs/harness/surveys/2026-07-04-pi-oven-meta-improvement-survey.md:112-149,165-179,204-216,255-258`
  - comparison `docs/harness/surveys/2026-07-04-external-harness-comparison.md:51-64,127-149`
  - sota `docs/research/2026-07-04-harness-loop-engineering-sota.md:79-94,133-149,170-183`
  - pre-decision HTML `docs/pre-decisions/2026-07-04-pi-oven-meta-improvement-v1.html:874-885,920-1099,1133-1305,1496-1507`
- Live code:
  - `.omp/extensions/pi-oven.ts:610-669,681-702,843-887,995-1033`
  - `.omp/extensions/pi-oven-runtime/gate-state.ts:52-73,190-216,281-380`
  - `.omp/extensions/pi-oven-runtime/gate.ts:75-114,433-477`
  - `scripts/pi-oven-setup/project-config.ts:69-120,176-209,266-318`
  - `scripts/pi-oven-setup/project-settings.ts:32-47,94-121,145-172,202-262`

**Implementation contract**
- `autonomous.json`, `push-consent.json`, `branch-contract.json`의 현재 live behavior를 깨지 않고 migration한다.
- first step은 **inventory + migration decision**이다. state file을 곧바로 쪼개지 않는다.
- `capability-registry.ts`는 `CapabilityId`뿐 아니라 deep-interview / verification / runtime-routing에 쓰이는 `CapabilityTag`와 tag map도 함께 정의해야 한다. DP-01의 **capability/tag registry-first**는 Task 1에서 잠가야 한다.
- `CapabilityId`는 최소 `code_write`, `owned_write_lane`, `shared_write_lane`, `external_read`, `external_mutation`, `ask`, `autonomous_continuation`, `verification_completion`, `debug_trace`, `release_install_sync`를 포함한다.
- project-state abstraction은 project-owned state와 machine-global defaults를 구분하되, current gate behavior와 parent-session mutex semantics를 유지해야 한다.

**Steps**
- [x] Re-open the required supporting-doc ranges and live-code ranges above.
- [x] Extend `gate-state.test.ts`, `gate.test.ts`, and `gate-handler.test.ts` with failing assertions that lock the current behavior of `autonomous.json`, `push-consent.json`, and `branch-contract.json`.
- [x] Create failing tests in `capability-registry.test.ts` and `project-state.test.ts` for capability ids, capability tags, file ownership, migration compatibility, and envelope shape.
- [x] Decide which runtime facts remain in `autonomous.json` during migration and which facts move behind `project-state.ts` adapters.
- [x] Implement `capability-registry.ts` and `project-state.ts` with deterministic JSON serialization, explicit read/write ownership, and the tag registry needed by Task 2’s deep-interview wiring.
- [x] Update `gate.ts` and `gate-state.ts` to consume the new registry/state contracts without regressing current gate behavior.
- [x] Re-run the full affected runtime-state test set before moving to Task 2.

**Targeted commands**
- `bun test tests/extensions/pi-oven-runtime/capability-registry.test.ts tests/extensions/pi-oven-runtime/project-state.test.ts tests/extensions/pi-oven-runtime/gate-state.test.ts tests/extensions/pi-oven-runtime/gate.test.ts tests/extensions/pi-oven-runtime/gate-handler.test.ts tests/extensions/pi-oven-runtime/wiring.test.ts`

**Expected outcomes**
- The targeted `bun test` command exits `0`.
- Current gate behavior still passes for `branch-contract.json`, `push-consent.json`, and parent-session proof surfaces.
- New registry/state tests prove the migration path instead of assuming it.

### Task 2 — Extend ask, then add deep-interview runtime/state/render, then wire skill/runtime triggers

**Files**
- Create: `.omp/extensions/pi-oven-runtime/deep-interview-runtime.ts`
- Create: `.omp/extensions/pi-oven-runtime/deep-interview-state.ts`
- Create: `.omp/extensions/pi-oven-runtime/deep-interview-render.ts`
- Create: `tests/extensions/pi-oven-runtime/deep-interview-runtime.test.ts`
- Create: `tests/extensions/pi-oven-runtime/deep-interview-state.test.ts`
- Modify: `.omp/extensions/pi-oven-runtime/pi-oven-ask.ts`
- Modify: `.omp/extensions/pi-oven-runtime/skill-keyword-loader.ts`
- Modify: `.omp/extensions/pi-oven-runtime/rules-injector.ts`
- Modify: `.omp/extensions/pi-oven.ts`
- Test: `tests/extensions/pi-oven-runtime/pi-oven-ask.test.ts`
- Test: `tests/extensions/pi-oven-runtime/skill-keyword-loader.test.ts`
- Test: `tests/extensions/pi-oven-runtime/rules-injector.test.ts`
- Test: `tests/extensions/pi-oven-runtime/wiring.test.ts`
- Test: `tests/extensions/pi-oven-runtime/deep-interview-runtime.test.ts`
- Test: `tests/extensions/pi-oven-runtime/deep-interview-state.test.ts`

**Required reread before coding**
- Supporting docs:
  - design `docs/specs/2026-07-04-pi-oven-meta-improvement-design.md:186-212,302-330,369-379`
  - survey `docs/harness/surveys/2026-07-04-pi-oven-meta-improvement-survey.md:112-123,165-175,240-253,255-258`
  - comparison `docs/harness/surveys/2026-07-04-external-harness-comparison.md:20-35,105-130,146-149`
  - sota `docs/research/2026-07-04-harness-loop-engineering-sota.md:97-113,164-167`
  - pre-decision HTML `docs/pre-decisions/2026-07-04-pi-oven-meta-improvement-v1.html:706-885`
- Live code:
  - `.omp/extensions/pi-oven-runtime/pi-oven-ask.ts:25-40,102-157,297-340`
  - `.omp/extensions/pi-oven-runtime/skill-keyword-loader.ts:301-440`
  - `.omp/extensions/pi-oven-runtime/rules-injector.ts:196-244`
  - `.omp/extensions/pi-oven.ts:843-887,995-1033`

**Implementation contract**
- Task 2는 **DP-01 Option C**를 직접 구현한다. ask UX, runtime seed/persist, state merge, approval/resume를 분리하지 않는다.
- `pi-oven-ask.ts`는 single-select tool에서 시작하지만, deep-interview metadata를 담을 수 있게 먼저 확장한다.
- Task 2는 Task 1에서 잠근 capability/tag registry를 실제로 사용해야 한다. ambiguity/deep-interview routing은 free-form wiring이 아니라 registry-driven flow여야 한다.
- `skill-keyword-loader.ts` / `rules-injector.ts` wiring은 마지막 단계다. runtime/state/render와 tag registry consumption이 생기기 전에는 wire하지 않는다.

**Steps**
- [x] Re-open the required supporting-doc ranges and live-code ranges above.
- [x] Extend `pi-oven-ask.test.ts` with failing assertions for metadata needed by deep-interview rounds, recommendations, and approval handoff.
- [x] Create failing deep-interview runtime/state tests for round identity, persistence, resume, approval handoff, and canonical merge.
- [x] Modify `pi-oven-ask.ts` to carry the new ask metadata.
- [x] Create `deep-interview-state.ts`, `deep-interview-runtime.ts`, and `deep-interview-render.ts` as the pi-oven-native bundle.
- [x] Only after the runtime/state/render bundle exists, wire `skill-keyword-loader.ts`, `rules-injector.ts`, and `.omp/extensions/pi-oven.ts` to route ambiguity-triggered interview flow through the native contract.
- [x] Re-run the affected ask/loader/rules/wiring suites plus the new deep-interview suites before moving to Task 3.

**Targeted commands**
- `bun test tests/extensions/pi-oven-runtime/pi-oven-ask.test.ts tests/extensions/pi-oven-runtime/skill-keyword-loader.test.ts tests/extensions/pi-oven-runtime/rules-injector.test.ts tests/extensions/pi-oven-runtime/wiring.test.ts tests/extensions/pi-oven-runtime/deep-interview-runtime.test.ts tests/extensions/pi-oven-runtime/deep-interview-state.test.ts`

**Expected outcomes**
- The targeted `bun test` command exits `0`.
- The deep-interview bundle exists as pi-oven-native runtime/state/render primitives, not prompt-only prose.
- Wiring happens only after the bundle exists.

### Task 3 — Hard-cut the control plane to explicit capability proofs and document temporary adapter boundaries

**Files**
- Modify: `.omp/extensions/pi-oven.ts`
- Modify: `.omp/extensions/pi-oven-runtime/skill-keyword-loader.ts`
- Modify: `.omp/extensions/pi-oven-runtime/rules-injector.ts`
- Modify: `.omp/extensions/pi-oven-runtime/gate.ts`
- Modify: `.omp/extensions/pi-oven-runtime/gate-handler.ts`
- Modify: `scripts/pi-oven-setup.ts`
- Modify: `scripts/pi-oven-setup/config-yml.ts`
- Modify: `scripts/pi-oven-setup/isolate.ts`
- Modify: `scripts/pi-oven-setup/suppress-sibling.ts`
- Modify: `scripts/pi-oven-setup/standalone-truth-surface.ts`
- Modify: `scripts/pi-oven-setup/status.ts`
- Modify: `commands/setup.md`
- Modify: `commands/doctor.md`
- Modify: `README.md`
- Modify: `tests/extensions/pi-oven-runtime/gate-handler.test.ts`
- Modify: `tests/extensions/pi-oven-runtime/skill-keyword-loader.test.ts`
- Modify: `tests/extensions/pi-oven-runtime/rules-injector.test.ts`
- Modify: `tests/extensions/pi-oven-runtime/wiring.test.ts`
- Modify: `tests/extensions/pi-oven.test.ts`
- Modify: `tests/scripts/pi-oven-setup/config-yml.test.ts`
- Modify: `tests/scripts/pi-oven-setup/isolate.test.ts`
- Modify: `tests/scripts/pi-oven-setup/suppress-sibling.test.ts`
- Modify: `tests/scripts/pi-oven-setup/status.test.ts`
- Modify: `tests/scripts/pi-oven-setup/apply.test.ts`
- Create: `tests/scripts/pi-oven-setup/compatibility-boundary.test.ts`
- Modify: `tests/plugin/pi-oven-doctor.test.ts`
- Modify: `tests/plugin/pi-oven-doctor-smoke-count.test.ts`
- Modify: `tests/plugin/skill-discoverability.test.ts`

**Required reread before coding**
- Supporting docs:
  - design `docs/specs/2026-07-04-pi-oven-meta-improvement-design.md:160-176,249-272,373-379`
  - survey `docs/harness/surveys/2026-07-04-pi-oven-meta-improvement-survey.md:218-238,240-253,255-258`
  - comparison `docs/harness/surveys/2026-07-04-external-harness-comparison.md:37-49,90-103,140-149`
  - sota `docs/research/2026-07-04-harness-loop-engineering-sota.md:133-149,164-183`
  - pre-decision HTML `docs/pre-decisions/2026-07-04-pi-oven-meta-improvement-v1.html:918-1099`
- Live code:
  - `scripts/pi-oven-setup.ts:52-56,184-219`
  - `scripts/pi-oven-setup/config-yml.ts:637-734,765-933`
  - `scripts/pi-oven-setup/isolate.ts:1-58`
  - `scripts/pi-oven-setup/standalone-truth-surface.ts`
  - `scripts/pi-oven-setup/status.ts`
  - `.omp/extensions/pi-oven.ts:843-887,995-1033`
  - `.omp/extensions/pi-oven-runtime/gate-handler.ts:225-263,363-434`

**Implementation contract**
- 허용되는 임시 adapter는 **native control plane 뒤에만** 존재할 수 있다. 현재 세션에서는 vendored worker runtime(`scripts/pi-oven-team/*`)만 해당 예외를 가진다.
- bootstrap message injection, tool remap, sibling suppression, `~/.claude`-relative isolation을 **정상 control-plane 경로로 계속 설명하는 것**은 금지한다.
- compatibility carve-out은 선택 사항이 아니다. 남길 경우 `README.md` / `commands/setup.md` / `commands/doctor.md`에 **같은 scope·same removal condition·same owner** 문구로 반복되어야 하며, 남기지 않을 경우 세 문서 모두에서 해당 carve-out 문구가 없어야 한다.

**Steps**
- [x] Re-open the required supporting-doc ranges and live-code ranges above.
- [x] Extend runtime/setup/plugin tests with failing assertions that capability-proof surfaces are the single front door and legacy suppression/isolation surfaces are no longer advertised as standard paths.
- [x] Create `tests/scripts/pi-oven-setup/compatibility-boundary.test.ts` with failing assertions that either (a) no compatibility carve-out remains anywhere, or (b) README / `commands/setup.md` / `commands/doctor.md` carry the exact same bounded scope / owner / removal-condition block.
- [x] Update runtime proof handling (`pi-oven.ts`, `skill-keyword-loader.ts`, `rules-injector.ts`, `gate.ts`, `gate-handler.ts`) to make capability proof surfaces explicit and bounded.
- [x] Update setup/status/doctor/README/command truth surfaces so user-facing guidance matches the new control-plane contract.
- [x] Choose one path explicitly: **no carve-out remains** or **one bounded temporary adapter carve-out remains**.
- [x] If a carve-out remains, document the same scope / owner / removal condition wording in all three user-facing docs and reject any extra carve-out text elsewhere.
- [x] Run the widened affected suites plus the legacy-removal scan before moving to Task 4.

**Targeted commands**
- `bun test tests/extensions/pi-oven.test.ts tests/extensions/pi-oven-runtime/gate-handler.test.ts tests/extensions/pi-oven-runtime/skill-keyword-loader.test.ts tests/extensions/pi-oven-runtime/rules-injector.test.ts tests/extensions/pi-oven-runtime/wiring.test.ts tests/scripts/pi-oven-setup/config-yml.test.ts tests/scripts/pi-oven-setup/isolate.test.ts tests/scripts/pi-oven-setup/suppress-sibling.test.ts tests/scripts/pi-oven-setup/status.test.ts tests/scripts/pi-oven-setup/apply.test.ts tests/scripts/pi-oven-setup/compatibility-boundary.test.ts tests/plugin/pi-oven-doctor.test.ts tests/plugin/pi-oven-doctor-smoke-count.test.ts tests/plugin/skill-discoverability.test.ts`
- `! grep -n -- "--isolate\|--no-isolate\|--suppress-sibling-skills\|--no-suppress-sibling-skills\|clean-room\|sibling suppression" commands/setup.md commands/doctor.md README.md scripts/pi-oven-setup/suppress-sibling.ts scripts/pi-oven-setup/standalone-truth-surface.ts`

**Expected outcomes**
- The targeted `bun test` command exits `0`.
- The legacy-removal scan exits `0`.
- `compatibility-boundary.test.ts` proves either full carve-out removal or exact same bounded carve-out wording across README / setup / doctor surfaces.

### Task 4 — Freeze lane policy and persistence contracts before scheduler edits

**Files**
- Create: `scripts/pi-oven-team/lane-policy.ts`
- Create: `tests/scripts/pi-oven-team/lane-policy.test.ts`
- Modify: `scripts/pi-oven-team/types.ts`
- Read: `scripts/pi-oven-team/runtime-v2.ts`, `scripts/pi-oven-team/scaling.ts`, `scripts/pi-oven-team/team-config.ts`, `scripts/pi-oven-team/task-file-ops.ts`, `scripts/pi-oven-team/state-paths.ts`, `scripts/pi-oven-team/rollback.ts`
- Test: `tests/scripts/pi-oven-team/lane-policy.test.ts`
- Test: `tests/scripts/pi-oven-team/task-file-ops.test.ts`

**Required reread before coding**
- Supporting docs:
  - design `docs/specs/2026-07-04-pi-oven-meta-improvement-design.md:214-243,273-300`
  - survey `docs/harness/surveys/2026-07-04-pi-oven-meta-improvement-survey.md:151-163,204-216,255-257`
  - comparison `docs/harness/surveys/2026-07-04-external-harness-comparison.md:51-64,127-149`
  - sota `docs/research/2026-07-04-harness-loop-engineering-sota.md:62-76,170-175`
  - pre-decision HTML `docs/pre-decisions/2026-07-04-pi-oven-meta-improvement-v1.html:1131-1305`
- Live code:
  - `scripts/pi-oven-team/runtime-v2.ts:7-28,97-216`
  - `scripts/pi-oven-team/scaling.ts:7-12,17-39,41-142`
  - `scripts/pi-oven-team/team-config.ts:39-116`
  - `scripts/pi-oven-team/task-file-ops.ts`
  - `scripts/pi-oven-team/state-paths.ts`

**Implementation contract**
- Task 4는 scheduler를 수정하지 않는다.
- lane policy는 `objective`, `independence_reason`, `shared_state_policy`, `output_schema`, `reducer`를 포함한다.
- scheduler write-order에 영향 주는 persistence surface(`team-config.ts`, `task-file-ops.ts`, `state-paths.ts`)를 읽고 contract를 먼저 잠근다.

**Steps**
- [x] Re-open the required supporting-doc ranges and live-code ranges above.
- [x] Add failing tests for lane classification, reducer presence, collision rejection, and persistence-contract expectations.
- [x] Implement `lane-policy.ts` and update `types.ts` so later scheduler code can consume explicit lane metadata.
- [x] Confirm Task 4 does not modify scheduler files.
- [x] Run the lane-policy and persistence-adjacent tests before moving to Task 5.

**Targeted commands**
- `bun test tests/scripts/pi-oven-team/lane-policy.test.ts tests/scripts/pi-oven-team/task-file-ops.test.ts`
- `git diff -- scripts/pi-oven-team/runtime-v2.ts scripts/pi-oven-team/scaling.ts scripts/pi-oven-team/rollback.ts scripts/pi-oven-team/fs-utils.ts`

**Expected outcomes**
- The targeted `bun test` command exits `0`.
- The diff command prints no scheduler-file changes at the end of Task 4.
- Lane policy captures the persistence/reducer boundary that Task 6 will later implement.

### Task 5 — Decide continuation persistence location, then separate continuation markers from completion gates

**Files**
- Create: `.omp/extensions/pi-oven-runtime/continuation-marker.ts`
- Create: `tests/extensions/pi-oven-runtime/continuation-marker.test.ts`
- Modify: `.omp/extensions/pi-oven-runtime/autonomous-stop-guard.ts`
- Modify: `.omp/extensions/pi-oven-runtime/gate-handler.ts`
- Modify: `.omp/extensions/pi-oven-runtime/gate-state.ts`
- Modify: `tests/extensions/pi-oven-runtime/autonomous-stop-guard.test.ts`
- Modify: `tests/extensions/pi-oven-runtime/gate-state.test.ts`
- Modify: `tests/extensions/pi-oven-runtime/wiring.test.ts`
- Test: `tests/extensions/pi-oven-runtime/continuation-marker.test.ts`
- Test: `tests/extensions/pi-oven-runtime/autonomous-stop-guard.test.ts`
- Test: `tests/extensions/pi-oven-runtime/gate-state.test.ts`
- Test: `tests/extensions/pi-oven-runtime/wiring.test.ts`

**Required reread before coding**
- Supporting docs:
  - design `docs/specs/2026-07-04-pi-oven-meta-improvement-design.md:267-300,302-327`
  - survey `docs/harness/surveys/2026-07-04-pi-oven-meta-improvement-survey.md:125-149,165-175,204-216,257-258`
  - comparison `docs/harness/surveys/2026-07-04-external-harness-comparison.md:51-64,135-149`
  - sota `docs/research/2026-07-04-harness-loop-engineering-sota.md:79-94,170-175`
  - pre-decision HTML `docs/pre-decisions/2026-07-04-pi-oven-meta-improvement-v1.html:1131-1305,1337-1507`
- Live code:
  - `.omp/extensions/pi-oven-runtime/autonomous-stop-guard.ts`
  - `.omp/extensions/pi-oven-runtime/gate-state.ts:281-380`
  - `.omp/extensions/pi-oven-runtime/gate-handler.ts:363-434`
  - `tests/extensions/pi-oven-runtime/autonomous-stop-guard.test.ts`
  - `tests/extensions/pi-oven-runtime/gate-state.test.ts`

**Implementation contract**
- first step은 continuation marker를 `autonomous.json`에 embed할지, 별도 파일로 둘지, existing `GateStateStore` mutex를 재사용할지 결정하는 failing test/contract step이다.
- continuation evidence와 completion evidence는 separate records로 남아야 한다.
- DP-04에 따라 verifier pending / halted-by-policy / lane resume / autonomous loop resume가 모두 구조화된 marker로 표현되어야 한다.

**Steps**
- [x] Re-open the required supporting-doc ranges and live-code ranges above.
- [x] Add failing tests that force an explicit persistence-location decision before implementation.
- [x] Create `continuation-marker.ts` only after the persistence location and mutex-owner decision is locked by tests.
- [x] Update `autonomous-stop-guard.ts`, `gate-handler.ts`, and `gate-state.ts` to keep continuation and completion evidence separate.
- [x] Re-run continuation/state/wiring suites before moving to Task 6.

**Targeted commands**
- `bun test tests/extensions/pi-oven-runtime/continuation-marker.test.ts tests/extensions/pi-oven-runtime/autonomous-stop-guard.test.ts tests/extensions/pi-oven-runtime/gate-state.test.ts tests/extensions/pi-oven-runtime/wiring.test.ts`

**Expected outcomes**
- The targeted `bun test` command exits `0`.
- The persistence location is explicit, tested, and compatible with the current state store.
- Continuation and completion evidence no longer share ambiguous state.

### Task 6 — Replace sequential worker startup/scale with policy-gated fan-out and explicit persistence order

**Files**
- Modify: `scripts/pi-oven-team/runtime-v2.ts`
- Modify: `scripts/pi-oven-team/scaling.ts`
- Modify: `scripts/pi-oven-team/rollback.ts`
- Modify: `scripts/pi-oven-team/fs-utils.ts`
- Modify: `scripts/pi-oven-team/team-config.ts`
- Modify: `scripts/pi-oven-team/task-file-ops.ts`
- Modify: `tests/scripts/pi-oven-team/runtime-v2.test.ts`
- Modify: `tests/scripts/pi-oven-team/scaling.test.ts`
- Modify: `tests/scripts/pi-oven-team/task-file-ops.test.ts`
- Modify: `tests/scripts/pi-oven-team/index.test.ts`
- Create: `tests/scripts/pi-oven-team/rollback.test.ts`
- Test: `tests/scripts/pi-oven-team/runtime-v2.test.ts`
- Test: `tests/scripts/pi-oven-team/scaling.test.ts`
- Test: `tests/scripts/pi-oven-team/task-file-ops.test.ts`
- Test: `tests/scripts/pi-oven-team/index.test.ts`
- Test: `tests/scripts/pi-oven-team/rollback.test.ts`

**Required reread before coding**
- Supporting docs:
  - design `docs/specs/2026-07-04-pi-oven-meta-improvement-design.md:214-243,302-330,361-367`
  - survey `docs/harness/surveys/2026-07-04-pi-oven-meta-improvement-survey.md:151-163,204-216,255-257`
  - comparison `docs/harness/surveys/2026-07-04-external-harness-comparison.md:51-64,127-149`
  - sota `docs/research/2026-07-04-harness-loop-engineering-sota.md:62-76,164-166,174-175`
  - pre-decision HTML `docs/pre-decisions/2026-07-04-pi-oven-meta-improvement-v1.html:1131-1305`
- Live code:
  - `scripts/pi-oven-team/runtime-v2.ts:7-28,97-216`
  - `scripts/pi-oven-team/scaling.ts:7-12,17-39,41-142`
  - `scripts/pi-oven-team/team-config.ts:39-116`
  - `scripts/pi-oven-team/task-file-ops.ts`
  - `scripts/pi-oven-team/rollback.ts`
  - `scripts/pi-oven-team/fs-utils.ts`

**Implementation contract**
- Fan-out은 `read_only`와 `owned_write` lane만 허용한다.
- sequential bottleneck 해결과 함께 `saveTeamConfig()` / `writeTaskStateFile()` / rollback write order를 명시적으로 다룬다.
- reducer order, collision evidence, rollback-safe persistence는 scheduler loop와 같은 수준의 ownership을 가진다.
- primary KPI는 supporting artifacts가 요구한 **worker fan-out latency**다. Task 6은 최소 `fanoutLatencyMs`, `sequentialComparableLatencyMs`, `startupImprovementRatio` 세 증거를 runtime/test surface에 남겨야 한다.

**Steps**
- [x] Re-open the required supporting-doc ranges and live-code ranges above.
- [x] Extend existing scheduler tests and create `rollback.test.ts` with failing assertions for dependency-aware batching, collision rejection, reducer order, rollback-safe persistence, and latency-evidence emission.
- [x] Update `runtime-v2.ts` and `scaling.ts` to batch only policy-approved lanes and to emit `fanoutLatencyMs`, `sequentialComparableLatencyMs`, and `startupImprovementRatio` evidence.
- [x] Update `rollback.ts`, `fs-utils.ts`, `team-config.ts`, and `task-file-ops.ts` so persistence order, collision evidence, and latency evidence remain deterministic.
- [x] Re-run the widened team-runtime suites before moving to Task 7.

**Targeted commands**
- `bun test tests/scripts/pi-oven-team/runtime-v2.test.ts tests/scripts/pi-oven-team/scaling.test.ts tests/scripts/pi-oven-team/task-file-ops.test.ts tests/scripts/pi-oven-team/index.test.ts tests/scripts/pi-oven-team/rollback.test.ts`
- `grep -n "fanoutLatencyMs\|sequentialComparableLatencyMs\|startupImprovementRatio" scripts/pi-oven-team/runtime-v2.ts scripts/pi-oven-team/scaling.ts scripts/pi-oven-team/team-config.ts tests/scripts/pi-oven-team/runtime-v2.test.ts tests/scripts/pi-oven-team/scaling.test.ts tests/scripts/pi-oven-team/index.test.ts`

**Expected outcomes**
- The targeted `bun test` command exits `0`.
- The KPI evidence scan exits `0`.
- Worker startup/scale is no longer purely sequential, and the task leaves concrete latency/improvement evidence for Task 8’s baseline document.

### Task 7 — Add runtime trace primitives and verifier-depth policy before updating agent/eval/setup surfaces

**Files**
- Create: `.omp/extensions/pi-oven-runtime/trace-primitives.ts`
- Create: `.omp/extensions/pi-oven-runtime/verifier-depth-policy.ts`
- Create: `tests/extensions/pi-oven-runtime/trace-primitives.test.ts`
- Create: `tests/extensions/pi-oven-runtime/verifier-depth-policy.test.ts`
- Modify: `.omp/extensions/pi-oven-runtime/gate.ts`
- Modify: `.omp/extensions/pi-oven-runtime/gate-handler.ts`
- Modify: `.omp/extensions/pi-oven-runtime/autonomous-stop-guard.ts`
- Modify: `scripts/pi-oven-setup/apply.ts`
- Modify: `scripts/pi-oven-team/index.ts`
- Modify: `agents/pi-oven-verifier.md`
- Modify: `evals/fresh-verifier/scenarios/smoke.yaml`
- Modify: `evals/fresh-verifier/scenarios/regression.yaml`
- Modify: `tests/scripts/pi-oven-team/index.test.ts`
- Test: `tests/extensions/pi-oven-runtime/trace-primitives.test.ts`
- Test: `tests/extensions/pi-oven-runtime/verifier-depth-policy.test.ts`
- Test: `tests/extensions/pi-oven-runtime/gate-handler.test.ts`
- Test: `tests/extensions/pi-oven-runtime/wiring.test.ts`
- Test: `tests/extensions/pi-oven.test.ts`
- Test: `tests/scripts/pi-oven-team/index.test.ts`

**Required reread before coding**
- Supporting docs:
  - design `docs/specs/2026-07-04-pi-oven-meta-improvement-design.md:302-330,348-379`
  - survey `docs/harness/surveys/2026-07-04-pi-oven-meta-improvement-survey.md:125-149,240-253`
  - comparison `docs/harness/surveys/2026-07-04-external-harness-comparison.md:90-103,146-149`
  - sota `docs/research/2026-07-04-harness-loop-engineering-sota.md:79-94,116-149,164-177`
  - pre-decision HTML `docs/pre-decisions/2026-07-04-pi-oven-meta-improvement-v1.html:1337-1507`
- Live code:
  - `.omp/extensions/pi-oven-runtime/gate.ts:433-510`
  - `.omp/extensions/pi-oven-runtime/gate-handler.ts:237-263,363-434`
  - `.omp/extensions/pi-oven-runtime/autonomous-stop-guard.ts`
  - `scripts/pi-oven-setup/apply.ts`
  - `scripts/pi-oven-team/index.ts`
  - `agents/pi-oven-verifier.md`

**Implementation contract**
- runtime contract가 먼저다. agent/eval/setup copy는 그 다음이다.
- trace primitive는 raw transcript 반복이 아니라 function/symbol/state 중심 contract여야 한다.
- verifier depth policy는 mode, risk, mutation scope, material edit 여부에 따라 light/deep verification과 hard-cap을 결정해야 한다.

**Steps**
- [x] Re-open the required supporting-doc ranges and live-code ranges above.
- [x] Create failing runtime tests for trace primitives and verifier-depth policy.
- [x] Implement `trace-primitives.ts` and `verifier-depth-policy.ts`.
- [x] Update runtime gate / handler / stop guard to consume the new contracts.
- [x] Only after the runtime contracts pass, update setup/team index/verifier agent/eval scenario surfaces to match them.
- [x] Re-run the widened runtime/team/plugin suites before moving to Task 8.

**Targeted commands**
- `bun test tests/extensions/pi-oven-runtime/trace-primitives.test.ts tests/extensions/pi-oven-runtime/verifier-depth-policy.test.ts tests/extensions/pi-oven-runtime/gate-handler.test.ts tests/extensions/pi-oven-runtime/wiring.test.ts tests/extensions/pi-oven.test.ts tests/scripts/pi-oven-team/index.test.ts`

**Expected outcomes**
- The targeted `bun test` command exits `0`.
- Trace and verifier-depth concepts exist first as runtime contracts, then as user-facing/eval surfaces.
- Hard-cap and material-edit revalidation are enforced by runtime logic, not only prose.

### Task 8 — Lock release/install sync and baseline evidence on top of the existing release helpers

**Files**
- Modify: `scripts/pi-oven-release/manifest-sync.ts`
- Modify: `scripts/pi-oven-release/git-ops.ts`
- Modify: `scripts/pi-oven-release/index.ts`
- Modify: `README.md`
- Modify: `commands/release.md`
- Modify: `tests/scripts/pi-oven-release/manifest-sync.test.ts`
- Modify: `tests/scripts/pi-oven-release/git-ops.test.ts`
- Modify: `tests/scripts/pi-oven-release/release-publisher.test.ts`
- Create: `docs/runtime-contracts/pi-oven-meta-control-plane.md`
- Create: `docs/baselines/2026-07-04-pi-oven-meta-improvement.md`
- Test: `tests/scripts/pi-oven-release/manifest-sync.test.ts`
- Test: `tests/scripts/pi-oven-release/git-ops.test.ts`
- Test: `tests/scripts/pi-oven-release/release-publisher.test.ts`

**Required reread before coding**
- Supporting docs:
  - design `docs/specs/2026-07-04-pi-oven-meta-improvement-design.md:24-39,302-345`
  - survey `docs/harness/surveys/2026-07-04-pi-oven-meta-improvement-survey.md:10-27,177-202,255-258`
  - comparison `docs/harness/surveys/2026-07-04-external-harness-comparison.md:8-16,140-149`
  - sota `docs/research/2026-07-04-harness-loop-engineering-sota.md:21-24,91-94,170-183`
  - pre-decision HTML `docs/pre-decisions/2026-07-04-pi-oven-meta-improvement-v1.html:918-1099,1337-1507`
- Live code:
  - `scripts/pi-oven-release/manifest-sync.ts`
  - `scripts/pi-oven-release/git-ops.ts`
  - `scripts/pi-oven-release/index.ts`
  - `README.md`
  - `commands/release.md`
  - `tests/scripts/pi-oven-release/manifest-sync.test.ts`
  - `tests/scripts/pi-oven-release/git-ops.test.ts`

**Implementation contract**
- Task 8은 greenfield release helper 작성이 아니다. existing helper output과 doc wording을 정렬하는 작업이다.
- source repo → release artifact → installed cache boundary를 repo-owned docs와 dry-run output으로 동시에 증명해야 한다.
- installed cache는 관찰 대상이지 patch target이 아니다.
- Task 8은 Task 6이 남긴 `fanoutLatencyMs`, `sequentialComparableLatencyMs`, `startupImprovementRatio` evidence를 baseline 문서에 기록해야 한다.
- Task 8은 broad TS/runtime/doc changes에 대한 final harness revalidation으로 `bun run check`, `bun run build`, `bun run lint:agents`를 포함한다.

**Steps**
- [x] Re-open the required supporting-doc ranges and live-code ranges above.
- [x] Add failing release tests for source-driven manifest sync and local-git release boundary handling.
- [x] Compare current helper output against the required boundary wording before editing docs.
- [x] Update release helpers and user-facing release docs so the helper output and the written contract match.
- [x] Create the control-plane contract doc and baseline evidence doc only after Tasks 1 through 7 evidence exists.
- [x] Record Task 6 latency evidence as concrete numeric values in `docs/baselines/2026-07-04-pi-oven-meta-improvement.md`.
- [x] Run the widened release suites, `bun run check`, `bun run build`, `bun run lint:agents`, and the release dry-run before ending the wave.

**Targeted commands**
- `bun test tests/scripts/pi-oven-release/manifest-sync.test.ts tests/scripts/pi-oven-release/git-ops.test.ts tests/scripts/pi-oven-release/release-publisher.test.ts`
- `bun run check`
- `bun run build`
- `bun run lint:agents`
- `bun run release:pi-oven -- --bump patch --dry-run`
- `grep -n "source repo\|release artifact\|installed cache" docs/runtime-contracts/pi-oven-meta-control-plane.md README.md commands/release.md`
- `grep -n "fanoutLatencyMs: [0-9][0-9]*\|sequentialComparableLatencyMs: [0-9][0-9]*\|startupImprovementRatio: [0-9][0-9.]*" docs/baselines/2026-07-04-pi-oven-meta-improvement.md`

**Expected outcomes**
- The targeted `bun test` command exits `0`.
- `bun run check`, `bun run build`, and `bun run lint:agents` all exit `0`.
- `bun run release:pi-oven -- --bump patch --dry-run` exits `0`.
- The runtime contract doc, baseline doc, and release helper output all express the same source/release/install boundary, and the baseline doc records the Task 6 latency KPI evidence as concrete numeric values.

## Execution order and ownership

1. **Task 0** runs first in every lane.
2. **Task 1** runs before all other implementation tasks because it freezes the live state migration contract.
3. **Task 2** starts only after Task 1 passes.
4. **Task 3** starts only after Task 2 passes and stays under one owner because it shares `pi-oven.ts`, `skill-keyword-loader.ts`, `rules-injector.ts`, and gate surfaces.
5. **Task 4** starts only after Task 3 passes. It may read scheduler/persistence files but must not modify scheduler files yet.
6. **Task 5** starts only after Task 4 passes because continuation persistence depends on policy/state contracts.
7. **Task 6** starts only after Task 4 and Task 5 both pass.
8. **Task 7** starts only after Task 6 passes.
9. **Task 8** runs last and only after evidence exists from Tasks 1 through 7.

### No-concurrent-write rules

- Shared-file writes are prohibited across lanes.
- Task 2 and Task 3 are deliberately serialized under one owner.
- Task 4 may read but not modify scheduler files.
- Task 6 owns scheduler + persistence-order changes.
- Task 8 may read all prior evidence but must not reopen design decisions.

## Verification matrix

| Task | Verification focus | Required command set | Expected result |
| --- | --- | --- | --- |
| Task 0 | cwd / branch contract / core file surface | `test ...`, `git branch --show-current`, `git status --short --branch` | exits `0`; current branch matches `.pi-oven/state/branch-contract.json` |
| Task 1 | state migration + capability registry + gate compatibility | widened runtime-state suite from Task 1 | exits `0` |
| Task 2 | ask metadata + deep-interview runtime/state/render + wiring | widened ask/loader/rules/wiring + deep-interview suite | exits `0` |
| Task 3 | capability-proof cutover + setup/status/doctor truth-surface rewrite | widened runtime/setup/plugin suite + legacy-removal scan + carve-out parity scan | all exit `0` |
| Task 4 | lane policy + persistence contract freeze | `lane-policy.test.ts` + `task-file-ops.test.ts` + scheduler diff guard | exits `0`; no scheduler diffs |
| Task 5 | continuation persistence location + continuation/completion split | widened continuation/state/wiring suite | exits `0` |
| Task 6 | scheduler fan-out + persistence order + rollback + KPI evidence | widened team-runtime suite + latency-evidence grep | all exit `0` |
| Task 7 | trace/runtime verifier-depth + hard-cap/material-edit revalidation | widened runtime/team/plugin suite | exits `0` |
| Task 8 | release/helper/doc boundary alignment + full harness revalidation | widened release suite + `bun run check` + `bun run build` + `bun run lint:agents` + release dry-run + baseline/KPI greps | all exit `0` |

## Commit points

- **Commit 1 after Task 1** — `refactor: introduce capability registry and state migration contract`
- **Commit 2 after Task 3** — `refactor: hard-cut control plane to explicit capability proofs`
- **Commit 3 after Task 6** — `feat: add lane policy and policy-gated scheduler fan-out`
- **Commit 4 after Task 7** — `feat: add trace primitives and verifier depth policy`
- **Commit 5 after Task 8** — `docs: lock release sync and baseline evidence for meta control plane`

## Residual execution risks

- **State-model collision risk**: `autonomous.json`/`push-consent.json`/`branch-contract.json` compatibility can break live gates if Task 1 skips migration-first testing.
- **Truth-surface drift risk**: Task 3 touches runtime, setup, status, doctor, README, and command surfaces simultaneously; docs can drift from code.
- **Scheduler under-scope risk**: Task 6 fails if it edits only `runtime-v2.ts`/`scaling.ts` and ignores `team-config.ts`/`task-file-ops.ts`/`rollback.ts`.
- **Deep-interview half-port risk**: Task 2 fails if ask UX improves without runtime/state/merge/approval parity.
- **Verification underfit risk**: narrow new tests can pass while regressions ship; existing suites are mandatory.
- **Release/doc mismatch risk**: Task 8 fails if helper output and docs diverge.
- **Stale-range execution risk**: if executors do not reopen the cited doc/code ranges before coding, the plan is being executed incorrectly.

## Self-review checklist

- [x] Task 0 validates the session branch contract instead of treating the branch name as a spec-derived invariant.
- [x] Task 1 starts with live-state inventory and migration compatibility before abstraction.
- [x] Task 2 preserves DP-01 Option C as a 4-part native bundle.
- [x] Task 3 preserves DP-02 Option B by naming temporary adapter boundaries explicitly.
- [x] Task 4 → Task 5 → Task 6 preserves DP-03 Option B in order.
- [x] Task 5 and Task 7 preserve DP-04 Option C with continuation/completion split, hard-cap, and revalidation.
- [x] Every task contains explicit supporting-doc reread hooks and live-code reread hooks.
- [x] Every task widens verification beyond only newly created tests.
- [x] No placeholder wording remains.

## Execution handoff

**Option 1 — subagent-driven-development (recommended)**
- Dispatch Task 0 as a preflight verifier.
- Dispatch Task 1 as its own lane.
- Dispatch Task 2 and Task 3 as one serialized control-plane lane.
- Dispatch Task 4, then Task 5, then Task 6 in the locked order.
- Dispatch Task 7 after Task 6.
- Dispatch Task 8 last after prior evidence exists.
- Each lane must reopen the task’s required supporting-doc and live-code ranges before editing.

**Option 2 — inline sequential execution**
- Run Task 0 through Task 8 in order in a single lane.
- Preserve the same ownership boundaries and reread protocol.
- Do not overlap shared-file edits.
