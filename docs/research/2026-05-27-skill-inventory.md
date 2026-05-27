# pi-oven Skill Inventory (4-source 전수조사)

- **Date:** 2026-05-27
- **Status:** WIP — oh-my-openagent 아직 미조사 (사용자 clone 대기)
- **Goal:** pi-oven v1 에 채택할 omp-native skill 셋 후보 정리

---

## Sources

| Source | Path | Count |
|---|---|---|
| pi-oven | `~/work/personal/pi-oven/skills/` | 18 skills |
| superpowers | `~/.claude/plugins/cache/claude-plugins-official/superpowers/5.1.0/skills/` | 14 skills |
| OMC skills | `~/.claude/plugins/cache/omc/oh-my-claudecode/4.14.3/skills/` | 41 skills |
| OMC agents | `~/.claude/plugins/cache/omc/oh-my-claudecode/4.14.3/agents/` | 19 agents |
| oh-my-openagent | (pending user clone) | ? |

---

## Tier 1 — MUST-HAVE (사용자 명시)

| Source | Name | 역할 | omp 매핑 노트 |
|---|---|---|---|
| superpowers | `subagent-driven-development` | implementation plan 을 fresh subagent 로 task-by-task 실행 + 리뷰 | omp `task` tool 또는 worker spawn |
| superpowers | `brainstorming` | 아이디어 → spec → 사용자 승인 (HARD GATE) | omp slash command / 직접 사용 |
| superpowers | `test-driven-development` | Red→Green→Refactor 강제 | omp test 러너 + bash tool |
| OMC | `deep-dive` | trace + deep-interview 파이프라인 | omp task + Socratic dialog |
| OMC | `deepinit` | AGENTS.md hierarchical 초기화 | omp ast_grep + file tools |
| OMC | `autopilot` | 아이디어 → working code 완전 자율 | omp ralph-style loop |
| OMC | (agents 19개) | analyst/architect/critic/debugger/executor/explorer/writer/... | omp provider routing + task tool 로 재구현 |
| pi-oven | (전체 18개) | commit gate / autonomous boundary / spec-and-review / etc. | omp 환경에 맞게 트리거/훅 재배선 필요 |

## Tier 2 — HIGH-VALUE (Tier 1 의 enabler)

| Source | Name | 채택 근거 |
|---|---|---|
| superpowers | `writing-plans` | brainstorming 다음 단계, spec-and-review 와 호환 |
| superpowers | `executing-plans` | subagent-driven-development 의 inline 변형 |
| superpowers | `using-superpowers` | skill 호출 메타 룰. omp 환경에 맞춰 rewrite |
| superpowers | `verification-before-completion` | pre-commit-gate Gate 5 와 자연 결합 |
| superpowers | `using-git-worktrees` | parallel agent 격리 |
| superpowers | `dispatching-parallel-agents` | omp 의 worker 다중 spawn 패턴화 |
| OMC | `ralph` | autonomous loop. autonomous-loop 와 페어 |
| OMC | `ralplan` | ralph entry gate (consensus planning) |
| OMC | `plan` | strategic planning + interview |
| OMC | `team` | N agents on shared task list |
| OMC | `verify` | post-change verification |
| OMC | `cancel` | autopilot/ralph/team mode 종료 |
| OMC | `deep-interview` | Socratic ambiguity gating |
| OMC | `ai-slop-cleaner` | regression-safe slop 청소 |

## Tier 3 — NICE-TO-HAVE (v2 후보)

| Source | Name | 후보 사유 |
|---|---|---|
| superpowers | `systematic-debugging` | OMC `debug` 와 겹침 — 하나만 채택 |
| superpowers | `finishing-a-development-branch` | merge/PR decision 가이드 |
| superpowers | `requesting-code-review`, `receiving-code-review` | code review 워크플로 |
| superpowers | `writing-skills` | skill 작성 dogfood |
| OMC | `ultrawork`, `ultraqa`, `ultragoal` | 고동시성 워크플로 |
| OMC | `ccg` | Claude-Codex-Gemini 트라이 |
| OMC | `autoresearch` | mission-based 개선 루프 |
| OMC | `wiki` | persistent knowledge base |
| OMC | `sciomc`, `self-improve`, `learner`, `skillify` | 메타 워크플로 |
| OMC | `project-session-manager` | worktree+tmux dev env |
| OMC | `trace`, `debug` | tracing/debugging lane |
| OMC | `external-context`, `mcp-setup`, `ask` | infra |
| OMC | `release`, `remember`, `skill`, `visual-verdict`, `omc-teams` | 보조 워크플로 |

## Tier 4 — OUT-OF-SCOPE (또는 omp-native 가 이미 처리)

| Source | Name | 사유 |
|---|---|---|
| OMC | `writer-memory` | 픽션 작가용 — pi-oven 무관 |
| OMC | `omc-reference`, `omc-setup`, `omc-doctor`, `setup` | OMC 자체 부트스트랩 — pi-oven 는 자체 인스톨러 |
| OMC | `hud`, `configure-notifications` | Claude Code UI 전용 |

---

## OMC agents/ 디렉토리 (19개)

`analyst.md`, `architect.md`, `code-reviewer.md`, `code-simplifier.md`, `critic.md`, `debugger.md`, `designer.md`, `document-specialist.md`, `executor.md`, `explore.md`, `git-master.md`, `planner.md`, `qa-tester.md`, `scientist.md`, `security-reviewer.md`, `test-engineer.md`, `tracer.md`, `verifier.md`, `writer.md`

이들은 SKILL.md 가 아닌 subagent 프로파일 (model routing + system prompt + tool allow list). omp 의 task tool 호출 시 어떤 provider/model 로 dispatch 할지를 정의. pi-oven 에선:
- agent 프로파일을 omp 의 `agents/` 등가 dir (있다면) 에 둠
- 없으면 우리 SKILL.md 내부에서 `task` tool 호출 시 model 명시 (`sonnet` / `opus` / `haiku`)

---

## pi-oven 18 skills (전부 Tier 1)

| Skill | 핵심 책임 |
|---|---|
| autonomous-boundary | autonomous mode 진입/할트 룰 + 3-slot branch 계약 |
| autonomous-loop | rate-limit 폴링, /compact 자동, multi-plan 연속 |
| background-monitoring | 백그라운드 task 소유권 + stuck threshold |
| codebase-survey | pre-planning 8-step 서베이 (CRG + deep read) |
| codex-handoff | codex CLI 호출 5 hard rule + E0-E4 ladder |
| fix-scope-expansion | callsite 전수 / Gate 4.5 |
| freshness-guard | stale 메타 doc 자동 fix / Gate 0.5 |
| large-task-delegation | 3+ 파일 / 200+ LoC → opus/sonnet 라우팅 |
| playwright-verification | Gate 4 UI smoke + OAuth click-through |
| pre-commit-gate | Gate 0/0.5/1/1.5/1.6/2/3/3.5/4/4.5/5 |
| pre-merge-sync | gh pr create 전 체크리스트 |
| production-access | prod / 외부 인프라 접근 boundary |
| regression-memory | gstack /learn JSONL recall + decay |
| spec-and-review | spec/plan/design + cross-vendor codex review |
| test-coverage | TDD strict + 100% touched-file coverage |
| tool-retry | Edit/Write/Bash auto-retry + Q-TOOL |
| user-queue | autonomous run ambiguous-decision queue |
| web-loop | web page improvement P0/P1/P2 loop |

각 스킬은 omp 환경에서 다음을 재배선해야:
- Claude-side 명시 호출 (`Skill("oh-my-claudecode:critic")`) → omp 의 multi-provider routing + task tool
- MCP 의존 (code-review-graph MCP, Playwright MCP) → omp 의 내장 tool 또는 shell-out
- UserPromptSubmit hook → omp 의 message-pre hook 또는 slash command
- codex CLI shell-out → omp 내부 provider 디스패치 (ChatGPT-sub → opencode-zen)

---

## 미해결 (오픈 항목)

1. **oh-my-openagent 전수조사** — 사용자 clone 후 진행. 그 산출물이 위 표 어느 tier 로 들어갈지 결정 필요.
2. **OMC agents 채택 방식** — 19개 전부 vs 핵심 6-8개 (executor / critic / architect / explorer / writer / debugger / verifier / planner) 만?
3. **pi-oven skill 본문 재작성 깊이** — 완전 rewrite vs 적용 부분 (Claude 명령) 만 패치?
4. **omp 의 skill 자동 디스커버리 + hook API** — 새 spec 작성 전 omp 본체 한 번 더 확인 필요.

---

## 다음 단계

1. 사용자가 oh-my-openagent clone → 4-source 인벤토리 완성
2. tier 합의 (1/2/3/4 라인 조정)
3. 새 spec 작성 (Thin Bundle 폐기, omp-native skill set 구조)
4. 새 Plan 1/2/3 작성
