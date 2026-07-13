> Historical; do not copy runtime syntax examples from this document.

# Spec E: pi-oven per-role model override via omp settings (옵션 C)

**Status**: FROZEN v3 — 2026-05-29 (cycle 3 codex PASS, 🔴 BLOCKER 0). **옵션 B (user-local override .md 파일) 폐기, 옵션 C (omp settings `task.agentModelOverrides`) 채택.**
**Review trail**: cycle 1 (option B, 🔴8) → cycle 2 (option C, 🔴3) → cycle 3 (🔴0 PASS). Verdicts: `docs/research/codex-reviews/pi-oven-user-local-override-critic-review{,-2,-3}.md`.
**Supersedes**: v1 (옵션 B, `~/.agent/subagents/` phantom path — cycle-1 critic 에서 BLOCKER 확정)
**Inputs**:
- Cycle-1 critic verdict: `docs/research/codex-reviews/pi-oven-user-local-override-critic-review.md` (codex + 4-lens, 🔴8)
- Option-C verification: workflow `wf_c1e7ee1d-7bd` (settings 메커니즘 file:line 검증)
- Stale audit: `docs/harness/surveys/2026-05-29-pi-oven-setup-stale-audit.md` (18 cluster: 7🔴/8🟡/3⚪)
- Open-item defaults: `docs/harness/user-queue.md` §Q-SPEC-E-CYCLE2-SCOPE
**Spec A 의존**: `docs/specs/2026-05-28-pi-oven-agent-registry.md` (23 ROLES, lint SoT)
**Spec B 의존**: `docs/specs/2026-05-28-pi-oven-setup-wizard.md` (이 spec 이 §2.1/§9.1 persistence 모델을 정정)

---

## §1 Goal

사용자가 자기 환경에서 per-role agent 모델을 바꾸되: (a) repo git tree 무변경, (b) CI lint fail 없음, (c) PR diff 오염 없음, (d) default 모델 bump 시 release-noise commit 없음.

**사용 시나리오 (확정, user-queue Q 답변)**: 개인·머신로컬. 개발자 개인이 자기 머신에서만 모델을 바꾸고, 공유/커밋하지 않으며, machine-global 로 모든 프로젝트에 적용.

---

## §2 진단 — 현 구조는 모델 override 가 통째로 무효 (root finding)

> SoT: `docs/harness/surveys/2026-05-29-pi-oven-setup-stale-audit.md` headline.

omp 의 실제 모델 선택은 **오직** settings `task.agentModelOverrides` 만 읽는다:

```
task/index.ts:648  const agentModelOverrides = session.settings.get("task.agentModelOverrides")
task/index.ts:649  const settingsModelOverride = agentModelOverrides[agentName]   // agentName = params.agent = frontmatter colon name
task/index.ts:651  resolveAgentModelPatterns({ settingsOverride, agentModel: effectiveAgent.model, ... })
model-resolver.ts:574-588  settingsOverride 가 frontmatter agentModel 보다 먼저 해소 (strictly wins), 동일 registry 매칭
```

현 pi-oven-setup 의 persistence 는 `omp plugin config set pi-oven ...` → `~/.omp/plugins/omp-plugins.lock.json` 의 `settings.pi-oven` 에 쓴다. omp 의 task/agent 모델 해소는 이 namespace 를 **전혀 읽지 않는다** (grep 0). 따라서:

- `--override` / `--reset` / `--import` / `--reapply` 가 쓰는 per-role config = **dead** (런타임 영향 0).
- 실제로 모델을 바꾸는 유일한 동작은 `agent-rewriter` 가 **커밋된** `agents/pi-oven-*.md` frontmatter 를 rewrite 하는 것 = §1 이 없애려는 그 git-tree 오염.
- `--status` 와 extension session_start drift 경고는 dead namespace 를 읽어 **허구**를 보고.

→ 옵션 C 는 enhancement 가 아니라 **최초의 올바른 모델-override 구현**. 동시에 dead 경로 전수 제거.

### §2.1 옵션 C key/scope 검증 결과 (확정)

| 항목 | 검증 결과 | 근거 |
|---|---|---|
| 키 형태 | **콜론** `pi-oven:<role>` (frontmatter `name:`), 파일명(하이픈) 아님 | `helpers.ts:222-223`, `task/index.ts:569,649` |
| schema | `Record<agentName,string>` (단일 string), default `{}` | `settings-schema.ts:2546-2549` |
| 우선순위 | settingsOverride > frontmatter model (strictly) | `model-resolver.ts:574-588` |
| registry 매칭 | frontmatter 와 동일 (`anthropic/claude-opus-4-8` 동일 해소) | `model-resolver.ts:556-562`, `executor.ts:643` |
| scope | user-global `~/.omp/agent/config.yml` = machine-global (모든 프로젝트) | `settings.ts:213,505,784-787` |
| 쓰기 | `omp config set task.agentModelOverrides '<json>'` (전역만; MERGE 필요) 또는 config.yml 직접 read-merge-write | `config-cli.ts:211-228`, `settings.ts:297-310` |
| silent-failure | retired/미매칭 model id → `{model:undefined}`, throw/warn 없이 session default 로 fallback | `model-resolver.ts:734`, `sdk.ts:947/983` |

---

## §3 옵션 C 설계

### §3.1 override 키·값·위치

- **위치**: user-global `~/.omp/agent/config.yml`, settings key `task.agentModelOverrides`.
- **키**: 콜론 agent name `pi-oven:<role>` (예: `pi-oven:critic`). CLI 의 하이픈 토큰(`critic`)을 `pi-oven:${role}` 로 변환.
- **값**: 단일 model 문자열 (예: `anthropic/claude-opus-4-8`). schema 가 단일 string 이므로 graceful-fallback 배열은 미지원 — 이는 의도된 한계 (개인 override 는 단일 모델).
- **MERGE 보장 (hard-require)**: (a) 모든 non-`pi-oven:*` 키 및 형제 `pi-oven:*` 키를 반드시 보존 — 절대 전체 replace 금지. (b) atomic write 필수. (c) **PREFER per-key dotted set**: `omp config set task.agentModelOverrides.pi-oven:<role> <model>` 를 우선 사용 — omp `settings.set` 이 path 를 `.` 로 split 하고 `setByPath` 가 leaf 만 set 하므로 형제 키 보존이 construction 에 의해 보장되며 (`settings.ts:90,299-300`), 콜론은 `.` 가 아니라 safe leaf segment 로 처리됨. 쓰기 자체를 omp 에 위임하므로 pi-oven-side read-merge-write 불필요. (d) 직접 YAML read-merge-write fallback 을 사용할 경우: omp 가 제공하는 `config/file-lock.ts` 를 반드시 사용하고 atomic temp-write+rename 으로 concurrent lost-update 방지 의무. — plan 단계에서 config-cli 가 undeclared dotted path + 콜론 leaf + string 값을 수용하는지 smoke-verify 후 fallback 여부 결정.
- **scope**: machine-global. `--status` 가 이를 명시. (per-project 는 본 spec out-of-scope — 개인·머신로컬 시나리오 확정.)

### §3.2 우선순위 (실제 omp 동작, 확정)

```
task.agentModelOverrides[pi-oven:<role>]   (settings, config.yml — 본 spec 의 override layer)   ← 최상위
   ↓ (없으면)
frontmatter model:  (agents/pi-oven-<role>.md — PROFILE_A 의 committed default)
   ↓ (전부 미매칭이면)
session default model   (silent fallback — §3.5 에서 setup-time 검증으로 완화)
```

repo `agents/` = 변경 불가 PROFILE_A baseline. override layer 는 repo 밖 settings.

### §3.3 flag rewire 명세 (audit A1–A6, I2, I4 통합)

| flag | 현재(폐기) | 옵션 C 후 |
|---|---|---|
| `--override <role>=<model>` | profileMap 병합 → agent frontmatter rewrite + dead plugin-config write | `task.agentModelOverrides["pi-oven:<role>"] = <model>` MERGE into config.yml. agent-rewriter / plugin-config 호출 제거. setup-time registry 검증 (§3.5). dispatcher 가 `--override` 존재 시 (`--profile/--apply` 없어도) override-write route 로 진입 — "No action specified" 분기에서 제외. |
| `--status` | dead namespace 읽어 profile/resolved-model 허구 + agent-file drift | 실제 effective model 표시: `override(pi-oven:<role>) ?? frontmatter model[0]`. config.yml task.agentModelOverrides + frontmatter 읽기. dead drift 제거. source(override/default) 표시. |
| `--import <file>` | pi-oven.* persist + agent rewrite | whitelist 된 per-role model 을 colon key 로 task.agentModelOverrides 에 write. agent rewrite 없음. |
| `--reset` | 71 pi-oven.* 키 삭제 + 23 agent file 을 PROFILE_A 로 rewrite | `task.agentModelOverrides["pi-oven:*"]` 항목만 삭제. agent file 무변경 (이미 committed PROFILE_A). |
| `--reapply` | runApply 재실행 (dead config + file rewrite) | **retire** (dispatcher + doc 제거). plugin-upgrade 가 config.yml override 를 안 건드리므로 obsolete. |
| `--profile custom` | dispatcher 가 hard-reject 하나 doc/일부 모듈이 사용 | **CLI 값으로 제거** (A\|B-only). override 는 `--override` 반복으로 표현. dispatcher 의 A\|B 검증 로직 자체는 유지 (제거와 모순 아님 — 값 `custom` 이 CLI 에서 허용되지 않는 것이며, 거부 분기 코드는 잔존). |
| `confirm-auth` | parseArgs 선언되나 미사용 (dead) | **삭제** (+ `confirmAuthViaPing` 미사용 시 제거). |
| `--apply --profile A\|B` | profileMap → agent rewrite + dead persist | **maintainer 전용 의미로 한정**: PROFILE_A/B 를 repo agents 에 generate (one-time, lint baseline 생성). agent-rewriter 의 유일한 정당 호출처 = 이 maintainer-generate 경로 (profiles.ts → repo agents/, lint baseline 생성). personal `--override` 는 agent 파일을 절대 rewrite 하지 않음. 일반 사용자 personal override 와 분리. (Spec B §6 흐름 정정.) |
| `--validate` | (유지) | 유지. override 적용 후 smoke ping 으로 검증 가능 (§6 AC#3 참조). |

### §3.4 코드 변경 범위 (구현 가이드 — 상세는 plan 단계)

- `scripts/pi-oven-setup/persist.ts` — model data 용 `writePluginConfig`/`deletePluginConfig`/`readPluginConfig` 폐기. 신규 `config.yml` task.agentModelOverrides write helper 추가: **PREFER** `omp config set task.agentModelOverrides.pi-oven:<role> <model>` per-key dotted set 경로 (§3.1 (c) 의 형제-보존 + atomic 위임). plan 단계에서 config-cli 가 undeclared dotted path + 콜론 leaf + string 값을 수용하는지 smoke-verify; 수용 실패 시 `config/file-lock.ts` + temp-write+rename atomic fallback 사용.
- `scripts/pi-oven-setup/apply.ts` — `:49-60` dead per-role write loop 제거, `:62-65` `rewriteAllAgents` 호출 제거.
- `scripts/pi-oven-setup/agent-rewriter.ts` — `rewriteAllAgents`/`rewriteAgentFile` 를 wizard 경로에서 제거 (maintainer `--apply` generate 경로로만 한정, 또는 별도 maintainer 스크립트로 분리). `readAgentFiles`/`detectDrift` 는 `--status` 가 frontmatter 읽는 용도로 재활용 가능.
- `scripts/pi-oven-setup/status.ts` — `:20-99` dead namespace 읽기 + drift 제거, effective-model 계산으로 재작성.
- `scripts/pi-oven-setup/reset.ts`, `import.ts` — config.yml override 대상으로 재작성, agent rewrite 제거.
- `scripts/pi-oven-setup/reapply.ts` — 제거 (dispatcher `scripts/pi-oven-setup.ts` 에서 라우팅 제거).
- `scripts/pi-oven-setup.ts` — `confirm-auth`(:38) 삭제, `--profile custom` 거부 로직은 유지하되 doc 동기화, `--reapply` 라우팅 제거. dispatcher 에 override-first route 추가: `--override` 가 값과 함께 존재하면 `--profile`/`--apply` 없이도 config.yml override-write route 로 진입 (현재 `:81` 의 `--profile|--apply` gating 과 `:112` "No action specified" exit 에서 standalone-override 케이스 제외). **flag 결합 우선순위 (codex c3 PUSHBACK)**: `--override` 는 `--status`/`--validate` 와만 결합 가능 — 결합 시 override-write 를 먼저 적용한 뒤 status/validate 실행 (예: `--status --override critic=X` = write 후 갱신된 effective model 표시). `--override` 를 `--apply`/`--import`/`--reset` 과 동시 사용하는 것은 상호배타로 거부 (명확한 에러 + exit 1).
- `.omp/extensions/pi-oven.ts` — `:155-217, 285-317` `loadProfileMapFromConfig`/`detectDriftFromMap`/session_start drift block 제거. `validateAgentRegistry` whitelist 유지.

### §3.5 silent-failure 완화 (cycle-1 B6) — validator contract (LOCKED)

retired/미매칭 model id 는 omp 에서 조용히 default 로 fallback (`model-resolver.ts:734`). 완화:

- **EXACT-ID-ONLY 정책 (LOCKED)**: override 값은 단일 model id — pattern 이 아님. schema 가 단일 string 이므로 pattern-like 입력은 별도 처리 없이 그대로 거부 대상. glob/prefix/wildcard 허용 없음.
- **setup-time 검증**: `--override`/`--import` 가 write 전에 override 값을 omp model-registry 또는 resolver 와 **동일한 resolution 의미론**으로 대조 — exact 해소 가능한 id 만 허용. 미해소 → write 거부 + 명확한 에러. plan 단계에서 구체 검증 호출을 1개로 고정 (model-registry 직접 조회 또는 resolver 호출 중 택일). **`auth-detect.ts` 의 provider-row parser (`:14,56`) 재사용 금지** — resolver parity 가 없는 단순 행 파서이므로 valid id 오분류 위험.
- **`--status` 경고**: task.agentModelOverrides 의 각 키 값이 현재 registry 에서 해소 가능한지 동일 검증으로 확인, 미해소 시 "override <role>=<model> 은 미해소 — session default 로 fallback 중" 경고. (malformed-frontmatter subclass 는 옵션 C 에 없음 — .md 파일 미사용.)

---

## §4 SoT 모델 (정정)

```
profiles.ts (PROFILE_A)  ──(maintainer 1회 --apply generate)──▶  agents/pi-oven-<role>.md frontmatter  ──(lint-agents 강제)──▶  committed baseline
                                                                          │
                                                                          ▼ (omp dispatch 시 frontmatter = base)
                                  task.agentModelOverrides[pi-oven:<role>]  (user-global config.yml, override layer, repo 밖, lint-blind)
```

- profiles.ts → frontmatter → lint 삼각형 = committed baseline (유지).
- **lint invariant 추가 (audit I3)**: `lint-agents.ts` 가 각 파일의 frontmatter `name` === `pi-oven:` + filenameRole (콜론형) 검증 + test 추가. 콜론 name = omp registry 키 = override 키이므로 불변식 필수.
- lint 은 PROFILE_A baseline 만 검사. user-global task.agentModelOverrides (personal/uncommitted) 는 의도적으로 검사 안 함 (AC#5).

---

## §5 docs/stale 정리 범위 (audit I5, I7, I8)

- **I5** `commands/pi-oven-setup.md` persistence 섹션 (:138,155,194,199,201,206-208) 재작성: config.yml task.agentModelOverrides 설명, "wizard 는 agents/ 수정 안 함" 명시, install-cache/upgrade-drift/--reapply limitation 삭제.
- **I7** opus-4-7→4-8 sweep: `README.md:197-201` (PROFILE_A 표는 profiles.ts 에서 생성 권장), `agents/pi-oven-critic.md:69` (body), `OPTIMIZED-MODEL.md:98`, `setup-wizard.md` (~13 lines), `agent-registry.md:566,750,1226,1228`.
- **I8** `.omc/project-memory.json:29-30` 의 destructive sed 제거: OPTIMIZED-MODEL.md 에 4-7→4-8 1회 적용+commit 후 build/test command 를 plain pipeline 으로 복원.
- **I1** Spec E v1 의 phantom `~/.agent/subagents` 9줄은 본 v2 가 대체 (이 파일 자체). `docs/WORKING-CONTEXT.md:33` 의 "option B confirmed" 항목 정정.

---

## §6 Acceptance Criteria (cycle-1 B5/B7 반영 — testable 재작성)

**AC#1** `--override critic=anthropic/claude-opus-4-8` 를 **`--profile`/`--apply` 없이 standalone** 으로 실행 후 `~/.omp/agent/config.yml` 의 `task.agentModelOverrides["pi-oven:critic"]` === `"anthropic/claude-opus-4-8"` 이고, **repo git tree 무변경** (`git status --short` 빈 출력), **plugin-config lock 파일 무변경**. (standalone override-only 실행이 "No action specified" 로 종료되지 않고 override-write route 로 진입함을 검증.)

**AC#2 (MERGE)** 두 role 을 연속 override (`--override critic=X` 후 `--override executor=Y`) 시 두 키 모두 config.yml 에 공존 (replace 아닌 merge). `--reset` 후 `task.agentModelOverrides` 에서 `pi-oven:*` 키만 제거되고 비-pi-oven 키는 보존.

**AC#3 (effective model, B5 반영)** override 가 있는 role 의 실제 해소 모델 검증. 단일 frontmatter 값 가정 금지:
- (a) DISCOVERY: `discoverAgents(cwd)` 가 `pi-oven:critic` 을 반환하고, override 적용 후 dispatch 시 resolved model 이 override 값임을 검증 — 실제 subagent dispatch 후 resolved model 을 `executor.ts:1157 progress.resolvedModel` 접근 또는 dispatch 결과의 model echo 중 하나로 캡처 (plan 에서 1개 고정).
- (b) NEGATIVE: retired/미매칭 id override → setup-time 거부 (§3.5). 거부 우회 시 dispatch 는 default 로 fallback (hard-fail 아님) — 이 동작을 문서화.

**AC#4 (configured effective override, B7 반영)** `--status` 가 role 별 `configured effective override = override(pi-oven:<role>) ?? frontmatter model[0]` 와 source(`override(config.yml)` / `default(frontmatter)`) 표시. 이는 **configured precedence** 이며 runtime registry 해소가 아님 — config.yml task.agentModelOverrides + frontmatter 직접 읽어 계산 (precedence 재구현 금지). 미해소 override 는 경고.

**AC#5 (lint scope)** `lint-agents` 는 repo `agents/` 만 검사 (user-global config.yml 무관). 추가로 frontmatter name === `pi-oven:`+filenameRole 불변식 통과 (I3) + 해당 test 추가.

**AC#6 (dead-path 제거)** `--reapply` / `--profile custom` / `confirm-auth` dispatcher·doc 에서 제거. `persist.ts` 의 model-data plugin-config write/read 부재 (grep). extension session_start drift block 부재. `apply.ts`/`reset.ts`/`import.ts` 가 `rewriteAllAgents` 미호출 (grep).

**AC#7 (stale sweep)** repo 전체 (skills/ 제외)에 `opus-4-7`/`claude-opus-4-7` 잔존 0 — **단 PROFILE_B (profiles.ts:197-292) + README:208 + harness-flow-progress.md:34 는 예외 (Q-PROFILE-B deferred)**. `models.yml` 제거 + 참조 정리 (Q-MODELS-YML default). project-memory.json sed 제거.

---

## §7 Open Items (사용자 결정 — user-queue §Q-SPEC-E-CYCLE2-SCOPE)

tentative default 로 진행, frozen spec review 게이트에서 확정:

- **Q-DISTRIBUTION-A7** — 23 agents origin/main merge + version SoT (package.json 0.1.0 vs manifest 0.1.0) + CI parity. **DEFER** (main 접근 contract 밖, release-gating 별도). 이 cycle 의 코드는 origin/main 에 agents 가 머지된 후에야 end-user install 에서 유효.
- **Q-MODELS-YML** — **DELETE** (orphaned, 0 readers). audit I6.
- **Q-VERSION-SOT** — **DEFER** (A7 과 묶음).
- **Q-PROFILE-B** — **LEAVE DEFERRED** (memory). 단독 bump 금지, AC#7 예외.

---

## §8 Out of scope

- profiles.ts PROFILE_A/B 정의 자체 (Spec A/B).
- per-project committed override (개인·머신로컬 시나리오 확정 — per-project 는 불필요).
- omp upstream 변경 (옵션 C 는 omp 무수정으로 동작).
- A7 distribution/release (별도 task).

---

## §9 구현 plan 개요 (writing-plans 에서 상세화)

- **Wave 1 (transport core)**: persist.ts config.yml read-merge-write helper + registry 검증 helper (TDD). 다른 wave 의 기반.
- **Wave 2 (flags)**: apply.ts / override / reset / import / status 재작성 (Wave 1 의존). reapply / confirm-auth / profile-custom 제거.
- **Wave 3 (extension + lint)**: `.omp/extensions/pi-oven.ts` drift 제거; lint-agents colon-name invariant + test. **Wave 2 이후 순서 실행** — extension drift 제거와 maintainer-generate/agent-rewriter 계약을 공유하므로 file-disjoint 아님. (병렬 주장 철회. 공유 계약 경계: `agent-rewriter.ts` 의 wizard 경로 제거 / maintainer 경로 한정 이 Wave 2 완료 후 확정되어야 Wave 3 extension 정리가 안전함.)
- **Wave 4 (docs/stale)**: I5 command-doc, I7 opus sweep, I8 project-memory, models.yml 삭제, WORKING-CONTEXT 정정. (mechanical — executor haiku 가능, 일부 sonnet.)
- 각 wave executor(sonnet) dispatch, TDD strict, wave 합류 review, 최종 fresh-agent verifier.
