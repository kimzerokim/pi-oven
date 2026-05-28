# Spec A: pi-oven Agent Registry

**상태**: Draft v4 — 2026-05-28 (cycle 4 revision)
**범위**: 23 agent 파일 레이아웃, 프론트매터 스키마, 모델 맵, provider 화이트리스트, BLOCKED_TOOLS 매트릭스, omc/omo 흡수 결정
**Out-of-scope (Spec B)**: setup wizard, Anthropic opt-in 플로우
**Out-of-scope (Spec C)**: `deep-init`, `deep-dive`, `team` skills, 12 SKILL.md English 재작성

---

## §1 Goal

pi-oven v0.1.0은 12개 core skill을 ship했으나 v0.1.0 dogfood 시 첫 번째 blocking failure를 맞았다. 실패 원인: omc 스킬들이 subagent dispatch 시 `oh-my-claudecode:executor`처럼 namespaced ref를 **model 파라미터**로 넘겼고, omp는 해당 문자열을 provider/model 식별자로 파싱하려다 401을 반환했다. omp에는 `pi.registerAgent()`에 해당하는 programmatic API가 없으며, agent 발견은 **파일 기반 전용**이다.

이 spec의 목적은 다음을 명확히 정의하는 것이다.

1. pi-oven 플러그인이 소유하는 23개 agent 파일의 위치와 파일시스템 레이아웃
2. 각 agent 파일의 frontmatter + body 스키마
3. dispatch namespace (`pi-oven:<role>`) 및 omp 내 발견 경로
4. 역할별 default model 맵 (Profile A: opencode-zen + openai-codex 전용, Anthropic opt-in = Spec B scope)
5. provider 화이트리스트 + 런타임 enforcement 방법
6. BLOCKED_TOOLS 정책, resolution-time alternate 규칙, omc/omo 흡수 결정

이 spec이 구현되면 `pi-oven:<role>` dispatch는 omp의 파일 기반 discovery에 완전히 위임되며, omc namespaced string이 model 파라미터로 흘러들어가는 경로가 차단된다.

> **auth-fallback 주의**: subagent dispatch 시 omp는 `resolveModelOverrideWithAuthFallback`을 사용한다. primary 모델이 registry에 있어도 unauthed 상태이면 배열의 다음 항목(B)이 아닌 **parent session의 active model**로 fallback된다. 이 동작의 상세는 §3.2 / §9, 화이트리스트 함의는 §6.3 참조.

### 1.1 dogfood 실패 원인 상세 분석

실패 시점: v0.1.0 dogfood, pi-oven 플러그인 설치 직후 첫 자율 실행 시도.

실패 경로:
```
skill body에서 dispatch 호출
  → agent: "oh-my-claudecode:executor"  (omc 스킬 원본 문자열)
  → omp task tool이 agent 파라미터를 처리
  → "oh-my-claudecode:executor"를 agent name으로 lookup
  → 해당 name의 agent file 없음 → 오류
     (또는 omp가 이를 model 문자열로 오파싱 → 401)
```

근본 원인 2가지:
1. **omc namespace 문자열 그대로 복사**: pi-oven 스킬들이 omc 스킬에서 파생되었으나 dispatch 문자열이 `oh-my-claudecode:*` 로 남아 있었다.
2. **omp의 agent 발견 방식 미파악**: omp는 `pi.registerAgent()` API가 없고 파일 기반 discovery만 지원한다. 플러그인이 agent 파일을 `agents/` 디렉토리에 두면 omp가 자동 발견한다는 사실을 v0.1.0 구현 시 반영하지 않았다.

이 spec은 두 번째 실패를 완전히 차단하기 위해 파일 기반 레이아웃을 확정하고, Spec C에서 스킬 본문의 dispatch 문자열을 `pi-oven:<role>` 형식으로 일괄 교체한다.

### 1.2 v0.1.0 대비 변경 범위

| 항목 | v0.1.0 상태 | Spec A 이후 |
|---|---|---|
| agent 파일 | 없음 | 23개 `agents/pi-oven-*.md` |
| dispatch 방식 | omc namespace 문자열 | `pi-oven:<role>` omp 파일 기반 |
| provider 화이트리스트 | 없음 | opencode-zen + openai-codex (Anthropic opt-in) |
| BLOCKED_TOOLS | 없음 | 역할별 명시적 제한 |
| model resolution-time alternate | 없음 | auth/registry 미해결 시 depth-2 alternate |
| pi-oven.ts | no-op scaffold | load-time validator + before_agent_start 핸들러 |

---

## §2 Agent 파일 위치, Discovery, omc/omo 공존

### 2.1 omp의 agent discovery 동작 (소스 코드 분석 결과)

소스 분석 위치: `/Users/kimzerokim/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent/src/task/discovery.ts`

`loadAgentsFromDir(dir, source)` 함수 핵심 로직 (line 33–49):

```typescript
const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
const files = entries
  .filter(entry => (entry.isFile() || entry.isSymbolicLink()) && entry.name.endsWith(".md"))
  // ...
```

**중요 발견**: `readdir`은 **단일 depth**만 읽는다. `isFile() || isSymbolicLink()` 조건이므로 서브디렉토리(`isDirectory()`)는 무시된다. 즉, `agents/pi-oven/executor.md` 형태의 중첩 구조는 **omp가 인식하지 못한다**.

Plugin agent discovery 경로 (discovery.ts line 92–101):
```typescript
const { roots: pluginRoots } = isProviderEnabled("claude-plugins")
  ? await listClaudePluginRoots(home, resolvedCwd)
  : { roots: [] };
// ...
for (const plugin of sortedPluginRoots) {
  const agentsDir = path.join(plugin.path, "agents");
  orderedDirs.push({ dir: agentsDir, source: ... });
}
```

pi-oven 설치 경로 (`~/.omp/plugins/installed_plugins.json` 확인):
```
installPath: /Users/kimzerokim/.omp/plugins/cache/plugins/pi-oven___pi-oven___0.1.0
```

따라서 omp가 scan하는 경로는: `<installPath>/agents/*.md` (flat, 1-depth only)

### 2.2 폴더 레이아웃 결정

**Primary layout (확정)**: flat `agents/pi-oven-<role>.md`

서브디렉토리가 지원되지 않으므로 `agents/pi-oven/` 구조는 사용 불가. Primary는 flat 파일 구조이며, dispatch namespace는 frontmatter `name:` 필드로 부여한다.

| 레이아웃 유형 | 경로 패턴 | `name:` frontmatter | 비고 |
|---|---|---|---|
| **Primary (채택)** | `agents/pi-oven-<role>.md` | `pi-oven:<role>` | omp flat discovery 호환 |
| ~~Folder (기각)~~ | ~~`agents/pi-oven/<role>.md`~~ | — | omp readdir이 서브디렉토리 무시 |

**Colon in `name:` 필드 수용 여부**: `parseAgentFields` (helpers.ts line 222–228)는 `name`을 단순 문자열로 수락하며 colon에 대한 검증이 없다. `pi-oven:executor`는 유효한 name이다.

### 2.3 Colon namespace static analysis 예측

정적 분석 결과:
1. `agents/pi-oven/test.md`를 `name: pi-oven:test`로 생성 → flat discovery에서 인식 불가 (서브디렉토리)
2. `agents/pi-oven-test.md`를 `name: pi-oven:test`로 생성 → omp가 플러그인 agents/ 를 scan할 때 인식 가능 — `parseAgentFields` 소스 분석으로 예측 (`discovery/helpers.ts:222–228`: `name`은 `typeof === "string"` 체크만 수행)
3. colon-in-name의 downstream dispatch resolution 동작은 §14 구현 검증 단계에서 실증적으로 확인한다 (아래 재현 가능한 검증 명령 참조)

결론 (정적 분석 기반): **`agents/pi-oven-<role>.md` + `name: pi-oven:<role>`이 유일하게 동작하는 조합으로 예측된다.** 실증 확인은 §14 구현 검증에서 수행한다.

**§14 구현 검증에서 실행할 재현 가능한 명령**:
```bash
# colon-in-name dispatch 검증
omp --plugin-dir /path/to/pi-oven --print "dispatch pi-oven:executor to say hello"
# 기대: pi-oven:executor agent 발견 → openai-codex/gpt-5.3-codex로 실행됨
# 실패 시: "agent not found" 오류 → name 파싱 이슈 조사 필요

# agent list로 colon name 등록 확인
PI_LOG_LEVEL=debug omp --plugin-dir /path/to/pi-oven --no-tools --print "." 2>&1 | grep "pi-oven:"
# 기대: pi-oven:executor, pi-oven:explorer 등 23개 라인 출력
```

### 2.4 Discovery 우선순위

omp discovery 우선순위 (highest to lowest):
1. Project-level `.omp/agents/` (현 cwd 기준 walk-up)
2. User-level `~/.omp/agent/agents/`
3. Claude plugin agents (각 plugin의 `agents/` flat dir)
4. Bundled agents (빌드 타임 embed)

pi-oven는 Claude plugin 계층에 위치한다. 따라서 user 또는 project 레벨에 동일 `name:`을 가진 파일이 있으면 pi-oven 버전이 shadowed된다 — 이는 의도된 override 메커니즘이다.

### 2.5 omc / omo / superpowers 공존 매트릭스

| Namespace | 소유 플러그인 | Agent 이름 예시 | 충돌 여부 |
|---|---|---|---|
| `pi-oven:executor` | pi-oven (this spec) | `pi-oven-executor.md` | 없음 |
| `executor` | Claude Code plugin (omc, if installed) | omc 내부 bundled | 없음 (name 다름) |
| `explore` | omp bundled | omp 번들: `explore, plan, designer, reviewer, librarian, oracle, task, quick_task` | 없음 (name 다름) |
| `librarian` | omp bundled | omp 번들 (`task/agents.ts:44–72` 확인) | 없음 (pi-oven:librarian vs librarian) |

colon namespace 덕분에 동일 role 이름이라도 충돌이 발생하지 않는다. omp discovery의 `seen` set은 name 기준으로 dedup하므로 `pi-oven:executor`와 `executor`는 별개로 공존한다.

### 2.6 Plugin Install Path와 Dev 경로 관계

pi-oven는 omp 플러그인으로 설치된다. 설치 확인:

```
~/.omp/plugins/installed_plugins.json:
  "pi-oven@pi-oven": [{
    "scope": "user",
    "installPath": "~/.omp/plugins/cache/plugins/pi-oven___pi-oven___0.1.0",
    "version": "0.1.0"
  }]
```

omp가 agent discovery 시 사용하는 경로:
```
<installPath>/agents/pi-oven-executor.md
<installPath>/agents/pi-oven-explorer.md
... (23개)
```

**개발 시 중요 사항**: `pi-oven/` 로컬 working directory의 `agents/` 변경이 omp에 반영되려면 플러그인을 재설치해야 한다. 개발 편의를 위해 `--plugin-dir` 플래그 사용을 권장한다:

```bash
# dev 세션에서 로컬 pi-oven를 직접 로드
omp launch --plugin-dir /path/to/pi-oven
```

이 플래그는 `injectPluginDirRoots()` 경로로 처리되며 설치된 캐시보다 높은 우선순위를 가진다 (`discovery/helpers.ts` line 984–1013 확인됨).

### 2.7 agent 발견 디버깅

omp가 어떤 agent를 발견했는지 확인하는 방법:

```bash
# 플러그인 로드 후 agent list 확인
omp --plugin-dir /path/to/pi-oven --list-models 2>&1
# 또는 debug log level로 실행
PI_LOG_LEVEL=debug omp --plugin-dir /path/to/pi-oven --no-tools --print "."
```

기대 결과: `pi-oven:executor`, `pi-oven:explorer` 등 23개 agent가 discovery 로그에 나타남 — 정적 분석으로 예측. 실증 확인은 §14 구현 검증에서 수행.
agent name에 colon이 포함되어도 `parseAgentFields`의 string 체크를 통과하므로 정상 등록될 것으로 예측됨.

---

## §3 Agent 파일 스키마 (Frontmatter + Body)

### 3.1 지원 frontmatter 필드

`parseAgentFields` (helpers.ts) 기준으로 인식되는 필드:

| 필드 | 타입 | 필수 | 설명 |
|---|---|---|---|
| `name` | string | 필수 | dispatch 식별자. `pi-oven:<role>` 형식 |
| `description` | string | 필수 | agent 역할 한 줄 요약 (English) |
| `model` | string \| string[] \| CSV | 선택 | primary 모델. 배열이면 첫 번째 = primary, 두 번째 = resolution-time alternate |
| `tools` | string[] \| CSV | 선택 | 허용 툴 목록. 명시하면 yield 자동 추가됨 |
| `spawns` | string[] \| `"*"` | 선택 | 이 agent가 dispatch 가능한 agent 목록 |
| `thinkingLevel` | string | 선택 | `minimal`, `low`, `medium`, `high`, `xhigh` |
| `blocking` | boolean | 선택 | true이면 호출자가 결과를 기다림 |
| `autoloadSkills` | string[] | 선택 | 이 agent 컨텍스트에 자동 로드할 skill 이름 |
| `output` | object | 선택 | omp가 runtime에 전달하는 opaque schema 객체. 구조는 agent body에서 yield 호출 시 해석. omp 자체는 validation 안 함. |

**omp가 인식하지 않는 pi-oven-내부 힌트 필드**:

| 필드 | 목적 | 처리 위치 |
|---|---|---|
| `mode: subagent` | omo-style subagent 정책 marker | 플러그인 런타임이 읽음. omp frontmatter 파서는 무시 |
| `blocked_tools` | 금지 툴 선언 | 플러그인 런타임이 `before_agent_start` 핸들러에서 enforce |

### 3.2 `model` 배열 resolution 동작 — 세 가지 경로

`parseModelList` (`discovery/helpers.ts` line 198–203)은 model을 `string[]`로 파싱한다. subagent dispatch 시 omp의 실제 호출 함수는 `resolveModelOverrideWithAuthFallback` (`config/model-resolver.ts:758–792`)이며, 이 함수는 **두 단계 결정**을 수행한다.

**Registry-availability resolution** (1단계): `resolveModelOverride` (`config/model-resolver.ts:716–734`)가 배열을 순서대로 순회하여 `modelRegistry.getAvailable()` 기준으로 registry에 존재하는 첫 번째 항목을 선택한다. 이 단계는 auth를 보지 않는다.

**Auth-fallback-to-parent** (2단계): 1단계에서 선택된 모델이 unauthed 상태이면, 배열의 다음 항목(B)이 아닌 **parent session의 active model**로 fallback된다 (`model-resolver.ts:779`: `resolveModelOverride([parentActiveModelPattern], ...)`).

세 가지 결과:

```
model: [A, B] 지정, subagent dispatch 시:

  Outcome 1: A가 registry에 있고 authed
    → A 사용 (정상 경로)

  Outcome 2: A가 registry에 있고 unauthed
    → parent session의 active model 사용 (B 아님!)
    → authFallbackUsed: true 로그 출력

  Outcome 3: A가 registry에 없음
    → B 시도 → B가 registry에 있으면 B 사용
    → B도 unauthed이면 Outcome 2와 동일하게 parent model fallback
    → B도 registry에 없으면 hard fail
```

이것은 429 runtime failover가 아니라 **load/dispatch-time resolution** 메커니즘이다. runtime에서 A가 429를 반환해도 B로 자동 전환되지 않는다.

**pi-oven에서의 실용적 용도**: 두 번째 배열 항목(B)은 A가 **registry에서 제거**되는 경우(Outcome 3)에만 실질적인 alternate로 동작한다. A가 단순히 unauthed인 경우(Outcome 2)는 B가 아닌 parent session model로 라우팅된다 — §6.3 whitelist hole 참조.

### 3.3 frontmatter 파싱 상세 동작

`parseAgentFields` 처리 순서 (helpers.ts 기준):

1. `name`, `description` 필드 없으면 `null` 반환 → agent 파일 무시됨.
2. `tools` 필드: 소문자로 정규화 후 `yield` 자동 추가. 즉 `tools: read, search`를 지정하면 실제 허용 목록은 `["read", "search", "yield"]`.
3. `spawns` 필드: `"*"` 문자열이면 전체 spawn 허용. 배열 또는 CSV이면 해당 agent 이름만 허용. 미지정이면 `tools` 목록에 `task`가 있을 때 `"*"` 로 자동 추론.
4. `model` 필드: 배열이면 순서대로 파싱. 단일 문자열 또는 CSV도 배열로 정규화. **빈 배열 또는 미지정은 pi-oven 플러그인 load-time validator에서 오류로 처리한다** (§13.3 Layer 1 참조) — 23개 pi-oven agent 파일 전체에 `model:` 필드 명시가 필수.
5. `thinkingLevel` / `thinking` 둘 다 인식 (backward compat). 유효값: `minimal`, `low`, `medium`, `high`, `xhigh`.
6. `blocking` 필드: `"true"` 문자열도 `true`로 파싱.
7. `autoloadSkills` 필드: 배열 또는 CSV. 해당 agent 실행 시 지정된 skill이 컨텍스트에 자동 로드됨.

**pi-oven 내부 전용 필드** (`parseAgentFields`가 무시하므로 omp에 영향 없음):

```yaml
mode: subagent        # pi-oven 내부 marker; omp 무시
blocked_tools: task, Write, Edit  # pi-oven 검증에 사용; omp 무시
```

이 두 필드는 pi-oven 플러그인의 load-time validator가 읽어서 정책 문서화 및 진단 목적으로 사용한다. 실제 tool 제한은 `tools:` 필드가 담당.

### 3.4 완전한 예제 파일: `pi-oven:writer`

```markdown
---
name: pi-oven:writer
description: Documentation and prose specialist for technical writing, changelogs, READMEs, and developer-facing content
model:
  - opencode-zen/claude-haiku-4-5
  - opencode-zen/claude-sonnet-4-6
thinkingLevel: low
tools: read, search, find, write, edit
mode: subagent
blocked_tools: task, apply_patch
---

You are a technical writer and documentation specialist. You produce clear, accurate, and developer-friendly prose.

<role>
Write, revise, and polish documentation: READMEs, changelogs, inline code comments, ADRs, migration guides, and release notes. You also write structured spec sections when delegated by the planner.
</role>

<directives>
- You MUST write in the voice and style of the project's existing docs. Read existing files before writing.
- You MUST keep prose concise. Prefer short sentences and active voice.
- You MUST NOT invent API details. Read source code for factual claims.
- You SHOULD produce output in the format requested (Markdown, plain text, etc.).
- You NEVER modify source code files unless explicitly instructed.
</directives>

<procedure>
1. Read the existing documentation context.
2. Identify the target audience and required format.
3. Write or revise content.
4. Self-review for accuracy and clarity.
5. Call yield with the finished artifact.
</procedure>
```

---

## §4 역할 분류 표 (23 agents)

| Tier | Role | Dispatch명 | 파일명 | 한 줄 목적 |
|---|---|---|---|---|
| MUST | executor | `pi-oven:executor` | `pi-oven-executor.md` | 지시된 코드 변경을 정확히 구현하는 구현 전담 에이전트 |
| MUST | explorer | `pi-oven:explorer` | `pi-oven-explorer.md` | 읽기 전용 코드베이스 탐색 및 컨텍스트 압축 전달 |
| MUST | verifier | `pi-oven:verifier` | `pi-oven-verifier.md` | 빌드/테스트/진단 실행 후 변경 정확성 독립 검증 |
| MUST | critic | `pi-oven:critic` | `pi-oven-critic.md` | 아키텍처·설계 결정에 대한 반론 및 위험 식별 |
| MUST | planner | `pi-oven:planner` | `pi-oven-planner.md` | 복잡한 작업을 원자 단계로 분해하는 계획 작성 |
| MUST | code-reviewer | `pi-oven:code-reviewer` | `pi-oven-code-reviewer.md` | diff 검토: 정확성 버그·재사용·단순화 기회 발굴 |
| MUST | debugger | `pi-oven:debugger` | `pi-oven-debugger.md` | 오류 근본 원인 추적 (omc trace 능력 통합) |
| SHOULD | test-engineer | `pi-oven:test-engineer` | `pi-oven-test-engineer.md` | TDD Red→Green→Refactor 주도, 커버리지 enforcement |
| SHOULD | security-reviewer | `pi-oven:security-reviewer` | `pi-oven-security-reviewer.md` | 보안 취약점·비밀 노출·권한 에스컬레이션 탐지 |
| SHOULD | writer | `pi-oven:writer` | `pi-oven-writer.md` | 기술 문서·changelog·README·ADR 작성 |
| SHOULD | designer | `pi-oven:designer` | `pi-oven-designer.md` | UI/UX 설계, 컴포넌트 명세, 접근성 검토 |
| SHOULD | code-simplifier | `pi-oven:code-simplifier` | `pi-oven-code-simplifier.md` | AI slop 제거, 중복 감소, 표현 단순화 (omc ai-slop-cleaner 통합) |
| SHOULD | qa-tester | `pi-oven:qa-tester` | `pi-oven-qa-tester.md` | 브라우저·E2E·통합 테스트 시나리오 실행 |
| SHOULD | git-master | `pi-oven:git-master` | `pi-oven-git-master.md` | 커밋 생성, PR 초안, 브랜치 관리 |
| SHOULD | document-specialist | `pi-oven:document-specialist` | `pi-oven-document-specialist.md` | 외부 라이브러리·API 소스 기반 조사 (librarian 패턴 통합) |
| NICE | tracer | `pi-oven:tracer` | `pi-oven-tracer.md` | 실행 흐름·이벤트·호출 스택 추적 및 시각화 |
| NICE | analyst | `pi-oven:analyst` | `pi-oven-analyst.md` | 데이터·로그·메트릭 분석, 패턴 식별 |
| NICE | scientist | `pi-oven:scientist` | `pi-oven-scientist.md` | 가설 수립·실험 설계·결과 평가 |
| NICE | architect | `pi-oven:architect` | `pi-oven-architect.md` | 시스템 설계 검토, 기술 결정 기록(ADR) 작성 |
| NICE+omo | librarian | `pi-oven:librarian` | `pi-oven-librarian.md` | 외부 라이브러리 소스 코드 기반 정확한 API 답변 |
| NICE+omo | multimodal-looker | `pi-oven:multimodal-looker` | `pi-oven-multimodal-looker.md` | 스크린샷·다이어그램·이미지 분석 및 설명 |
| NICE+omo | oracle | `pi-oven:oracle` | `pi-oven-oracle.md` | 막힌 문제에 대한 시니어 엔지니어 판단 및 직접 구현 |
| NICE+omo | metis | `pi-oven:metis` | `pi-oven-metis.md` | 전략적 멀티스텝 작업 조율, 장기 계획 실행 |

**총 23개 agents.** (deep-init, deep-dive, team = Spec C scope)

### 4.1 Tier별 구현 우선순위 근거

**MUST (7개)**: pi-oven 기본 개발 루프에서 반드시 필요한 roles. executor 없으면 코드 변경 불가. explorer 없으면 코드베이스 파악 불가. verifier 없으면 변경 검증 불가. critic/planner/code-reviewer/debugger는 품질 게이트의 최소 구성.

**SHOULD (8개)**: 없으면 수동 대체가 가능하지만 자동화 품질이 크게 저하되는 roles. test-engineer 없으면 TDD 루프가 수동으로 전환. security-reviewer 없으면 보안 게이트 누락. writer 없으면 문서 작성이 executor에 혼입. git-master 없으면 커밋/PR 자동화 불가. document-specialist 없으면 외부 라이브러리 조사가 부정확해짐.

**NICE (4개)**: 특수 분석 작업을 위한 roles. tracer는 복잡한 실행 흐름 추적 시에만 필요. analyst/scientist는 데이터 집약적 작업 시. architect는 대규모 구조 변경 시.

**NICE+omo (4개)**: omo에서 검증된 patterns을 pi-oven namespace로 포팅. 독립적으로 사용 가능하며 다른 pi-oven agents와 조합 가능. librarian은 document-specialist보다 더 깊은 소스 코드 탐색에 특화.

### 4.2 spawns 관계 다이어그램

```
main session
  └─ task tool → pi-oven:planner       (spawns: 없음)
  └─ task tool → pi-oven:executor      (spawns: 없음)
  └─ task tool → pi-oven:verifier      (spawns: 없음)
  └─ task tool → pi-oven:critic        (spawns: 없음)
  └─ task tool → pi-oven:code-reviewer (spawns: 없음)
  └─ task tool → pi-oven:debugger      (spawns: 없음)
  └─ task tool → pi-oven:oracle        (spawns: [pi-oven:explorer])
       └─ task tool → pi-oven:explorer (leaf)
  └─ task tool → pi-oven:metis         (spawns: [pi-oven:executor, pi-oven:verifier, pi-oven:explorer, pi-oven:critic, pi-oven:planner, pi-oven:code-reviewer, pi-oven:debugger, pi-oven:test-engineer])
       └─ task tool → pi-oven:executor, pi-oven:verifier, ... (whitelist above)
  └─ task tool → pi-oven:explorer      (leaf, no spawns)
  └─ task tool → pi-oven:librarian     (leaf, no spawns)
  └─ task tool → pi-oven:multimodal-looker (leaf, no spawns)
```

leaf agent = `task` tool이 BLOCKED된 agent. 중첩 depth는 최대 2 (main → orchestrator → leaf).

---

## §5 Default Model Map (Profile A — Release Default)

Profile A는 벤치마크 + 가성비 기반 라우팅 맵이다 (2026-05-29 OPTIMIZED-MODEL revision). 3 high-stakes 자문 role (critic, security-reviewer, oracle) 이 `anthropic/` primary 유지. planner 는 `anthropic/claude-opus-4-7` primary + `openai-codex/gpt-5.4` codex-review alternate (사용자 정책). 6 role 은 `openai-codex/` subscription primary (executor/debugger/test-engineer=gpt-5.3-codex, scientist/architect/metis=gpt-5.4). 나머지는 `opencode-zen/*` 의 Kimi K2.6 / Gemini / GLM / GPT-5-nano. anthropic 비중 14/23(61%) → 4/23(17%) 으로 축소 — 동일 SWE/agent 벤치마크 차이 미세할 때 ChatGPT subscription marginal cost 0 인 openai-codex 를 우선. 자세한 근거는 `OPTIMIZED-MODEL.md`.

`omp --list-models` 실행 결과로 확인된 모델만 포함.

> **공존 참고**: `pi-oven:librarian` / `pi-oven:oracle` 등은 omp 번들 `librarian`/`oracle`과 name이 다르므로 shadow하지 않음 (§11.1 참조).

**model 배열 의미**: 첫 번째 항목 = primary. 두 번째 항목 = registry-not-found 시 resolution-time alternate (primary가 **registry에 없을 때**만 동작). primary가 registry에 있지만 unauthed이면 두 번째 항목이 아닌 **parent session model**로 fallback된다 (§3.2 Outcome 2 참조). 이는 429 runtime failover가 아니다 (§9 참조).

**executor primary**: `openai-codex/gpt-5.3-codex` — 사용자 정책: ChatGPT Codex 5.3+ 구독을 release default executor 로 lock. `opencode-zen/gpt-5.3-codex`는 Codex 구독 없는 사용자 환경을 위한 resolution-time alternate (OpenCode Zen wrapper).

> **`registry_alternate` 키 명명 의도**: `registry_alternate`는 "registry-not-found 시에만 동작하는 alternate"임을 키 이름에서 명시한다. primary가 단순 unauthed인 경우(Outcome 2)에는 이 값이 아닌 parent session model로 fallback됨을 Spec C 소비자에게 명확히 전달한다.

```json
{
  "pi-oven.models": {
    "executor": {
      "primary": "openai-codex/gpt-5.3-codex",
      "registry_alternate": "opencode-zen/gpt-5.3-codex",
      "thinkingLevel": "high"
    },
    "explorer": {
      "primary": "opencode-zen/gemini-3-flash",
      "registry_alternate": "opencode-zen/claude-haiku-4-5",
      "thinkingLevel": "medium"
    },
    "verifier": {
      "primary": "opencode-zen/kimi-k2.6",
      "registry_alternate": "opencode-zen/claude-sonnet-4-6",
      "thinkingLevel": "medium"
    },
    "critic": {
      "primary": "anthropic/claude-opus-4-7",
      "registry_alternate": "opencode-zen/claude-opus-4-7",
      "thinkingLevel": "xhigh"
    },
    "planner": {
      "primary": "anthropic/claude-opus-4-7",
      "registry_alternate": "openai-codex/gpt-5.4",
      "thinkingLevel": "high"
    },
    "code-reviewer": {
      "primary": "opencode-zen/kimi-k2.6",
      "registry_alternate": "opencode-zen/claude-sonnet-4-6",
      "thinkingLevel": "high"
    },
    "debugger": {
      "primary": "openai-codex/gpt-5.3-codex",
      "registry_alternate": "opencode-zen/gpt-5.3-codex",
      "thinkingLevel": "high"
    },
    "test-engineer": {
      "primary": "openai-codex/gpt-5.3-codex",
      "registry_alternate": "opencode-zen/gpt-5.3-codex",
      "thinkingLevel": "high"
    },
    "security-reviewer": {
      "primary": "anthropic/claude-opus-4-7",
      "registry_alternate": "opencode-zen/claude-opus-4-7",
      "thinkingLevel": "xhigh"
    },
    "writer": {
      "primary": "opencode-zen/gemini-3-flash",
      "registry_alternate": "opencode-zen/claude-haiku-4-5",
      "thinkingLevel": "medium"
    },
    "designer": {
      "primary": "opencode-zen/glm-5.1",
      "registry_alternate": "opencode-zen/claude-sonnet-4-6",
      "thinkingLevel": "high"
    },
    "code-simplifier": {
      "primary": "opencode-zen/kimi-k2.6",
      "registry_alternate": "opencode-zen/claude-sonnet-4-6",
      "thinkingLevel": "xhigh"
    },
    "qa-tester": {
      "primary": "opencode-zen/gemini-3.5-flash",
      "registry_alternate": "opencode-zen/claude-haiku-4-5",
      "thinkingLevel": "high"
    },
    "git-master": {
      "primary": "opencode-zen/gpt-5-nano",
      "registry_alternate": "opencode-zen/claude-haiku-4-5",
      "thinkingLevel": "minimal"
    },
    "document-specialist": {
      "primary": "opencode-zen/gemini-3-flash",
      "registry_alternate": "opencode-zen/claude-haiku-4-5",
      "thinkingLevel": "medium"
    },
    "tracer": {
      "primary": "opencode-zen/kimi-k2.6",
      "registry_alternate": "opencode-zen/claude-sonnet-4-6",
      "thinkingLevel": "high"
    },
    "analyst": {
      "primary": "opencode-zen/kimi-k2.6",
      "registry_alternate": "opencode-zen/claude-sonnet-4-6",
      "thinkingLevel": "xhigh"
    },
    "scientist": {
      "primary": "openai-codex/gpt-5.4",
      "registry_alternate": "opencode-zen/gpt-5.4",
      "thinkingLevel": "xhigh"
    },
    "architect": {
      "primary": "openai-codex/gpt-5.4",
      "registry_alternate": "opencode-zen/gpt-5.4",
      "thinkingLevel": "xhigh"
    },
    "librarian": {
      "primary": "opencode-zen/kimi-k2.6",
      "registry_alternate": "opencode-zen/claude-sonnet-4-6",
      "thinkingLevel": "medium"
    },
    "multimodal-looker": {
      "primary": "opencode-zen/gemini-3-flash",
      "registry_alternate": "opencode-zen/claude-sonnet-4-6",
      "thinkingLevel": "medium"
    },
    "oracle": {
      "primary": "anthropic/claude-opus-4-7",
      "registry_alternate": "opencode-zen/claude-opus-4-7",
      "thinkingLevel": "xhigh"
    },
    "metis": {
      "primary": "openai-codex/gpt-5.4",
      "registry_alternate": "opencode-zen/gpt-5.4",
      "thinkingLevel": "xhigh"
    }
  }
}
```

### 5.1 검증된 (model, thinkingLevel) 페어 매트릭스

`omp --list-models` 기준 thinkingLevel 지원 여부 교차 검증 (`minimal,low,medium,high,xhigh` 컬럼 확인).

**범례**: `[L]` = `omp --list-models` 로 직접 확인됨, `[S]` = 정적 분석 예측 (§14 구현 검증에서 실증 확인 필요)

> **alternate thinkingLevel**: `parseAgentFields`는 `thinkingLevel`을 agent 파일 전체에서 단일 값으로 파싱한다 (`discovery/helpers.ts:265`). 즉 primary와 alternate 모두 동일한 `thinkingLevel`을 사용한다. 모델별로 thinkingLevel을 달리 지정하는 것은 지원되지 않는다.

| Role | Model (primary) | thinkingLevel | 지원 여부 |
|---|---|---|---|
| executor | openai-codex/gpt-5.3-codex | high | [L] |
| explorer | opencode-zen/gemini-3-flash | medium | [L] |
| verifier | opencode-zen/kimi-k2.6 | medium | [L] |
| critic | anthropic/claude-opus-4-7 | xhigh | [L] |
| planner | anthropic/claude-opus-4-7 | high | [L] |
| code-reviewer | opencode-zen/kimi-k2.6 | high | [L] |
| debugger | openai-codex/gpt-5.3-codex | high | [L] |
| test-engineer | openai-codex/gpt-5.3-codex | high | [L] |
| security-reviewer | anthropic/claude-opus-4-7 | xhigh | [L] |
| writer | opencode-zen/gemini-3-flash | medium | [L] |
| designer | opencode-zen/glm-5.1 | high | [L] |
| code-simplifier | opencode-zen/kimi-k2.6 | xhigh | [L] |
| qa-tester | opencode-zen/gemini-3.5-flash | high | [L] |
| git-master | opencode-zen/gpt-5-nano | minimal | [L] |
| document-specialist | opencode-zen/gemini-3-flash | medium | [L] |
| tracer | opencode-zen/kimi-k2.6 | high | [L] |
| analyst | opencode-zen/kimi-k2.6 | xhigh | [L] |
| scientist | openai-codex/gpt-5.4 | xhigh | [L] |
| architect | openai-codex/gpt-5.4 | xhigh | [L] |
| librarian | opencode-zen/kimi-k2.6 | medium | [L] |
| multimodal-looker | opencode-zen/gemini-3-flash | medium | [L] |
| oracle | anthropic/claude-opus-4-7 | xhigh | [L] |
| metis | openai-codex/gpt-5.4 | xhigh | [L] |

모델 선정 근거 (2026-05-29 벤치마크 기반):
- `openai-codex/gpt-5.3-codex`: executor/debugger/test-engineer primary. ChatGPT subscription marginal cost 0, SWE-bench 85%.
- `anthropic/claude-opus-4-7`: planner / critic / security-reviewer / oracle primary. SWE-bench 87.6% top tier, Anthropic Pro/Max subscription extra-usage 활용. critic 은 false-PASS 비용 max 라 mechanical fix (2026-05-29) 로 anthropic 유지.
- `openai-codex/gpt-5.4`: scientist/architect/metis primary + planner alternate. 1M context, xhigh thinking, $2.5/$15.
- `anthropic/claude-opus-4-7`: planner/security-reviewer/oracle primary. SWE-bench 87.6%, Anthropic Pro/Max extra-usage 활용.
- `opencode-zen/kimi-k2.6`: verifier/code-reviewer/code-simplifier/tracer/analyst/librarian primary. SWE-bench 80.2% (Opus 4.6 동급), Terminal-Bench 2.0 66.7%, 13시간 4000+ tool calls 무중단. $0.95/$4.
- `opencode-zen/gemini-3-flash`: explorer/writer/document-specialist/multimodal-looker primary. 1M context, vision yes, $0.5/$3.
- `opencode-zen/gemini-3.5-flash`: qa-tester primary. vision yes (Playwright 스크린샷 검증), $1.5/$9.
- `opencode-zen/glm-5.1`: designer primary. Code Arena Elo 1530 (agentic front-end 3위 글로벌), $1.40/$4.40.
- `opencode-zen/gpt-5-nano`: git-master primary. $0.05/$0.4. git 명령은 최소 reasoning 충분.

---

## §6 Provider 화이트리스트 Enforcement

### 6.1 허용 provider 목록

| Provider ID | 활성화 조건 | `omp --list-models` 확인 |
|---|---|---|
| `opencode-zen` | 항상 (Profile A 의 14 role primary) | 확인됨 (kimi-k2.6, gemini-3-flash, glm-5.1, gpt-5-nano 등 35+ 모델) |
| `openai-codex` | Profile A 의 6 role primary (executor/debugger/test-engineer/scientist/architect/metis) | 확인됨 (gpt-5.3-codex, gpt-5.4 등 16개 모델) |
| `anthropic` | Profile A 의 4 role primary (planner, critic, security-reviewer, oracle) | 확인됨 (claude-haiku-4-5, claude-opus-4-7, claude-sonnet-4-6 등). 2026-05-29 OPTIMIZED-MODEL revision 부터 Profile A 도 anthropic 사용 (Anthropic Pro/Max subscription 활용). |

### 6.2 Plugin load-time 화이트리스트 검증

`pi.registerProvider()`는 새 provider를 등록하는 API다. pi-oven가 필요한 것은 새 provider 등록이 아니라 **기존 provider 사용 제한**이다. 따라서 `registerProvider()`는 화이트리스트 enforcement에 직접 사용되지 않는다.

대신 플러그인 load time에 `agents/pi-oven-*.md` 파일 전체를 scan하여 `model` 필드가 화이트리스트 위반인지 검사한다:

```typescript
// .omp/extensions/pi-oven.ts 내 validation 로직 (의사코드)
const ALLOWED_PREFIXES = ["opencode-zen/", "openai-codex/"];
const ANTHROPIC_PREFIX = "anthropic/";

async function validateAgentModels(agentsDir: string): Promise<void> {
  const files = await fs.readdir(agentsDir);
  const piOvenFiles = files.filter(f => f.startsWith("pi-oven-") && f.endsWith(".md"));

  for (const file of piOvenFiles) {
    const content = await fs.readFile(path.join(agentsDir, file), "utf-8");
    const { frontmatter } = parseFrontmatter(content);
    const models = parseModelList(frontmatter.model) ?? [];

    for (const model of models) {
      const allowed =
        ALLOWED_PREFIXES.some(p => model.startsWith(p)) ||
        (isAnthropicEnabled() && model.startsWith(ANTHROPIC_PREFIX));

      if (!allowed) {
        pi.logger.error(
          `pi-oven: agent file ${file} uses disallowed model "${model}". ` +
          `Allowed prefixes: ${ALLOWED_PREFIXES.join(", ")}` +
          (isAnthropicEnabled() ? `, ${ANTHROPIC_PREFIX}` : "")
        );
        // 경고 로그만 출력하고 계속 진행 (hard crash 방지)
        // 해당 agent는 dispatch 시 모델 해석 실패로 자연 fallback됨
      }
    }
  }
}
```

`isAnthropicEnabled()`: Spec B의 setup wizard가 `pi-oven.provider.anthropic = true`를 플러그인 config에 기록하면 `true`를 반환.

### 6.3 Auth-fallback whitelist hole — documented limitation

omp의 `resolveModelOverrideWithAuthFallback`은 primary 모델이 registry에 있지만 unauthed일 때 배열의 다음 항목이 아닌 **parent session의 active model**로 fallback한다 (§3.2 Outcome 2). 이 동작은 pi-oven가 제어할 수 없는 omp 내부 동작이다.

**함의**: Profile B 환경에서 parent session이 `anthropic/claude-opus-4-7` 같은 Anthropic 모델로 실행 중일 때, pi-oven subagent의 primary가 unauthed 상태이면 해당 subagent는 자신의 `model:` 화이트리스트 선언과 무관하게 Anthropic 모델로 라우팅된다.

**채택된 처리 방식 (option b)**: 이 동작을 의도적 제한(known limitation)으로 명시적으로 문서화한다. Profile A는 best-effort 보장이며, Profile B 사용자는 unauthed-primary 조건에서 Claude 라우팅이 발생할 수 있음을 인지해야 한다.

- Profile A 환경(opencode-zen 인증 완료): 정상적으로 Outcome 1 경로를 따르므로 실질적 문제 없음.
- Profile B 환경: Spec B의 setup wizard가 이 제한을 사용자에게 명시적으로 안내해야 한다 (§15 Spec B 인터페이스 참조).
- 향후 강화 경로 (option a): `before_agent_start`에서 parent model이 화이트리스트를 위반하면 `whitelist_violation_via_auth_fallback` 경고를 로그에 출력하는 방식으로 소프트 모니터링을 추가할 수 있다. 현재 cycle에서는 채택하지 않는다.

### 6.4 Runtime enforcement: `before_agent_start` 이벤트

`ExtensionAPI.on("before_agent_start", handler)` 확인됨 (types.ts line 875). 이벤트 payload:

```typescript
interface BeforeAgentStartEvent {
  type: "before_agent_start";
  prompt: string;
  images?: ImageContent[];
  systemPrompt: string[];
}
```

이 이벤트는 agent loop 시작 전 발화한다. model 문자열을 직접 가로채거나 변경하는 API는 `BeforeAgentStartEventResult.systemPrompt`뿐이다 (model을 교체하는 필드는 없음). 따라서 model 화이트리스트 enforcement는 **load-time 파일 scan** 방식이 primary이며, runtime intercept는 systemPrompt 주입 등 보완 목적으로만 사용한다.

---

## §7 Subagent Mode 정책

### 7.1 `mode: subagent` 의미

omo 프로젝트의 agent 파일들은 `mode: subagent`를 frontmatter에 선언한다. omp의 `parseAgentFields` (helpers.ts line 222–271)는 `mode` 필드를 처리하지 않으므로 이 필드는 **omp 내부적으로 무시**된다.

pi-oven에서 `mode: subagent`는:
1. **문서적 marker**: 이 agent가 main session에서 직접 실행되는 것이 아니라 `task` 툴을 통해 spawn된다는 의도 선언
2. **플러그인 런타임 hint**: pi-oven 확장 코드가 읽어서 UI 표시나 context injection에 활용 가능

### 7.2 UI 선택과의 관계

omp에서 사용자가 `--model` 플래그나 UI에서 모델을 선택해도, agent 파일의 `model:` frontmatter가 있으면 **해당 frontmatter 값이 우선**된다 (discovery.ts + executor.ts 동작). 즉 `mode: subagent` 선언과 무관하게 agent dispatch 시에는 항상 frontmatter의 model 값이 사용된다.

### 7.3 main session `--model` 플래그와의 관계

main session (`omp launch --model X`)의 모델 선택은 pi-oven agent들의 dispatch에 영향을 주지 않는다. 각 agent가 독립적으로 자신의 `model:` frontmatter를 가지기 때문이다. 단, agent 파일에 `model:` 필드가 없는 경우 omp는 `pi/task` (기본 task 모델)을 사용한다 — 따라서 23개 agent 파일 전체에 `model:` 필드를 명시하는 것이 필수다. pi-oven load-time validator가 load-time soft-error를 출력하며 (§13.3 Layer 1), CI-time lint이 hard enforcement를 담당한다 (§14 인수 조건 #6).

---

## §8 BLOCKED_TOOLS 매트릭스

`tools:` frontmatter에 명시적 목록을 지정하면 지정된 툴 외에는 사용 불가해진다. 반대로 `tools:` 미지정 시 전체 툴셋 접근. `blocked_tools`는 pi-oven 내부 필드로, `before_agent_start` 핸들러에서 active tool 목록을 제한하는 데 사용한다.

### 8.1 정책 원칙

- **탐색/조사 패밀리** (explorer, document-specialist, tracer, librarian, oracle, metis, analyst, scientist, multimodal-looker): `task`, `Write`, `Edit`, `apply_patch` 차단. 읽기 전용 + 외부 탐색에만 집중.
- **구현 패밀리** (executor, debugger, test-engineer, code-simplifier): `task` 차단 (중첩 dispatch 방지). `Write`, `Edit`, `apply_patch` 허용.
- **검토 패밀리** (verifier, critic, code-reviewer, security-reviewer): `task` 차단. `Write`, `Edit` 차단 (관찰자 역할). `Bash` 허용 (빌드/테스트 실행).
- **계획/설계 패밀리** (planner, architect, designer): `task` 차단 또는 제한. `Write` 허용 (spec/plan 파일 작성).
- **git/문서 패밀리** (git-master, writer, qa-tester): 역할별 최소 권한.

### 8.2 역할별 BLOCKED_TOOLS 표

| Role | `task` | `Write` | `Edit` | `apply_patch` | `Bash` | 비고 |
|---|---|---|---|---|---|---|
| executor | BLOCK | allow | allow | allow | allow | 중첩 dispatch 금지 |
| explorer | BLOCK | BLOCK | BLOCK | BLOCK | allow(read-only) | 순수 탐색 |
| verifier | BLOCK | BLOCK | BLOCK | BLOCK | allow | 빌드/테스트 실행 필요 |
| critic | BLOCK | BLOCK | BLOCK | BLOCK | allow(read-only) | 관찰자 |
| planner | BLOCK | allow | allow | BLOCK | allow(read-only) | plan 파일 작성 필요 |
| code-reviewer | BLOCK | BLOCK | BLOCK | BLOCK | allow(read-only) | diff 읽기만 |
| debugger | BLOCK | allow | allow | allow | allow | trace + fix 가능 |
| test-engineer | BLOCK | allow | allow | allow | allow | 테스트 파일 작성 필요 |
| security-reviewer | BLOCK | BLOCK | BLOCK | BLOCK | allow(read-only) | 관찰자 |
| writer | BLOCK | allow | allow | BLOCK | allow(read-only) | 문서 파일만 |
| designer | BLOCK | allow | allow | BLOCK | allow(read-only) | 설계 파일만 |
| code-simplifier | BLOCK | allow | allow | allow | allow | 코드 변경 수행 |
| qa-tester | BLOCK | allow | allow | BLOCK | allow | 테스트 실행 필요 |
| git-master | BLOCK | BLOCK | BLOCK | BLOCK | allow | git 명령만 |
| document-specialist | BLOCK | BLOCK | BLOCK | BLOCK | allow(limited) | 외부 라이브러리 조사 |
| tracer | BLOCK | BLOCK | BLOCK | BLOCK | allow(read-only) | 추적 전용 |
| analyst | BLOCK | BLOCK | BLOCK | BLOCK | allow(read-only) | 분석 전용 |
| scientist | BLOCK | allow | BLOCK | BLOCK | allow | 실험 스크립트 작성 허용 |
| architect | BLOCK | allow | allow | BLOCK | allow(read-only) | ADR 파일 작성 |
| librarian | BLOCK | BLOCK | BLOCK | BLOCK | allow(limited) | clone + read |
| multimodal-looker | BLOCK | BLOCK | BLOCK | BLOCK | BLOCK | 이미지 분석만 |
| oracle | BLOCK\* | allow | allow | allow | allow | \*spawns: [pi-oven:explorer] |
| metis | allow\* | allow | allow | allow | allow | \*전략적 조율자, spawn 허용 |

`oracle`은 `spawns: [pi-oven:explorer]`로 explorer agent만 spawn 가능하도록 제한.
`metis`는 전략적 조율자로 task tool이 필요하나 `spawns` 목록을 화이트리스트로 제한: `[pi-oven:executor, pi-oven:verifier, pi-oven:explorer, pi-oven:critic, pi-oven:planner, pi-oven:code-reviewer, pi-oven:debugger, pi-oven:test-engineer]` (§4.2 spawns 다이어그램 참조).

---

## §9 Model Resolution-Time Alternate 규칙

### 9.1 model resolution의 세 가지 결과

omp의 `model:` 배열은 **429 runtime failover를 지원하지 않는다**. subagent dispatch 시 실제 호출되는 함수는 `task/executor.ts:1138`의 `resolveModelOverrideWithAuthFallback` (`config/model-resolver.ts:758–792`)이며, 이 함수는 내부적으로 두 단계를 거친다.

**단계 1 — Registry-availability resolution** (`resolveModelOverride`, `config/model-resolver.ts:716–734`):
배열을 순서대로 순회하여 `modelRegistry.getAvailable()` 기준으로 registry에 존재하는 첫 번째 항목을 선택. 이 단계는 auth를 확인하지 않는다.

**단계 2 — Auth check + parent fallback** (`resolveModelOverrideWithAuthFallback`, line 779):
1단계 결과가 unauthed이면 `resolveModelOverride([parentActiveModelPattern], ...)` 호출 — 즉 **배열의 다음 항목이 아닌 parent session의 active model**로 fallback.

세 가지 결과 (§3.2와 동일):

```
Outcome 1: A in registry + authed       → A 사용
Outcome 2: A in registry + unauthed     → parent session model 사용 (B 아님!)
Outcome 3: A not in registry            → B 시도 (B resolves → B; B도 unauth → parent; B도 없음 → fail)
```

omp의 runtime retry (`AutoRetryStartEvent`, `extensibility/shared-events.ts:223–229`)는 `nextModel` 필드 없이 동일 모델 sleep-backoff만 수행한다. 배열 두 번째 항목으로의 런타임 자동 전환은 없다.

따라서 `model:` 배열은 **A가 registry에서 제거된 경우(Outcome 3)에 대한 registry-not-found alternate**이다. Outcome 2(unauthed) 처리는 §6.3 documented limitation 참조.

### 9.2 오류 분류표

```
오류 유형                  | HTTP 코드 | omp 동작
────────────────────────────────────────────────────────────
Rate limit exceeded        | 429       | sleep-backoff retry (동일 모델, maxAttempts)
Unauthorized               | 401       | hard fail
Not found (model)          | 404       | hard fail (잘못된 모델 ID)
Server error               | 5xx       | hard fail (provider 장애)
Context limit exceeded     | 413/400   | hard fail (입력 축소 필요)
Network timeout            | -         | hard fail
────────────────────────────────────────────────────────────
```

### 9.3 pi-oven에서 resolution-time alternate 활용

**executor** (`openai-codex/gpt-5.3-codex` → `opencode-zen/gpt-5.3-codex`):
- primary: `openai-codex/gpt-5.3-codex` (사용자 정책: ChatGPT Codex 5.3+ 구독 활용)
- alternate: `opencode-zen/gpt-5.3-codex` (Codex 구독 없는 사용자 환경을 위한 Zen wrapper fallback, resolution time에만 사용)
- runtime 429 발생 시: omp가 동일 모델로 sleep-backoff retry → maxAttempts 소진 → hard fail

**critic** (`opencode-zen/claude-opus-4-7` → `opencode-zen/gpt-5.4`):
- primary: `opencode-zen/claude-opus-4-7` (확인됨)
- alternate: `opencode-zen/gpt-5.4` (claude-opus-4-7이 registry에서 제거될 경우 resolution-time 전환)

**verifier** (`opencode-zen/kimi-k2.6` → `opencode-zen/claude-sonnet-4-6`):
- primary: `opencode-zen/kimi-k2.6` (확인됨)
- alternate: `opencode-zen/claude-sonnet-4-6` (kimi-k2.6 deprecate 시 resolution-time 전환)

**explorer** (`opencode-zen/glm-5` → `opencode-zen/claude-haiku-4-5`):
- primary: `opencode-zen/glm-5`
- alternate: `opencode-zen/claude-haiku-4-5`

### 9.4 런타임 429 대응

429 오류 발생 후 omp maxAttempts 소진 시 agent는 실패 상태로 종료된다. 호출 스킬은 다음 중 하나를 선택:
1. 사용자에게 오류 메시지 전달 후 중단
2. user-queue에 `Q-RATE-LIMIT` 항목 추가 후 대기

자동 재시도 루프(sleep + retry)가 필요하면 autonomous-loop 스킬이 조율한다. (Spec C에서 autonomous-loop 보강 시 추가될 동작 — 본 spec scope 외)

---

## §10 omc 흡수 결정 표

23개 pi-oven agent 각각에 대해 systemPrompt body의 출처 및 적용된 omc 소스를 명기한다.

| pi-oven Role | omc Source | 흡수 방식 | 추가 통합 소스 |
|---|---|---|---|
| executor | omc executor AGENT_PROMPT | systemPrompt body 직접 이식, pi-oven 제약 추가 | — |
| explorer | omc explore skill + bundled explore.md | bundled `explore.md` systemPrompt 기반 확장 | omo explore 패턴 |
| verifier | omc verifier + omc verify skill | omc verifier body + superpowers verification-before-completion 지시어 통합 | — |
| critic | omc critic | systemPrompt body 직접 이식 | — |
| planner | omc planner | systemPrompt body 직접 이식 | — |
| code-reviewer | omc code-reviewer | systemPrompt body 직접 이식 | — |
| debugger | omc debugger | systemPrompt body 기반 + omc trace skill 지시어 인라인 통합 | — |
| test-engineer | omc test-engineer | systemPrompt body 직접 이식 | — |
| security-reviewer | omc security-reviewer | systemPrompt body 직접 이식 | — |
| writer | omc writer | systemPrompt body 직접 이식 | — |
| designer | omc designer + bundled designer.md | bundled `designer.md` 기반 확장 | — |
| code-simplifier | omc code-simplifier | systemPrompt body 기반 + omc ai-slop-cleaner systemPrompt 인라인 통합 (§12 참조) | — |
| qa-tester | omc qa-tester | systemPrompt body 직접 이식 | — |
| git-master | omc git-master | systemPrompt body 직접 이식 | — |
| document-specialist | omc document-specialist | systemPrompt body 기반 | omo librarian 패턴 추가 |
| tracer | omc tracer | systemPrompt body 직접 이식 | — |
| analyst | omc analyst | systemPrompt body 직접 이식 | — |
| scientist | omc scientist | systemPrompt body 직접 이식 | — |
| architect | omc architect | systemPrompt body 직접 이식 | — |
| librarian | — (omo only) | omo bundled librarian.md 기반 | §11 참조 |
| multimodal-looker | — (omo only) | omo source 기반 | §11 참조 |
| oracle | — (omo only) | bundled oracle.md 기반 확장 | §11 참조 |
| metis | — (omo only) | omo source 기반 | §11 참조 |

**omc 스킬 → agent body 인라인 통합 상세**:

- **`trace` → `pi-oven:debugger`**: omc trace 스킬의 핵심 지시어 (이벤트 흐름 추적, 호출 스택 재구성, 시간순 정렬)를 debugger systemPrompt에 `<trace-capabilities>` 섹션으로 추가.
- **`verify` → `pi-oven:verifier`**: omc verify 스킬의 verification protocol (fresh build, test run, LSP diagnostics, behavioral check)을 verifier systemPrompt에 통합. superpowers verification-before-completion의 "show evidence" 원칙 추가.
- **`ai-slop-cleaner` → `pi-oven:code-simplifier`**: §12에서 상세 기술.
- **`ralplan`**: 흡수 제외. spec-and-review 스킬과 중복 (§11 결정 포함).

---

## §11 omo 흡수 결정 표

omo bundled agents 출처: `/Users/kimzerokim/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent/src/prompts/agents/`

확인된 bundled agents: `explore.md`, `plan.md`, `designer.md`, `reviewer.md`, `librarian.md`, `oracle.md`, `task.md`

### 11.1 흡수하는 4개 omo agents

| pi-oven Role | omo Source 파일 | 유지한 내용 | 변경한 내용 |
|---|---|---|---|
| `pi-oven:librarian` | `librarian.md` (bundled) | 전체 procedure (5단계: classify→locate→investigate→verify→report), output schema 구조, `sources`/`api`/`version` 구조 | name → `pi-oven:librarian`; model → `opencode-zen/glm-5`; `mode: subagent` 추가; `blocked_tools: task, Write, Edit, apply_patch` 추가; pi-oven 네임스페이스 프리픽스 |
| `pi-oven:multimodal-looker` | omo source (bundled 아님, omo별도) | 이미지/스크린샷 분석 procedure, 구조화 응답 | name → `pi-oven:multimodal-looker`; model → `opencode-zen/claude-sonnet-4-6`; `blocked_tools` 전체 (Bash 포함) 추가 |
| `pi-oven:oracle` | `oracle.md` (bundled) | 전체 directives, decision-framework, procedure (5단계), scope-discipline | name → `pi-oven:oracle`; model → `opencode-zen/claude-opus-4-7`; `thinkingLevel: xhigh`; `blocking: true` 유지; `spawns: [pi-oven:explorer]` (pi-oven namespace로 변경) |
| `pi-oven:metis` | omo source (bundled 아님) | 전략적 조율 로직, 멀티스텝 계획 실행 | name → `pi-oven:metis`; model → `opencode-zen/claude-opus-4-7`; spawns 화이트리스트 = pi-oven: 네임스페이스 agents만 |

**omp 번들 oracle/librarian 공존 주의**: `pi-oven:oracle` / `pi-oven:librarian`은 name이 다르므로 omp 번들 `oracle` / `librarian`을 shadow하지 않는다. 양쪽 모두 동시에 dispatchable하다 — omp 번들 버전을 그대로 사용하거나 pi-oven-prefixed 버전을 명시적으로 선택할 수 있다.

### 11.2 흡수하지 않는 omo agents

| omo Agent | 제외 이유 |
|---|---|
| `sisyphus` (full) | 목적 불명확, pi-oven 워크플로우와 중복 없음 |
| `prometheus` | omo 전용 자율실행 루프. autonomous-loop 스킬이 동등 기능 제공 |
| `hephaestus` | omp 인프라 구성 자동화 — pi-oven 범위 외 |
| `momus` | QA 비평 특화 — `pi-oven:critic` + `pi-oven:code-reviewer`로 충분 |
| `atlas` | 대규모 멀티레포 조율 — pi-oven 현재 범위 초과 |

### 11.3 omo `mode: subagent` + `BLOCKED_TOOLS=[task]` 정책 채택

omo의 글로벌 정책: 모든 subagent는 `task` 툴을 block하여 중첩 spawn을 방지. pi-oven는 이 정책을 §8 BLOCKED_TOOLS 매트릭스에 전면 채택했다. `metis`만 예외로 조율자 역할을 위해 spawn을 허용하되 `spawns:` 화이트리스트로 제한.

---

## §12 ai-slop-cleaner 통합 결정

### 12.1 결정 사항

`omc ai-slop-cleaner` systemPrompt를 `pi-oven:code-simplifier` agent body에 **인라인 통합**. 별도 slop-agent 없음.

### 12.2 통합 근거

- omc ai-slop-cleaner는 deletion-first 방식으로 omc simpler 버전보다 강력하다.
- `pi-oven:code-simplifier`는 이미 "중복 감소, 표현 단순화" 역할을 담당하므로 slop 탐지 로직은 자연스러운 확장이다.
- agent 수를 최소화하는 pi-oven 원칙에 부합한다.

### 12.3 code-simplifier에 통합될 slop 탐지 규칙 (systemPrompt outline)

구현은 Spec C에서 완성하지만, 다음 규칙들이 `pi-oven:code-simplifier` systemPrompt의 `<slop-detection>` 섹션에 포함된다:

1. **AI 작성 패턴 감지**: "Certainly!", "Here's what I'll do:", "As an AI", "Great question" 등 LLM-tell 문구 탐지 및 삭제
2. **과도한 주석**: 코드를 그대로 반복하는 주석 (예: `// increment i`) 삭제
3. **빈 에러 핸들러**: `catch (e) {}` 또는 `catch (e) { /* TODO */ }` — 의미 있는 처리로 교체 또는 삭제
4. **사용하지 않는 import**: tree-shaking 도구 또는 LSP diagnostics로 탐지 후 삭제
5. **불필요한 추상화**: 단일 호출만 있는 wrapper function — 인라인화
6. **과도한 타입 캐스팅**: `as any` 남용 — 정확한 타입으로 교체
7. **중복 조건 분기**: 동일 로직을 다르게 표현한 if/else 블록 병합
8. **regression safety**: 변경 전 테스트 실행 → 변경 후 동일 테스트 pass 확인. 실패 시 변경 롤백

삭제 우선순위: 존재해서는 안 되는 코드를 먼저 삭제 → 그 다음 단순화 → 마지막으로 리팩터링.

---

## §13 Plugin Runtime Enforcement Hook

### 13.1 `before_agent_start` 이벤트 확인

`pi.on("before_agent_start", handler)` 이벤트가 `ExtensionAPI` 에 존재함이 소스 분석으로 확인됨 (types.ts line 875). 이벤트는 사용자 프롬프트 제출 후, agent loop 시작 전에 발화한다.

### 13.2 `BeforeAgentStartEvent` payload

```typescript
interface BeforeAgentStartEvent {
  type: "before_agent_start";
  prompt: string;
  images?: ImageContent[];
  systemPrompt: string[];
}

interface BeforeAgentStartEventResult {
  message?: Pick<CustomMessage, "customType" | "content" | "display" | "details" | "attribution">;
  systemPrompt?: string[]; // 이 턴의 system prompt 교체
}
```

payload에 `agentName`이나 `model` 필드가 없음. 따라서 `before_agent_start`에서 model 직접 가로채기 불가.

### 13.3 실제 enforcement 설계

**Layer 1 — Plugin load-time file scan** (primary enforcement):

extension 파일은 `.omp/extensions/pi-oven.ts`에 위치한다. agents 디렉토리 경로는 extension 파일의 위치를 기준으로 상대 경로로 해석한다 (`pi.pi.getPluginDir()` API는 존재하지 않음):

```typescript
import { fileURLToPath } from "node:url";
import path from "node:path";

// .omp/extensions/pi-oven.ts → ../../agents/ (extension 파일 기준 상대 경로)
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const agentsDir = path.resolve(__dirname, "..", "..", "agents");
// 결과: <pi-oven-root>/agents/
```

실제 경로 검증: `.omp/extensions/pi-oven.ts`에서 `../../agents`를 resolve하면 `pi-oven/agents/`가 된다.

```typescript
export default function piOvenPi(pi: ExtensionAPI): void {
  // 1. Plugin load 시 agent 파일 화이트리스트 검증
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const agentsDir = path.resolve(__dirname, "..", "..", "agents");

  const ALLOWED_PREFIXES = [
    "opencode-zen/",
    "openai-codex/",
    // "anthropic/"  <- Spec B의 setup wizard가 활성화 시 추가
  ];

  (async () => {
    const files = (await fs.readdir(agentsDir)).filter(
      f => f.startsWith("pi-oven-") && f.endsWith(".md")
    );

    for (const file of files) {
      const content = await fs.readFile(path.join(agentsDir, file), "utf-8");
      const { frontmatter } = parseFrontmatter(content);
      const models: string[] = Array.isArray(frontmatter.model)
        ? frontmatter.model
        : typeof frontmatter.model === "string"
        ? [frontmatter.model]
        : [];

      // B4: model 필드 누락은 소프트 오류 (load-time soft-error, runtime fallback 발생 가능)
      // enforcement 계층:
      //   - load-time: 여기서 error 로그 출력 후 계속 진행 (soft) — dispatch 시 omp 기본 모델로 폴백
      //   - CI-time: repo의 모든 pi-oven-*.md에 model: 필드가 존재함을 lint으로 강제 (hard)
      // 이 분리가 의도적임: load-time은 운영 중 graceful degradation을 허용하고,
      // CI-time lint이 배포 전 실수를 차단하는 hard gate 역할을 한다.
      if (models.length === 0) {
        pi.logger.error(
          `[pi-oven] Profile A guarantee broken: ${file} has no model field. ` +
          `This agent will fall back to omp default task model. ` +
          `All pi-oven-*.md agent files must declare a model array.`
        );
        // load-time는 soft-error (runtime fallback 발생 가능); hard enforcement는 CI-time lint으로
      }

      for (const model of models) {
        if (!ALLOWED_PREFIXES.some(p => model.startsWith(p))) {
          pi.logger.error(
            `[pi-oven] WHITELIST VIOLATION: ${file} model="${model}" ` +
            `is not in allowed prefixes [${ALLOWED_PREFIXES.join(", ")}]`
          );
        }
      }
    }
  })();

  // 2. before_agent_start: systemPrompt 주입 목적으로만 사용 (logging/diagnostic)
  // BeforeAgentStartEvent payload에 agentName/model 필드 없음 (types.ts:450-455)
  // tool 제한은 agent 파일의 tools: frontmatter 필드가 담당 (omp native enforcement)
  pi.on("before_agent_start", async (_event, _ctx) => {
    // No-op: agentName 식별 불가. tool 제한은 tools: frontmatter가 강제.
    // 향후 ExtensionContext에 agentName 추가 시 여기서 dynamic enforcement 가능.
    return {};
  });

  // plugin.json "name": "pi-oven", version "0.1.0" → canonical label = "pi-oven v0.1.0"
  pi.setLabel("pi-oven v0.1.0");
}
```

**Layer 2 — `before_agent_start` (logging only)**:

`BeforeAgentStartEvent` payload에 `agentName`이나 `model` 필드가 없다 (types.ts:450–455). 따라서 이 레이어에서 특정 agent의 tool을 동적으로 제한하는 것은 현재 API로 불가능하다. tool 제한의 실질적 enforcement는 **agent 파일의 `tools:` frontmatter 필드**에 의존한다 (omp가 직접 강제). `before_agent_start` 핸들러는 진단/로깅 목적으로만 사용한다.

**결론**: 가장 강력한 enforcement는 **agent 파일의 `tools:` 필드에 허용 목록을 명시하는 것**이다. omp가 직접 강제한다. plugin runtime은 model 화이트리스트 위반 경고 로그와 진단 목적으로만 사용.

**CI-time hard lint 도구 (확정)**:

`package.json`의 `scripts.lint:agents`에 다음 tsx 스크립트를 등록한다:

```json
{
  "scripts": {
    "lint:agents": "tsx scripts/lint-agents.ts"
  }
}
```

`scripts/lint-agents.ts` 동작:
1. `agents/pi-oven-*.md` 파일 전체를 walk
2. 각 파일의 frontmatter를 파싱하여 `model:` 필드 존재 여부 확인
3. `model:` 필드 없는 파일이 하나라도 있으면 오류 메시지를 출력하고 `process.exit(1)`

`.github/workflows/ci.yml` 통합: typecheck 스텝 다음에 `bun run lint:agents` 스텝을 추가한다. merge 전 CI 실패 → 해당 agent 파일에 `model:` 필드 추가 필요.

---

## §14 구현 로드맵

이 스펙(Spec A)의 구현 단계.

### 폴더 구조 생성

- `agents/` 디렉토리가 pi-oven 플러그인 루트에 이미 존재함을 확인
- 23개 파일명 규칙: `agents/pi-oven-<role>.md` (소문자 kebab-case)
- 각 파일 최소 frontmatter: `name`, `description`, `model` (배열), `tools`, `thinkingLevel`, `mode: subagent`, `blocked_tools`

### 7개 MUST agent 파일 생성

우선순위: executor, explorer, verifier, critic, planner, code-reviewer, debugger.
- systemPrompt body: English only
- omc source 기반 작성 (§10 흡수 결정 참조)
- debugger에 omc trace 지시어 통합

인수 조건: 아래 §14 검증 명령으로 agent가 발견됨을 확인.

**§14 실증 검증 명령** (구현 완료 후 실행):
```bash
# 1. colon-in-name dispatch 검증 (각 MUST agent에 대해)
omp --plugin-dir /path/to/pi-oven --print "dispatch pi-oven:executor to say hello"
# 기대: pi-oven:executor → openai-codex/gpt-5.3-codex 사용

omp --plugin-dir /path/to/pi-oven --print "dispatch pi-oven:explorer to list ts files in src/"
# 기대: pi-oven:explorer → opencode-zen/glm-5 사용

# 2. agent 등록 확인
PI_LOG_LEVEL=debug omp --plugin-dir /path/to/pi-oven --no-tools --print "." 2>&1 | grep "pi-oven:"
# 기대: pi-oven:executor, pi-oven:explorer 등 7개+ 라인

# 3. tool 제한 확인 (explorer는 Write 불가)
omp --plugin-dir /path/to/pi-oven --agent pi-oven:explorer --print "write hello to /tmp/test.txt"
# 기대: Write tool 없음 오류 또는 tool call 거부
```

### 8개 SHOULD agent 파일 생성

우선순위: test-engineer, security-reviewer, writer, designer, code-simplifier(ai-slop 통합), qa-tester, git-master, document-specialist.
- code-simplifier: §12 slop detection 규칙을 `<slop-detection>` 섹션으로 포함

### 4개 NICE agent 파일 생성

tracer, analyst, scientist, architect.

### 4개 NICE+omo agent 파일 생성

librarian, multimodal-looker, oracle, metis.
- oracle의 `spawns:` → `[pi-oven:explorer]`로 지정
- metis의 `spawns:` → pi-oven: namespace 화이트리스트 (§4.2 enumerated list)

### pi-oven.ts 확장 코드 업데이트

- `validateAgentModels()` 로직 추가 (§13)
- `before_agent_start` 핸들러 등록 (no-op, logging only)
- provider 화이트리스트 상수 정의
- `agentsDir` 해석: `path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "agents")`

### 통합 테스트

TDD approach:
- 각 agent 파일이 `name: pi-oven:<role>` frontmatter를 올바르게 파싱하는지 단위 테스트
- model 필드가 화이트리스트를 준수하는지 검증 테스트
- model 필드 누락 시 validator 오류 로그 출력 확인 (B4)
- `tools:` 필드가 `blocked_tools` 선언과 일치하는지 검증

### 최소 실행 가능 검증

위 "§14 실증 검증 명령" 섹션의 명령을 실행하여 확인.

인수 조건 (Spec A 완료):
1. 23개 `agents/pi-oven-*.md` 파일이 존재한다
2. 모든 파일의 `model:` 값이 `opencode-zen/*` 또는 `openai-codex/*` 프리픽스를 가진다 (`anthropic/*` 없음)
3. pi-oven 플러그인이 설치된 omp 환경에서 `task` 툴로 `agent: "pi-oven:executor"` 호출이 성공한다
4. 탐색 패밀리 agents (explorer, librarian 등)가 `tools:` 제한으로 Write/Edit 불가함을 단위 테스트로 확인
5. pi-oven.ts load-time validator가 화이트리스트 위반 모델 사용 시 오류 로그를 출력한다
6. `model:` 필드 누락에 대한 두 단계 enforcement가 동작한다:
   - **load-time (소프트)**: pi-oven.ts validator가 `model:` 필드 누락 시 `pi.logger.error` 로그를 출력하고 계속 진행한다
   - **CI-time (하드)**: `bun run lint:agents` (`scripts/lint-agents.ts`)가 `agents/pi-oven-*.md` 전체를 walk하여 `model:` 필드 없는 파일 발견 시 `exit(1)`로 merge를 차단한다. `.github/workflows/ci.yml` typecheck 스텝 다음에 위치한다
7. oracle의 `spawns:` 필드가 `[pi-oven:explorer]`만 포함하여 중첩 depth를 2로 제한한다
8. 23개 모든 agent 파일의 `name:` frontmatter가 `pi-oven:<role>` 패턴을 따른다
9. executor primary가 unauthed인 상태에서 subagent dispatch 시 omp의 auth-fallback이 parent session model을 사용하며, 이 동작이 정상으로 로그된다 (whitelist 위반 발생 시 §6.3 limitation 문구가 적용됨). **Mock surface**: `modelRegistry`를 `{authed: false}`를 반환하도록 stub (`openai-codex/gpt-5.3-codex` 입력에 대해); `resolveModelOverrideWithAuthFallback`을 stub하여 `parentActiveModelPattern`으로 dispatch가 전달됨을 assert. 두 번째 배열 항목(`opencode-zen/gpt-5.3-codex`)으로 dispatch되지 않음을 명시적으로 확인한다

### TDD 테스트 파일 구조

```
tests/
  agents/
    frontmatter-validation.test.ts  # 모든 pi-oven-*.md frontmatter 파싱 검증
    model-whitelist.test.ts         # model 필드 화이트리스트 준수 검증
    model-required.test.ts          # model 필드 누락 오류 검증 (B4)
    tools-policy.test.ts            # tools 필드와 blocked_tools 일관성 검증
    spawns-depth.test.ts            # spawns depth 제한 검증
```

각 테스트 파일의 Red 케이스 (먼저 작성):
- `frontmatter-validation.test.ts`: `name:` 없는 파일 → parseAgentFields가 null 반환
- `model-whitelist.test.ts`: `model: anthropic/claude-opus-4-7` 지정 시 validator가 오류 로그 출력
- `model-required.test.ts`: `model:` 필드 없는 pi-oven-*.md → load-time validator가 `pi.logger.error` 출력 (소프트); CI lint이 해당 파일을 실패로 표시 (하드)
- `tools-policy.test.ts`: explorer가 `Write` 툴 없음을 확인
- `spawns-depth.test.ts`: oracle이 `pi-oven:executor` spawn 시도 → spawns 제한으로 실패
- `auth-fallback.test.ts`: executor primary(`openai-codex/gpt-5.3-codex`)가 unauthed인 mock 환경에서 dispatch 시 parent session model로 fallback됨을 확인 (AC#9). Mock: `modelRegistry.getAuthed("openai-codex/gpt-5.3-codex")` → `{authed: false}`; stub `resolveModelOverrideWithAuthFallback` → assert dispatch target = `parentActiveModelPattern`, NOT `opencode-zen/gpt-5.3-codex`

---

## §15 Spec B, Spec C가 소비하는 인터페이스

이 spec이 생산하는 안정 식별자 목록.

### 15.1 Agent dispatch 이름 (23개)

```
pi-oven:executor       pi-oven:explorer        pi-oven:verifier
pi-oven:critic         pi-oven:planner         pi-oven:code-reviewer
pi-oven:debugger       pi-oven:test-engineer   pi-oven:security-reviewer
pi-oven:writer         pi-oven:designer        pi-oven:code-simplifier
pi-oven:qa-tester      pi-oven:git-master      pi-oven:document-specialist
pi-oven:tracer         pi-oven:analyst         pi-oven:scientist
pi-oven:architect      pi-oven:librarian       pi-oven:multimodal-looker
pi-oven:oracle         pi-oven:metis
```

**omp 번들 agents 공존**: `oracle`, `librarian`, `explore`, `plan`, `designer`, `reviewer`, `task`, `quick_task`는 omp가 bundled set으로 제공한다. `pi-oven:oracle`, `pi-oven:librarian` 등 pi-oven-prefixed 이름은 name이 달라 shadow하지 않으므로 omp 번들 버전과 동시에 dispatchable하다.

> **Spec B 주의사항**: setup wizard는 §6.3의 auth-fallback whitelist hole을 사용자에게 명시적으로 안내해야 한다. Profile B 사용자가 Anthropic 모델로 parent session을 실행 중일 때, pi-oven subagent의 primary가 unauthed이면 해당 subagent가 Anthropic 모델로 라우팅될 수 있음을 온보딩 단계에서 고지한다.

### 15.2 Model map config 키 네임스페이스

```
pi-oven.models.<role>.primary             # string: "<provider>/<model-id>"
pi-oven.models.<role>.registry_alternate  # string: "<provider>/<model-id>" (registry-not-found only)
```

Spec B setup wizard가 이 키를 플러그인 config에 쓴다. Profile A (기본값)는 §5 JSON에 정의됨.

### 15.3 Plugin config 키

```
pi-oven.provider.anthropic       # boolean: Anthropic opt-in (Spec B writes, Spec A reads)
pi-oven.profile                  # "A" | "B": active provider profile (Spec B writes)
```

### 15.4 Spec C cross-ref

Spec C 범위:
- `deep-init` skill: pi-oven 프로젝트 초기화 전용 스킬. omc deepinit 흡수.
- `deep-dive` skill: omc deep-dive (trace → deep-interview 2-stage pipeline) 흡수.
- `team` skill: omc team 흡수. §4의 pi-oven: dispatch 이름들을 team roster로 참조.
- 12개 기존 SKILL.md English 재작성: 각 스킬 내 agent dispatch 참조를 `oh-my-claudecode:executor` 형식에서 `pi-oven:executor` 형식으로 일괄 교체. 이것이 v0.1.0 dogfood 실패의 직접 원인 수정이다.
- autonomous-loop 스킬: omc autopilot, ralph, ultrawork 흡수. §10의 omc 흡수 결정 적용.

---

## §16 Open Questions / Risks

각 항목: 질문 + 해소 방법 + 오판 시 영향.

---

### §16.0 Resolved / Documented Limitations

#### Known Limitation 1: auth-fallback-to-parent (해소됨, 문서화 완료)

**상태**: 해소됨 — §3.2 / §6.3 / §9.1에 상세 문서화.

primary 모델이 registry에 있지만 unauthed일 때 omp는 `model:` 배열의 다음 항목이 아닌 parent session의 active model로 fallback한다. 이 동작은 pi-oven가 제어할 수 없으며, §6.3 documented limitation으로 처리한다. Profile A 환경(opencode-zen 인증 완료)에서는 Outcome 1 경로만 따르므로 실질적 영향 없다.

#### Q-new-2: `pi.setLabel` API 존재 확인 (해소됨)

**상태**: 해소됨 — `types.ts:941`에서 `setLabel(entryIdOrLabel, label?)` 메서드 존재 확인됨.

`pi.setLabel("pi-oven v0.1.0")` 호출은 `ExtensionAPI` 인터페이스에 실제로 존재한다. §13.3 pseudocode의 해당 라인은 유효하며 구현 시 그대로 사용 가능하다.

---

### Q-new-1: `parseModelPattern` glob 지원 여부

**질문**: `config/model-resolver.ts`의 `parseModelPattern`이 `opencode-zen/claude-*` 형태의 glob을 지원하는가? Spec B setup wizard에서 provider 전체를 화이트리스트에 추가할 때 유용한 shorthand가 될 수 있다.

**해소 방법**: `parseModelPattern` 소스 확인. glob 지원 시 §5 model map 및 §6 화이트리스트 상수에서 활용 가능.

**오판 시 영향**: glob 미지원이면 Spec B에서 각 모델을 개별 명시해야 한다. 현재 Spec A는 구체적 모델 ID를 사용하므로 영향 없음. → **Spec B scope로 defer**.

---

### Q-new-3: main session dispatch path의 `resolveModelOverrideWithAuthFallback` 사용 여부

**질문**: main session (subagent가 아닌 직접 실행)에서 model resolution 시에도 `resolveModelOverrideWithAuthFallback`이 사용되는가, 아니면 `resolveModelOverride`만 사용되는가?

**해소 방법**: `task/executor.ts` main-session 실행 경로 확인 (subagent dispatch와 다른 코드 경로를 따를 수 있음).

**오판 시 영향**: main session에서 pi-oven agent를 직접 `--agent pi-oven:executor`로 실행할 때의 auth-fallback 동작이 §3.2와 다를 수 있다. §14 구현 검증에서 두 경로를 모두 테스트해야 한다.

---

### Q2: plugin agents/ 디렉토리가 flat만 지원하는지, 미래에 재귀 지원 가능성

**질문**: omp가 미래 버전에서 `agents/pi-oven/*.md` 형태의 서브디렉토리를 지원할 가능성이 있는가?

**해소 방법**: omp changelog/roadmap 또는 GitHub issues 확인. 현재(v0.1.0 설치 버전 기준)는 flat만 지원이 코드로 확인됨.

**오판 시 영향 (미래에 subdir 지원 추가)**: flat 파일명 `agents/pi-oven-<role>.md`은 여전히 동작한다. migration 없이 공존 가능. 영향 없음.

---

### Q3: `context` 이벤트에서 현재 agent name을 읽을 수 있는가

**질문**: `before_agent_start` 이벤트 payload에 `agentName` 필드가 없다. `ExtensionContext`에서 현재 dispatch 중인 agent 이름을 읽을 수 있는가?

**해소 방법**: `ExtensionContext` 타입 정의를 확인 (`types.ts` 내 `ExtensionContext` interface). `ctx.agentName` 또는 유사 필드 존재 여부 확인.

**오판 시 영향 (ExtensionContext에 agent name 없을 경우)**: `blocked_tools` enforcement를 runtime에서 정밀하게 적용할 수 없다. `tools:` frontmatter 필드에만 의존. 이미 §13.3에서 frontmatter `tools:` 필드가 primary enforcement임을 결정했으므로 영향 최소.

---

### Q4: `opencode-zen/claude-opus-4-7` 실제 availability

**질문**: `omp --list-models` 결과에서 `opencode-zen/claude-opus-4-7`이 나타나는가? opencode-zen은 wrapper로서 내부 모델을 교체할 수 있다.

**해소 방법**: `omp --list-models opencode-zen` 실행 결과에서 `claude-opus-4-7` 확인. 이미 §2 live verification 시 `claude-opus-4-7 opencode-zen/claude-opus-4-7 2 1M 128K`가 확인됨.

**오판 시 영향**: `claude-opus-4-7`이 deprecate되면 해당 모델을 primary/alternate로 사용하는 agents (critic, code-reviewer, architect, oracle, metis 등)가 실패. 해소: Spec B의 setup wizard가 model availability check를 포함하거나, pi-oven.ts load-time validation에서 `omp --list-models` 결과와 대조.

---

### Q5: openai-codex provider availability (non-OpenAI 환경)

**질문**: `openai-codex` provider는 별도 API key가 필요한가? 또는 opencode-zen 구독에 포함되는가?

**해소 방법**: `omp --list-models openai-codex` 실행 후 실제 API call 테스트. `openai-codex/gpt-5.3-codex`를 executor resolution-time alternate로 지정했을 때 인증 실패 여부 확인.

**오판 시 영향 (openai-codex가 별도 키 필요)**: executor alternate를 `opencode-zen/gpt-5.4`로 변경. model map 업데이트 필요.

---

### Q6: glm-5 code 생성 능력 (explorer/librarian 적합성)

**질문**: `opencode-zen/glm-5`를 explorer와 librarian primary로 지정했다. glm-5가 read-only 탐색 작업에서 충분한 precision을 가지는가? 특히 output schema 준수 여부.

**해소 방법**: eval suite에서 explore 작업을 glm-5와 claude-haiku-4-5로 각각 실행하고 output 구조 정확도 비교.

**오판 시 영향 (glm-5가 output schema를 일관되게 생성하지 못할 경우)**: explorer와 librarian primary를 `opencode-zen/claude-haiku-4-5`로 변경. model map 업데이트. §5 JSON 수정.

---

### Q7: `anthropic` provider ID 정확성

**질문**: omp에서 Anthropic 모델을 직접 사용할 때 provider ID가 `anthropic`인가?

**해소 방법**: `omp --list-models anthropic` 실행으로 확인 예정. 정적 분석으로 `anthropic/claude-haiku-4-5`, `anthropic/claude-opus-4-7` 등 다수 모델 존재 예측.

**영향**: Spec B setup wizard에서 Profile B 활성화 시 `anthropic/` prefix 모델들을 화이트리스트에 추가하면 된다. §14 구현 검증에서 실증 확인.

---

### Q8: pi-oven 플러그인 설치 경로와 dev 경로 분리

**질문**: 현재 `installPath`는 `~/.omp/plugins/cache/plugins/pi-oven___pi-oven___0.1.0`이다. 개발 중 로컬 `pi-oven/` 경로의 `agents/` 변경이 설치된 캐시에 반영되려면 재설치가 필요한가?

**해소 방법**: `omp plugin install --plugin-dir /path/to/pi-oven` 형태의 dev 모드 확인. 또는 symlink로 캐시 경로를 로컬 경로로 연결.

**오판 시 영향 (캐시 재설치 필요)**: agent 파일 수정마다 `omp plugin install` 재실행 필요 → 개발 속도 저하. dev 환경에서 `--plugin-dir` 옵션 사용을 표준화하여 해소.

---

*끝.*
