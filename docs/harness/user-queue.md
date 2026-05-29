# Autonomous Run — User Decision Queue

Per `docs/specs/2026-05-27-pi-oven-foundation-design.md` Section 3 (Layer 4) + pi-oven `user-queue` 패턴. 자율 실행 중 ambiguous decision 또는 외부 의존성 누락 시 Pending entry append + 사용자 복귀 시 batch resolve.

---

## Pending

### Q-NIGHTLY-AB-C-REVIEW-001

- **Date opened:** 2026-05-28 (autonomous overnight run)
- **Cycle:** Model routing + subagent consolidation initiative (post-v0.1.0)
- **Branch:** `feature/standard-expansion` (사용자 명시, push 보류)
- **Scope:** Spec A (agent registry) + Spec B (setup wizard) + Spec C (skill rewrite + new skills). 각 spec = draft → codex critic cycle (PASS = BLOCKER 0 + no structural change) → TDD implement → tests pass → semantic commit (per-spec). 외부 의존 0 (omc/omo refs 제거, superpowers attribution 만), 모든 SKILL.md / agent file / code comment English only.
- **Tentative defaults (자율 결정, wake 시 review):**
  - Agent file path: `agents/pi-oven/<role>.md` 폴더 구조 + dispatch namespace `pi-oven:<role>`. omp 가 폴더 + namespace 미지원 시 fallback `agents/pi-oven-<role>.md` flat + frontmatter `name: pi-oven:<role>`. 실측 검증 = sub-agent 가 직접 omp CLI 호출로 확인.
  - Default model map: opencode-zen 기준 (배포판 default). anthropic opt-in profile 은 wizard 가 user 본인 환경 인증 감지 시 활성.
  - 25 agent: MUST 7 + SHOULD 8 + NICE 4 + omo absorbed 4 (librarian/multimodal-looker/oracle/metis) + 2 새 skill (deep-init, deep-dive — Spec C scope).
  - omc 흡수: autopilot/ralph/ultrawork → autonomous-loop 보강; trace → debugger 보강; verify → fresh-verifier 보강; team → 새 skill (Plan 3 wiring); ralplan 제외 (spec-and-review 와 중복).
  - omo 흡수: BLOCKED_TOOLS=[task] 패턴을 explore/research 계열 전체에 적용; `mode: subagent` (UI selection 무시) 전역.
  - ai-slop-cleaner: omc 가 더 강력 (deletion-first, regression-safe) → pi-oven-code-simplifier systemPrompt 에 inline. 별도 agent 안 만듦.
  - Commit policy: per-spec single semantic commit (history clean). push 보류 — 사용자 wake 후 review + 명시 confirm.
  - TDD policy: red→green→refactor; tests must pass before semantic commit; 다음 spec 진행 전에 commit 끝.
  - omp 실측 검증: spec/implementation 작성 중 omp CLI 의 폴더/namespace/before_agent_start 지원 여부 등은 sub-agent 가 직접 Bash 로 omp 명령 호출하여 확인 (main 은 dispatch+review only).
- **User action required at wake:**
  1. `git log --oneline feature/standard-expansion ^main | head` — 최대 3 commit (Spec A/B/C 각 1)
  2. 각 spec 의 `docs/specs/2026-05-28-pi-oven-*.md` + critic verdict 파일 review
  3. 23 agent file `agents/pi-oven/*.md` 본문 sample 확인 (executor / explorer / verifier 등)
  4. `/pi-oven:setup` wizard UX 확인
  5. SKILL.md rewrite 결과 (12 + new skills) spot-check
  6. Push 결정 — `git push origin feature/standard-expansion` (또는 main merge 결정)
- **Status:** Pending (사용자 wake 시 resolve)

---

### Q-SPEC-E-CYCLE2-SCOPE

- **Date opened:** 2026-05-29
- **Branch:** `feature/standard-expansion` (사용자 명시: 현재 브랜치, 직접 커밋, PR 없음, push 보류)
- **Context:** pi-oven-setup stale 감사 (`docs/harness/surveys/2026-05-29-pi-oven-setup-stale-audit.md`) → 모델 override spine 이 dead namespace 에 write. Option C (settings `task.agentModelOverrides`) locked. 아래 항목은 tentative default 로 진행, frozen spec review 게이트에서 사용자 확정.
- **Tentative defaults (자율 진행):**
  - **Q-SCOPE-CYCLE2** — 구현 범위: CORE rewire (A1–A6) + flag 정리 (I2 `--profile custom` 제거, I4 `confirm-auth` 제거) + lint colon-name invariant (I3) + extension drift 제거 (A6) + command-doc 재작성 (I5) + opus-4-7→4-8 stale sweep (I7/I8) + project-memory sed 제거 (I8). 현재 브랜치 직접 커밋.
  - **Q-DISTRIBUTION-A7** — 23 agents main merge + version SoT (package.json 0.1.0 vs manifest 0.1.0) + CI parity: **DEFER**. main 접근은 contract 밖 (release-gating 별도 task).
  - **Q-MODELS-YML** — orphaned `models.yml` (0 readers, stale ids): **DELETE** + 참조 제거 (audit I6 권고).
  - **Q-VERSION-SOT** — version 불일치: **DEFER** (A7 과 묶어 release task).
  - **Q-PROFILE-B** — PROFILE_B opus-4-7 half-migrated: **LEAVE DEFERRED** per memory `project_profile_b_deferred.md`. 단독 bump 금지, flag-only.
- **User action at review gate:** frozen cycle-2 spec + codex verdict review → 위 default 확정/조정.
- **Status:** Pending

---

## Resolved

### Q-OMP-NOT-INSTALLED-001

- **Date opened:** 2026-05-27 (Plan 0 Task 7)
- **Date resolved:** 2026-05-27 (Plan 0 verify pass)
- **Original trigger:** `which omp` → not found; `~/.omp/` 디렉토리 없음
- **Resolution:** 사용자가 omp 직접 설치 (`curl -fsSL https://omp.sh/install | sh`, bun 1.3.12 → 1.3.14 업그레이드 동반). 이어서 `omp plugin marketplace add kimzerokim/pi-oven` + `omp plugin install pi-oven@pi-oven` 완료. 검증된 install 경로: `~/.omp/plugins/cache/plugins/pi-oven___pi-oven___0.1.0/` (Plan 1 종료 시점 v0.1.0 으로 upgrade 예정).
- **Side effect captured:** 실제 omp v15.5.3 install layout 이 spec assumption (`~/.omp/plugins/pi-oven/` + `omp-plugins.lock.json`) 과 달랐음 → `docs/instincts/omp-install-layout.md` 신규 작성, spec Section 4 수정 (commit `0736bf9`), `docs/adr/0001-omp-marketplace-distribution.md` Post-v0.1.0 Observed Layout 섹션 추가.
