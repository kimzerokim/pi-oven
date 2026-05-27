# Working Context

Last updated: 2026-05-27

## Purpose

pi-oven v1 build. omp marketplace plugin as single successor for 5 frozen sources (omc / omo / Pocock / superpowers / pi-oven).

## Current Sprint

- **v0.1.0 (Plan 0 + rename patch)** — Scaffold + GitHub repo + omp marketplace add + plugin install verify + identifier rename. **Completed.** STOP for user check-in before Plan 1 (Bootstrap 12 core skills).

## Active Queues

- Plan 0: 8 tasks (scaffold + publish + install verify)
- Plan 1 (queued): Bootstrap 12 core skills
- Plan 2/3/4 (deferred): Standard expansion / TS extension / Polish + release

## Current Constraints

- omp-only (Q2). Claude Code cross-harness 동작은 부산물, maintain 안 함.
- Distributed SoT (Approach B). No `harness-share.md` hub.
- Codex OAuth + Zen 양대 default. Anthropic native opt-in.

## Latest Execution Notes

- 2026-05-27: **v0.1.0 rename + republish complete** — pi-oven@pi-oven-marketplace → **pi-oven@pi-oven**. GitHub repo renamed `pi-oven` → `pi-oven`. Old omp install uninstalled + new added/installed (installPath: `~/.omp/plugins/cache/plugins/pi-oven___pi-oven___0.1.0`). Tag v0.1.0 + GitHub release published. Surgical rename (identifier only; project codename "pi-oven" preserved in spec/SOUL/plan docs).
- 2026-05-27: **Q-OMP-NOT-INSTALLED-001 RESOLVED** — user installed omp via `curl omp.sh/install | sh` (bun 1.3.12→1.3.14 upgrade). marketplace add + plugin install verified live by main.
- 2026-05-27: **Plan 0 scaffold complete** — v0.1.0 published at https://github.com/kimzerokim/pi-oven. Catalog HTTP 200 OK. 7 commits pushed. Verifier (opus) PASS 4/4 (prod-build / stub-sweep / SoT-alignment / spec-freeze).
- 2026-05-27: Foundation design spec committed (`ed6c4c3`). Plan 0 작성 + execute 시작.
- 2026-05-27: brainstorming session (Q1-Q6 + 3 axioms + ECC pattern absorption + memory layer + install lifecycle + testing strategy) 완료.
- 2026-05-27: Previous design + Plan 1 installer foundation (1313 LoC) SUPERSEDED. Pivot to omp-native, marketplace-distributed.

## Update Rule

Detailed for current sprint + blockers + next actions only. Completed work summarized into archive once it stops shaping execution.
