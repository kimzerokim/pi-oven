# Harness Flow Progress

Meta cycle tracking. Each entry = one self-improvement / build cycle of pi-oven.

## 2026-05-28 — Spec A: Agent registry (post-v0.1.0)

- Cycle: pi-oven v0.1.0 → (toward v0.1.0 after Spec A+B+C complete)
- Trigger: Plan 2 dogfood failure — subagent dispatch resolved `oh-my-claudecode:*` namespaced refs as model strings → 401. Root cause: omp has no `subagent_type` registry; all dispatch is file-based.
- Branch: `feature/standard-expansion` (push deferred until user wake review)
- Spec: `docs/specs/2026-05-28-pi-oven-agent-registry.md` (1268 lines, ACCEPT cycle 4)
- Critic cycles: 4 (REJECT 5 BLOCKERs → REJECT 2 new BLOCKERs → REJECT 1 structural → ACCEPT). Verdict files at `docs/research/codex-reviews/2026-05-28-pi-oven-agent-registry-critic-review{,-2,-3,-4}.md`.
- Mode: autonomous overnight run, per-spec semantic commit. push 보류.
- Implementation status: COMPLETE (pending commit).
- Deliverables:
  - 23 agent files in `agents/pi-oven-*.md` (flat layout — omp discovery is flat-only, verified live)
    - MUST 7: executor, explorer, verifier, critic, planner, code-reviewer, debugger (tracer body absorbed)
    - SHOULD 8: test-engineer, security-reviewer, writer, designer, code-simplifier (ai-slop-cleaner inlined), qa-tester, git-master, document-specialist (omo librarian pattern)
    - NICE 4 omc: tracer, analyst, scientist, architect
    - NICE 4 omo-absorbed: librarian, multimodal-looker, oracle, metis
  - Load-time validator at `.omp/extensions/pi-oven.ts` — `validateAgentRegistry(agentsDir, logger)` checks provider whitelist (opencode-zen / openai-codex / anthropic only), soft-error logs on violation.
  - CI-time hard lint at `scripts/lint-agents.ts` — fails build on missing `model:` field.
  - 18 bun tests pass (5 existing + 7 lint-agents + 6 pi-oven extension validator).
  - English-only agent bodies; Korean reserved for trigger keyword matching.
- Open items deferred to Spec B / Spec C: setup wizard (B), /pi-oven:setup command, anthropic opt-in profile flow (B), 12 SKILL.md English rewrite + new skills deep-init/deep-dive/team (C), autonomous-loop boost (C), fresh-verifier boost (C).
- Status: spec ACCEPT; implementation done; semantic commit pending.

## 2026-05-27 — Plan 1 v0.1.0 Bootstrap 12 Core Skills

- Cycle: pi-oven v0.1.0 → v0.1.0
- Spec: `docs/specs/2026-05-27-pi-oven-foundation-design.md`
- Plan: `docs/plans/2026-05-27-pi-oven-plan-1-bootstrap-12-core-skills.md` (1986 lines)
- Pattern loop: cycle 1 REJECT (10 BLOCKERs — eval-runner SDK contract hallucinated) → cycle 2 ACCEPT (all resolved with SDK type evidence at `agent-session.d.ts:337/493`)
- Mode: autonomous, 3-slot contract (destination=즉시 push / branch=main 직접 / PR mode=없음 / stop=12 skills PASS + tag v0.1.0)
- Status: **completed (v0.1.0)**
- Commits: e60c6b2 (Task 0) → 5a83781 → 20125d4 → cab27eb → 3d3a9d3 → ed23632 → a2dd356 → f22f502 → 4186086 → 932ff79 → 3330b3b → 107ae99 (Tasks 1-11) → d5f582b (mid-sprint sync) → a8327a8 (Task 12 autonomous-loop) → Task 13 final commit
- 12 skills shipped: code-quality-discipline / eval-runner / tdd-strict / brainstorming / writing-plans / codebase-survey / spec-and-review / large-task-delegation / fresh-verifier / pre-commit-gate / subagent-driven-development / autonomous-loop
- Eval-runner real impl: `scripts/run-eval.ts` + `scripts/lib/eval-runner.ts` (TDD-tested, 6 bun tests pass, omp SDK subscribe-pattern)
- Subagent execution model: per-task fresh `oh-my-claudecode:explore` (sonnet) + `oh-my-claudecode:writer` (sonnet) dispatch. Main = dispatch + review only.
- Tag: v0.1.0, gh release published
- Dogfood switch: threshold met (`docs/decisions/0001-dogfood-switch.md`)
- Eval execution: deferred to Plan 4 (LLM provider keys not yet provisioned — Codex / Zen / Anthropic-opt-in)
- Next: STOP — user check-in before Plan 2 (Standard expansion ~33 skills; first cycle to run inside omp + pi-oven instead of Claude Code session)

## 2026-05-27 — v0.1.0 Identifier Rename Patch

- Cycle: pi-oven v0.1.0 → v0.1.0 (rename only, no functional change)
- Trigger: user request — "pi-oven@pi-oven-marketplace 별로야, pi-oven@pi-oven 로"
- Changes: catalog plugin name (pi-oven→pi-oven) + marketplace name (pi-oven-marketplace→pi-oven) + GitHub repo (pi-oven→pi-oven) + slash command prefix (/pi-oven:→/pi-oven:) + extension file (pi-oven.ts→pi-oven.ts) + command files (pi-oven-*→pi-oven-*) + extension label/log strings
- Preserved: project codename "pi-oven" in design spec / SOUL / plan body (internal name)
- Commits: 2a8a51b (rename) + (this one) post-rename docs sync
- Tag: v0.1.0, release published
- omp ops: uninstall pi-oven@pi-oven-marketplace → marketplace remove pi-oven-marketplace → marketplace add kimzerokim/pi-oven → install pi-oven@pi-oven (verified live, scope=user, version=0.1.0)
- Status: completed
- Next: STOP — user check-in before Plan 1 (Bootstrap 12 core skills)

## 2026-05-27 — Plan 0 Scaffold

- Cycle: pi-oven v0.1.0 bootstrap
- Source: brainstorm session 2026-05-27 (Q1-Q6, 3 axioms, 5 sections)
- Spec: `docs/specs/2026-05-27-pi-oven-foundation-design.md`
- Plan: `docs/plans/2026-05-27-pi-oven-plan-0-scaffold.md`
- Mode: autonomous, stop condition = end of Plan 0
- Status: **completed (v0.1.0)**
- Commits: 5197504 → 588ad14 → f009917 → 98a996b → 0c80828 (Tasks 1-5) + Task 8 final commit
- GitHub: https://github.com/kimzerokim/pi-oven
- Tag: v0.1.0
- Verifier verdict: PASS (4/4 cycle-exit checks — prod-build / stub-sweep / SoT-alignment / spec-freeze)
- Deferred: Task 7 omp marketplace add + plugin install (Q-OMP-NOT-INSTALLED-001 in user-queue, omp CLI not locally installed)
- Next: STOP — user check-in before Plan 1 (Bootstrap 12 core skills)
