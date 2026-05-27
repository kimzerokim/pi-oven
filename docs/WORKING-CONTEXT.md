# Working Context

Last updated: 2026-05-27

## Purpose

pi-oven v1 build. omp marketplace plugin as single successor for 5 frozen sources (omc / omo / Pocock / superpowers / pi-oven).

## Current Sprint

- **Plan 1 — Bootstrap 12 core skills** — Tasks 0-11 complete (11/12 skills + eval-runner real impl). Plugin.json lists 11 skills. Remaining: Task 12 (autonomous-loop meta) + Task 13 (acceptance + tag v0.1.0). spec-and-review Pattern loop = ACCEPT cycle 2.

## Active Queues

- Plan 0: 8 tasks (scaffold + publish + install verify)
- Plan 1 (queued): Bootstrap 12 core skills
- Plan 2/3/4 (deferred): Standard expansion / TS extension / Polish + release

## Current Constraints

- omp-only (Q2). Claude Code cross-harness 동작은 부산물, maintain 안 함.
- Distributed SoT (Approach B). No `harness-share.md` hub.
- Codex OAuth + Zen 양대 default. Anthropic native opt-in.

## Latest Execution Notes

- 2026-05-27: **Plan 1 Tasks 1-11 complete** (commits 5a83781 → 20125d4 → cab27eb → 3d3a9d3 → ed23632 → a2dd356 → f22f502 → 4186086 → 932ff79 → 3330b3b → 107ae99). 11 skills ported: code-quality-discipline / eval-runner / tdd-strict / brainstorming / writing-plans / codebase-survey / spec-and-review / large-task-delegation / fresh-verifier / pre-commit-gate / subagent-driven-development. Task 2 = eval-runner real impl (TDD-tested, omp SDK subscribe-pattern, 6 tests pass). Plugin.json lists 11 skills. Remaining: Task 12 (autonomous-loop meta orchestrator) + Task 13 (acceptance + tag v0.1.0).
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
