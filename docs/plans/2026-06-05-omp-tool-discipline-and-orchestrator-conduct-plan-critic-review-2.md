# Critic Review (cycle 2) — omp-tool-discipline + orchestrator-conduct (REVISED spec + plan)

> Codex CLI unavailable; fell back to `oh-my-claudecode:critic` (opus). **Cycle: 2.**
> Previous: `docs/plans/2026-06-05-omp-tool-discipline-and-orchestrator-conduct-plan-critic-review.md`.
> BLOCKERs resolved since cycle 1: 4 / 4.

**VERDICT: PASS — 0 BLOCKERs (3 NITs incorporated, no cycle 3).**

## Cycle-1 BLOCKERs — all verified RESOLVED
- **#11/#21 (tools SoT):** Spec §2 now states tools/blocked_tools are a profiles-derived SoT (lint-agents.ts:178-191 JSON equality vs PROFILE_A; profiles.test C/D===A), requiring identical edits across all 4 profiles + agent file in lockstep, blocked_tools unchanged. profiles.ts is in the plan File Structure + the FIRST Phase-C checkbox. No free-to-widen language remains.
- **#12 (matrix):** All 8 delta rows verified exact vs live PROFILE_A — architect only +web_search (already had lsp/ast_grep), oracle all 3 (had none), no duplicate adds, no blocked_tools collisions, other-16 accurate.
- **#13 (critic read-only):** critic keeps bash blocked + a general "never mandate a blocked tool" rule added. Full audit: critic+bash was the ONLY blocked-vs-mandated conflict; verifier/code-reviewer/security-reviewer clean; task-blocked roles clean.
- **#17 (green-bar):** Phase-C checklist ordered profiles.ts(×4)→agent file→lint:agents→bun test. Holds at batch 1.

## Cycle-1 NITs — all verified addressed
Test paths (pi-oven-runtime/ ../../../, pi-oven.test ../../); autonomousActive reuse of needsAutonomousReminder; conduct index-0 assertion (applyToSystemPrompt appends, so unshift is correct); --reset --full leaves flags (documented); apply output-line test; identity-loss guard = Phase-E critic. profiles.test C/D tools tests are relational → identical edits keep all tests green (ran: 89 pass).

## Cycle-2 NITs (incorporate; not cycle-continuation triggers)
1. 🟡 **plan B2 — HOIST needsAutonomousReminder.** `const needsAutonomousReminder` is declared at pi-oven.ts:453 INSIDE the first `if(isParentSession)` block (439-469) and is OUT OF SCOPE at the conduct injection (second isParentSession block, 472-480). Fix: B2 Step 3 must say "hoist the needsAutonomousReminder computation above line 439 (outer handler scope) so the SAME const serves both the reminder and the conduct injection" — else a literal reader re-declares it (re-introducing the cycle-1 #7 double-definition).
2. 🟡 **profiles.test.ts — add PROFILE_B equality guard.** profiles.test asserts tools-equality only for C (416-425) and D (540-549); lint references only PROFILE_A; PROFILE_B has NO automated guard. The spec/plan correctly NAME PROFILE_B in the identical-edit instruction, but if an executor forgets B nothing fails and a `--profile B` user silently gets the 8 roles with old/narrow tools. Fix: add a `describe("PROFILE_B")` with `tools`/`blocked_tools` `.toEqual(PROFILE_A[role]…)` mirroring C/D; note it in the plan File Structure profiles.test.ts row.
3. 🟡 **spec §3 — eval ungated note.** tracer/analyst gain `eval`; `eval` has no `.enabled` key (correctly omitted from TOOL_ENABLEMENT). Add one line in §3: "`eval` is ungated (no `.enabled` key), so no enablement entry is needed for the tracer/analyst `eval` grants" — pure clarity.

## Open Questions (not findings)
- No test that all 5 standing parent blocks (discipline+language+project+keyword-skills+conduct) coexist in one turn — each independently deduped, collision implausible.
- The conduct block adds a 5th always-on parent injection (minor context cost; acceptable, deduped).
