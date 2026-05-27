# pi-oven v1 Foundation Design

- **Date:** 2026-05-27
- **Status:** DRAFT — brainstorm output, awaits `writing-plans` + Phase 0
- **Authors:** kimzerokim + Claude (Opus 4.7 1M)
- **Source:** brainstorming session 2026-05-27 (Q1-Q6 + 3 design axioms + 5 sections)

---

## Executive Summary

**pi-oven v1 = single omp marketplace plugin** that re-implements a curated subset of workflow patterns from 5 frozen sources (oh-my-claudecode, oh-my-openagent, Matt Pocock skills, superpowers, pi-oven) as an **omp-native discipline + workflow orchestration layer**.

Value proposition: **omp tool ceiling × omo/omc/superpowers/pi-oven workflow ceiling**. The new project is the single successor for all five sources (they are frozen). Distribution = `omp plugin install pi-oven@pi-oven`. No commercial layer, no marketplace operator role; we are a single plugin publisher.

---

## Design Axioms

### Axiom 1 — Tool × Workflow Ceiling

pi-oven 의 가치 = **omp 의 tool 성능** (edits land first attempt, summarized reads, in-process search/LSP/DAP) × **omo + omc + superpowers + pi-oven 의 workflow orchestration pattern** (ralph autonomous loop / team mode / cross-vendor critic / pre-commit gate / fresh-verifier). 단순 skill port 가 아니라 workflow PATTERN 의 omp-native 재구현.

### Axiom 2 — OpenCode Zen First + Native Key Opt-In

v1 default routing = OpenCode Zen 키. native API key (Anthropic / OpenAI / xAI) opt-in. 모델 선정 phase 는 Zen 으로 다양 시도, 선정 후 native key 전환. **Performance tuning 인프라 (benchmark + model role swap + A/B 비교) 가 v1 first-class** — `/pi-oven:benchmark` slash command + eval runner.

### Axiom 3 — Codex OAuth 헤비 + Anthropic Native-Only-Paid

OpenAI Codex (OAuth 구독, omp 내부 directly routed) + OpenCode Zen 양대 default. Anthropic Pro/Max 가 3rd party 호출 불가 → native API key (token billing) 만 opt-in. cross-vendor critic 도 이 둘 + Zen 안의 GLM/Qwen/Kimi 등으로 충분.

---

## Brainstorm Decisions

| # | Topic | Decision |
|---|---|---|
| Q1 | Identity | **Successor** — 5 sources (omc / omo / Pocock / superpowers / pi-oven) 모두 frozen. pi-oven 가 단일 후계 layer + 좋은 점 흡수 |
| Q2 | Surface | **omp-only** — TS extension + markdown skill. Claude Code 동작은 omp cross-harness 디스커버리 부산물 (maintenance 책임 X) |
| Q3 | Scope | **Standard ~45 skills** — 매일 워크플로 풀세트 (pi-oven 18 + tier-1/2 흡수) |
| Q4 | Implementation | **Hybrid** — SKILL.md primary + TS extension for hooks/gates |
| Q5 | Workflow form | **Both** — single autonomous loop + multi-agent team mode 둘 다 v1 |
| Q6 | Architecture | **Approach B — omp-idiomatic rewrite** (distributed SoT, no harness-share.md hub, omp internal cross-vendor critic) |

---

## Section 1 — Component Map & SoT Model

### 7 Components

1. **`skills/<name>/SKILL.md` (~45)** — self-contained, distributed SoT. omp native provider priority 100. Pocock category 폴더 평탄화.
2. **`.omp/extensions/pi-oven.ts`** — single TS extension entry. Hook 영역: `tool_call / tool_result / agent_start / agent_end / turn_start / session_* / ttsr_triggered`. 책임: workflow orchestration state machine (single loop + team mode), 10-stage pre-commit gate, autonomous boundary 3-slot contract, fresh-verifier mandatory exit, per-agent disallowedTools enforcement, fact-force gate, config protection, MCP health check, eval checkpoint, cost tracker.
3. **`agents/<name>.md` (14 markdown profiles)** — 8 core (executor / critic / verifier / explore / planner / writer / designer / debugger) + 6 ECC 흡수 (harness-optimizer / silent-failure-hunter / pr-test-analyzer / refactor-cleaner / docs-lookup / code-explorer). v2 deferred: performance-optimizer / a11y-architect.
4. **`commands/<name>.md` (~23 slash commands)** — `setup / benchmark / doctor / autonomous / mode / context / state-query / memory-route / save-session / resume-session / learn / new-skill / reference / eval / eval-all / eval-trend / team / team-shutdown / harness-audit / quality-gate / loop-start / loop-status / skill-create / security-scan / cost-report`.
5. **`rules/` (TTSR rule pack)** — keyword detector (autonomous-mode triggers), forbidden command guard (`rm -rf` / force-push without confirm), branch-contract reminder injection, immutability-first, security-pre-commit, research-before-code, proactive-agent-dispatch, TDD-mandatory.
6. **`models.yml`** — default routing: OpenAI Codex (OAuth) primary, OpenCode Zen secondary, Anthropic native opt-in. role-specific (`default / smol / slow / plan / commit`) + per-provider fallback chains + path-scoped overrides.
7. **`README.md` + setup wizard** — 1-line install + key detection + first-run setup.

### SoT model (per-skill, no hub doc)

- 각 SKILL.md self-contained. **No `harness-share.md` hub** (Approach B). 룰 중복 감수, hub 단일점 의존 회피.
- SKILL.md body **target ≤ 500 단어 compressed format** (호출 시 token cost 통제), **hard cap 800 lines** (invariant audit, CI enforce).
- 깊은 context: `skills/<name>/references/<topic>.md` — omp `skill://pi-oven/<name>/references/<topic>.md` URL 로 lazy-load. 일반 호출 path 에는 안 들어옴.
- Shared discipline (TDD strict / autonomous boundary / 10-stage pre-commit gate / cross-vendor critic / fresh-verifier) 은 **3 layer 로 enforce**:
  - TS extension event-level enforcement (block / inject / dispatch)
  - TTSR rule pack text-level enforcement (keyword 감지 후 system-reminder 주입)
  - SKILL.md inline boilerplate (사람-readable 문서, DRY 손실 trade-off 수용)
- **Versioning**: SKILL.md `version:` frontmatter (pi-oven 패턴) + plugin level `package.json` version.

### MCP Integration

- **Required**: `github` (PR), `Context7` (docs lookup, omp 이미 보유)
- **Opt-in (setup wizard 자동 감지)**: `jira` / `firecrawl` / `vercel` / `cloudflare` / `supabase`
- **Defer v2**: `omega-memory` / `longhand` / `sequential-thinking`

---

## Section 1-bis — Skill Evaluation Infrastructure

1. **`evals/<skill>/scenarios/*.yaml`** — `smoke / regression / adversarial / pressure-test / canary` 태그.
2. **`scripts/run-eval.ts`** — omp SDK (`createAgentSession` + `ModelRegistry`) 활용. RPC mode 또는 SDK embed.
3. **Slash commands**: `/pi-oven:eval <skill>` / `/pi-oven:eval-all [--tag <tag>]` / `/pi-oven:benchmark <task>` (model × skill matrix) / `/pi-oven:new-skill <name>` (scaffold; **eval 없이 skill 추가 불가 강제**).
4. **Result schema (JSON)**: `{ skill, scenario, model, provider, passed, latency_ms, token_in, token_out, cost_usd, tool_calls[], observations[] }`.
5. **CI**: `.github/workflows/eval.yml` — PR 마다 `smoke + regression` (5-15분), nightly full suite, `workflow_dispatch` benchmark matrix. artifacts: `eval-results.jsonl`, `benchmark-matrix.md`, `adversarial-failures.md` (failed → auto-issue).
6. **History**: `docs/eval/history/<date>-<run-id>.jsonl` (사용자 working repo) + plugin source `.github/` artifacts (CI run).
7. **Trend**: `/pi-oven:eval-trend <skill>` 가 누적 history 에서 latency / pass-rate / cost 추이.
8. **Skill upgrade gate**: SKILL.md `version:` bump 시 해당 skill 의 eval suite 자동 run. 회귀 검출 시 bump revert.

---

## Section 1-ter — Self-Evaluating Migration Cycle (Dogfood Loop)

### Per-skill migration cycle (every plan step = this shape)

```
For each skill in migration backlog:
  Phase 1 — Source analysis           [explore subagent]
  Phase 2 — Draft                     [writer subagent sonnet]
            SKILL.md + references + evals/<skill>/scenarios/{smoke,adversarial,regression}.yaml
  Phase 3 — Eval                      [scripts/run-eval.ts via omp SDK]
            smoke (default role) + cross-vendor benchmark (Zen 다양)
  Phase 4 — Verdict gate
            smoke PASS + adversarial PASS  → Phase 5
            smoke FAIL → fix loop (max 3 cycles, then Q-MIGRATION-HALT)
            adversarial FAIL → 'weak' tag, plan issue, 계속 진행
            cross-vendor 불일치 → model-routing 조정 추천 입력
  Phase 5 — Commit + log              [git + evals/.history/]
            다음 skill 진입
```

### Dogfood phasing (chicken-and-egg 해결)

- **Bootstrap phase** (pi-oven 미동작): main agent = Claude Code (지금 이 session). 활용: pi-oven 기존 skill. pi-oven = build target.
- **Maturity threshold**: Plan 1 의 12 core skill eval PASS.
- **Dogfood switch**: 이후 cycle 의 main agent = omp + 설치된 pi-oven v0.x. Claude Code 의존 → omp 의존.
- **Self-improvement phase (post-v1)**: pi-oven 가 자기 eval history 보고 weak skill 식별 → fix 제안 → user review → commit (omc self-improve / sciomc 패턴).

### Plan 구조 (writing-plans 단계 미리보기)

- **Plan 0** — Scaffold: marketplace plugin 구조 + extension skeleton + eval-runner + 첫 3 slash command + models.yml + README stub
- **Plan 1** — Bootstrap 12 core skills: autonomous-loop, codebase-survey, spec-and-review, large-task-delegation, pre-commit-gate, fresh-verifier, eval-runner-skill, brainstorming, writing-plans, TDD, subagent-driven-development, code-quality-discipline
- **Plan 2** — Standard expansion (~33 skill, dogfood mode)
- **Plan 3** — Workflow orchestration TS extension: single autonomous loop + multi-agent team mode + gate state machine + per-agent disallowedTools
- **Plan 4** — Polish + release: setup wizard, OpenCode Zen / Codex OAuth / Anthropic native key onboarding, CI eval pipeline, benchmark suite, marketplace catalog publish

각 Plan 의 step 은 위 per-skill cycle 모양 (Plan 2 가 가장 많은 cycle).

---

## Section 2 — Workflow Orchestration Data Flow

### (A) Single Autonomous Loop

**Entry**: TTSR keyword ("끝까지 끝내줘" / "ralph로 돌려" / "자율실행" / "ralph") 또는 `/pi-oven:autonomous <task>`.

**State machine** (extension-owned, `.pi-oven/state/autonomous.json` persisted):

```
IDLE → AWAITING_CONTRACT  [ask: destination / branch / PR 3-slot]
     → ACTIVE
       → [survey → spec+critic → plan dispatch → commit + Gate 0-5 → verifier]
       → CYCLE_COMPLETE
         → ACTIVE (next cycle if work remains)
         → EXIT (all done / verifier FAIL / halt-keyword)
```

**Per-cycle work** (각 step = omp `task` 한 번):
1. Codebase survey — explore subagent (sonnet)
2. Spec + critic — writer subagent (sonnet) draft + cross-vendor critic via omp multi-provider (Codex + Zen 다양 model 동시 task fan-out, verdict aggregate)
3. Plan dispatch — executor subagent (sonnet)
4. Pre-commit gate — extension intercepts `pi.on('tool_result')` Bash `git commit`, Gate 0-5 sequential (실패 시 block + reason)
5. Fresh-verifier — opus subagent, mandatory exit gate (extension `pi.on('agent_end')` block transition until verifier dispatched)

**Resilience (omo Sisyphus + ECC 흡수)**:
- subagent ≥ 5min no progress → kill + diagnose + retry
- first-prompt-watchdog 90s (cold-start failure 빠른 회수)
- main turn idle ≥ 3min → wake-up
- context 50% → 자동 `/compact` + autocontinue (manual stop 없음)
- 5h API window 초과 → ScheduleWakeup
- polite-stop TTSR detect + force continue
- runtime-fallback reactive (provider error → 다음 provider)

### (B) Multi-Agent Team Mode

**Entry**: `/pi-oven:team create <name> --members=N` (N ∈ 2-8) 또는 autonomous loop 안에서 "decomposable parallel" 판단 + user confirm.

**Storage layout** (omo 패턴 흡수):
```
.pi-oven/teams/<name>/
  ├ config.json
  ├ state.json
  ├ mailbox/<from>/<to>/<seq>.json
  ├ tasklist.jsonl
  └ worktrees/<member>/    # omp EnterWorktree
```

**Coordination**:
- omp `task` worker dispatch (background, own worktree, per-model concurrency cap from omo BackgroundManager)
- omp `irc` (in-process broadcast) + extension mailbox (persistent cross-session)
- omp `todo_write` shared list + extension sync to `tasklist.jsonl`
- extension `mailbox-poll` (3s) → 받는 worker 에 system-reminder inject
- ParentWakeNotifier event (worker 완료 → main wake, sleep/poll 대신)

**Shutdown**: `/pi-oven:team shutdown <name>` → worker idle 확인 (max wait 60s, force after) → state.json 마무리 commit → worktree 정리 (사용자 선택) → terminate.

### Primitive Mapping (요약)

| pi-oven 워크플로 element | omp primitive |
|---|---|
| 3-slot branch contract | `ask` tool |
| codebase survey | `task` + explore agent (sonnet) |
| cross-vendor critic | omp `ModelRegistry` + multi-provider routing (Codex + Zen fan-out) |
| pre-commit Gate 0-5 | extension `pi.on('tool_result')` on Bash `git commit` |
| fresh-verifier mandatory exit | extension `pi.on('agent_end')` block until verifier dispatched |
| team worker spawn | `task` (background) + `EnterWorktree` isolation |
| inter-agent comms | `irc` (in-process) + extension mailbox (persistent) |
| shared task list | `todo_write` + extension sync to `tasklist.jsonl` |
| state persistence | `pi.appendEntry()` + `.pi-oven/state/<name>.json` |
| autonomous keyword trigger | TTSR rule pack |
| dynamic discipline reminder | extension `pi.on('turn_start')` + system-reminder |
| stuck detection | extension turn-timing watcher |
| auto-`/compact` at 50% | extension `ctx.getContextUsage()` + `ctx.compact()` |
| per-agent disallowedTools | extension `pi.on('tool_call')` + agent-id check (omp 에 native 없음) |
| fact-force gate (ECC) | extension `pi.on('tool_call', edit)` first-edit-per-file investigation |
| config protection | extension `pi.on('tool_call', edit)` config-file path detect |
| continuous learning observer | extension async `pi.on('tool_result')` → instinct candidate |
| MCP health check | extension `pi.on('tool_call', mcp)` server health probe |
| eval checkpoint | extension `pi.on('session_before_compact')` state save + eval baseline |
| cost tracker | extension `pi.on('turn_end')` SQLite cost_tracker append |

---

## Section 3 — Memory & Session Continuity (4-Layer)

```
Layer 1: omp Hindsight memory
  preference / debug note / temp context
  API: retain / recall / reflect

Layer 2: .pi-oven/state/                (runtime, gitignore default)
  state/autonomous.json          autonomous loop state machine
  state/gate-cache.json          pre-commit Gate 0-5 result cache
  state/fix-scope-cache.json     CRG-replacement cache
  teams/<name>/                  team mode runtime (config/state/mailbox/tasklist/worktrees)
  regression-sidecar.json        regression memory metadata
  cache/                         freshness scan, eval intermediate
  logs/                          extension internal logs

Layer 3: .pi-oven/state/store.sqlite    (structured event store)
  cost_tracker (ts, agent, model, provider, tokens_in/out, cost_usd)
  session_event (ts, type, payload)
  governance_event (ts, type, payload)   secrets/policy/approval audit
  learn_extraction (session_id, pattern, confidence, status)
  gate_result (ts, gate_id, status, reason, file_path)
  eval_run (ts, skill, scenario, model, passed, latency, cost)
  API: /pi-oven:state query <sql>

Layer 4: docs/                          (human-readable SoT, git-tracked)
  WORKING-CONTEXT.md          current sprint / blockers / latest exec notes
  SOUL.md                     project identity + principles
  contexts/<mode>.md          dev/research/review/autonomous mode profile
  decisions/<NNNN>.md         user decisions (explicit)
  instincts/<name>.md         learned patterns (continuous-learning-v2)
  adr/<NNNN>.md               architecture decisions
  harness/surveys/<date>-<topic>-survey.md  codebase surveys
  harness/user-queue.md       autonomous run ambiguous-decision queue
  harness/harness-flow-progress.md         meta cycle tracking
  plans/<name>.md             implementation plans
  plans/<name>-critic-review.md            critic verdicts
  specs/<date>-<topic>-design.md           design specs (this brainstorm output)
  research/<date>-<topic>.md  research notes
  eval/history/<date>-<run-id>.jsonl       user-project eval run history
```

### Consistency 메커니즘 (extension 책임)

1. **Memory router** — 자동 분류:
   - preference / debug → Layer 1 (Hindsight)
   - cycle / gate event → Layer 3 (SQLite)
   - decision → Layer 4 `docs/decisions/<NNNN>.md`
   - instinct → Layer 4 `docs/instincts/<name>.md`
   - working-context update → Layer 4 `docs/WORKING-CONTEXT.md`
   - architecture → Layer 4 `docs/adr/<NNNN>.md`
   - **duplicate detection**: 이미 다른 layer 에 있는 내용 → link only, 본문 중복 금지

2. **Session start hook** (`pi.on('session_start')`):
   - Layer 4 hot SoTs (WORKING-CONTEXT + SOUL + 현재 mode context) **압축 inject** to system prompt
   - Layer 1 Hindsight project-scoped recall (recent N)
   - Layer 3 unresolved user-queue entries

3. **Session end hook** (`pi.on('session_shutdown')`):
   - turn log 분석 → instinct candidate + WORKING-CONTEXT update proposal
   - user review gate (auto-commit X)
   - Layer 3 SQLite session event 누적 (auto)

4. **Slash commands**: `/pi-oven:save-session [name]` / `/pi-oven:resume-session [name]` / `/pi-oven:mode <name>` / `/pi-oven:learn` / `/pi-oven:memory route <what>` / `/pi-oven:state query <sql>` / `/pi-oven:context`.

5. **CI consistency check** (extension audit, CI step):
   - WORKING-CONTEXT.md latest exec note ≥ 1주일 stale → warn
   - decisions/ vs ADR contradiction → fail
   - instincts/ stale ≥ 90일 → archive proposal

---

## Section 4 — Install Lifecycle + Setup Wizard

### Pre-install

- omp 설치 (`curl -fsSL https://omp.sh/install | sh` 또는 `bun install -g @oh-my-pi/pi-coding-agent`)
- bun ≥ 1.3.14
- git
- provider 키 1개 이상 (Codex OAuth / Zen / Anthropic native)

### Install (한 줄)

```sh
omp plugin marketplace add kimzerokim/pi-oven
omp plugin install pi-oven@pi-oven
```

### Catalog (`.claude-plugin/marketplace.json`)

- catalog 가 plugin source self-reference (`source.source = "git-subdir"`, `path = "."`)
- `plugins[]` = 1 entry (pi-oven 자신). single plugin layer (Q1 결정)

### Setup wizard 7 step (`/pi-oven:setup`)

```
1. Provider key detection (Codex OAuth / Zen / Anthropic optional)
2. Model role config → models.yml (default=Codex GPT-5, smol=Zen GLM-4.5-flash, slow=Codex o3, commit=smol)
3. First benchmark (optional) — 모델 × skill matrix
4. docs/ skeleton (WORKING-CONTEXT / SOUL / contexts/dev,research,review,autonomous / decisions / adr / ...)
5. Hook + TTSR activation (default ON 8 hooks + 4 TTSR rule packs, 토글 가능)
6. MCP server detection + opt-in (github/Context7 required, jira/firecrawl/vercel opt-in)
7. /pi-oven:doctor 자동 sanity check
```

### Scope strategy

- **Default user** (omp v15.5.3 observed: `~/.omp/plugins/cache/plugins/pi-oven___pi-oven___<version>/`) — 모든 프로젝트에서 사용 가능. pi-oven 권장.
- **Opt-in project** (project-scope install — omp 가 `.omp/plugins/` 의 사용자 plugin 디렉토리에 cache) — 특정 프로젝트 격리. omp 표준대로 project scope 가 user scope 의 동일 plugin shadow.

### Upgrade / Uninstall / Idempotency

- **Upgrade**: 같은 명령 재실행 → omp 가 catalog 새 sha 감지 → bun install → lockfile 갱신 → migration hook (state schema forward migrate)
- **State schema**: 항상 forward-compatible (additive only)
- **Rollback**: `omp plugin install pi-oven@1.0.0@pi-oven` (version pin)
- **Uninstall**: omp 표준. `.pi-oven/` 자동 삭제 X (사용자 직접). `docs/` 그대로 (git-tracked 자산)
- **Idempotency**: `~/.omp/plugins/installed_plugins.json` (v2 schema, observed in omp v15.5.3 — `omp-plugins.lock.json` 가정은 outdated docs 의 npm-style plugin manager path) + SKILL.md version 비교 + atomic install + idempotent setup wizard. 자세한 layout: `docs/instincts/omp-install-layout.md`.

### Cross-harness 부산물 (maintenance 책임 X)

- omp 가 `.claude/` `.cursor/` `.codex/` `.gemini/` `.opencode/` `.cline/` `.windsurf/` 자동 디스커버리 (priority 100/80/70/...)
- pi-oven markdown 자원 (skills / agents / commands / rules) 은 Claude Code 에서도 자동 동작 (best-effort, 우리가 maintain 안 함)
- TS extension (`.omp/extensions/`) 은 omp-only — pre-commit Gate / autonomous boundary / fresh-verifier / per-agent disallowedTools 같은 시그니처 hook 은 Claude Code 에서 안 동작
- 약 60-65% 자원이 cross-harness 자동 호환, **35-40% (시그니처) omp-only**

---

## Section 5 — Testing / Verification Strategy

### Eval scenario categories

- **`smoke`** — happy path 1-2 turn. PR 마다 CI. <30s.
- **`regression`** — 과거 버그. release 마다 nightly. fail = release block.
- **`adversarial`** — skill 을 잘못된 컨텍스트에 던짐 (polite stop / gate bypass / verifier skip / fact-force evasion). discipline robustness 측정.
- **`pressure-test`** — multi-turn 적대적 사용자 5-10 turn. LLM-as-judge.
- **`canary`** — production-like task end-to-end (예: 실제 React component 추가 + test + commit).

### Acceptance threshold

- smoke pass rate ≥ 95% (3 회 run 평균)
- adversarial pass rate ≥ 80% (Codex GPT-5 기준, 모델별 차이 허용)
- p95 latency ≤ 30s (smoke), ≤ 180s (canary)
- per-skill cost budget (예: TDD-strict 1회 호출 ≤ $0.10)
- regression pass rate = 100% (absolute)

### CI integration

```
.github/workflows/eval.yml
├── on: pull_request    → smoke + regression suite (5-15분)
├── on: schedule nightly → full suite (smoke + regression + adversarial + pressure + canary)
├── on: workflow_dispatch → /pi-oven:benchmark matrix (model × skill)
└── artifacts:
    ├── eval-results.jsonl  (push to docs/eval/history/ via separate commit)
    ├── benchmark-matrix.md
    └── adversarial-failures.md  (failed → auto-issue)
```

### TS extension invariant audits (CI step)

```ts
test('every SKILL.md has version: frontmatter')
test('every skill has at least 1 smoke scenario in evals/')
test('no pi.on() called outside extension entry')
test('all worker spawns go through ParentWakeNotifier gate')
test('all internal message dispatch goes through prompt-async-gate')
test('every agent in agents/ has model: / tools: / spawns: frontmatter')
test('no SKILL.md body > 800 lines (compressed format rule)')
```

### End-to-end dogfood test (v1.0.0 release gate)

```
v1.0.0-rc1 install된 pi-oven 가:
1. "새 skill pi-oven-followup-skill 추가" task 받음
2. /pi-oven:autonomous 모드 진입
3. ASK-FIRST 3-slot contract → user confirm
4. survey → spec-and-review → plan → execute → pre-commit gate → fresh-verifier
5. 새 skill 의 eval scenarios PASS
6. commit + push + PR 생성
7. CI eval suite PASS
→ user merge → v1.0.0 GA
```

이 통과 = **dogfood loop production-ready** 증명.

---

## v2 Deferred

1. **ecc2-style dashboard** (multi-session orchestration daemon, Rust)
2. **`/multi-execute`** (external Codex/Gemini fallback parallel worker)
3. **omega-memory MCP** (semantic agent memory)
4. **longhand session history indexing** (post-compaction recovery)
5. **npm mirror publish** (`@pi-oven/pi` direct install path)
6. **performance-optimizer / a11y-architect agents**
7. **Claude Code 호환 maintenance** (현재 best-effort, 명시화 시점 미정)

---

## Explicit Rejects

| Item | Reason |
|---|---|
| 40+ language-specific agents (csharp, kotlin, rust, ...) | out-of-scope harness layer; 별도 marketplace plugin |
| OpenCode plugin port | Q2 omp-only 결정과 충돌 |
| IDE/platform configs (Tkinter dashboard, Trae/Zed/Qwen 등) | out-of-scope |
| Risk-scoring system (다른 plugin 평가) | single-plugin scope 외 |
| Multi-harness plugin composition | Q2 충돌 |
| 5-tier hook composition (omo) | single TS extension 충분 |
| Hashline LINE#ID hash | omp `ast_edit` 이미 보유 |
| IntentGate keyword detector | TTSR 와 redundant |
| Workspace migration (.sisyphus → .omo) | 새 시작 |
| Boulder state | omp `todo_write` + extension sync 충분 |
| Commercial layer (ECC Pro / GitHub App) | OSS 유지, no hosted service |

---

## Open Questions

- v1.x → v2 transition 시점: Claude Code 호환 support maintenance 명시화 결정
- Anthropic Pro/Max 가 3rd party 호출 허용 시 default 변경 (현재 axiom 3 의 가정 변경)
- Team mode max member 8 명 초과 시점
- npm mirror 추가 시점 (Phase 4 결정)

---

## Approval Path

이 design 은 brainstorming Section 1-5 의 conversational 승인 위에 작성. 자율 실행 entry 후:

1. **이 design doc commit** (now)
2. **`writing-plans` skill 호출** → Plan 0/1/2/3/4 작성 + commit
3. **GitHub repo 생성** (`gh repo create kimzerokim/pi-oven --public`) + remote add + push
4. **Phase 0 — Scaffold**: marketplace catalog + extension skeleton + eval-runner + slash commands + models.yml + README + omp marketplace add + plugin install dry-run verify
5. **STOP — user check-in** (3-slot contract 의 stop condition)

이후 user OK 받으면 Phase 1 (12 core skill bootstrap) 자율 진행.

---

## Glossary

- **omp** = oh-my-pi, the coding-agent runtime we're building on
- **omc** = oh-my-claudecode (frozen source)
- **omo** = oh-my-openagent / oh-my-opencode (frozen source)
- **Pocock skills** = Matt Pocock's skills bucket (frozen source)
- **superpowers** = Jesse Vincent's superpowers (frozen source)
- **pi-oven** = previous Claude Code-based harness (frozen, successor → pi-oven)
- **ECC** = Everything Claude Code by Affaan Mustafa (memory/session patterns referenced)
- **dogfood loop** = pi-oven build/migrate cycle uses pi-oven itself as the workflow runner (after Plan 1 maturity threshold)
