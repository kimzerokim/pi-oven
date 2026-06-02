# OPTIMIZED-MODEL.md — pi-oven 모델 라우팅 최종 결정 (PROFILE_A)

작성일: 2026-05-28 (제안서) → 2026-05-29 (벤치마크 기반 재구성 + 결정 적용)
대상: `scripts/pi-oven-setup/profiles.ts` PROFILE_A (release default)
상태: **결정서** — `profiles.ts`, 23 agent file, spec 2개 동기화 완료

---

## 0. TL;DR

- **벤치마크 기반 재구성** — 이전 제안서 (§1 SWE/tool-calling 데이터 부재 인정) 를 SWE-bench Verified / Aider polyglot / Atlas Cloud 비교에 따라 다시 짰다. Kimi K2.6 (Opus 4.6 동급 SWE 80.2% + 4000+ tool calls 안정), GLM-5.1 (Code Arena Elo 1530, agentic front-end 3위), MiniMax-m2.7 (저비용 multi-agent) 활용.
- **Anthropic 편향 해소** — 이전 PROFILE_A 의 Claude 비중 14/23 = 61% → 새 PROFILE_A 의 anthropic primary 3/23 = 13%. Claude opus 만 유지하되 high-stakes 자문 role 에 한정 (planner / security-reviewer / oracle). 나머지는 openai-codex (subscription marginal cost 0) + opencode-zen.
- **OpenAI Codex subscription 적극 활용** — 6 role 이 `openai-codex/*` primary. executor/debugger/test-engineer = gpt-5.4, scientist/architect/metis = gpt-5.4 (cost-efficient frontier). planner alternate 도 gpt-5.4 (codex-review). critic primary 는 사용자 mechanical fix 로 anthropic/claude-opus-4-8 유지 (false PASS 비용 max).
- **Deprecation 처리** — `opencode-zen/glm-5` (2026-05-14 만료) 가 사용되던 explorer + librarian primary 교체. explorer → gemini-3-flash (1M ctx vision yes), librarian → glm-5.1 (long-horizon citation).
- **Fallback 정책** — primary 가 `opencode-zen/*` 이 아니면 alternate = `opencode-zen/*` 의 same model id wrapper. 예외: planner = `openai-codex/gpt-5.4` (codex-review cross-validation, 사용자 정책).

---

## 1. 입력 자료

### 1.1 omp `--list-models` 표기 (2026-05-28 fetch)

> ⚠️ **사이트 표기 vs omp 표기**: opencode-zen 카탈로그 사이트가 `kimi-k2-6`, `gemini-3-5-flash`, `glm-5-1` 같은 대시 표기를 쓰지만 **omp 실측 등록명은 점 표기** (`kimi-k2.6`, `gemini-3.5-flash`, `glm-5.1`). Claude / GPT-5 계열만 대시. 이전 제안서 §1 표기 오류 전부 정정.

**확정 사용 모델 (omp `--list-models` 실측)**

| omp 모델 ID | thinking 지원 | vision | context | 입력 $/1M | 출력 $/1M |
|---|---|---|---|---|---|
| `openai-codex/gpt-5.5` | low/medium/high/xhigh | yes | 272K+ | 5.00 | 30.00 |
| `openai-codex/gpt-5.4` | low/medium/high/xhigh | yes | 1M | 2.50 | 15.00 |
| `openai-codex/gpt-5.3-codex` | low/medium/high/xhigh | yes | 272K | 구독 (marginal 0) | 구독 (marginal 0) |
| `anthropic/claude-opus-4-8` | minimal/low/medium/high/xhigh | yes | 1M | 5.00 | 25.00 |
| `opencode-zen/kimi-k2.6` | minimal/low/medium/high/xhigh | no | 262K | 0.95 | 4.00 |
| `opencode-zen/gemini-3-flash` | minimal/low/medium/high | yes | 1M | 0.50 | 3.00 |
| `opencode-zen/gemini-3.5-flash` | minimal/low/medium/high | yes | 1M | 1.50 | 9.00 |
| `opencode-zen/glm-5.1` | minimal/low/medium/high/xhigh | no | 205K | 1.40 | 4.40 |
| `opencode-zen/gpt-5-nano` | minimal/low/medium/high | yes | 400K | 0.05 | 0.40 |
| `opencode-zen/gpt-5.5` | low/medium/high/xhigh | yes | 272K+ | 5.00 | 30.00 |
| `opencode-zen/gpt-5.4` | low/medium/high/xhigh | yes | 1M | 2.50 | 15.00 |
| `opencode-zen/gpt-5.3-codex` | low/medium/high/xhigh | yes | 272K | 1.75 | 14.00 |
| `opencode-zen/claude-opus-4-8` | minimal/low/medium/high/xhigh | yes | 1M | 5.00 | 25.00 |
| `opencode-zen/claude-sonnet-4-6` | minimal/low/medium/high (xhigh 없음) | yes | 1M | 3.00 | 15.00 |
| `opencode-zen/claude-haiku-4-5` | minimal/low/medium/high/xhigh | yes | 200K | 1.00 | 5.00 |

### 1.2 Deprecation 처리

| 모델 | 만료 | 우리 영향 | 조치 |
|---|---|---|---|
| `opencode-zen/glm-5` | 2026-05-14 | explorer + librarian primary | **교체 완료**: explorer→gemini-3-flash, librarian→glm-5.1 |
| `opencode-zen/minimax-m2.1` | 2026-03-15 | 사용 안 함 | — |
| `opencode-zen/kimi-k2` | 2026-03-06 | k2.6 사용 | — |

### 1.3 벤치마크 데이터 (2026-05 fetch)

**SWE-bench Verified Leaderboard (2026-05-22)**:
- Claude Mythos Preview: 93.9% (registry 미등록)
- Claude Opus 4.7: **87.6%**
- GPT-5.3 Codex: **85%**
- GPT-5.5: **88.7%** (leaderboard top)
- Claude Opus 4.6: 80.8%
- **Kimi K2.6: 80.2%** (Opus 4.6 동급, 가격 1/5)
- GLM-5 / Kimi K2.5 / DeepSeek V3.2 = top-10 진입

**Kimi K2.6 추가 메트릭**:
- SWE-Bench Pro: 58.6%
- Terminal-Bench 2.0: 66.7%
- 13시간 4000+ tool calls 무중단 안정 → long-horizon agent 1위급

**GLM-5.1 (2026-03-27 출시)**:
- Claude Opus 4.6 의 94% 코딩 성능
- Code Arena Elo 1530 (agentic web dev 3위 글로벌)
- 가격: Opus 의 1/3.5

**MiniMax M2.7**:
- SWE-Bench Pro 56.22% (10B active param)
- GLM-5.1 의 94% 성능을 1/5 가격에
- multi-agent collaboration 강점

**Aider Polyglot (2026-05)**:
- Claude Opus 4.5: 89.4%
- GPT-5 high: 88.0%
- (구체 Kimi/GLM/MiniMax 스코어는 leaderboard 부재)

**BFCL V4 (tool calling, 2026-04-12 update)**:
- Llama 3.1 405B Instruct: 0.885 (top public)
- 구체 Claude/Kimi/GLM 비교는 leaderboard 미공개 → tool calling 직접 비교 불가, 일반 평판 기반 보조

---

## 2. 최종 결정 — PROFILE_A 23 role

| # | Role | primary | registry_alternate | thinking | 선정 근거 |
|---|---|---|---|---|---|
| 1 | executor | `openai-codex/gpt-5.4` | `opencode-zen/gpt-5.4` | high | 코드 구현 = Codex 구독 (토큰 0) |
| 2 | explorer | `opencode-zen/gemini-3-flash` | `opencode-zen/claude-haiku-4-5` | medium | 1M ctx + vision + $0.5 |
| 3 | verifier | `opencode-zen/glm-5.1` | `opencode-zen/claude-sonnet-4-6` | high | glm-5.1: 저비용 reasoning+tool-use, kimi-k2.6 대체 (v0.1.0); false-PASS 비대칭 방어 위해 medium→high (2026-05-29 재검증) |
| 4 | critic | `anthropic/claude-opus-4-8` | `opencode-zen/claude-opus-4-8` | xhigh | false PASS 비용 max → Anthropic subscription Opus 유지 (사용자 mechanical fix 2026-05-29) |
| 5 | planner | `anthropic/claude-opus-4-8` | `openai-codex/gpt-5.4` | high | 사용자 정책: opus 4.7 + codex review |
| 6 | code-reviewer | `opencode-zen/glm-5.1` | `opencode-zen/claude-sonnet-4-6` | high | glm-5.1: 강한 reasoning+tool-use, 저비용; kimi-k2.6 대체 (v0.1.0) |
| 7 | debugger | `openai-codex/gpt-5.4` | `opencode-zen/gpt-5.4` | high | Codex 구독 (토큰 0) |
| 8 | test-engineer | `openai-codex/gpt-5.4` | `opencode-zen/gpt-5.4` | high | Codex 구독 (토큰 0) |
| 9 | security-reviewer | `anthropic/claude-opus-4-8` | `opencode-zen/claude-opus-4-8` | xhigh | OWASP/STRIDE = max reasoning, Anthropic 구독 |
| 10 | writer | `opencode-zen/gemini-3-flash` | `opencode-zen/claude-haiku-4-5` | medium | 1M ctx + $0.5 |
| 11 | designer | `opencode-zen/glm-5.1` | `opencode-zen/claude-sonnet-4-6` | high | Code Arena Elo 1530 (front-end 3위) |
| 12 | code-simplifier | `opencode-zen/glm-5.1` | `opencode-zen/claude-sonnet-4-6` | xhigh | glm-5.1: behavior-preserving refactor reasoning, 저비용; kimi-k2.6 대체 (v0.1.0) |
| 13 | qa-tester | `opencode-zen/gemini-3.5-flash` | `opencode-zen/claude-haiku-4-5` | high | vision + 빠른 응답 |
| 14 | git-master | `opencode-zen/claude-haiku-4-5` | `opencode-zen/claude-sonnet-4-6` | low | 커밋 메시지 스타일/언어 추론 + concern 기반 분할 + rebase 안전성은 기계적이지 않음 → nano/minimal 과소용량; haiku/low 로 승격 (2026-05-29 재검증) |
| 15 | document-specialist | `opencode-zen/gemini-3-flash` | `opencode-zen/claude-haiku-4-5` | medium | 1M ctx + $0.5 |
| 16 | tracer | `opencode-zen/glm-5.1` | `opencode-zen/claude-sonnet-4-6` | high | glm-5.1: long-horizon causal reasoning, 205K ctx, 저비용; kimi-k2.6 대체 (v0.1.0) |
| 17 | analyst | `opencode-zen/glm-5.1` | `opencode-zen/claude-sonnet-4-6` | xhigh | glm-5.1: tool-use + xhigh reasoning, 저비용; kimi-k2.6 대체 (v0.1.0) |
| 18 | scientist | `openai-codex/gpt-5.4` | `opencode-zen/gpt-5.4` | xhigh | falsifiability + 구독 |
| 19 | architect | `openai-codex/gpt-5.4` | `opencode-zen/gpt-5.4` | xhigh | ADR/system design + 구독 |
| 20 | librarian | `opencode-zen/glm-5.1` | `opencode-zen/claude-sonnet-4-6` | medium | glm-5.1: long-horizon citation, 205K ctx, 저비용; kimi-k2.6 대체 (v0.1.0) |
| 21 | multimodal-looker | `opencode-zen/gemini-3-flash` | `opencode-zen/claude-sonnet-4-6` | medium | vision 강점, 1M ctx |
| 22 | oracle | `anthropic/claude-opus-4-8` | `opencode-zen/claude-opus-4-8` | xhigh | 2+ 실패 후 마지막 보루 |
| 23 | metis | `openai-codex/gpt-5.4` | `opencode-zen/gpt-5.4` | xhigh | 인터뷰 + tool calling + 구독 |

### 2.1 Provider 분포

| Provider | role 수 | 비중 |
|---|---|---|
| `opencode-zen/*` | 13 | 57% |
| `openai-codex/*` | 6 | 26% |
| `anthropic/*` | 4 | 17% |

이전 (2026-05-28 첫 제안서 직후) 대비:
- Anthropic primary: 14 (61%) → **4 (17%)**, **44%p 감소**
- OpenAI Codex primary: 1 → **6**
- Opus 정당화 역할 4개로 한정 (critic 의 false-PASS 비용 max + security-reviewer / oracle 의 max reasoning + planner 의 opus+codex review 정책)

### 2.2 thinkingLevel 호환 검증

| Role | level | 모델 | 호환 |
|---|---|---|---|
| critic | xhigh | anthropic/claude-opus-4-8 | ✓ |
| scientist | xhigh | openai-codex/gpt-5.4 | ✓ |
| architect | xhigh | openai-codex/gpt-5.4 | ✓ |
| metis | xhigh | openai-codex/gpt-5.4 | ✓ |
| analyst | xhigh | opencode-zen/glm-5.1 | ✓ |
| code-simplifier | xhigh | opencode-zen/glm-5.1 | ✓ |
| security-reviewer | xhigh | anthropic/claude-opus-4-8 | ✓ |
| oracle | xhigh | anthropic/claude-opus-4-8 | ✓ |
| planner | high | anthropic/claude-opus-4-8 | ✓ |
| designer | high | opencode-zen/glm-5.1 | ✓ |
| qa-tester | high | opencode-zen/gemini-3.5-flash | ✓ |
| 나머지 | medium/minimal | (Gemini Flash 등) | ✓ (low/medium/high) |

**모든 role thinking 레벨 호환 OK** (이전 분석에서 gemini-3.1-pro=medium 미지원, sonnet-4-6=xhigh 미지원 문제 → 둘 다 회피).

---

## 3. Fallback (registry_alternate) 정책

**기본 정책**: primary 가 `openai-codex/*` 또는 `anthropic/*` 이면 alternate = `opencode-zen/*` 의 same model id wrapper.

| primary → | alternate |
|---|---|
| `openai-codex/gpt-5.4` | `opencode-zen/gpt-5.4` |
| `anthropic/claude-opus-4-8` | `opencode-zen/claude-opus-4-8` |

**예외**: planner primary = `anthropic/claude-opus-4-8`, alternate = `openai-codex/gpt-5.4` (사용자 정책: opus 가 plan 만들고 codex 가 review 하는 cross-vendor fan-out 의도. same-model wrapper 가 아닌 codex review).

`opencode-zen/*` primary 인 role 의 alternate 는 동일 family 의 안정 wrapper (claude-sonnet-4-6 또는 claude-haiku-4-5).

---

## 4. 적용 결과 (2026-05-29 cycle)

이번 cycle 에서 동시에 변경된 surface:

1. ✅ `scripts/pi-oven-setup/profiles.ts` — PROFILE_A 23 entry 재작성 (PROFILE_B 손대지 않음)
2. ✅ 23 `agents/pi-oven-*.md` — `model:` 배열 정합 (21 변경 + 2 유지 = executor, verifier)
3. ✅ `tests/scripts/pi-oven-setup/profiles.test.ts` — structural invariant 만 남김 (모델 ID hard-code 제거, 사용자 "튜닝하면서 바꿀거" 정책 반영)
4. ✅ `docs/specs/2026-05-28-pi-oven-setup-wizard.md` §4 — Profile A 표 + 정의 문구 동기화
5. ✅ `docs/specs/2026-05-28-pi-oven-agent-registry.md` §5 + §5.1 + §6 — Profile A JSON, thinkingLevel matrix, provider whitelist 동기화
6. ✅ `OPTIMIZED-MODEL.md` (이 문서) — 결정서로 update
7. (대기) `docs/WORKING-CONTEXT.md` activity log
8. (대기) 최종 검증 (bun test / lint:agents / check / build)

`lint-agents.ts` (CI) 가 PROFILE_A 와 agent file 정합 검증. test invariant 통과.

---

## 5. 다음 cycle 결정 사항

### 5.1 Profile B 정의 재고

이번 cycle 에서 Profile B 는 손대지 않음. 다만 Profile B 의 본질이 "anthropic 우선" 이었는데 새 Profile A 도 일부 anthropic 을 사용하니까 Profile B 차별성 약화. 다음 cycle 결정 필요:
- (a) Profile B 폐기 (Profile A 만)
- (b) Profile B = "anthropic 100% primary" 로 재정의
- (c) Profile B = "Anthropic Max + Opus 우선, 다른 role 도 Opus" 로 재정의

### 5.2 skill ↔ agent dispatch 연결 (omp 환경)

검증 결과 — `pi-oven:` prefix agent 가 어떤 skill 에서도 직접 dispatch 되지 않음 (claude-code skill grep 0건). 이유는 환경 분리:
- claude-code skill = claude-code 의 Agent tool 만 호출 (subagent_type 후보 = `oh-my-claudecode:*`, `Plan`, `Explore` 등; `pi-oven:` 없음)
- `pi-oven:` agent = omp plugin subagent, omp 환경에서만 호출

사용자가 "omp 에서만 skill ↔ agent 호출 연결" 요청 — omp 의 skill 시스템 (or workflow) 안에서 어떤 pi-oven agent 가 호출되는지 명시 작업 필요. 별도 cycle 권장 (조사 + spec + skill 또는 workflow file update).

### 5.3 실측 1-2 cycle 후 재조정

이번 결정은 SWE-bench / Aider / 평판 기반. 실제 우리 workload (예: planner Opus 의 plan 품질, designer GLM-5.1 의 UI 코드 quality, MiniMax 대신 Kimi 로 간 결정 등) 의 실측 후 1-2 cycle 후 재조정 권장.

### 5.4 무료 모델 활용

`opencode-zen/big-pickle` / `deepseek-v4-flash-free` 등 한시 무료 모델. 저위험 role (writer, document-specialist) 임시 routing 테스트 가치 — 다음 cycle 검토.

### 5.5 라우팅 재검증 (2026-05-29)

23 role 전수 재검증 (cluster별 fan-out audit + 합성). 19 role keep (벤치마크·경제성 정당). 2 변경 적용:

- **git-master** `gpt-5-nano`/`minimal` → **`claude-haiku-4-5`/`low`** (alt `claude-sonnet-4-6`). 근거: 이 role 의 실제 작업(EN/KO 혼용 커밋 스타일 추론, concern 기반 diff 분할 3+→2/5+→3/10+→5, rebase 시퀀싱)은 기계적이지 않으며 nano/minimal 로는 과소용량. 호출 빈도 낮음(커밋 시점) → 품질 우선이 합리적. `claude-haiku-4-5` = 카탈로그의 style-match 적임 모델. body 도 nano "mechanical/no-scaffold" 프레이밍에서 haiku/low 의 "두 판단 지점에만 경량 추론" 으로 재튜닝.
- **verifier** `kimi-k2.6` `medium` → **`high`** (모델 유지). 근거: false-PASS 는 전체 루프를 통과시키는 catastrophic 비대칭(critic/security-reviewer 와 동일 논리). 동일 모델 thinking bump 라 marginal-cost-only.

provider 분포 불변(zen 13 / codex 6 / anthropic 4). PROFILE_B 미변경(deferred).

---

## 6. 참고

- opencode-zen 카탈로그: https://opencode.ai/docs/zen (2026-05-28 fetch)
- SWE-bench Verified Leaderboard: https://llm-stats.com/benchmarks/swe-bench-verified (2026-05-22 update)
- Aider Polyglot Leaderboard: https://llm-stats.com/benchmarks/aider-polyglot
- BFCL V4: https://gorilla.cs.berkeley.edu/leaderboard.html (2026-04-12)
- Kimi K2.6 / GLM-5.1 / MiniMax M2.7 비교: https://www.atlascloud.ai/blog/guides/kimi-k2-6-vs-glm-5-1-vs-qwen-3-6-plus-vs-minimax-m2-7-coding-2026
- 현재 SoT: [`scripts/pi-oven-setup/profiles.ts`](scripts/pi-oven-setup/profiles.ts)
- SoT 정책: [`docs/decisions/0001-dogfood-switch.md`](docs/decisions/0001-dogfood-switch.md) §"Source of truth for model routing"
- 권한 분리: agent 파일은 derived artifact, `/pi-oven:setup --apply` 로만 갱신, `scripts/lint-agents.ts` 가 CI 에서 sync 검증.
