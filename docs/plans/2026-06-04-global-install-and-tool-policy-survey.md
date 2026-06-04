# pi-oven 글로벌 설치 및 도구 정책 조사 보고서 (2026-06-04)

## 1. 개요
`docs/plans/2026-06-04-global-install-and-agent-tool-policy-design.md` 스펙 구현을 위한 코드베이스 조사 결과입니다. 현재 pi-oven은 프로젝트 로컬 설정(`.pi-oven/config.json`)과 글로벌 캐시 설정을 혼용하고 있으며, 에이전트 도구 정책이 마크다운 파일과 린트 스크립트에 분산되어 있습니다.

## 2. 조사 결과

### 2.1 설치 감지 및 설정 (Install Detection & Config)
*   **프로젝트 로컬 감지**:
    *   `.omp/extensions/pi-oven.ts`: `<repoRoot>/.pi-oven/config.json`의 `setupCompletedAt`을 읽어 `setupComplete` 상태를 결정합니다.
    *   `session_start` 훅에서 `!setupComplete`인 경우 사용자에게 설치 안내(`notify`)를 노출합니다.
    *   `CLAUDE.md` 주입 여부(`projectInstructionsEnabled`)도 이 파일의 `projectInstructions` 키로 제어합니다.
*   **글로벌 캐시 감지**:
    *   `scripts/pi-oven-setup/cache-resolver.ts`: `~/.omp/plugins/cache/plugins/kzk___pi-oven___*` 경로에서 에이전트 파일을 검색합니다.
    *   `/pi-oven:setup --status` 명령은 이미 이 글로벌 캐시를 우선적으로 참조합니다.
*   **의존성**:
    *   `scripts/pi-oven-setup/project-config.ts`: `markSetupComplete`, `isSetupComplete`, `clearSetupComplete` 함수가 로컬 `.pi-oven/config.json`을 물리적 소스 오브 트루스(SoT)로 사용합니다.

### 2.2 도구 정책 및 린트 (Tool Policy & Lint)
*   **에이전트별 정책**:
    *   `agents/pi-oven-*.md`: 프론트매터의 `tools:` 및 `blocked_tools:` 배열이 개별 에이전트의 도구 권한을 정의합니다.
    *   `scripts/lint-agents.ts`: 에이전트 본문(`body`)에서 언급된 도구가 프론트매터 권한 내에 있는지 검증합니다. `KNOWN_TOOLS` 화이트리스트가 하드코딩되어 있습니다.
*   **중앙 집중화 부재**:
    *   도구 정책이 24개 에이전트 파일에 파편화되어 있으며, 린트 스크립트와 정책 테이블(디자인 문서상의 테이블) 간의 자동 동기화 기제가 없습니다.
*   **런타임 게이트**:
    *   `.omp/extensions/pi-oven-runtime/gate.ts` & `gate-handler.ts`: `git commit`, `git push`, 그리고 `write`/`edit` 등 코드 수정 도구에 대한 하드 게이트를 수행합니다. 단, 이는 에이전트별 `tools:` 권한과는 독립적인 FSM 기반 보안 계층입니다.

## 3. 구현 범위 (Fix Surface)

### 3.1 글로벌 전용 설치 감지 (Global-only Install Detection)
*   **`.omp/extensions/pi-oven.ts`**:
    *   `setupComplete` 결정 로직을 로컬 파일 존재 여부에서 글로벌 캐시/설정(`.omp/agent/config.yml` 등) 확인으로 변경합니다.
    *   프로젝트 로컬 `.pi-oven/config.json`이 없어도 설치 경고가 뜨지 않도록 수정합니다.
*   **`scripts/pi-oven-doctor.ts`**:
    *   `countAgents`, `countSkillMd` 등 로컬 디렉토리 기반 체크를 `cache-resolver.ts`의 `resolveCacheAgentsDir`를 사용하는 글로벌 감지 로직으로 전환합니다.

### 3.2 로컬 설정 참조 제거 (Removing Local Config Input)
*   **`scripts/pi-oven-setup/project-config.ts`**:
    *   `markSetupComplete` 등이 로컬 파일을 생성하지 않고 글로벌 설정 파일에 기록하도록 변경하거나, 프로젝트별 언어 설정 전용으로 축소합니다.
*   **언어 설정(Language)**: 언어 설정은 프로젝트별 특성일 수 있으므로 로컬 `.pi-oven/config.json`에 남겨두되, 설치 완료 여부(`setupCompletedAt`)는 글로벌로 이동합니다.

### 3.3 도구 정책 중앙 집중화 (Centralized Tool Policy)
*   **신규 소스 오브 트루스**: `scripts/pi-oven-setup/profiles.ts` 또는 신규 `policy.ts`에 24개 역할별 도구 정책 테이블을 정의합니다.
*   **에이전트 갱신**: `scripts/pi-oven-setup/agent-rewriter.ts`를 확장하여, 정의된 정책 테이블에 따라 `agents/pi-oven-*.md`의 프론트매터를 자동 갱신하도록 합니다.
*   **린트 통합**: `scripts/lint-agents.ts`가 개별 파일이 아닌 중앙 정책 테이블을 기준으로 검증하도록 수정합니다.

## 4. 구현 리스크
*   **호환성**: 기존 로컬 설정을 가진 프로젝트에서 글로벌 설정으로의 마이그레이션 누락 시 중복 경고 발생 가능성이 있습니다.
*   **도구 명칭 불일치**: Claude Code 도구명과 omp 네이티브 도구명이 혼용되는 구간(린트 등)에서 정책 위반 오탐지가 발생할 수 있습니다.
*   **MCP 도구 예외**: `context7` 등 MCP 기반 도구는 현재 `agents` allowlist 밖에서 관리되므로 정책 중앙화 시 포함 여부를 명확히 해야 합니다.

## 5. 다음 단계
- [ ] `GlobalInstallState`를 위한 글로벌 설정 저장소 확정 (예: `~/.omp/agent/config.yml`의 `pi-oven` 네임스페이스)
- [ ] 중앙 도구 정책 테이블(TS) 설계 및 `agent-rewriter.ts` 연동 작업 준비
