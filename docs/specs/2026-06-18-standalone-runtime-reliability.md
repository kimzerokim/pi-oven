# 사양 — Standalone Runtime Reliability

> 상태: frozen / implementation-ready
> 날짜: 2026-06-18
> 사전결정 워크시트: `docs/pre-decisions/2026-06-18-standalone-runtime-reliability-v1.html`
> 최종 결정 기록: `docs/decisions/2026-06-18-standalone-runtime-reliability.html`
> 사이클 메타데이터: `docs/meta/2026-06-18-standalone-runtime-reliability-cycle.md`
> 구현 계획: `docs/plans/2026-06-18-standalone-runtime-reliability-plan.md`

## 1. 목적

이 spec의 목적은 `pi-oven@kzk`의 standalone runtime reliability 계약을 **결정 완료 상태로 동결**하고, 그 결정 경계 위에서 구현 계획이 유효하게 작성될 수 있도록 기준을 확정하는 것이다.

이 문서는 더 이상 decision-pending 문서가 아니다. 2026-06-18 사전결정 워크시트에서 수집된 사용자 승인 결과를 반영했고, 이 승인 집합만이 이후 구현과 검증의 기준이다.

## 2. 이번 사이클의 결과

이번 토픽은 아래 순서를 완료했다.

1. survey
2. repo-tracked pre-decision HTML worksheet
3. user decision capture
4. spec freeze

이제 5단계인 implementation plan 작성이 권한을 가진다. 이 spec와 결정 기록 HTML이 현재 authoritative input이며, 그 전에 나온 설명이나 가정성 plan은 현재 지침이 아니다.

## 3. 범위

이번 사이클은 sibling plugin(`superpowers`, `oh-my-claudecode`, `agentmemory`, `matt-pocock`) 유무와 무관하게, pi-oven이 standalone marketplace plugin으로서 자기 계약만으로 예측 가능하게 동작하는지를 다룬다.

고정 대상 계약은 다음과 같다.

- pi-oven skill이 installed plugin 자산에서 예측 가능하게 로드된다.
- pi-oven subagent가 `pi-oven:<role>` identity로 예측 가능하게 dispatch된다.
- runtime, setup, status, doctor가 같은 root-boundary 모델을 공유한다.
- project scope는 project scope로 남고, global remediation은 숨기지 않고 표면화된다.
- 문서와 truth surface가 현재 실제 CLI/runtime 동작과 일치한다.
- 완료 선언은 repo-root happy path가 아니라 installed-topology 증거에 기대도록 만든다.

## 4. 근거 기반

이 spec는 다음 조사 아티팩트를 근거로 삼는다.

- `agent://ProjectSurvey`
- `agent://SkillLoadingSurvey`
- `agent://ProfileRoutingSurvey`
- `agent://StandaloneRiskSurvey`
- `agent://GajaeSourceSurvey`
- `agent://GajaeContextSurvey`

이 조사들이 공통으로 뒷받침한 핵심 사실은 다음과 같다.

1. pi-oven은 22개 skill, 24개 agent, namespaced runtime guidance, profile writer를 이미 shipping한다.
2. runtime keyword skill loading과 doctor 일부 경로는 아직 `process.cwd()` 기반 plugin 자산 탐색에 기대어 standalone install topology에서 경계가 흐릴 수 있다.
3. namespaced guidance는 강하지만, gate/dispatch/state credit가 같은 엄격도로 닫혀 있지는 않다.
4. project/global routing writer는 비교적 명시적이지만, installed-topology end-to-end proof가 현재 가장 약하다.
5. setup/doctor/README 일부는 현재 실제 CLI/runtime truth와 완전히 일치하지 않는다.
6. 외부 비교 근거상, 작은 공개 surface와 증거 기반 완료 기준이 standalone 신뢰성 메시지에 유리하다.

## 5. 승인된 결정 집합

아래 여섯 결정은 이미 승인되었고, 이 spec에 동결되었다.

| ID | 승인안 | 동결된 결정 |
|---|---|---|
| D1 | A | `pluginRoot` / `projectRoot` / `home` 경계를 명시적으로 분리한다. |
| D2 | A | keyword-index / plugin-integrity 문제는 visible warning으로 올리고, doctor/status가 같은 신호를 보여준다. |
| D3 | A | pi-oven gate와 pi-oven-dispatched identity에서는 namespaced form만 정식 경로로 취급한다. |
| D4 | A | project scope는 순수하게 유지하고, setup/status/doctor는 필요한 global remediation만 명시한다. |
| D5 | A | 문서 드리프트는 docs-tightening으로 해결한다. 현재 없는 CLI/runtime surface를 이번 사이클에서 새로 약속하지 않는다. |
| D6 | A | 최소 완료 증거는 installed-topology 테스트와 doctor/status evidence다. |

최종 사람용 결정 기록은 아래 아티팩트에 남긴다.

- `docs/decisions/2026-06-18-standalone-runtime-reliability.html`

## 6. 동결된 구현 계약

### 6.1 Root boundary contract

- plugin-owned 자산(`.claude-plugin/plugin.json`, shipped `skills/`, shipped `agents/`, runtime extension 기준 자산)은 `pluginRoot`에서 읽는다.
- project-owned 상태(`.pi-oven/`, project `CLAUDE.md`, project `.omp/settings.json`)는 `projectRoot`에서 읽는다.
- machine-global 설정(`~/.omp/agent/config.yml`, home-config 계층)은 `home` 기준으로 읽는다.
- plugin-owned 경로를 `process.cwd()`나 project root가 조용히 대체해서는 안 된다.
- runtime, doctor, 관련 truth surface는 같은 root 모델을 설명해야 한다.

### 6.2 Failure visibility contract

- keyword-index load failure, plugin-integrity failure, 또는 동등한 standalone contract 위반은 debug-only에 머물 수 없다.
- 세션을 즉시 hard-fail하지는 않지만, 사용자에게 visible warning을 보여야 한다.
- `/pi-oven:setup --status`와 `/pi-oven:doctor`는 같은 문제를 같은 의미로 surface해야 한다.
- status/doctor는 “무엇이 부족한지”와 “어떤 remediation이 필요한지”를 사실대로 설명해야 한다.

### 6.3 Identity strictness contract

- pi-oven이 요구하는 skill identity는 `skill://pi-oven:<name>`이다.
- pi-oven이 요구하는 dispatched agent identity는 `pi-oven:<role>`이다.
- pi-oven gate, required-skill credit, pi-oven-dispatched validation은 bare form을 pi-oven 성공 경로로 인정하지 않는다.
- 이번 결정은 pi-oven 범위에 한정된다. 플랫폼 전체 bare form 금지까지 확장하지 않는다.

### 6.4 Project-scope remediation contract

- project-scope setup은 project-scoped routing만 쓴다.
- 필요한 global tool flag나 machine-global prerequisite가 비어 있으면, setup/status/doctor는 후속 global remediation을 명시한다.
- project scope 작업이 숨은 global write로 승격되면 안 된다.
- project scope 사용자가 “왜 아직 부족한지”를 tool surface에서 바로 알 수 있어야 한다.

### 6.5 Documentation truthfulness contract

- `README.md`, `commands/setup.md`, `commands/doctor.md`, 관련 truth surface는 현재 실제 CLI/runtime behavior만 설명한다.
- 현재 구현에 없는 조합, validate path, recovery path, hidden side effect는 문서에서 제거하거나 correction note로 정리한다.
- 이번 cycle의 기본 방향은 CLI expansion이 아니라 docs-tightening이다.
- 따라서 문서가 제품을 끌고 가지 않는다. 제품이 실제로 하는 일만 문서화한다.

### 6.6 Minimum completion proof contract

- standalone runtime reliability 완료 선언의 최소 기준은 installed-topology proof다.
- proof는 최소한 다음을 포함한다.
  - separated pluginRoot/projectRoot topology에서의 skill loading evidence
  - same topology에서의 pi-oven dispatch / routing truthfulness evidence
  - doctor output evidence
  - status output evidence
- repo-root 단위 테스트만으로는 완료를 주장할 수 없다.
- sibling-plugin matrix나 release-wide 강화 기준은 미래 확장 주제가 될 수 있지만, 이번 cycle의 최소 기준은 아니다.

## 7. 구현 범위와 비범위

### 7.1 이번 구현 범위

- runtime/doctor/status/setup가 위 동결 계약과 충돌하는 부분을 수정한다.
- namespaced identity enforcement와 visible warning truth surface를 맞춘다.
- 문서 드리프트를 현재 실제 CLI/runtime behavior에 맞게 정리한다.
- installed-topology proof를 위한 테스트와 evidence collection 경로를 만든다.

### 7.2 이번 구현 비범위

- 플랫폼 전체 bare skill / bare agent 금지
- 새 product surface를 여는 CLI expansion
- sibling-plugin 전체 matrix를 이번 cycle의 최소 완료 기준으로 승격
- release 전반의 추가 운영 요구사항을 standalone minimum proof에 묶는 일

## 8. 구현 및 검증에 대한 지시

이 spec를 구현하는 plan은 아래 원칙을 따라야 한다.

1. root-boundary 수정과 installed-topology proof를 먼저 다룬다.
2. failure visibility와 pi-oven identity strictness를 runtime/gate/status/doctor에 일관되게 반영한다.
3. project-scope remediation은 안내를 강화하되 hidden global write를 추가하지 않는다.
4. docs-tightening은 실제 CLI/runtime truth를 기준으로 하고, 문서를 맞추기 위해 새 CLI surface를 발명하지 않는다.
5. 완료 판정은 installed-topology 테스트와 doctor/status evidence가 준비되기 전에는 내리지 않는다.

## 9. 권한 있는 다음 아티팩트

이 spec freeze 이후의 권한 있는 다음 아티팩트는 아래 둘이다.

1. 최종 결정 기록: `docs/decisions/2026-06-18-standalone-runtime-reliability.html`
2. 구현 계획: `docs/plans/2026-06-18-standalone-runtime-reliability-plan.md`

이 두 문서는 이미 승인된 여섯 결정만을 해설하거나 실행 순서로 바꾸어야 한다. 열린 결정을 다시 도입해서는 안 된다.

## 10. 상태 결론

Standalone runtime reliability v1의 decision capture는 완료되었다. 이 spec는 frozen 상태이며 implementation-ready다. 이후 작업은 이 문서를 다시 decision worksheet처럼 다루지 않고, 오직 구현과 증거 수집의 기준으로만 사용한다.
