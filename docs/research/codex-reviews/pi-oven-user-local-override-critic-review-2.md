# Spec E (option C) — Critic Review Cycle 2

**Cycle**: 2
**Previous**: `docs/research/codex-reviews/pi-oven-user-local-override-critic-review.md` (cycle 1, option B → 🔴8)
**BLOCKERs resolved since cycle 1**: 8/8 (option C rewrite resolved all cycle-1 BLOCKERs; L1-L6 respected per codex). New cycle-2 BLOCKERs: 3.
**Date**: 2026-05-29
**Spec under review**: `docs/specs/2026-05-29-pi-oven-user-local-override.md` (v2, option C)
**Source**: codex `gpt-5.3-codex` (read-only, high) — raw `/tmp/codex-out-c2.txt` (session in err log). LOCKED PRIOR DECISIONS L1-L6 injected (cycle-1 verdict + option-C facts) → no re-flag of dead-B / settings.pi-oven.

**Gate decision**: **CONTINUE (cycle 3)** — 🔴 3 BLOCKER. No structural redesign (option C stands; codex item 1/5/7 confirm contract + SoT correct). Precise edits → cycle 3.

---

## 🔴 BLOCKER (3) — cycle 3 edits

### Bc2-1. `--override` standalone dispatcher route 미명세
- **codex #2**. `scripts/pi-oven-setup.ts:81` 은 `--profile|--apply` 있을 때만 apply-path 실행, 없으면 `:112` "No action specified" exit. spec §3.3/§3.4 + AC#1/#2 는 standalone `--override critic=...` 를 쓰는데 dispatcher 에 override-first route 가 없음.
- **fix**: §3.4 dispatcher bullet + §3.3 `--override` row 에 명시 — `--override` 가 (값과 함께) 존재하면 `--profile/--apply` 없이도 config.yml override-write route 로 진입. "No action specified" 분기에서 override 케이스 제외. AC#1 에 "standalone `--override` 단독 실행" 명시.

### Bc2-2. MERGE 가 concurrency-safe 아님 + transport 미결정
- **codex #4 (BLOCKER) + NIT**. read-merge-write 는 단일 프로세스 sibling clobber 만 막고 concurrent invocation lost-update 는 못 막음. transport 를 "plan 결정"으로 미룬 건 behavior-level 보장(atomicity + non-`pi-oven:*` 키 보존)을 spec 이 hard-require 할 때만 허용.
- **main 선제 검증**: omp `settings.set(path, val)` 은 path 를 `.` 로 split → `setByPath` 가 **leaf 만** set (sibling 보존, `settings.ts:90,299-300`). 콜론은 `.` 가 아니라 leaf segment 로 안전. → `omp config set task.agentModelOverrides.pi-oven:<role> <model>` 가 **per-key dotted set 으로 형제 키 보존** (pi-oven-side read-merge-write 불필요, lost-update 회피). omp 에 `config/file-lock.ts` 존재.
- **fix**: §3.1 을 behavior 보장으로 hard-require — (a) 모든 non-`pi-oven:*` 키 + 형제 `pi-oven:*` 키 보존, (b) atomic write. **PREFER per-key dotted `omp config set task.agentModelOverrides.pi-oven:<role>`** (sibling-preserving by construction, 쓰기를 omp 에 위임). 직접 YAML fallback 시 file-lock + temp-write+rename atomic 의무. plan 에서 config-cli 의 undeclared dotted-path + 콜론 키 + string 값 수용 여부 smoke 확인.

### Bc2-3. silent-failure validator contract 불명확
- **codex #6 (BLOCKER) + NIT**. §3.5 "`omp --list-models` 또는 registry query" 가 한 메커니즘을 lock 안 함. override 가 pattern-like string 허용하면 naive list-membership 이 valid 입력 오분류. auth-detect 의 provider-row parser (`auth-detect.ts:14,56`) 는 resolver parity 아님 — 재사용 금지.
- **fix**: §3.5 정책 lock = **EXACT-ID-ONLY** (override 값은 단일 model id, pattern 아님 — schema 가 단일 string). override 값을 omp model-registry/resolver 와 동일 의미로 대조 (exact 해소 가능한 id 만 허용), 미해소 시 write 거부. auth-detect parser 재사용 금지 명시. plan 에서 구체 검증 호출(model-registry 조회 또는 resolver) 핀.

---

## ⚪ PUSH-BACK (2) — 반영 (NIT 수준 wording/scope)

### PBc2-1. AC#3/#4 wording 과장
- **codex #3**. `resolved = override ?? frontmatter[0]` 는 runtime registry 해소/fallback 이 아니라 **configured precedence**. "resolved" 명명이 과장. AC#3 의 `progress.resolvedModel` 는 concrete test contract 미핀.
- **fix**: AC#4 명칭 → "configured effective override" + configured precedence 임을 명시 (runtime 해소 아님). AC#3(a) 에 runtime observability 의 구체 검증 방법 핀 (실제 subagent dispatch 후 resolved model 캡처 방법 — model echo 또는 progress.resolvedModel 접근 경로 1개 고정).

### PBc2-2. Wave 병렬 주장 + `--apply` 모호 + custom 문구
- **codex #8**. §9 Wave 3(extension+lint) ∥ 주장 낙관적 — extension drift 제거와 wizard 가 maintainer-generate/rewriter 계약을 공유. `--apply` maintainer semantics vs `apply.ts` rewrite 책임 모호. `--profile custom` "제거" vs "reject 로직 유지" 문구 충돌.
- **fix**: §9 Wave deps 정정 — extension/lint wave 가 agent-rewriter 계약 공유 시 Wave 2 뒤로 sequence (또는 공유 계약 명시). §3.3 `--apply` 명확화: **agent-rewriter 의 유일한 정당 호출처 = maintainer-generate (profiles.ts→repo agents, lint baseline 생성)**; personal `--override` 는 절대 rewrite 안 함. §3.3 custom row + §3.4 문구: "custom" 은 CLI 값에서 제거, dispatcher A\|B 검증 로직은 유지 (모순 아님).

---

## codex 가 확인한 PASS 항목
- item 1 CONTRACT CORRECTNESS: none (§2.1/§3.1/§3.2 정확)
- item 5 SoT + lint invariant: none (colon-name invariant 적절)
- item 7: L1-L6 존중, dead-B/settings.pi-oven 재오픈 없음

---

## 부록 — codex cycle-2 원문
`/tmp/codex-out-c2.txt` (4585 bytes). 위 Bc2-1~3 / PBc2-1~2 로 categorize 완료.
