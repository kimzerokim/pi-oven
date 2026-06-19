# 사이클 메타데이터 — Standalone Runtime Reliability

> 날짜: 2026-06-18
> 토픽 슬러그: `standalone-runtime-reliability`
> 워크시트: `docs/pre-decisions/2026-06-18-standalone-runtime-reliability-v1.html`
> 결정 기록: `docs/decisions/2026-06-18-standalone-runtime-reliability.html`
> frozen spec: `docs/specs/2026-06-18-standalone-runtime-reliability.md`
> 구현 계획: `docs/plans/2026-06-18-standalone-runtime-reliability-plan.md`
> 워크시트 단계: complete
> planning authorization: granted

## 1. 이번 사이클 결과

이번 사이클은 decision-heavy repo 작업을 다음 순서로 끝냈다.

`survey -> pre-decision html -> user decision -> spec freeze -> plan`

현재 상태는 다음과 같다.

- survey: 완료
- pre-decision HTML worksheet: 완료
- user decision capture: 완료
- spec freeze: 완료
- planning authorization: 부여됨

즉, 이 메타데이터는 더 이상 “왜 워크시트부터 시작하나”를 설명하는 pending 문서가 아니라, **워크시트 단계가 실제로 닫혔고 planning이 열렸음을 기록하는 문서**다.

## 2. 닫힌 결정 경계

이번 사이클에서 승인된 결정은 정확히 여섯 개다.

| ID | 승인안 | 요약 |
|---|---|---|
| D1 | A | `pluginRoot` / `projectRoot` / `home` 경계 분리 |
| D2 | A | visible warning + doctor/status 동일 신호 |
| D3 | A | pi-oven gate/dispatch에서는 namespaced form만 정식 경로 |
| D4 | A | project scope는 순수 유지, remediation은 setup/status/doctor가 설명 |
| D5 | A | docs-tightening으로 truth surface 정리, CLI expansion은 이번 범위 밖 |
| D6 | A | installed-topology 테스트 + doctor/status evidence를 최소 완료 기준으로 채택 |

이 승인 집합은 아래 두 산출물에 승격되었다.

- frozen spec: `docs/specs/2026-06-18-standalone-runtime-reliability.md`
- decision artifact: `docs/decisions/2026-06-18-standalone-runtime-reliability.html`

## 3. 아티팩트 체인

이번 사이클의 권한 있는 아티팩트 체인은 아래와 같다.

1. 조사 근거
   - `agent://ProjectSurvey`
   - `agent://SkillLoadingSurvey`
   - `agent://ProfileRoutingSurvey`
   - `agent://StandaloneRiskSurvey`
   - `agent://GajaeSourceSurvey`
   - `agent://GajaeContextSurvey`
2. 사용자 결정 수집 입력물
   - `docs/pre-decisions/2026-06-18-standalone-runtime-reliability-v1.html`
3. 최종 결정 기록
   - `docs/decisions/2026-06-18-standalone-runtime-reliability.html`
4. frozen spec
   - `docs/specs/2026-06-18-standalone-runtime-reliability.md`
5. 첫 유효 구현 계획
   - `docs/plans/2026-06-18-standalone-runtime-reliability-plan.md`

중요한 점은, 2번 워크시트는 이제 authority가 아니라 **historical input**이라는 것이다. 현재 authority는 3~5번이다.

## 4. planning authorization 기록

planning은 이제 허용된다. 단, 다음 제약을 유지한다.

- plan은 승인된 여섯 결정만 구현 순서로 풀어야 한다.
- plan은 docs-tightening 선택을 따라 문서/truth-surface 정리를 CLI 확장보다 우선해야 한다.
- plan은 installed-topology proof work를 별도 마지막 장식이 아니라 completion gate로 포함해야 한다.
- plan은 project-scope purity를 깨는 hidden global write를 제안하면 안 된다.

## 5. future cycle에 남기는 재사용 규칙

이번 사이클이 future decision-heavy 주제에 남기는 규칙은 그대로 유지한다.

1. Survey
2. Pre-decision HTML worksheet
3. User decision capture
4. Spec freeze
5. Plan
6. Implementation

그리고 각 단계의 의미는 아래와 같다.

- worksheet는 review input이다.
- spec는 승인된 결정만 동결한다.
- decision artifact는 사람이 읽는 최종 결정 기록이다.
- plan은 동결된 spec 위에서만 유효하다.

## 6. obsolete 상태 정리

이 토픽에서 spec freeze 이전에 쓰인 설명, 가정, 또는 premature planning 문장은 현재 authority가 아니다. 이후 구현자는 워크시트를 다시 decision capture 장치로는 읽되, 현재 지침은 frozen spec / decision artifact / implementation plan 삼종으로만 따라야 한다.

## 7. 한 줄 요약

Standalone runtime reliability 사이클은 이제 **worksheet complete, spec frozen, planning authorized** 상태다.
