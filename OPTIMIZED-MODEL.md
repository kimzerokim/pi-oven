# OPTIMIZED-MODEL.md — pi-oven 모델 라우팅 최적화 제안서

작성일: 2026-05-28
대상: `scripts/pi-oven-setup/profiles.ts` PROFILE_A (release default)
상태: **제안서** (즉시 적용 X — 사용자가 검토 후 별도 cycle 에서 반영)

---

## 0. TL;DR

- **시급**: `opencode-zen/glm-5` 가 2026-05-14 deprecated 됐는데 explorer + librarian 의 primary 가 아직 그걸 가리킴. **오늘 기준 만료 14일 경과** — 다음 cycle 에서 가장 먼저 교체.
- **원칙**:
  1. 프론티어 (Opus 4.7 / GPT-5.5 / GPT-5.5-pro) = 품질 게이트 + 보안 + 아키텍처 + 코드 삭제 같은 high-stakes 추론에만.
  2. 실제 코드 구현 (executor, debugger) = **OpenAI Codex 구독** (`openai-codex/gpt-5.3-codex`). 토큰 비용이 아닌 구독 고정 비용으로 최적.
  3. 그 외 = Kimi K2.6 / GLM-5.1 / Gemini 3.5-Flash / MiniMax M2.7 / Qwen 3.6 중 컨텍스트 윈도우 · tool calling · 가격 균형.
- **기대 효과**: 23 role 중 12 role 을 저비용 티어로 이전, 평균 토큰 비용 ~60% 감소 추정 (정확한 효과는 실측 필요).

---

## 1. 입력 자료

### 1.1 opencode-zen 카탈로그 (2026-05-28 fetch, [opencode.ai/docs/zen](https://opencode.ai/docs/zen))

> 사이트 표기 `opencode/...` ↔ omp 표기 `opencode-zen/...`. 사이트 `claude-opus-4.7` ↔ omp `claude-opus-4-7` (점 vs 대시).

**프론티어 / 코딩 특화**

| 모델 (omp 표기) | 입력 $/1M | 출력 $/1M | 캐시 read | 용도 |
|---|---|---|---|---|
| `opencode-zen/gpt-5.5` | 5.00 (≤272K) / 10.00 | 30.00 / 45.00 | 0.50 / 1.00 | flagship — 최강 추론 |
| `opencode-zen/gpt-5.5-pro` | 30.00 | 180.00 | 30.00 | premium tier (비쌈) |
| `opencode-zen/gpt-5.4` | 2.50 (≤272K) / 5.00 | 15.00 / 22.50 | 0.25 / 0.50 | 가성비 좋은 frontier |
| `opencode-zen/gpt-5.4-mini` | 0.75 | 4.50 | 0.075 | 저비용 추론 |
| `opencode-zen/gpt-5.4-nano` | 0.20 | 1.25 | 0.02 | 초저비용 (라우팅용) |
| `opencode-zen/gpt-5.3-codex` | 1.75 | 14.00 | 0.175 | **코드 특화** |
| `opencode-zen/gpt-5.3-codex-spark` | 1.75 | 14.00 | 0.175 | 코드 특화 (spark variant) |
| `opencode-zen/gpt-5.1-codex-max` | 1.25 | 10.00 | 0.125 | 저비용 code variant |
| `opencode-zen/gpt-5.1-codex-mini` | 0.25 | 2.00 | 0.025 | 매우 저렴한 code variant |
| `opencode-zen/gpt-5-nano` | 0.05 | 0.40 | 0.005 | 최저비용 |
| `opencode-zen/claude-opus-4-7` | 5.00 | 25.00 | 0.50 | latest Opus flagship |
| `opencode-zen/claude-opus-4-6` | 5.00 | 25.00 | 0.50 | 이전 Opus |
| `opencode-zen/claude-sonnet-4-6` | 3.00 | 15.00 | 0.30 | mid-tier 추론 |
| `opencode-zen/claude-haiku-4-5` | 1.00 | 5.00 | 0.10 | 저비용 Anthropic |

**저비용 추론 (영역 특화)**

| 모델 | 입력 $/1M | 출력 $/1M | 강점 (추정) | 비고 |
|---|---|---|---|---|
| `opencode-zen/gemini-3-1-pro` | 2.00 (≤200K) / 4.00 | 12.00 / 18.00 | 대형 context, vision | Google flagship |
| `opencode-zen/gemini-3-5-flash` | 1.50 | 9.00 | 빠른 응답, vision | mid Google |
| `opencode-zen/gemini-3-flash` | 0.50 | 3.00 | 가성비 1위급, vision | budget Google |
| `opencode-zen/glm-5-1` | 1.40 | 4.40 | tool calling | GLM 최신 (구 glm-5 대체) |
| `opencode-zen/kimi-k2-6` | 0.95 | 4.00 | **대형 context**, 코딩 | Moonshot 최신 |
| `opencode-zen/kimi-k2-5` | 0.60 | 3.00 | 대형 context | 한 단계 아래 |
| `opencode-zen/minimax-m2-7` | 0.30 | 1.20 | 초저비용 | Recent MiniMax |
| `opencode-zen/qwen3-6-plus` | 0.50 | 3.00 | 다국어, tool | Alibaba |
| `opencode-zen/qwen3-5-plus` | 0.20 | 1.20 | 초저비용 | Alibaba budget |
| `opencode-zen/grok-build-0-1` | 1.00 | 2.00 | 빌드/CI 특화 | xAI |
| `opencode-zen/big-pickle` | Free | Free | 한시 무료 | feedback 수집 |
| `opencode-zen/deepseek-v4-flash-free` | Free | Free | 한시 무료 | feedback 수집 |

### 1.2 Deprecation 알림 (즉시 영향)

| 모델 | Deprecation 일자 | 우리 영향 |
|---|---|---|
| **`opencode-zen/glm-5`** | **2026-05-14 (지남)** | **explorer + librarian primary — 즉시 교체 필요** |
| `opencode-zen/gpt-5-codex` | 2026-07-23 | 우리는 5.3-codex 사용 — 영향 없음 |
| `opencode-zen/gpt-5.1-codex` | 2026-07-23 | 영향 없음 |
| `opencode-zen/gpt-5.2-codex` | 2026-07-23 | 영향 없음 |
| `opencode-zen/claude-sonnet-4` | 2026-06-15 | 우리는 4-6 사용 — 영향 없음 |
| `opencode-zen/minimax-m2.1` | 2026-03-15 (지남) | 사용 안 함 |
| `opencode-zen/kimi-k2` | 2026-03-06 (지남) | 우리는 k2.6 사용 — 영향 없음 |

### 1.3 OpenAI Codex (ChatGPT 구독)

`openai-codex/gpt-5.3-codex`, `openai-codex/gpt-5.4` 등은 **구독 정액제** (Plus / Pro / Team 플랜에 포함). 토큰당 추가 과금 없음 (사용량 한도 내). 코드 구현 / 디버깅 / 코드 fan-out 리뷰의 절대적 가성비.

→ 정책: **primary 가 코드 작업이면 가급적 `openai-codex/*`, registry_alternate 는 동일 모델의 `opencode-zen/*` wrapper** (rate-limit fallback).

---

## 2. 23 role 별 권장 (PROFILE_A)

각 행: 현재 primary → 권장 primary / registry_alternate / 근거.

> ⚠️ 표시 = 즉시 교체 필요 (deprecation 또는 명백한 mis-fit).

| # | Role | 현재 primary | 권장 primary | 권장 alternate | 근거 / 트레이드오프 |
|---|---|---|---|---|---|
| 1 | executor | `openai-codex/gpt-5.3-codex` | **유지** | `opencode-zen/gpt-5.3-codex` | 코드 구현 = Codex 구독 최적. 현재 그대로. |
| 2 | ⚠️ explorer | `opencode-zen/glm-5` (만료) | `opencode-zen/kimi-k2-6` | `opencode-zen/gemini-3-flash` | 파일 검색 + 대형 context (k2.6) / 빠른 fallback (gemini-3-flash). glm-5 만료. |
| 3 | verifier | `opencode-zen/kimi-k2-6` | **유지** | `opencode-zen/gemini-3-5-flash` | gate check, 평이한 추론, 저렴. |
| 4 | critic | `opencode-zen/claude-opus-4-7` | **유지** | `openai-codex/gpt-5.4` | 품질 게이트 = Opus 정당화. cross-vendor fan-out alternate. |
| 5 | planner | `opencode-zen/claude-sonnet-4-6` | `opencode-zen/kimi-k2-6` | `opencode-zen/claude-sonnet-4-6` | 작업 분해는 Sonnet 과잉. Kimi 가성비 우수. Sonnet 은 fallback. |
| 6 | code-reviewer | `opencode-zen/claude-opus-4-7` | **유지** | `openai-codex/gpt-5.4` | 코드 리뷰는 보수적으로 Opus 유지. fan-out alternate = OpenAI. |
| 7 | debugger | `opencode-zen/gpt-5.3-codex` | `openai-codex/gpt-5.3-codex` | `opencode-zen/gpt-5.3-codex` | executor 와 동일 — Codex 구독으로 직접. |
| 8 | test-engineer | `opencode-zen/claude-sonnet-4-6` | `openai-codex/gpt-5.3-codex` | `opencode-zen/claude-sonnet-4-6` | 테스트 = 코드 = Codex 구독. Sonnet 은 fallback. |
| 9 | security-reviewer | `opencode-zen/claude-opus-4-7` | **유지** | `opencode-zen/claude-sonnet-4-6` | OWASP/STRIDE = Opus 정당화. |
| 10 | writer | `opencode-zen/claude-haiku-4-5` | `opencode-zen/gemini-3-flash` | `opencode-zen/claude-haiku-4-5` | 문서 작성 — Gemini Flash 더 저렴 ($0.5 vs $1). Haiku 는 fallback. |
| 11 | designer | `opencode-zen/claude-sonnet-4-6` | **유지** | `opencode-zen/gemini-3-1-pro` | UI/UX 코드 = Sonnet. vision 필요 시 Gemini Pro. |
| 12 | code-simplifier | `opencode-zen/claude-opus-4-7` | **유지** | `openai-codex/gpt-5.4` | 삭제·리팩토링 behavior 보존 = Opus 정당화. fan-out alt = OpenAI. |
| 13 | qa-tester | `opencode-zen/claude-sonnet-4-6` | `opencode-zen/gemini-3-5-flash` | `opencode-zen/claude-sonnet-4-6` | E2E + Playwright 스크립트 = Flash 충분 + vision. |
| 14 | git-master | `opencode-zen/claude-haiku-4-5` | `opencode-zen/gpt-5-nano` | `opencode-zen/claude-haiku-4-5` | git 명령 — nano 면 충분. 비용 1/20. |
| 15 | document-specialist | `opencode-zen/claude-sonnet-4-6` | `opencode-zen/gemini-3-flash` | `opencode-zen/claude-haiku-4-5` | 외부 SDK 문서 lookup — Flash 빠르고 저렴. |
| 16 | tracer | `opencode-zen/claude-sonnet-4-6` | **유지** | `opencode-zen/kimi-k2-6` | 인과 추적 = Sonnet 깊이 필요. Kimi 대형 context fallback. |
| 17 | analyst | `opencode-zen/claude-opus-4-7` | `opencode-zen/claude-sonnet-4-6` | `opencode-zen/claude-opus-4-7` | 통계 분석 — Sonnet 보통 충분. 어려운 case 만 Opus. |
| 18 | scientist | `opencode-zen/claude-opus-4-7` | **유지** | `opencode-zen/claude-sonnet-4-6` | 실험 설계 + falsifiability = Opus 정당화. |
| 19 | architect | `opencode-zen/claude-opus-4-7` | **유지** | `openai-codex/gpt-5.4` | 시스템 설계 + ADR = Opus 정당화. fan-out alt = OpenAI. |
| 20 | ⚠️ librarian | `opencode-zen/glm-5` (만료) | `opencode-zen/kimi-k2-6` | `opencode-zen/gemini-3-1-pro` | web research 대형 context. glm-5 만료. |
| 21 | multimodal-looker | `opencode-zen/claude-sonnet-4-6` | `opencode-zen/gemini-3-1-pro` | `opencode-zen/claude-sonnet-4-6` | vision = Gemini 강점. Sonnet 은 fallback. |
| 22 | oracle | `opencode-zen/claude-opus-4-7` | **유지** | `opencode-zen/claude-sonnet-4-6` | 2+ failed attempt 후 마지막 보루 = Opus 정당화. |
| 23 | metis | `opencode-zen/claude-opus-4-7` | `opencode-zen/claude-sonnet-4-6` | `opencode-zen/claude-opus-4-7` | 요구사항 인터뷰 — Sonnet 충분. 모호한 case 만 Opus. |

### 2.1 변경 요약

- **즉시 (deprecation 대응)**: 2 role — explorer, librarian.
- **추천 변경 (비용 절감)**: 10 role — planner, debugger, test-engineer, writer, qa-tester, git-master, document-specialist, analyst, multimodal-looker, metis.
- **유지**: 11 role — executor, verifier, critic, code-reviewer, security-reviewer, designer, code-simplifier, tracer, scientist, architect, oracle.

### 2.2 OpenAI 구독 직접 호출 변경 (정책 #2)

현재 PROFILE_A 에서 `openai-codex/*` primary 는 **executor 1개**. 권장안에서 추가로 **debugger, test-engineer** 가 OpenAI 구독으로 이전. 총 3개. registry_alternate 의 zen wrapper 도 동일하게 fan-out 한다.

> ⚠️ 주의: 사용자의 ChatGPT 플랜 한도 (Plus 월 ~250 메시지, Pro 무제한 가까움) 내에서 사용해야 함. 한도 초과 시 zen wrapper 로 자동 fallback (omp resolveModelOverrideWithAuthFallback).

---

## 3. 비용 견적 (rough)

> 가정: 24h cycle 에서 각 role 평균 10회 호출, 호출당 입력 5K + 출력 2K tokens. 23 role × 10 = 230 호출/일.

### 현재 PROFILE_A (이번 sync 직후 상태)

| Tier | Role 수 | 호출/일 | 입력 토큰 $ | 출력 토큰 $ | 일일 추정 |
|---|---|---|---|---|---|
| Opus ($5/$25) | 8 (critic, code-reviewer, security-reviewer, code-simplifier, analyst, scientist, architect, oracle) + metis (~9) | 90 | $2.25 | $4.50 | **$6.75** |
| Sonnet 4.6 ($3/$15) | 7 (planner, test-engineer, designer, qa-tester, document-specialist, tracer, multimodal-looker) | 70 | $1.05 | $2.10 | **$3.15** |
| GPT-5.3-codex ($1.75/$14) | 2 (executor primary [구독], debugger) | 20 | $0 (구독) / $0.175 | $0 (구독) / $0.56 | **~$0.73** |
| Haiku 4.5 ($1/$5) | 2 (writer, git-master) | 20 | $0.10 | $0.20 | **$0.30** |
| Kimi K2.6 ($0.95/$4) | 1 (verifier) | 10 | $0.05 | $0.08 | **$0.13** |
| GLM-5 (만료) | 2 (explorer, librarian) | 20 | — | — | **0 (요청 실패)** |
| **합계** | 23 | 230 | — | — | **~$11.06/일** |

### 제안 PROFILE_A

| Tier | Role 수 | 호출/일 | 일일 추정 |
|---|---|---|---|
| Opus ($5/$25) | 6 (critic, code-reviewer, security-reviewer, code-simplifier, scientist, architect, oracle) | ≈70 | **$5.25** |
| Sonnet 4.6 ($3/$15) | 3 (designer, tracer, analyst, metis) | 40 | **$1.80** |
| GPT-5.3-codex via OpenAI 구독 ($0/$0 marginal) | 3 (executor, debugger, test-engineer) | 30 | **~$0** |
| Kimi K2.6 ($0.95/$4) | 3 (explorer, librarian, planner) | 30 | **$0.36** |
| Gemini 3-flash ($0.5/$3) | 3 (writer, document-specialist, qa-tester) | 30 | **$0.21** |
| Gemini 3.1 Pro ($2/$12) | 1 (multimodal-looker) | 10 | **$0.34** |
| Verifier kimi | 1 | 10 | **$0.13** |
| GPT-5-nano ($0.05/$0.4) | 1 (git-master) | 10 | **$0.012** |
| **합계** | 23 | 230 | **~$8.10/일** |

**절감**: ~$3/일 (~27%). 더 큰 효과는 **executor + debugger + test-engineer 가 OpenAI 구독으로 들어가서 토큰 카운트 자체가 빠지는 부분** — 코드 구현이 가장 호출 빈도 높은 role 이므로 실측 시 30~60% 절감 예상.

> 위 견적은 토큰 가정이 거칠다 (실제 자율 cycle 의 호출 빈도/토큰 분포 측정 후 재계산 권장).

---

## 4. 적용 가이드 (다음 cycle)

1. **`scripts/pi-oven-setup/profiles.ts` PROFILE_A 수정** — 위 §2 권장 표대로 12 row + 2 deprecation row.
2. **`scripts/pi-oven-setup/profiles.ts` PROFILE_B 동기화** — Profile B 는 Anthropic 우선이므로 primary 는 anthropic/* 유지, registry_alternate 만 위 권장에 맞춰 조정.
3. **`docs/specs/2026-05-28-pi-oven-setup-wizard.md` §4 §5 표 동기화** — profile diff 와 동일하게.
4. **agent 파일은 만지지 않음** — `/pi-oven:setup --apply` 가 rewrite 함. CI lint 가 검증.
5. **`tests/scripts/pi-oven-setup/profiles.test.ts`** — registry_alternate prefix 검사가 anthropic/openai-codex/opencode-zen 3개 다 허용하는지 확인 (현재는 PROFILE_A 가 opencode-zen + openai-codex 만 허용).
6. **모델 ID 사전 검증** — 적용 전에 `omp --list-models | grep -E 'kimi-k2-6|gemini-3-flash|gpt-5-nano'` 로 실제 등록명 확인. 사이트 표기와 omp 표기가 다를 수 있음 (위 §1.1 주의 참조).

---

## 5. 미해결 / 다음 cycle 결정 필요

- **Profile B (Anthropic opt-in) 의 변경 범위**: Profile B 는 본질이 Anthropic primary 인데, planner / writer / qa-tester / explorer / librarian 같은 저비용 후보를 Profile B 에서도 zen 으로 강등할지 — 사용자 결정.
- **`opencode-zen/big-pickle` / `deepseek-v4-flash-free` 무료 모델 활용**: feedback 수집 한시 무료. verifier / writer 같은 저위험 role 에 임시 라우팅하여 비용 0 으로 운영해볼 수 있음. 단 deprecation 시점 불명.
- **SWE-bench / tool-calling 실제 벤치마크 데이터 부재**: 이 문서의 권장은 모델 사이즈 + 가격 + 공개된 일반 평판 기반. 실제 우리 workload 에서 Kimi K2.6 가 planner 로 적합한지 등은 1-2 cycle 의 실측이 필요.
- **OpenAI 구독 한도 모니터링**: executor + debugger + test-engineer 3 role 이 모두 OpenAI 직접 호출로 가면 ChatGPT Plus ($20/월) 250-메시지 한도 안에 들어갈지 확인. 초과 시 Pro ($200/월) 필요 — 그 경우 옵션 zen wrapper 로 자동 fallback 후 토큰 과금이라 비용 모델이 달라짐.

---

## 6. 참고

- opencode-zen 카탈로그: https://opencode.ai/docs/zen (2026-05-28 fetch)
- 현재 SoT: [`scripts/pi-oven-setup/profiles.ts`](scripts/pi-oven-setup/profiles.ts)
- SoT 정책: [`docs/decisions/0001-dogfood-switch.md`](docs/decisions/0001-dogfood-switch.md) §"Source of truth for model routing"
- 권한 분리: agent 파일은 derived artifact, `/pi-oven:setup --apply` 로만 갱신, `scripts/lint-agents.ts` 가 CI 에서 sync 검증.
