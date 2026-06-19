# 2026-06-18 — Standalone Runtime Reliability 구현 계획

이 계획은 `docs/specs/2026-06-18-standalone-runtime-reliability.md`의 frozen 계약과 `docs/decisions/2026-06-18-standalone-runtime-reliability.html`의 승인된 결정 집합(D1–D6)을 구현 순서로 풀어낸 첫 유효 plan이다.

## 목표

standalone marketplace install 기준에서 pi-oven의 runtime / setup / status / doctor / 문서 truth surface를 같은 계약으로 정렬하고, installed-topology 증거가 있어야만 완료를 주장할 수 있게 만든다.

## 고정 입력

- D1 · `pluginRoot` / `projectRoot` / `home` 경계 명시적 분리
- D2 · visible warning + doctor/status 동일 신호
- D3 · pi-oven gate/dispatch identity는 namespaced form만 정식 경로
- D4 · project scope 순수 유지, remediation은 setup/status/doctor가 설명
- D5 · docs-tightening 우선, CLI expansion 비우선
- D6 · installed-topology 테스트 + doctor/status evidence가 최소 완료 기준

## 이번 계획의 비범위

- 플랫폼 전체 bare skill / bare agent 금지
- 새 CLI 기능 추가로 문서 드리프트를 해소하는 작업
- sibling-plugin 전체 매트릭스를 이번 minimum completion proof로 승격하는 작업
- release-wide 추가 운영 게이트 확장

## Phase 1 — Root boundary를 코드 계약으로 고정

### 목적

plugin-owned 자산과 project-owned 자산을 코드 레벨에서 분리해, standalone install topology에서 `process.cwd()`가 plugin root를 가장하지 못하게 만든다.

### 대상 파일

- 수정: `.omp/extensions/pi-oven.ts`
- 수정: `.omp/extensions/pi-oven-runtime/skill-keyword-loader.ts`
- 수정: `scripts/pi-oven-doctor.ts`
- 검토 후 필요 시 수정: `scripts/pi-oven-setup/cache-resolver.ts`
- 테스트: `tests/extensions/pi-oven-runtime/skill-keyword-loader.test.ts`
- 테스트: `tests/extensions/pi-oven-runtime/wiring.test.ts`
- 테스트: `tests/plugin/pi-oven-doctor.test.ts`

### 작업

1. runtime extension에서 plugin-owned 자산을 읽는 경로와 project-owned 상태를 읽는 경로를 분리한다.
2. skill keyword index loader가 `pluginRoot`를 입력으로 받도록 이름과 호출부를 정리한다.
3. doctor가 shipped skills / agents / plugin manifest probe는 plugin root에서, project-local 상태 probe는 project root에서 읽도록 분리한다.
4. root 경계가 섞인 fallback을 제거하거나 명시적 failure signal로 바꾼다.

### 검증 기대치

- installed plugin root가 project cwd 밖에 있어도 keyword skill index 경로가 유지된다.
- doctor는 cwd에 `skills/`나 `.claude-plugin/`이 없어도 plugin install 자체를 잘못 FAIL로 판정하지 않는다.
- project root 기반 state probe와 plugin root 기반 asset probe가 같은 함수 안에서 암묵적으로 섞이지 않는다.

### 검증 명령(예시, 미검증)

- `bun test tests/extensions/pi-oven-runtime/skill-keyword-loader.test.ts`
- `bun test tests/extensions/pi-oven-runtime/wiring.test.ts`
- `bun test tests/plugin/pi-oven-doctor.test.ts`

## Phase 2 — visible warning과 pi-oven identity strictness를 같은 truth surface로 맞춤

### 목적

standalone contract 위반이 debug-only로 사라지지 않게 하고, pi-oven gate/dispatch에서 bare form이 성공 경로로 남지 않게 닫는다.

### 대상 파일

- 수정: `.omp/extensions/pi-oven.ts`
- 수정: `.omp/extensions/pi-oven-runtime/gate-handler.ts`
- 수정: `.omp/extensions/pi-oven-runtime/gate.ts`
- 수정: `scripts/pi-oven-setup/status.ts`
- 수정: `scripts/pi-oven-doctor.ts`
- 테스트: `tests/extensions/pi-oven-runtime/gate-handler.test.ts`
- 테스트: `tests/extensions/pi-oven-runtime/gate.test.ts`
- 테스트: `tests/extensions/pi-oven-runtime/wiring.test.ts`
- 테스트: `tests/scripts/pi-oven-setup/status.test.ts`
- 테스트: `tests/plugin/pi-oven-doctor.test.ts`

### 작업

1. keyword-index / plugin-integrity failure가 발생하면 runtime이 visible warning에 필요한 상태를 남기도록 정리한다.
2. `status`와 `doctor`가 같은 실패를 같은 의미로 보고하도록 wording과 판정 기준을 맞춘다.
3. pi-oven required-skill credit는 `skill://pi-oven:<name>` 성공 경로에만 부여되도록 정리한다.
4. pi-oven-dispatched identity는 `pi-oven:<role>`에만 부여되도록 gate validation을 조인다.
5. 플랫폼 전체 금지로 확장하지 말고, pi-oven lane에서만 contract를 닫는다.

### 검증 기대치

- standalone contract failure가 debug log에만 남지 않는다.
- `doctor`와 `status`가 같은 문제를 서로 다른 뜻으로 표현하지 않는다.
- bare skill read 시도나 bare role dispatch 시도가 pi-oven success credit로 기록되지 않는다.

### 검증 명령(예시, 미검증)

- `bun test tests/extensions/pi-oven-runtime/gate-handler.test.ts`
- `bun test tests/extensions/pi-oven-runtime/gate.test.ts`
- `bun test tests/scripts/pi-oven-setup/status.test.ts`
- `bun test tests/plugin/pi-oven-doctor.test.ts`

## Phase 3 — project-scope remediation과 docs-tightening 정렬

### 목적

project scope는 순수하게 유지하면서도, 사용자가 빠진 global prerequisite를 setup/status/doctor와 문서에서 즉시 이해할 수 있게 만든다.

### 대상 파일

- 수정: `scripts/pi-oven-setup/apply.ts`
- 수정: `scripts/pi-oven-setup/validate.ts`
- 수정: `scripts/pi-oven-setup/status.ts`
- 수정: `scripts/pi-oven-doctor.ts`
- 수정: `commands/setup.md`
- 수정: `commands/doctor.md`
- 수정: `README.md`
- 테스트: `tests/scripts/pi-oven-setup/apply.test.ts`
- 테스트: `tests/scripts/pi-oven-setup/validate.test.ts`
- 테스트: `tests/scripts/pi-oven-setup/status.test.ts`
- 테스트: `tests/plugin/pi-oven-doctor.test.ts`

### 작업

1. project-scope setup이 자동 global write를 하지 않는 현재 계약을 유지한다.
2. project-scope-only 사용자가 부족한 global tool flag 또는 prerequisite를 봤을 때, 다음에 해야 할 global remediation을 status/doctor/setup 결과에서 바로 알 수 있게 만든다.
3. `commands/setup.md`, `commands/doctor.md`, `README.md`에서 현재 CLI가 실제로 지원하지 않는 조합, validate 경로, 설치/복구 설명을 제거하거나 현재 truth에 맞게 고친다.
4. 문서를 맞추기 위해 새 CLI 동작을 약속하지 않는다.

### 검증 기대치

- project scope 사용자는 “왜 아직 부족한지”와 “다음 global step이 무엇인지”를 truth surface에서 바로 읽을 수 있다.
- 문서 예시는 현재 실제 CLI/runtime behavior와 모순되지 않는다.
- docs-tightening 범위를 넘어 CLI expansion으로 번지지 않는다.

### 검증 명령(예시, 미검증)

- `bun test tests/scripts/pi-oven-setup/apply.test.ts`
- `bun test tests/scripts/pi-oven-setup/validate.test.ts`
- `bun test tests/scripts/pi-oven-setup/status.test.ts`
- `bun test tests/plugin/pi-oven-doctor.test.ts`

## Phase 4 — installed-topology proof를 completion gate로 승격

### 목적

repo-root happy path가 아니라, 분리된 pluginRoot/projectRoot topology에서 standalone reliability를 입증하는 최소 완료 증거를 만든다.

### 대상 파일

- 수정: `tests/extensions/pi-oven-runtime/skill-keyword-loader.test.ts`
- 수정: `tests/extensions/pi-oven-runtime/wiring.test.ts`
- 수정: `tests/extensions/pi-oven-runtime/gate-handler.test.ts`
- 수정: `tests/plugin/pi-oven-doctor.test.ts`
- 수정: `tests/scripts/pi-oven-setup/status.test.ts`
- 필요 시 추가 fixture: `tests/extensions/pi-oven-runtime/*` 또는 `tests/plugin/*` 내부의 installed-topology fixture 경로

### 작업

1. plugin root와 project root가 분리된 fixture topology를 만든다.
2. 그 topology에서 keyword skill loading, pi-oven dispatch identity, status truthfulness, doctor truthfulness를 각각 검증한다.
3. doctor/status evidence를 completion proof의 필수 출력물로 정의한다.
4. repo-root unit test만 통과한 상태를 완료로 부르지 못하도록 acceptance 문장을 테스트와 plan에 반영한다.

### 검증 기대치

- installed-topology fixture가 실제 minimum completion proof의 기준이 된다.
- doctor/status evidence 없이는 standalone reliability 완료를 선언할 수 없다.
- proof 범위는 D6 최소 기준에 맞고, sibling-plugin matrix나 release-wide gate를 이번 cycle 필수 조건으로 확대하지 않는다.

### 검증 명령(예시, 미검증)

- `bun test tests/extensions/pi-oven-runtime/skill-keyword-loader.test.ts`
- `bun test tests/extensions/pi-oven-runtime/wiring.test.ts`
- `bun test tests/extensions/pi-oven-runtime/gate-handler.test.ts`
- `bun test tests/plugin/pi-oven-doctor.test.ts`
- `bun test tests/scripts/pi-oven-setup/status.test.ts`

## 완료 기준

아래 네 조건이 모두 충족되어야 이 주제를 완료라고 부를 수 있다.

1. root-boundary contract가 runtime / doctor / status에서 같은 모델로 구현된다.
2. visible warning, doctor, status가 standalone contract 위반을 같은 의미로 surface한다.
3. pi-oven gate/dispatch identity는 namespaced form 기준으로 닫힌다.
4. installed-topology 테스트와 doctor/status evidence가 준비된다.

## 구현 순서 요약

1. Root boundary 분리
2. visible warning + namespaced identity strictness 정렬
3. project-scope remediation + docs-tightening 정리
4. installed-topology proof를 completion gate로 고정
