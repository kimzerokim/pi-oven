# Spec C Critic Review — Cycle 2

- Date: 2026-05-28
- Reviewer: oh-my-claudecode:critic (opus)
- Spec: `/Users/kimzerokim/work/personal/pi-oven/docs/specs/2026-05-28-pi-oven-skill-rewrite-and-new-skills.md` (1053 lines)
- Previous: `docs/research/codex-reviews/2026-05-28-pi-oven-skill-rewrite-and-new-skills-critic-review.md`
- Cycle: 2
- BLOCKERs resolved since cycle 1: 3/3 ✓
- Verdict: **REJECT (CONTINUE)** — 3 NEW BLOCKERs + 6 NITs

---

## Cycle 1 BLOCKER verification

| # | Cycle 1 finding | Status |
|---|---|---|
| B1 | §2.1 grep scope incomplete | ✓ RESOLVED — recursive grep, gate-detail.md:38 row added, AC#2 walks all files |
| B2 | Unanchored omc source paths | ✓ RESOLVED — §2.4 canonical root `external_harness/oh-my-claudecode/skills/`; all 8 omc sources anchored |
| B3 | deep-dive parallel dispatch undefended | ✓ RESOLVED — large-task-delegation:51 cited; Spec A §4 graph cited; Q2/Q4 RESOLVED; AC#10 added |

3/3 resolved. But 3 new BLOCKERs introduced by cycle 2 deltas + verification claims.

---

## 1. 🔴 BLOCKER (3 new)

### B-C1 — `pi-oven.ts` path drift in §6.2 (line 631)

Spec line 631 references `pi-oven.ts` without path qualifier; reads as if file is at top-level. Actual location: `.omp/extensions/pi-oven.ts`. Spec A line 56, 895 anchor the file there.

**Fix**: Change line 631 to ``**`.omp/extensions/pi-oven.ts` label update**: `pi.setLabel("pi-oven v0.1.0")` ...``.

### B-C2 — §3.2 per-file Korean assessment table empirically false for 6+ SKILL.md files

Spec §3.2 (lines 130-138) claims "No (already English body)" for autonomous-loop, large-task-delegation, codebase-survey, brainstorming, tdd-strict, writing-plans. Live grep shows Korean characters in body:

| File | Korean lines | Spec claim |
|---|---|---|
| `large-task-delegation/SKILL.md` | 21, 32, 93 | "No" — WRONG |
| `autonomous-loop/SKILL.md` | 5, 15, 120 | "No" — WRONG |
| `codebase-survey/SKILL.md` | 17 | "No" — WRONG |
| `brainstorming/SKILL.md` | 5, 17 | "No" — WRONG |
| `writing-plans/SKILL.md` | 5, 16 | "No" — WRONG |
| `tdd-strict/SKILL.md` | 5, 21 | "No" — WRONG |
| `spec-and-review/SKILL.md` | 5, 16, 36 | "Partial" — partially right |

Q6 (line 1031-1041) doubles down: "only code-quality-discipline has Korean" — verifiably false.

Most violations are inline backtick-quoted trigger keywords (e.g. `120: | User sends `그만`, `stop`, ...`). AC#1 regex `/[가-힣]{5,}/` is line-level. `large-task-delegation:32` reads `User override accepted with one line ("그냥 메인이 직접 해").` — 9-char Korean run in narrative prose, not in fenced code block. Will be flagged.

Without correction, executor implements only code-quality-discipline rewrites → AC#1 fails → loop blocks → halts asking for direction (no English replacements specified).

**Fix**:
(a) Re-audit all 12 SKILL.md files; list every Korean-character line; classify each as "trigger-keyword-literal-keep-as-inline-code" or "narrative-prose-replace-with-English".
(b) For narrative cases (large-task-delegation:32/93 explicitly), provide English replacement text in §3.2.
(c) Update Q6 to remove false "only code-quality-discipline" claim.

### B-C3 — `references/*.md` scope contradiction

§2.1 audits ALL files under `skills/` for omc refs (recursive).
§3 + §7.2 audit only SKILL.md top-level for Korean / English.

Live grep finds Korean prose in `references/`:
- `skills/code-quality-discipline/references/principles.md:118-152` — 14 Korean lines (post-write checklist + design-it-twice prose)
- `skills/large-task-delegation/references/dispatch-anatomy.md:38-50` — 11 Korean lines (TDD red-state + production state mutation rules)

§3.1 policy: "Body text and descriptions: English only" — but never declares whether `references/*` is in scope. Result: SKILL.md rewritten to English, `references/*.md` Korean survives → silent regression.

**Fix**: Add §3.3 "Scope of references/* files". Recommendation: include `references/*.md` in English-only scope. Provide English replacements for `principles.md:118-152` and `dispatch-anatomy.md:38-50`. Update §7.2 test to recurse into references. Update AC#1 accordingly.

---

## 2. 🟡 NIT (6)

1. **N-C1** §7.3 line 789 `bun test` baseline claim ≥ 145 unverified. Pin actual baseline.
2. **N-C2** §6.4 commands array vs skill name: clarify whether `/pi-oven:team` auto-registers from skill `name:` field or needs plugin.json commands declaration.
3. **N-C3** §4.2 line 282 "Spec A §4" — replace with `docs/specs/2026-05-28-pi-oven-agent-registry.md:<line>` for line anchor.
4. **N-C4** §5.1 line 502 `pi-oven:architect` cross-cite Spec A role enumeration line for traceability.
5. **N-C5** AC#10 (§8 line 873) "start timestamps overlap" — clarify mock dispatcher vs eval-runner trace records. Currently unverifiable.
6. **N-C6** §6.2 line 629 note plugin name is `pi-oven` (NOT `pi-oven`) in marketplace.json `plugins[0].name`.

---

## 3. ⚪ PUSH-BACK

None. Cycle 1 BLOCKERs (B1/B2/B3) all verified resolved correctly against filesystem.

---

## What's Missing

1. References scope explicit declaration (B-C3).
2. Per-file Korean re-audit (B-C2).
3. `evals/<skill>/scenarios/*.yaml` language scope unspecified.
4. AC#10 verifiability mechanism.
5. AC#5 grep word-boundary tightening (`ultrawork` substring matches headings).

---

## Path to ACCEPT (cycle 3)

1. Fix B-C1 `.omp/extensions/pi-oven.ts` path qualifier.
2. Fix B-C2 — re-audit all 12 SKILL.md + classify Korean lines + supply English replacements for narrative prose.
3. Fix B-C3 — declare references/* in English-only scope + supply replacements + recurse test.
4. Apply 6 NITs.
5. Cycle 3 should ACCEPT cleanly.

---

## Source references

- `.omp/extensions/pi-oven.ts` (B-C1 actual path)
- `skills/large-task-delegation/SKILL.md:32, 93` (B-C2 narrative Korean)
- `skills/code-quality-discipline/references/principles.md:118-152` (B-C3)
- `skills/large-task-delegation/references/dispatch-anatomy.md:38-50` (B-C3)
- Spec A line 56, 895 (pi-oven.ts canonical path)
- `external_harness/oh-my-claudecode/skills/{autopilot,ralph,ultrawork,verify,deepinit,deep-dive,team}/SKILL.md` (canonical root verified exists)
