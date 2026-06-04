# 2026-06-04 — 글로벌 설치 및 에이전트 도구 정책 구현 계획

이 계획은 `docs/plans/2026-06-04-global-install-and-agent-tool-policy-design.md` 스펙에 따라 pi-oven의 설치 모델을 글로벌 전용으로 전환하고, 에이전트 도구 정책을 중앙 집중식으로 관리하도록 구현합니다.

## 목표
- pi-oven 설치 여부를 로컬 프로젝트 마커(`.pi-oven/config.json`)가 아닌 글로벌 캐시 상태로 판단.
- 작가(authoring) 역할군에 대해 풍부한 도구 권한(`tools: ["*"]`)을 부여하고, 읽기 전용 역할군은 기존 제약을 유지.
- 도구 정책의 소스 오브 트루스(SoT)를 TypeScript 파일로 일원화하고 린트/리와이터를 통해 동기화.

## 주요 작업 및 파일

### 1단계: 글로벌 설치 감지 고도화
- **`scripts/pi-oven-setup/cache-resolver.ts`**
  - `checkGlobalInstallStatus()` 함수 추가: `resolveCacheAgentsDir`를 사용하여 실제 설치 여부 및 경로 반환.
- **`scripts/pi-oven-doctor.ts`**
  - `gather()` 함수가 로컬 `./agents` 대신 `checkGlobalInstallStatus()`를 우선 참조하도록 수정.
  - 설치 실패 시 "글로벌 캐시에 pi-oven이 없음"을 명확히 리포트.
- **`.omp/extensions/pi-oven.ts`**
  - `setupComplete` 변수명을 `globalInstallFound` 등으로 변경(또는 의미 전환).
  - 로컬 `.pi-oven/config.json` 부재 시에도 글로벌 설치가 확인되면 설치 안내(`notify`)를 생략.

### 2단계: 도구 정책 중앙 집중화
- **`scripts/pi-oven-setup/profiles.ts`**
  - `AgentToolPolicy` 타입 및 `TOOL_POLICIES` 객체 추가.
  - 역할별 `tools`, `blocked_tools` 정의 (디자인 문서의 Authoring/ReadOnly 분류 적용).
- **`scripts/pi-oven-setup/agent-rewriter.ts`**
  - `applyToolPolicy()` 함수 추가: `profiles.ts`의 정책을 마크다운 프론트매터에 주입.
  - `rewriteAgentFile`이 모델/생각 수준뿐만 아니라 도구 정책도 갱신하도록 확장.
- **`scripts/lint-agents.ts`**
  - 개별 파일의 도구 설정을 검증하는 대신, `profiles.ts`의 정책과 일치하는지 강제 검증하도록 수정.

### 3단계: 로컬 설정 영향력 축소
- **`scripts/pi-oven-setup/project-config.ts`**
  - `isSetupComplete`를 설치 여부가 아닌 "프로젝트별 언어 설정 존재 여부" 수준으로 의미 축소.
  - `markSetupComplete`가 생성하는 `setupCompletedAt`을 레거시 필드로 취급.
- **`.omp/extensions/pi-oven.ts`**
  - 로컬 설정 파일이 없어도 런타임이 정상 동작하도록 fail-soft 로직 강화.

## 작업 순서

| 순서 | 작업 내용 | 대상 파일 |
| :--- | :--- | :--- |
| 1 | 글로벌 설치 감지 헬퍼 구현 | `scripts/pi-oven-setup/cache-resolver.ts` |
| 2 | Doctor 설치 체크 로직 전환 | `scripts/pi-oven-doctor.ts` |
| 3 | 런타임 확장 설치 알림 로직 수정 | `.omp/extensions/pi-oven.ts` |
| 4 | 중앙 도구 정책 테이블 정의 | `scripts/pi-oven-setup/profiles.ts` |
| 5 | 에이전트 리와이터 도구 정책 지원 | `scripts/pi-oven-setup/agent-rewriter.ts` |
| 6 | 에이전트 파일 일괄 갱신 실행 | `agents/*.md` |
| 7 | 린트 스크립트 정책 동기화 검증 추가 | `scripts/lint-agents.ts` |
| 8 | 레거시 로컬 설정 참조 코드 정리 | `scripts/pi-oven-setup/project-config.ts` |

## 검증 계획

### 1. 설치 감지 검증
- [ ] **글로벌 설치 + 로컬 설정 없음**: `pi-oven:doctor`가 설치 PASS를 반환하는지 확인.
- [ ] **글로벌 설치 없음**: `pi-oven:doctor`가 설치 FAIL 및 "Global cache missing" 메시지를 표시하는지 확인.
- [ ] **런타임 확장**: `.pi-oven/config.json`이 없는 신규 프로젝트에서 "Not installed" 알림이 뜨지 않는지 확인.

### 2. 도구 정책 검증
- [ ] **린트 패스**: `bun run lint:agents`를 실행하여 모든 에이전트 파일이 `profiles.ts` 정책과 일치하는지 확인.
- [ ] **권한 확인**: `executor`, `writer` 등 Authoring 역할의 프론트매터에 `tools: ["*"]`가 주입되었는지 확인.
- [ ] **제약 확인**: `explorer`, `critic` 등 ReadOnly 역할의 `tools`가 여전히 제한적인지 확인.

### 3. 회귀 테스트
- [ ] **언어 설정**: `.pi-oven/config.json`에 명시된 언어 설정이 여전히 시스템 프롬프트에 정상 주입되는지 확인.
- [ ] **기존 프로젝트**: 기존에 설치된 프로젝트에서 doctor 실행 시 영향이 없는지 확인.
