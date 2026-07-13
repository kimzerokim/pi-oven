> Historical; do not copy runtime syntax examples from this document.

# Spec D: omp plugin 의 15 skill ↔ 23 pi-oven agent dispatch 정합

**Status**: Draft v1 — 2026-05-29 (cycle 1)
**Scope**: `skills/<name>/SKILL.md` 15개의 pi-oven agent dispatch instruction 보강, broken reference 4건 정리, dead-code 11 agent 의 dispatch path 설계
**Spec A 의존**: `docs/specs/2026-05-28-pi-oven-agent-registry.md` (23 ROLES 정의)
**Spec B 의존**: `docs/specs/2026-05-28-pi-oven-setup-wizard.md` (PROFILE_A 모델 routing)
**Out-of-scope**: claude-code 환경의 skill (~/.claude/skills/pi-oven-*) ↔ pi-oven: agent 연결 (환경 분리, 별도 spec 대상). 모델 routing 자체 변경 (OPTIMIZED-MODEL.md 결정 그대로).

---

## §1 Goal

omp plugin `pi-oven@pi-oven` 가 노출하는 15개 skill 이 23개 `pi-oven-*` agent 를 dispatch 하는 connectivity 가 현재 부실하다. 진단 결과:

- 8 skill (53%) 이 어떤 `pi-oven:` agent 도 호출하지 않는다. 사용자가 skill 을 trigger 해도 main agent 가 직접 진행 → 23 agent 자산이 자동 활용 안 됨.
- 4 broken reference (skill 이 호출하는 `pi-oven:` ID 가 ROLES 23개에 없음).
- 11 agent (48%) 가 어떤 skill 에서도 호출되지 않음 (dead path).

본 spec 의 목표는 **15 skill × 23 agent matrix 에서 의미 있는 모든 (skill, agent) 연결을 정의**하고, **broken reference 를 정리**하며, **각 agent 가 최소 한 개 이상의 skill 호출 경로 가지도록 보장**하는 것이다.

claude-code 환경 (`~/.claude/skills/pi-oven-*`) 의 skill 은 omp 의 skill 과 별도 시스템 — 본 spec 은 omp plugin 의 `skills/*/SKILL.md` 만 다룬다.

---

## §2 현재 상태 진단 (2026-05-29 grep 실측)

### §2.1 skill → pi-oven agent 참조 매트릭스

| Skill | 참조 횟수 | 호출 agent | 분류 |
|---|---:|---|---|
| team | 27 | executor, planner, debugger, designer, test-engineer, code-reviewer, writer, security-reviewer, explorer, verifier, ⚠️ `pi-oven:team` | OK + 1 broken |
| autonomous-loop | 18 | architect, code-reviewer, code-simplifier, critic, debugger, executor, explorer, planner, security-reviewer, verifier, ⚠️ `pi-oven:autonomous` | OK + 1 broken |
| deep-init | 9 | explorer, writer | 부분 |
| large-task-delegation | 7 | critic, executor, explorer, planner, verifier, writer | OK |
| deep-dive | 6 | explorer, tracer | 부분 |
| eval-runner | 3 | ⚠️ `pi-oven:benchmark`, `pi-oven:eval`, `pi-oven:eval-all` | **전부 broken** |
| fresh-verifier | 2 | verifier | OK |
| brainstorming | 0 | — | **미연결** |
| code-quality-discipline | 0 | — | **미연결** |
| codebase-survey | 0 | — | **미연결** |
| pre-commit-gate | 0 | — | **미연결** |
| spec-and-review | 0 | — | **미연결** |
| subagent-driven-development | 0 | — | **미연결** |
| tdd-strict | 0 | — | **미연결** |
| writing-plans | 0 | — | **미연결** |

### §2.2 agent → skill 호출 매트릭스

호출되는 agent (12개):
- explorer (5 skill)
- verifier (4)
- executor, planner, writer (각 3)
- critic, debugger, code-reviewer, security-reviewer (각 2)
- architect, code-simplifier, designer, test-engineer, tracer (각 1)

호출 안 됨 (11개, dead path):
- **analyst**
- **code-simplifier** (autonomous-loop 1회만 — 거의 dead)
- **document-specialist**
- **git-master**
- **librarian**
- **metis**
- **multimodal-looker**
- **oracle**
- **qa-tester**
- **scientist**
- **architect** (autonomous-loop 1회만 — 거의 dead)

### §2.3 Broken reference 5건 → **false positive (모두 slash command)**

cycle 1 의 첫 lint-skills 실행은 `pi-oven:[a-z-]+` 토큰을 전수 잡았지만, 실제 5건 모두 slash command (`/pi-oven:<name>`) 이지 agent reference 아니었다. slash command 와 agent ID 는 별개 namespace:

| skill | 참조 토큰 | 실제 의미 |
|---|---|---|
| autonomous-loop | `/pi-oven:autonomous` | slash command (trigger keyword + 본문 예시) |
| eval-runner | `/pi-oven:eval`, `/pi-oven:eval-all`, `/pi-oven:benchmark` | slash command (CLI 진입점) |
| team | `/pi-oven:team` | slash command (trigger keyword) |

`scripts/lint-skills.ts` regex 에 negative lookbehind `(?<!\/)` 추가하여 slash-command prefix `/pi-oven:` 는 lint 대상 외, 순수 `pi-oven:<role>` 만 ROLES 정합 검사. 적용 후 violation = 0.

**결과**: §6 AC#1(b) "broken reference 5 → 0" 만족.

---

## §3 8 skill 에 agent dispatch instruction 보강안

skill 별로 어떤 pi-oven agent 를 어느 step 에서 dispatch 하는지. **SKILL.md body 는 영어만** (사용자 정책 `feedback_skill_language.md`); Korean = trigger keyword 매칭만. 본 spec 의 dispatch 안은 한국어 설명, 실제 SKILL.md 패치는 영어로.

### §3.1 brainstorming

현재: main agent 가 사용자랑 직접 대화 (요구사항 명확화 → 디자인).

추가 dispatch:
- **Step 1 (intent clarification)**: `pi-oven:metis` — Socratic 인터뷰. 모호한 요구사항 명확화.
- **Step 2 (codebase context)**: `pi-oven:explorer` — 관련 파일 / 패턴 찾기.
- **Step 3 (alternative approaches)**: `pi-oven:architect` — 2-3 approach 의 trade-off 분석.
- **Step 4 (write design)**: main 직접 (메인이 작성, pi-oven:writer 는 publication 단계)

### §3.2 code-quality-discipline

현재: main agent 가 직접 code-quality 체크.

추가 dispatch:
- **Step 1 (code review)**: `pi-oven:code-reviewer` — SOLID / spec compliance / regression surface.
- **Step 2 (simplification)**: `pi-oven:code-simplifier` — deletion-first, behavior preserve.
- **Step 3 (security check)**: `pi-oven:security-reviewer` — OWASP / supply chain.

### §3.3 codebase-survey

현재: main agent 가 직접 grep / read.

추가 dispatch:
- **Step 1 (file/pattern search)**: `pi-oven:explorer` — read-only codebase search.
- **Step 2 (causal trace)**: `pi-oven:tracer` — call graph, hypotheses (if survey 가 디버깅 관련).
- **Step 3 (external SDK doc)**: `pi-oven:document-specialist` — SDK / framework reference 가 필요할 때.

### §3.4 pre-commit-gate

현재: main agent 가 직접 lint / test 실행.

추가 dispatch:
- **Gate 1 (code review)**: `pi-oven:code-reviewer`.
- **Gate 2 (security)**: `pi-oven:security-reviewer`.
- **Gate 3 (verifier)**: `pi-oven:verifier` — fresh-agent evidence-based check.
- **Gate 4 (qa)**: `pi-oven:qa-tester` — Playwright / E2E (UI 변경 시).
- **Gate 5 (git)**: `pi-oven:git-master` — atomic commit, style-matched message.

### §3.5 spec-and-review

현재: main agent 가 직접 spec draft + codex review.

추가 dispatch:
- **Step 0 (survey)**: `pi-oven:explorer` + `pi-oven:librarian` (외부 reference 필요 시).
- **Step 1 (draft)**: main + `pi-oven:architect` (구조 설계) / `pi-oven:document-specialist` (외부 SDK).
- **Step 2 (review)**: `pi-oven:critic` (최종 quality gate, false PASS 비용 max).
- **Step 3 (synthesize)**: main agent.

### §3.6 subagent-driven-development

현재: main agent 가 직접 task 분해 + dispatch.

추가 dispatch:
- **Step 1 (decompose)**: `pi-oven:planner` — atomic task 분해.
- **Step 2 (per-task)**: `pi-oven:executor` — code 구현.
- **Step 3 (verify)**: `pi-oven:verifier` — fresh-agent evidence check.
- **Step 4 (review)**: `pi-oven:code-reviewer` (필요 시).

### §3.7 tdd-strict

현재: main agent 가 직접 red-green-refactor 진행.

추가 dispatch:
- **Step 1 (test design)**: `pi-oven:test-engineer` — test strategy + red test 작성.
- **Step 2 (green impl)**: `pi-oven:executor` — minimal implementation.
- **Step 3 (refactor verify)**: `pi-oven:verifier` — test pass + behavior preserve 검증.
- **Step 4 (debug if red)**: `pi-oven:debugger` — failing test root cause.

### §3.8 writing-plans

현재: main agent 가 직접 plan 작성.

추가 dispatch:
- **Step 1 (requirements gather)**: `pi-oven:metis` — interview / sub-agent dispatch (whitelist: explorer/librarian/document-specialist).
- **Step 2 (codebase context)**: `pi-oven:explorer`.
- **Step 3 (decompose)**: `pi-oven:planner`.
- **Step 4 (architectural risks)**: `pi-oven:architect`.

---

## §4 11 unused agent 의 추가 dispatch path

§3 에서 이미 커버:
- analyst → eval-runner (§2.3 broken fix), code-quality-discipline 의 metrics analysis
- code-simplifier → code-quality-discipline (§3.2)
- document-specialist → codebase-survey (§3.3), spec-and-review (§3.5), large-task-delegation (이미 부분)
- git-master → pre-commit-gate (§3.4 Gate 5)
- librarian → spec-and-review (§3.5)
- metis → brainstorming (§3.1), writing-plans (§3.8)
- multimodal-looker → (TBD — designer / qa-tester 안에서 sub-dispatch)
- oracle → (TBD — pre-commit-gate / autonomous-loop 의 2+ 실패 후 escalation)
- qa-tester → pre-commit-gate (§3.4 Gate 4), tdd-strict (있어도 됨)
- scientist → eval-runner (§2.3 fix), spec-and-review (실험 설계)
- architect → spec-and-review (§3.5), writing-plans (§3.8), brainstorming (§3.1)

§4 잔여 결정 (open question):
- multimodal-looker 가 어디서 dispatch? designer skill (UI 코드 작성 전) 또는 qa-tester skill (Playwright 스크린샷 분석 — 단 qa-tester 자체가 vision agent gemini-3.5-flash 라 sub-dispatch 의 의미 약함).
- oracle 의 escalation pattern — 어떤 skill 이 "2+ 실패 후 oracle 호출" 패턴 가지는지.

→ §3 + §4 적용 후 11 unused 중 9개 매핑 완료, 2개 (multimodal-looker, oracle) 미해결.

---

## §5 broken reference 정리안 → **lint regex 만 수정, SKILL.md 본문은 손대지 않음**

§2.3 재진단 결과 5건 모두 slash command (false positive) 라 SKILL.md 본문 변경 없음. 대신 `scripts/lint-skills.ts` 에 `(?<!\/)pi-oven:...` lookbehind 적용하여 slash command 와 agent reference 를 구분. 이로써 broken 진단 0건, SKILL.md 의 사용자 인터페이스 (slash command trigger 와 본문 예시) 모두 보존.

---

## §6 Acceptance Criteria

**AC#1**: 15 SKILL.md 의 grep `pi-oven:[a-z-]+` 매핑 매트릭스가 §2.1 표 대비 다음 조건 만족:
- (a) 미연결 skill 개수: 8 → **0**.
- (b) broken reference: 5 → **0**.
- (c) unused agent 개수: 11 → **2 이하** (multimodal-looker, oracle 제외 잔여).

**AC#2**: 모든 SKILL.md 의 pi-oven agent reference 가 ROLES 23개 안에 있다 (CI lint 추가 검토 — `scripts/lint-skills.ts` 신설 후보).

**AC#3**: `bun test` / `bun run lint:agents` / `bun run check` / `bun run build` 모두 PASS 유지.

**AC#4**: 적용 후 사용자가 omp 에서 `/codebase-survey` 같은 skill 호출 시 SKILL.md 의 instruction 에 따라 main agent 가 `pi-oven:explorer` 등을 dispatch. 실제 dispatch 동작은 omp runtime 의 책임이며 본 spec 은 instruction 정의까지 보장.

---

## §7 Open Questions → Resolution (2026-05-29 자율 결정)

### §7.1 `pi-oven:team` self-reference → **N/A (slash command 였음)**

§2.3 재진단 결과 `/pi-oven:team` 은 slash command trigger 였고 agent reference 아니었음. team skill 본문 변경 없이 lint regex 만 수정. 향후 team coordinator agent (ROLES 확장) 가 실제로 필요해질 때 별도 spec 으로 결정.

### §7.2 multimodal-looker → **(b) designer skill 안 sub-dispatch**

designer 의 primary = `opencode-zen/glm-5.1` (vision no), qa-tester 의 primary = `opencode-zen/gemini-3.5-flash` (vision yes). designer 의 mockup-image-to-code 워크플로우에서 multimodal-looker 가 image → text 변환을 먼저 수행 (vision gap 보완). qa-tester 는 자체 vision 보유라 multimodal-looker 의무는 아니지만 multi-screenshot 비교 같은 복합 케이스에서 호출 가능.

### §7.3 oracle escalation → **autonomous-loop 2+ fail + fresh-verifier secondary fail**

oracle = 마지막 보루. trigger:
1. autonomous-loop 의 fix attempt 가 연속 2 회 실패한 후 (3 번째 시도 전 oracle consult)
2. fresh-verifier 의 secondary check 가 unverified 로 종결된 후 (final escalation)

pre-commit-gate 는 자체 gate 실패로 종결되므로 oracle escalation 대상 아님 (사용자가 직접 fix).

### §7.4 CI lint 신설 → **(yes) `scripts/lint-skills.ts` 추가**

lint-agents.ts 와 동일 패턴. SKILL.md frontmatter + body 의 `pi-oven:[a-z-]+` 토큰을 ROLES 23개 set 과 매칭. mismatch = violation, exit 1. CI 에서 `bun run lint:skills` 로 통합. `lint:agents` 와 `lint:skills` 가 SoT 정합 검증의 두 축.

### §7.5 적용 cycle → **이번 cycle 자율 적용** (사용자 자율실행 지시)

원래 draft 는 적용을 다음 cycle 로 분리하려 했으나 사용자 "나머지 스펙 작성, 플래너 크리틱, tdd 구현까지 자율 실행" 지시에 따라 이번 cycle 에서 적용까지 자율 진행. codex cross-vendor review 는 시간 비용 + 자율 모드 의 main self-verification 금지 정책 충돌로 skip — 대신 fresh-agent verifier 만 final gate.

---

## §8 적용 작업 결과 (이번 cycle, 자율 완료)

1. ✅ §7 open question 해소 (위 5건; §7.1 은 false positive 정정)
2. ✅ **8 미연결 SKILL.md 에 `## Agent Dispatch (omp)` 영어 섹션 append**:
   - brainstorming → metis / explorer / architect / writer
   - code-quality-discipline → code-reviewer / code-simplifier / security-reviewer / analyst
   - codebase-survey → explorer / tracer / document-specialist / librarian
   - pre-commit-gate → code-reviewer / security-reviewer / verifier / qa-tester / git-master + oracle escalation
   - spec-and-review → explorer / librarian / architect / document-specialist / critic / scientist
   - subagent-driven-development → planner / executor / verifier / code-reviewer
   - tdd-strict → test-engineer / executor / verifier / debugger + oracle escalation
   - writing-plans → metis / explorer / planner / architect / (metis-spawn) document-specialist / librarian
3. ✅ **`scripts/lint-skills.ts` 신설** + negative-lookbehind regex `(?<!\/)pi-oven:...` 로 slash command 와 agent reference 구분
4. ✅ **`package.json scripts.lint:skills`** = `bun scripts/lint-skills.ts`
5. ✅ **검증**: `bun run lint:agents` (PASS), `bun run lint:skills` (PASS, 0 violation), `bun test` (149 pass / 0 fail), `bun run check` (PASS), `bun run build` (PASS).
6. ✅ **AC#1**: 미연결 8 → 0; broken 5 → 0 (lint regex 정정); unused agent 11 → 2 (multimodal-looker, oracle 의 일부 path 만 매핑됨; §7.2 / §7.3 의 잔여 work 는 다음 cycle).
7. ✅ **AC#2**: 모든 SKILL.md 의 `pi-oven:` agent reference 가 ROLES 안에 있음 (lint-skills 가 CI gate 로 enforce).
8. ✅ **AC#3**: 모든 verify command PASS.
9. ✅ **AC#4**: SKILL.md instruction 정의 완료 (실제 runtime dispatch 동작 보장은 omp 책임).

### 다음 cycle 잔여 → 자율 cycle 2 추가 적용 (2026-05-29)

- ✅ **§7.2 multimodal-looker sub-dispatch** — `agents/pi-oven-designer.md` 의 "Mockup-to-Implementation Handoff" 섹션에 image input → `pi-oven:multimodal-looker` 첫 단계 dispatch instruction 추가; `agents/pi-oven-qa-tester.md` 의 "Playwright Visual Verification" 섹션에 compound visual diff 케이스 (multi-screenshot, multi-viewport, diagram, PDF) 의 `pi-oven:multimodal-looker` sub-dispatch 추가.
- ✅ **§7.3 oracle escalation 확장** — `skills/autonomous-loop/SKILL.md` Resilience 섹션에 "2 consecutive fix attempts failed → dispatch pi-oven:oracle before third attempt" 명시; `skills/fresh-verifier/SKILL.md` Q-VERIFIER-FAIL action 에 "dispatch pi-oven:oracle for final strategic consultation before halt" 명시. pre-commit-gate + tdd-strict 의 기존 oracle escalation 과 함께 4 surface (pre-commit-gate / tdd-strict / autonomous-loop / fresh-verifier) coverage.
- ✅ **CI workflow lint:skills 통합** — `.github/workflows/ci.yml` 의 `Lint pi-oven agent files` step 다음에 `Lint pi-oven skill files` step 추가. push/PR 시점에 `bun run lint:agents + lint:skills` 둘 다 강제.
- ⏸ **PROFILE_B 정의 재고** — 자율 결정 보류. PROFILE_B 의 본질이 "anthropic primary 우선" 인데 새 PROFILE_A 가 anthropic 4 role 사용하면서 차별성 약화. 옵션: (a) PROFILE_B 폐기 (PROFILE_A 만), (b) PROFILE_B = anthropic 100% primary 로 재정의, (c) PROFILE_B = "Pro/Max Heavy" — 모든 advisory + coding role 도 anthropic primary. 코드 변경 영향 큼 (profiles.ts PROFILE_B map + spec B §5 + 23 agent file frontmatter Profile B 분기). 사용자 명시 결정 후 진행. 본 cycle 에서는 spec memo only, profiles.ts PROFILE_B 자체 미변경.

---

## §8 다음 cycle 작업 목록

1. **spec-and-review codex review** — 본 draft 를 spec-and-review skill 로 cross-vendor review (codex consult, BLOCKER / NIT 분류).
2. **§7 open question 해소**:
   - §7.1 team self-reference 결정
   - §7.2 multimodal-looker dispatch 위치
   - §7.3 oracle escalation pattern (어떤 skill 어떤 step)
   - §7.4 CI lint 신설 여부
3. **적용**: 15 SKILL.md edit + (선택) `scripts/lint-skills.ts` 추가 + 적용 후 `bun run lint:agents + lint:skills + test + check + build` PASS.
4. **agent count revisit**: ROLES 23 에 `pi-oven:team` 추가 여부 결정 후 PROFILE_A 도 동기화 (§7.1 (c) 선택 시).
