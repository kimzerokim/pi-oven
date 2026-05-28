# Working Context

Last updated: 2026-05-29

## Purpose

pi-oven v1 build. omp marketplace plugin as single successor for 5 frozen sources (omc / omo / Pocock / superpowers / pi-oven).

## Current Sprint

- **Model routing + subagent consolidation initiative** (post-v0.1.0). 3-spec split + per-spec semantic commit + autonomous overnight run on `feature/standard-expansion`:
  - **Spec A — Agent registry** — **ACCEPT cycle 4** + IMPL complete: 23 pi-oven-prefixed agent files (`agents/pi-oven-*.md`), load-time validator in `.omp/extensions/pi-oven.ts`, CI-time hard lint (`scripts/lint-agents.ts` + `package.json scripts.lint:agents`), 18 tests pass.
  - **Spec B — Setup wizard** — **ACCEPT cycle 4** + IMPL complete: `/pi-oven:setup` LLM-driven prompt template (`commands/pi-oven-setup.md`), batch CLI (`scripts/pi-oven-setup.ts` + 11 submodules under `scripts/pi-oven-setup/`), Profile A (opencode-zen+openai-codex default) / Profile B (anthropic opt-in), agent-file source-of-truth + plugin-config informational, `session_start` drift detection + parent-session capture, agent-file-presence ALLOWED_PREFIXES (no `pi.getPluginSettings` from extension), 145 tests pass.
  - **Spec C — Skill rewrite + new skills (deep-init, deep-dive, team)** — **ACCEPT cycle 3** + IMPL complete: 12 SKILL.md sweep (omc/omo refs → pi-oven:*, narrative Korean → English, references/* in scope), 3 new skills (deep-init / deep-dive / team) with 9 scenarios, autonomous-loop boost (autopilot + ralph + ultrawork patterns, 129→192 lines), fresh-verifier boost (verify + verification-before-completion, 80→135 lines), plugin.json + marketplace.json + pi-oven.ts setLabel → v0.1.0, 152 tests pass.

**v0.1.0 baseline ready**: 23 pi-oven-* agents + /pi-oven:setup wizard + 15 self-contained skills + provider whitelist (opencode-zen + openai-codex + anthropic opt-in). Zero external dispatch dependency.
- **Push deferred** — overnight commits stay local; user wake review per `docs/harness/user-queue.md` Q-NIGHTLY-AB-C-REVIEW-001.

## Active Queues

- Plan 0: 8 tasks (scaffold + publish + install verify)
- Plan 1 (queued): Bootstrap 12 core skills
- Plan 2/3/4 (deferred): Standard expansion / TS extension / Polish + release

## Current Constraints

- omp-only (Q2). Claude Code cross-harness 동작은 부산물, maintain 안 함.
- Distributed SoT (Approach B). No `harness-share.md` hub.
- Codex OAuth + Zen 양대 default. Anthropic native opt-in.

## Latest Execution Notes

- 2026-05-29: **PROFILE_A benchmark-based routing revision (OPTIMIZED-MODEL.md)**. SWE-bench Verified / Aider polyglot / Atlas Cloud 비교 기반 재구성. Anthropic primary 비중 14/23(61%) → 4/23(17%) — planner(opus+codex review), critic(opus, mechanical fix), security-reviewer(opus), oracle(opus). OpenAI Codex primary 1→6 (executor/debugger/test-engineer=gpt-5.3-codex, scientist/architect/metis=gpt-5.4). 신규 모델 활용: kimi-k2.6 (6 role — verifier/code-reviewer/code-simplifier/tracer/analyst/librarian), gemini-3-flash (4 role — explorer/writer/document-specialist/multimodal-looker), gemini-3.5-flash (qa-tester), glm-5.1 (designer, Code Arena Elo 1530), gpt-5-nano (git-master). Deprecation 처리: opencode-zen/glm-5 (2026-05-14 만료) 사용 role 모두 교체. Fallback 정책: opencode-zen 동일 모델 wrapper (예외: planner alternate = openai-codex/gpt-5.4 codex review). Surface 동기화: profiles.ts PROFILE_A + 23 agent file + setup-wizard.md §4 + agent-registry.md §5/§5.1/§6 + OPTIMIZED-MODEL.md (제안서 → 결정서). PROFILE_B 손대지 않음 (다음 cycle 결정). 사용자 정책: test 의 모델 ID hard-code 제거 (튜닝 자유로움 위해 structural invariant 만), profiles.test.ts + agent-rewriter.test.ts dynamic invariant 로 약화.

- 2026-05-28: **Spec C (skill rewrite + new skills) ACCEPT + IMPL complete**. 3-cycle critic loop (cycle 1 REJECT 3 BLOCKERs — incomplete grep + unanchored omc paths + undefended parallel dispatch → cycle 2 REJECT 3 new BLOCKERs — pi-oven.ts path drift + false per-file Korean assessment + references/* scope contradiction → cycle 3 ACCEPT). Impl 4 phases: SKILL.md sweep (12 files) + 3 new skills + 2 boosts + version bump. v0.1.0 baseline: 15 skills (12 existing + 3 new: deep-init, deep-dive, team), 23 pi-oven-* agents (Spec A), /pi-oven:setup wizard (Spec B). plugin.json + marketplace.json + pi-oven.ts setLabel all → v0.2.0. 152 tests pass.
- 2026-05-28: **Spec B (setup wizard) ACCEPT + IMPL complete**. 4-cycle critic loop (cycle 1 REJECT 1 CRITICAL + 9 MAJOR → cycle 2 REJECT 5 new BLOCKERs (API-surface verification failures) → cycle 3 REJECT 2 BLOCKERs (false-premise + undefined symbol) → cycle 4 ACCEPT). Impl: `/pi-oven:setup` LLM-driven prompt template + batch CLI dispatcher with 11 submodules (profiles, cache-resolver, auth-detect, agent-rewriter, persist, status, import, reset, validate, apply, reapply) + 127 new tests (Phase 1-3 sum = 24+19+68 = 111; Phase 4 +16; total Spec B addition = 127, bun test = 145 / lint:agents exit 0 / typecheck + build clean). `.omp/extensions/pi-oven.ts` refactored: agent-file-presence dynamic ALLOWED_PREFIXES, session_start drift detection + parent-session model capture to `~/.omp/plugins/pi-oven-session-model.json`. Profile A (release default opencode-zen + openai-codex) / Profile B (anthropic opt-in, sonnet-4-6 + opus-4-7 + haiku-4-5; explorer + librarian keep opencode-zen/glm-5 for 1M context). Source of truth = agent file (`agents/pi-oven-*.md` model:` array); plugin config = wizard state storage.
- 2026-05-28: **Spec A (agent registry) ACCEPT + IMPL complete**. 4-cycle critic loop (cycle 1 REJECT 5 BLOCKERs → cycle 2 REJECT 2 new BLOCKERs → cycle 3 REJECT 1 structural BLOCKER → cycle 4 ACCEPT). Impl: 23 agent files `agents/pi-oven-*.md` (omc + omo source absorbed, English bodies), load-time validator in `.omp/extensions/pi-oven.ts` (Profile A guarantee soft-error logging), CI-time hard lint at `scripts/lint-agents.ts`, 18 bun tests pass (5 existing + 7 lint-agents + 6 pi-oven extension). Provider whitelist = opencode-zen + openai-codex + anthropic (opt-in). All defaults = opencode-zen + openai-codex only (anthropic opt-in for user environments). flat layout `agents/pi-oven-<role>.md` with frontmatter `name: pi-oven:<role>` (omp discovery is flat-only, folder layout fallback unused).
- 2026-05-27: **Plan 1 v0.1.0 published — 12 core skills shipped + dogfood switch met**. Task 12 commit a8327a8 (autonomous-loop meta orchestrator — ralph + Sisyphus + boundary merge). Task 13 acceptance: 12 SKILL.md verified, plugin.json count 12, canary dogfood scenario authored (`evals/dogfood/scenarios/v0.1.0-end-to-end.yaml`), `docs/decisions/0001-dogfood-switch.md` written. Tag v0.1.0 + gh release published. Eval execution deferred to Plan 4 (LLM provider key bootstrap).
- 2026-05-27: **Plan 1 Tasks 1-11 complete** (commits 5a83781 → 20125d4 → cab27eb → 3d3a9d3 → ed23632 → a2dd356 → f22f502 → 4186086 → 932ff79 → 3330b3b → 107ae99). 11 skills ported: code-quality-discipline / eval-runner / tdd-strict / brainstorming / writing-plans / codebase-survey / spec-and-review / large-task-delegation / fresh-verifier / pre-commit-gate / subagent-driven-development. Task 2 = eval-runner real impl (TDD-tested, omp SDK subscribe-pattern, 6 tests pass).
- 2026-05-27: **Plan 1 spec-and-review cycle 2 ACCEPT** (commit 56d535b) — cycle 1 10 BLOCKERs resolved with SDK type evidence; cycle 2 9 NITs optional non-blocking.
- 2026-05-27: **Plan 1 cycle 1 REJECT** (commit 24f18a1) — eval-runner SDK contract hallucinated; cycle 2 revision applied (commit 5e0d23a).
- 2026-05-27: **v0.1.0 rename + republish complete** — pi-oven@pi-oven-marketplace → **pi-oven@pi-oven**. GitHub repo renamed `pi-oven` → `pi-oven`. Old omp install uninstalled + new added/installed (installPath: `~/.omp/plugins/cache/plugins/pi-oven___pi-oven___0.1.0`). Tag v0.1.0 + GitHub release published. Surgical rename (identifier only; project codename "pi-oven" preserved in spec/SOUL/plan docs).
- 2026-05-27: **Q-OMP-NOT-INSTALLED-001 RESOLVED** — user installed omp via `curl omp.sh/install | sh` (bun 1.3.12→1.3.14 upgrade). marketplace add + plugin install verified live by main.
- 2026-05-27: **Plan 0 scaffold complete** — v0.1.0 published at https://github.com/kimzerokim/pi-oven. Catalog HTTP 200 OK. 7 commits pushed. Verifier (opus) PASS 4/4 (prod-build / stub-sweep / SoT-alignment / spec-freeze).
- 2026-05-27: Foundation design spec committed (`ed6c4c3`). Plan 0 작성 + execute 시작.
- 2026-05-27: brainstorming session (Q1-Q6 + 3 axioms + ECC pattern absorption + memory layer + install lifecycle + testing strategy) 완료.
- 2026-05-27: Previous design + Plan 1 installer foundation (1313 LoC) SUPERSEDED. Pivot to omp-native, marketplace-distributed.

## Update Rule

Detailed for current sprint + blockers + next actions only. Completed work summarized into archive once it stops shaping execution.
