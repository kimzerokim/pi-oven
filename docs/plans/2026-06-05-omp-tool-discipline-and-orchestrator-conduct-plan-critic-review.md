> Historical; do not copy runtime syntax examples from this document.

# Critic Review (cycle 1) — omp-tool-discipline + orchestrator-conduct (spec + plan)

> Codex CLI stalled (no first token); fell back to `oh-my-claudecode:critic` (opus) per kzk-codex-handoff.
> Verdict captured from the agent transcript. Cycle: 1.

**VERDICT: CHANGES_REQUESTED — 4 BLOCKERs** (#11/#21 profiles.ts is the tools SoT and is omitted; #12 matrix
deltas wrong vs live PROFILE_A; #13 critic/reviewer template mandates a blocked `bash`; #17 plan File Structure +
green-bar batch workflow break without profiles.ts co-edits). Tool-enablement key spellings all verified CORRECT.

## 1. omp mechanism correctness
1. ⚪ All six TOOL_ENABLEMENT keys verified vs settings-schema.ts: `astGrep.enabled` (2209, true),
   `inspect_image.enabled` (2289, **false — the real gap**), `web_search.enabled` (2369, true), `lsp.enabled`
   (1952, true), `browser.enabled` (2375, true), `debug.enabled` (2269, true). Mixed casing correct. No no-op bug.
2. 🟡 `omp config set <dotted.key> <bool>` valid (config-cli.ts). `setMemoryAndAsyncConfig` precedent proves it.
   Omitting `eval.enabled` is CORRECT — `eval` has no `.enabled` gate (only eval.py/eval.js). Do not add it.
3. 🟡 Parent-only injection feasible — `pi-oven.ts:431` before_agent_start already gates parent blocks on
   isParentSession + reads FSM/stop-guard. No new hook needed; one new call inside the existing handler.

## 2. Prong-2 (config layer)
4. ⚪ Strongest part. Keys correct, scalar dotted-set transport correct, apply global-branch insertion correct
   (apply.ts ~140-167 global; ~119-139 project excluded), throw-on-nonzero matches idiom.
5. 🟡 Task A2 project-scope test is weak: project writers are file-based, so `calls2.some(set)===false` passes
   trivially. The apply OUTPUT line (`✓ tools enabled:…`) is asserted nowhere.
6. 🟡 `--reset --full` interaction left undecided in spec §3. Decide: LEAVE the tool flags (omp infra; a user who
   got inspect_image enabled won't expect --reset to break vision). Document it.

## 3. Prong-3 (orchestrator conduct)
7. 🟡 autonomousActive signal inconsistency: Task B2 uses `fsm.state.active || stopGuardState.autonomousActive`;
   existing `needsAutonomousReminder` (pi-oven.ts:453-455) uses a DIFFERENT third disjunct
   (`…|| matchedSkills.some(s=>s.name==="autonomous-loop")`). Pick ONE definition + reuse so the conduct carve-out
   and the reminder never disagree.
8. 🟡 "Placed FIRST" is unverified: test must assert `out[0].includes(KEY)`, not just presence. applyToSystemPrompt
   APPENDS (rules-injector.ts:215/222/230); conduct must be unshifted into the post-applyToSystemPrompt array.
9. ⚪ Context bloat real but acceptable: ~6-10 lines, deduped marker, orthogonal to keyword-skills. Note the parent
   already carries discipline + language + full repo CLAUDE.md (≤256KB) + matched-skills.
10. 🟡 buildKeywordMatchedSkillsPrompt already says "You MUST load each listed skill … before substantive action."
    Adding "hard precondition" is low value for a weak follower. Keep minimal.

## 4. Prong-1 (rewrite + matrix)
11. 🔴 **BLOCKER — spec's core premise is FALSE.** `lint-agents.ts:178-191` enforces `tools`/`blocked_tools`
    EQUALITY against `profiles.ts` PROFILE_A (`JSON.stringify` equality), NOT just body↔tools. Every agent file's
    `tools:` currently equals profiles.ts exactly. **Any `tools:` widening WITHOUT a matching profiles.ts edit
    fails `bun run lint:agents` (`tools drift from profiles.ts`).** The Phase-C matrix (tracer +lsp/ast_grep/eval/
    debug, oracle +lsp/ast_grep/web_search, verifier +lsp, critic +web_search, analyst +lsp/ast_grep,
    security-reviewer +lsp/ast_grep, planner +lsp/ast_grep/web_search) requires editing profiles.ts FIRST, which
    the plan never lists. **Fix:** add `scripts/pi-oven-setup/profiles.ts` as a Phase-C target; edit
    `tools`/`blocked_tools` in profiles.ts AND the agent file in lockstep (`--apply` only rewrites
    model/thinkingLevel, not tools — hand-sync both). CLAUDE.md "Model routing" § is also stale on this.
12. 🔴 **BLOCKER — matrix deltas wrong vs live PROFILE_A:** oracle has NONE of lsp/ast_grep/web_search (3 adds,
    not "mostly has"); librarian "(has all)" is FALSE (lacks eval/debug/inspect_image); tracer is read-only-ish
    (`blocked write,edit,apply_patch,task`) so +eval/+debug is a real capability expansion — enumerate it
    deliberately. Rebuild the matrix from the live dump (below), annotating actual tools + blocked_tools per role.
13. 🔴 **BLOCKER — critic body↔tools self-conflict.** profiles.ts critic: `blocked_tools` includes `bash`. The
    reviewer-register template mandates "use `bash` to run the failing build/tests." critic (opus) cannot run bash
    → a false mandate. lint skips backticked blocked tools (so no lint fail) but the mandate is a lie. **Fix:**
    critic uses a NO-bash read-only reviewer variant; AUDIT every role whose `blocked_tools` contains a
    template-named tool (esp. `task`-blocked roles vs any "spawn/delegate" template line).
14. 🟡 data-runner has read but NOT search/find; if body names them, add to profiles.ts. data-runner + writer are
    the only non-`*` roles with `write` — preserve it; don't strip in a "read-only research" template misapply.
15. 🟡 `["*"]` agents (executor, debugger, test-engineer, designer, code-simplifier, qa-tester): body-only,
    lint's instructed-but-not-granted bypassed → a body typo naming a non-tool is silently uncaught. Low risk.

## 5. TDD adequacy
16. 🟡 Untested: (a) conduct block POSITION (finding 8); (b) apply OUTPUT line; (c) all four standing blocks
    coexisting in one parent turn; (d) Phase C body rewrites have NO automated content test — only lint
    (tools-consistency) + manual smoke. "Preserve role identity" (spec §2) is untested across 24 files; the
    Phase-E critic pass is the ONLY guard against identity loss. Call it out.

## 6. Sequencing / risk
17. 🔴 **BLOCKER (process):** Plan File Structure omits profiles.ts despite Phase C requiring it (#11). An executor
    will widen agent `tools:`, run lint, and hit RED on the first agent with a delta (C-batch1). The per-agent
    "Run lint:agents — MUST pass" step FAILS until profiles.ts is co-edited. Breaks the green-bar workflow at
    batch 1.
18. 🟡 Test-file location: the new tests for rules-injector / skill-keyword-loader already EXIST at
    `tests/extensions/pi-oven-runtime/*.test.ts` (3-level `../../../`), NOT `tests/extensions/` (2-level). Add
    cases to the EXISTING files; fix import depth to `../../../.omp/...`. (B2's `tests/extensions/pi-oven.test.ts`
    with `../../.omp/...` IS correct.)
19. 🟡 Exactly 839 tests now. Verify `profiles.test.ts` doesn't pin per-role `tools` arrays that would need
    updating after profiles.ts edits (Open Question).
20. 🟡 No rollback note: Prong 2 re-writes 6 global keys on EVERY global setup; a user who set `debug.enabled=false`
    gets it silently re-enabled. Document in commands/setup.md (the "can't silently neuter" framing cuts both ways).

## 7. Missed
21. 🔴 **BLOCKER (big miss):** profiles.ts as the tools SoT (= #11/#12/#13/#17). Invalidates the "only tools: +
    body change" claim and the green-bar batch workflow.
22. 🟡 Vision: with `inspect_image.enabled=false`, the whitelist is irrelevant — Prong 2 is the actual fix; Prong 1
    needs NO vision tool delta (multimodal-looker already has inspect_image, qa-tester is `*`). Prongs correctly
    coupled.
23. 🟡 project-scope-only users (never run global setup) get toothless vision (inspect_image stays false). Locked
    decision, but note it in docs.
24. 🟡 Phase D bumps Status/README but no `release:pi-oven` (fine — no release requested; doc-bump cosmetic).

## Live PROFILE_A tools (rebuild the matrix from this)
```
executor             ["*"]                                                        blocked []
explorer             read,search,find,bash,web_search,lsp,ast_grep                blocked write,edit,apply_patch,task
verifier             read,search,find,bash,recall,task,report_finding             blocked write,edit,apply_patch
critic               read,search,find,report_finding,recall                       blocked write,edit,apply_patch,bash,task  ← bash BLOCKED
planner              read,search,find,bash,recall,task                            blocked write,edit,apply_patch
code-reviewer        read,search,find,bash,lsp,ast_grep,recall,report_finding     blocked write,edit,apply_patch,task
debugger             ["*"]                                                        blocked []
test-engineer        ["*"]                                                        blocked []
security-reviewer    read,search,find,bash,recall,web_search                      blocked write,edit,apply_patch,task
writer               read,search,find,write,edit,web_search                       blocked apply_patch,bash,task
designer             ["*"]                                                        blocked []
code-simplifier      ["*"]                                                        blocked []
qa-tester            ["*"]                                                        blocked []
git-master           read,search,find,bash                                        blocked write,edit,apply_patch,task
document-specialist  read,search,find,bash,recall,web_search                      blocked write,edit,apply_patch,task
tracer               read,search,find,bash                                        blocked write,edit,apply_patch,task
analyst              read,search,find,bash,eval,recall                            blocked write,edit,apply_patch,task
architect            read,search,find,bash,lsp,ast_grep,recall,retain            blocked write,edit,apply_patch,task
librarian            read,search,find,bash,lsp,web_search,ast_grep,recall        blocked write,edit,apply_patch,task
multimodal-looker    read,search,find,bash,inspect_image                          blocked write,edit,apply_patch,task
oracle               read,search,find,bash,recall,retain                          blocked write,edit,apply_patch,task  ← NO lsp/ast_grep/web_search
metis                read,search,find,bash,recall,task                            blocked write,edit,apply_patch
deep-researcher      read,search,find,web_search,retain,recall,reflect            blocked write,edit,apply_patch,task
data-runner          bash,eval,read,write,retain                                  blocked edit,apply_patch,task  ← NO search/find
```

## Open Questions
- Does `profiles.test.ts` pin per-role `tools` arrays (so profiles.ts tool edits require test updates)? Verify before batch 1.
- `--reset --full` tool-flag handling — decide (recommend: leave).
- metis "(assess; +lsp,ast_grep if body names)" — resolve to a concrete profiles.ts edit or leave tool-unchanged. Make explicit per-role.
