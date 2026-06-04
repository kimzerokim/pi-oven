# Open Problems Survey Report (2026-06-04)

## 1. Setup config.yml writer
`scripts/pi-oven-setup/config-yml.ts`는 `omp config get/set` 명령어를 통해 `~/.omp/agent/config.yml`을 관리합니다. `task.agentModelOverrides`는 `Record<string, string>` 구조로 개별 모델 매핑을 저장하며, `setAgentModelOverride` 함수가 이를 원자적으로 업데이트합니다 (config-yml.ts:145-190).

`modelRoles`는 `setModelRoles` 함수를 통해 `default`와 `title` 키를 포함한 레코드로 관리됩니다 (config-yml.ts:300-319). PROFILE_A에서 사용하는 정식 모델 ID는 `default: "gpt-5.4:high"`, `title: "gpt-5.4-mini:low"`입니다 (profiles.ts:254-257).

**추천 수정 지점**: `retry.fallbackChains` 쓰기 경로를 `config-yml.ts`에 추가하고, `apply.ts`의 `runApply` (apply.ts:63-80) 단계에서 `modelRoles`와 함께 기록하는 것이 가장 깔끔합니다. `retry.fallbackChains`는 `Record<string, string[]>` 구조로 모델 역할별 대체 모델 목록을 저장해야 합니다.

## 2. syncPiOvenAgentMirrors
`.omp/extensions/pi-oven.ts`에 정의된 `syncPiOvenAgentMirrors`는 현재 런타임에서 호출되지 않습니다 (pi-oven.ts:596-598). 런타임 지연을 방지하기 위해 `session_start` 등에서 제거되었습니다.

현재 이 함수를 사용하는 곳은 `tests/extensions/pi-oven.test.ts` (pi-oven.test.ts:208-275) 뿐이며, CLI 스크립트나 다른 확장 프로그램에서의 사용은 발견되지 않았습니다.

**추천 수정 지점**: 런타임에서 호출되지 않는 사멸 코드이므로 `pi-oven.ts`에서 함수를 제거하고, `tests/extensions/pi-oven.test.ts`의 관련 테스트도 함께 정리해야 합니다.

## 3. session-model JSON consumers
`~/.omp/plugins/pi-oven-session-model.json`은 `.omp/extensions/pi-oven.ts`의 `captureSessionModel` 함수에 의해 `{ model, capturedAt }` 형태로 생성됩니다 (pi-oven.ts:265-281).

현재 모든 문서(`setup.md`, `skill-flow.ko.html`, `2026-05-28-pi-oven-setup-wizard.md`)는 이 필드 구성을 전제로 설명하고 있으며 (setup.md:105, 2026-05-28-pi-oven-setup-wizard.md:647), `modelId`나 `timestamp`와 같은 구버전 키를 읽는 코드는 더 이상 존재하지 않습니다. 모든 소비자가 `model`과 `capturedAt`을 읽는 것으로 확인되었습니다.

**추천 수정 지점**: 현재 구조가 모든 소비자 및 테스트와 일치하므로 데이터 모양 변경은 필요 없으나, 스크립트에서 이를 읽는 공통 유틸리티를 `scripts/pi-oven-setup/config-yml.ts` 등에 명시적으로 추가하여 형식을 고정하는 것이 좋습니다.

## 4. blocked_tools enforcement
`blocked_tools`는 omp 엔진 수준에서 강제되는 필드가 아니며, `node_modules/@oh-my-pi/pi-coding-agent`의 타입 정의에서도 발견되지 않았습니다. 현재는 `agents/*.md` 파일의 프론트매터에만 선언되어 있습니다.

`docs/specs/2026-05-28-pi-oven-agent-registry.md` 981라인에 명시된 바와 같이, `before_agent_start` 이벤트 페이로드에는 `agentName`이나 `model` 필드가 없어 런타임에서 특정 에이전트의 툴을 동적으로 제한할 수 없습니다. 따라서 실질적인 제한은 에이전트 파일의 `tools:` 프론트매터 필드(allowlist)에 의존합니다 (registry-registry.md:983).

**추천 수정 지점**: `tools:` allowlist가 유일한 실제 경계이므로, 에이전트 정의 시 `tools:` 필드를 필요한 최소 툴로 엄격히 제한하고, `blocked_tools`는 `lint-agents.ts` 수준에서 `tools:`와의 일관성을 검증하는 용도로 유지해야 합니다.

## 5. AI-slop / dead comments
`.omp/extensions/pi-oven.ts`에 의식의 흐름(SOC) 스타일 주석이 일부 남아 있습니다.
- 274-279라인: `mkdirSync` 및 테스트 기대값에 대한 메모성 주석.
- 596-598라인: `syncPiOvenAgentMirrors` 제거 사유에 대한 설명 주석.
`[MOD]` 마커는 더 이상 발견되지 않았습니다.

**추천 수정 지점**: `syncPiOvenAgentMirrors` 제거 시 관련 주석을 함께 삭제하고, 274라인의 메모성 주석을 표준 JSDoc 또는 간결한 구현 설명으로 정제해야 합니다.

## 6. lint-agents tool policy check
`scripts/lint-agents.ts`는 에이전트 파일의 `tools` 및 `blocked_tools`를 `profiles.ts`의 `PROFILE_A` 데이터와 직접 비교하여 검증합니다 (lint-agents.ts:157-169).

또한 에이전트 본문에서 언급된 툴들이 실제로 `tools` 필드에 포함되어 있는지도 확인합니다 (lint-agents.ts:98-114). 이를 확장하여 `tools:` allowlist와 `blocked_tools` list에 중복이 있거나 논리적 충돌(예: tools에 포함되었는데 blocked에도 포함됨)이 있는 경우 에러를 발생시키도록 보강할 수 있습니다.

**추천 수정 지점**: `lint-agents.ts`에 `tools`와 `blocked_tools` 사이의 교집합이 없는지 확인하는 로직을 추가하여 정책 일관성을 강제해야 합니다.
