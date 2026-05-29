# Spec E (pi-oven user-local override) — Critic Review

**Cycle**: 1
**Date**: 2026-05-29
**Spec under review**: `docs/specs/2026-05-29-pi-oven-user-local-override.md`
**Sources** (3-way, independent):
1. Main(Claude opus-4-8) 1차 리뷰 + repo grounding (직접 omp 소스/repo grep)
2. codex `gpt-5.3-codex` (read-only, high reasoning) — 17 points → `/tmp/codex-out.txt` (원문 §부록)
3. 4-lens adversarial workflow (`wf_e5beea6c-da7`, 5 agents / 346k tokens / 27 raw → 13 merged)

**Gate decision**: **CONTINUE** (cycle 1, 🔴 BLOCKER 8개 잔존. HALT은 cycle≥5에서만. 구조적 rewrite 필요 — wording fix 아님.)

**codex ↔ workflow 일치도**: 대형 BLOCKER 8개 중 7개가 두 소스 독립 동시 지적(concurrence). 신뢰도 높음. workflow 단독 추가 발견 2건(origin/main agents 부재, `agentModelOverrides` 최상위 tier)은 main이 직접 재확정함.

---

## Ground Truth (검증 완료 — 재논쟁 금지)

omp 실제 설치본 `@oh-my-pi/pi-coding-agent` 소스 직접 확인:

- **GT1** omp는 user-home subagent override를 **이미 지원**한다 (`task/discovery.ts:59-122` `discoverAgents`). → 옵션 B feasible, **upstream PR 불요**. AC#1/§7.1의 "미지원 시 PR" 분기는 폐기.
- **GT2** 실제 agent discovery dir (우선순위 순, `config.ts:83-86` + `dirs.ts:98` `getConfigAgentDirName()="<.omp>/agent"`):
  - project: `<cwd>/.omp/agents`, `.claude/agents`, `.codex/agents`, `.gemini/agents`
  - user: `~/.omp/agent/agents`, `~/.claude/agents`, `~/.codex/agents`, `~/.gemini/agents`
  - subdir = `agents` (NOT `subagents`), base = `.omp/agent` 또는 `.claude` (NOT bare `~/.agent`/`~/.agents`).
- **GT3** precedence (`discovery.ts:79-122`): source당 project→user 순, sources `.omp`>`.claude`>`.codex`>`.gemini`, 그 다음 plugin roots, 마지막 bundled. dedup = **이름(`agent.name`) first-seen-wins** (`discovery.ts:104-111`).
- **GT4** repo의 bare `agents/`는 end-user에게 **plugin-root tier로만** 도달 (최하위, bundled 직전). bare `<project>/agents/`는 project config dir가 아님.

---

## 🔴 BLOCKER (8) — cycle 2 구조 수정 필요

### B1. override 경로가 phantom — `~/.agent/subagents/`는 아무것도 로드 안 함
- **출처**: codex #1 + workflow #1 (4 lens 전원) + main 1차. **3-way 동시.**
- **근거**: spec이 의존한 `.agent`/`.agents` 패턴은 **disjoint한 다른 subsystem**(skills/rules/prompts provider `discovery/agents.ts:29-86`)이며 subagent를 등록하지 않음. subagent는 오직 `getConfigDirs("agents",{project:false})`(`discovery.ts:64`)로만 로드. `subagents/`라는 segment는 omp discovery 어디에도 없음(grep 0건). §2.2가 두 시스템을 conflate함.
- **영향 위치**: §2.2, §3.1(row 1-2), §3.2(#1), §4 table(b), §4.1 wizard, §5 table, AC#1/AC#2, §7.1.
- **fix**: 전 참조를 `~/.omp/agent/agents/pi-oven-<role>.md`(primary) + `~/.claude/agents/pi-oven-<role>.md`(legacy)로 치환. §3.1 row1-2 + §2.2 "subagent 도 동일 패턴이면" 추론 삭제. AC#1을 "supported, verified — no PR"로 해소, §8 step2 삭제.

### B2. override 키는 파일명이 아니라 frontmatter `name:` (콜론형 `pi-oven:<role>`)
- **출처**: codex #15 + workflow #2 + main grounding. **3-way 동시.**
- **근거**: dedup은 `seen.has(agent.name)` (`discovery.ts:108`), `name:`은 frontmatter에서 옴(`helpers.ts:223`), 파일명 무관. repo 23개 agent 전부 `name: pi-oven:critic`(콜론)인데 파일명은 `pi-oven-critic.md`(하이픈). lint-agents는 파일명 유래 role(`lint-agents.ts:37,62`)로 키잉 — 런타임 name과 다른 identity, frontmatter name 검증 없음 → 콜론/하이픈 트랩이 silent ship 가능.
- **영향**: 사용자가 `~/.omp/agent/agents/pi-oven-critic.md`를 만들어도 frontmatter `name`이 `pi-oven:critic`이 아니면 **별개 agent로 등록되어 override 실패**.
- **fix**: override 생성기는 반드시 `name: pi-oven:<role>`(콜론) emit. §3.1/§3.2에 "파일명=scan dir 선택, shadowing=frontmatter name" 명시. AC#3는 name 충돌+승리를 assert. (선택) repo-side lint: frontmatter name == 파일명 role의 콜론형.

### B3. 토대 전제 붕괴 — 23 agents가 origin/main에 없음 (`.gitkeep`만)
- **출처**: workflow #4 (codex #5는 "cache empty"로 약하게) + main 재확정.
- **근거**: `git ls-tree origin/main agents/` → `agents/.gitkeep` (empty blob e69de29) **only**. 23개는 로컬 feature branch에만 존재. 마켓플레이스 install = `git.clone(ref:main)` (`source-resolver.ts:109`, agents/ 필터 안 함) → fresh install/`pi-oven plugin update`는 agents 0개. **override가 override할 대상이 real install에 없음.** (참고: 빈 install cache는 2026-05-27 stale install 잔재이지 packaging 제외 아님 — `discovery.ts:100`이 manifest `agents:[]` 무시하고 `plugin.path/agents/` 무조건 scan. main 머지 후 재설치하면 채워짐.)
- **fix**: Spec E(및 Spec A)에 hard precondition 추가 — "23 agents가 origin/main에 머지되어야 'repo=canonical default' 성립". AC#1/§5를 `git ls-tree origin/main agents/` 23-file 확인에 gate. §3.1/§3.2의 "packaging이 agents 제외" 우려는 false이므로 삭제.

### B4. user-home override는 machine-global — 모든 repo에 적용 (spec은 "personal"로 오표기)
- **출처**: codex #7 + workflow #8 + main lens 예측. **3-way 동시.**
- **근거**: user dir은 `os.homedir()`로만 구성, project 성분 0 (`config.ts:126-138, 83-86`); `discovery.ts:64-69`이 cwd 무관 매 세션 주입. first-seen dedup + user>plugin-root이므로 `~/.omp/agent/agents/pi-oven-critic.md` 하나가 **머신의 모든 프로젝트에서** repo default를 silent shadow. spec은 이걸 default `/pi-oven:setup` target으로 권고(§4 (c)).
- **fix**: machine-global임을 명시. default target을 per-project `<proj>/.omp/agents/pi-oven-<role>.md`(findAllNearestProjectConfigDirs가 `.omp` source 내 user dir보다 위로 rank)로 재고, machine-global write는 명시적 `--scope=user` flag 뒤로. 단 per-project `.omp/agents/`는 gitignore 안 하면 git-tracked → §1 "clean git tree" 목표와 tension 발생 — 이 trade-off 명시.

### B5. AC#3 검증 불가 — 모델은 단일 frontmatter 값이 아니라 registry-매칭 pattern-list, 그 위에 settings override
- **출처**: workflow #5 (단독, 심층) + codex #9(약하게). main 재확정.
- **근거**: dispatch 모델 = `resolveAgentModelPatterns({settingsOverride: task.agentModelOverrides[agentName] (최상위), agentModel: agent.model, ...})` (`task/index.ts:648-657`) → registry 매칭(`executor.ts:643`). frontmatter `model:`은 우선순위 **list**(`helpers.ts:198-203`)이지 단일값 아님. omp는 "role X의 resolved model"을 돌려주는 API 없음(task result는 `agentSource`=bundled|user|project만 노출). → "active model == frontmatter model"은 settings override/registry 필터 시 거짓이고 smoke ping으로 검증 불가.
- **fix**: AC#3을 분리·검증가능하게 재작성 — (a) DISCOVERY: `discoverAgents(cwd)`가 pi-oven-<role>을 user-local dir filePath + model[]==override list로 반환하는지 assert; (b) OBSERVABILITY: 실제 subagent 실행 후 `agentSource=='user'` 또는 resolved model(`executor.ts:1157 progress.resolvedModel`) assert. **`task.agentModelOverrides`를 precedence 모델 최상위 tier로 추가** (settings > user-local file > plugin-root file > bundled).

### B6. silent-failure 2종 — retired model id / malformed frontmatter (둘 다 inert override를 active로 오인)
- **출처**: codex #13+#14 + workflow #6. **2-way 동시.**
- **근거**: (1) override `model:` pattern이 전부 미매칭 → `logger.warn` 후 skip, 전부 fail이면 `{model: undefined}`(`model-resolver.ts:716-735`) → `sdk.ts:947/961/983-989`이 **조용히 settings `default` role로 fallback**, throw 없음. retired id(예: 4.8 출시 후 `claude-opus-4-7`) override는 default 모델로 돈다. (2) override frontmatter 깨지면 `parseAgent('warn')` → throw → `discovery.ts:42-49`에서 catch→null→filter → 같은 name의 repo/plugin default가 dedup으로 로드. fat-finger override는 silent inert.
- **fix**: AC#3은 resolved model로 검증 + negative case(retired id → warn+fallback 기대, hard-fail 아님). array fallback 의미 문서화(예: `[claude-opus-4-8, claude-opus-4-5]`). `/pi-oven:setup`에 생성 override parse 검증 pass 추가. AC#4 `--status`가 (a) parse 실패한 override 존재 (b) 미해소/retired model pattern 표면화.

### B7. AC#4 resolution chain은 omp output에서 derive 불가 — `discoverAgents().filePath`로 구동, precedence 재구현 금지
- **출처**: codex #10 + workflow #7. **2-way 동시.**
- **근거**: task output의 `agentSource`는 bundled|user|project로 coarsen됨(`discovery.ts:86,88,101`), plugin-root는 scope로 user|project 재라벨 → 'user'가 진짜 user-home override인지 user-scope plugin인지 모호, 'install cache' 구분 불가. chain 라벨링하려면 pi-oven가 `getConfigDirs`+`findAllNearestProjectConfigDirs`+plugin-root 순서를 재구현 = upstream drift 위험(discovery.ts 헤더 주석이 이미 stale: `.pi` 언급, `.codex`/`.gemini` 누락).
- **fix**: omp `discoverAgents`를 직접 import/invoke해서 pi-oven-<role>별 `agent.filePath`+`agent.source` 보고(SoT 단일, drift-proof). source 분류는 filePath를 `$HOME` prefix-match(read-only, 저렴). AC 서브항목: "--status source 라벨은 `discoverAgents().filePath`로 구동, pi-oven-local precedence 복사본 금지". role별 전체 discovered source 나열 collision check 추가.

### B8. §3.2 precedence 모델이 개념적으로 틀림 — bare repo `agents/`는 project config dir 아님
- **출처**: codex #2/#3/#11 + workflow #3 + main 1차. **3-way 동시.**
- **근거**: §3.2는 (1)user-local (2)project repo `<project>/agents/` (3)plugin cache 3-tier로 그렸으나, `findAllNearestProjectConfigDirs("agents",cwd)`(`config.ts:213-242`)는 `<cwd>/.omp/agents` 등만 매칭, bare `<project>/agents/` 없음. repo엔 `.omp/extensions`만 있고 `.omp/agents` 없음. repo `agents/`는 plugin-root tier(최하위)로만 도달(GT4). 실제 flat 순서: project `.omp/agents` > user `~/.omp/agent/agents` > project `.claude` > user `.claude` > … > plugin roots(shipped repo agents/) > bundled.
- **fix**: §3.2를 flat 실제 순서로 재기술. "project repo agents/=#2" tier 삭제/한정. §5 row2의 "effect 보존" 근거 수정 — user dir가 **plugin-root tier**보다 위라서지 project dir보다 위라서가 아님. `.codex`/`.gemini`는 non-interfering tail이라 1줄 주석.

---

## ⚪ PUSH-BACK (2)

### P1. §7.4 plugin-config precedence는 moot — plugin config는 모델 선택에 영향 0
- **출처**: codex #12 + workflow #9. **2-way 동시.**
- **근거**: dispatch 모델 = `modelOverride ?? agent.model`(`executor.ts:643`), top input은 `task.agentModelOverrides` settings. `task/`·`agent/` 어디에도 plugin config(`pi-oven.models.<role>.primary`) 읽는 곳 없음(grep 0). `omp plugin config set`은 runtime이 모델 선택에 안 봄. 양방향 precedence 자체가 없음.
- **결론**: §7.4 삭제 또는 "plugin config는 wizard bookkeeping일 뿐, model-resolution chain 밖"으로 재프레임. Spec B의 "supported routing entry" 주장도 모델 선택 한정 정정.

### P2. §4 `--target=repo`(option a/r)는 마켓플레이스 end-user에게 무의미
- **출처**: workflow #10 (codex #6는 BLOCKER로). main은 🟡 design-gap으로 본다 (아래 N으로 강등하지 않고 push-back+gating으로).
- **근거**: installed user는 repo project checkout이 없고 repo agents는 plugin cache(`.git` 있는 checkout, `pi-oven plugin update` 시 re-clone으로 clobber) 안에 있음. [r]/`--target=repo`는 비존재 dir 또는 volatile cache를 타겟.
- **결론**: [r]/`--target=repo`를 "repo clone 내 maintainer(cwd==repo root)"로 gating. wizard가 'pi-oven repo 내부 vs installed plugin user' 감지 후 [r] 제공 여부 결정. §4.1에 명시.

---

## 🟡 NIT (3)

- **N1 revert/delete UX 미정 + §7.5 `--reapply` 모순**: §5 row3은 수동 rm 전제, §4는 create/update만. `reapply.ts:19-49`는 target param 없이 `pi-oven.profile` 읽어 항상 repo file rewrite → §7.5의 "target 따라 동작"은 clarification 아닌 signature 변경. **fix**: `--target=user-local --reset`(전체 제거)/`--remove <role>`(1개) 추가 + AC + dir 명시. `--reapply`는 §8 명시 작업으로 scope하거나 repo-only 유지 + 별도 `--reapply-user-local`.
- **N2 AC#5는 정확(lint scope OK) + symlink 노트**: `lint-agents.ts:13,37,62` repo agents/만, `~/.` 안 읽음 → AC#5 충족. `discovery.ts:35-36`이 `isFile()||isSymbolicLink()`+`.md` → **file-level** symlink override 로드됨(dotfile manager chezmoi/stow 가능, 단 agents/ dir 전체 symlink는 readdir 미추적). §7.3에 "override 불변식=런타임 콜론형 name" 추가.
- **N3 migration plan 누락** (codex #17): repo `agents/pi-oven-*.md`를 이미 손댄 기존 사용자용 one-time detector+cleanup. (현 repo는 agents가 main에 없어 end-user 영향 낮음 → 우선순위 낮으나 명시 권장.) dotfile sync orphan override(codex #16)는 harmless(model staleness만).

---

## 💡 전략 노트 — 옵션 B보다 단순한 대안 후보 (cycle 2 결정 필요)

workflow B5 발견의 함의: **`task.agentModelOverrides` (settings key)** 가 `resolveAgentModelPatterns`의 `settingsOverride`로 들어가 **모델 선택 최상위 tier**(`task/index.ts:648-652`). 즉 override **파일을 안 만들고** settings 한 항목(`task.agentModelOverrides.<agentName> = <model>`)으로 per-role 모델을 바꿀 수 있을 가능성. 이는:
- repo git tree 무변경 (§1 목표 충족)
- machine-global vs per-project scope를 settings scope(user/project settings.json)로 자연 해결 (B4 완화)
- override 파일 phantom-path/name-dedup/parse-failure 클래스 회피 (B1/B2/B6 회피)

cycle 2 Step -1(brainstorming)에서 **옵션 C = `agentModelOverrides` settings 방식**을 옵션 B와 비교 평가할 것. (검증 필요: settings scope/형식, agentName 키가 콜론형 `pi-oven:<role>`인지, registry 매칭 동일 적용인지.)

---

## Gate 판정 & cycle 2 scope

**CONTINUE** — 🔴 8개. cycle 2는 구조 rewrite:
1. 전 경로 `~/.omp/agent/agents/`로 정정 + name 콜론형 불변식 (B1/B2)
2. origin/main agents 머지 precondition + premise 정정 (B3)
3. scope(machine-global/per-project) + default target 재결정 (B4)
4. AC#3/#4 재작성 (discoverAgents/filePath/resolvedModel 기반), `agentModelOverrides` tier 반영 (B5/B7)
5. silent-failure 검증 + `--status` 경고 (B6)
6. §3.2 precedence flat 재기술 (B8)
7. §7.4 정리, §4 target gating, revert UX, §7.5 reapply 결정 (P1/P2/N1)
8. **옵션 C(agentModelOverrides) brainstorming 비교** (전략 노트)

cycle 2 revise는 `oh-my-claudecode:executor`(sonnet)에 categorized edit list로 dispatch → codex 재consult(cycle 2 verdict = `-2.md`).

---

## 부록 — codex 원문 (gpt-5.3-codex, read-only/high)

전체 17 points 원문: `/tmp/codex-out.txt` (session 019e71b7). 핵심 발췌:
- #1 §3.1 path wrong [BLOCKER] → B1
- #2/#3/#11 §3.2 precedence wrong, `<project>/agents/` not discovered [BLOCKER] → B8
- #5 §1/§5 premise broken (empty cache) [BLOCKER] → B3
- #7 machine-global scope hidden [BLOCKER] → B4
- #9 AC#3 weak/non-deterministic [BLOCKER] → B5
- #10 AC#4 must introspect runtime [BLOCKER] → B7
- #13 malformed frontmatter silent fall-through [BLOCKER] → B6
- #14 retired model id late-fail → setup-time validation [BLOCKER] → B6
- #15 dedup by name not filename [BLOCKER] → B2
- #6 §4 option(a) underspecified for non-maintainers → P2
- #12 §7.4 plugin config speculative [NIT] → P1
- #16 dotfile sync portability [NIT] → N3
- #17 migration plan missing [BLOCKER→demoted NIT] → N3
