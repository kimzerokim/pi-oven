# Spec C Critic Review — Cycle 1

- Date: 2026-05-28
- Reviewer: oh-my-claudecode:critic (opus)
- Spec: `/Users/kimzerokim/work/personal/pi-oven/docs/specs/2026-05-28-pi-oven-skill-rewrite-and-new-skills.md` (983 lines)
- Cycle: 1
- Verdict: **REJECT (CONTINUE)** — 3 BLOCKERs + 6 NITs

---

## 1. 🔴 BLOCKER

### B1. §2.1 grep scope incomplete — missed `references/` subdirs

Spec C §2.1 grep `grep -rn ... skills/*/SKILL.md` only covers top-level SKILL.md. Live re-grep across `skills/`:
- `skills/pre-commit-gate/references/gate-detail.md:38` contains `oh-my-claudecode:ai-slop-cleaner` — same dispatch ref class as the 9 enumerated.

AC#2 in §8 reuses the same incomplete glob → false-green. Implementation following Spec C verbatim ships dispatch poison surviving in `references/`.

**Fix**:
1. §2.1 grep → `grep -rn "oh-my-claudecode:\|omo:" skills/` (recursive, all files).
2. §2.1 findings table: add `skills/pre-commit-gate/references/gate-detail.md:38 → pi-oven:code-simplifier`.
3. AC#2 + `skill-omc-refs.test.ts`: walk all files under `skills/`, not just `SKILL.md` top-level.

### B2. omc source paths unanchored — implementer can't reproduce

§4.1-§4.3 cite `oh-my-claudecode/skills/<name>/SKILL.md` — relative to nothing. Real candidates:
- `external_harness/oh-my-claudecode/skills/deepinit/SKILL.md`
- `external_harness/oh-my-claudecode/skills/deep-dive/SKILL.md`
- `external_harness/oh-my-claudecode/skills/team/SKILL.md`
- Alternate: `~/.claude/plugins/marketplaces/omc/skills/<name>/`

§4.3 picks `team/` over `omc-teams/` without rationale. `omc-teams/SKILL.md` also exists (CLI/tmux variant); silent choice = wrong-variant risk.

**Fix**:
1. Add §2.4 "Source path resolution": canonical root = `/Users/kimzerokim/work/personal/external_harness/oh-my-claudecode/skills/`.
2. §4 all `omc source:` paths anchored to that root.
3. §4.3 add one-line rationale: source = `team/` (native MCP team) NOT `omc-teams/` (CLI/tmux variant) because pi-oven uses omp `task` tool natively, no tmux pane drive needed.

### B3. §4.2 deep-dive Phase 3 parallel tracer dispatch undefended

§4.2 specifies "3 parallel `task` calls" but Q2/Q4 admit "open risk" — no smoke test, no detection mechanism for the fallback branch. Existing `large-task-delegation/SKILL.md:51` ALREADY demonstrates the pattern (`multiple task calls in one response, each with run_in_background: true`) but Spec C never cites this as evidence.

**Fix**:
1. §4.2 Phase 3 cite `skills/large-task-delegation/SKILL.md:51` + Spec A §4 dispatch graph as evidence parallel fanout works in pi-oven.
2. Q2 → status VERIFIED (with cite).
3. Q4 → resolved by same evidence.
4. Add AC smoke test: dispatch 3 `pi-oven:tracer` task calls with `run_in_background: true`, verify start timestamps overlap.

---

## 2. 🟡 NIT

### N1. AC#1 Korean regex line-level, no backtick-string exclusion → false positives

`KOREAN_PROSE_REGEX = /[가-힯ᄀ-ᇿ㄰-㆏]{5,}/` is line-level. `large-task-delegation/SKILL.md:521` has `"그냥 메인이 직접 해"` (12 Korean chars) inside backtick-quoted English example — AC#1 will fire false-positive.

**Fix**: Either (a) tighten regex to exclude backtick spans, (b) require Korean string literals on their own line so whole line can be skipped, or (c) put Korean examples in fenced code blocks.

### N2. Regex range `[가-힯]` is non-standard — use `[가-힣]`

`[가-힯]` (U+AC00–U+D7AF) overshoots into reserved area; canonical Hangul block is `[가-힣]` (U+AC00–U+D7A3).

### N3. §6.2 marketplace.json instruction wrong direction

`.claude-plugin/marketplace.json` EXISTS in SoT (`plugins[0].version = "0.1.0"`). Q7 "may not exist" is moot. Bump target = `plugins[0].version`, not top-level `"version"`.

**Fix**: Update §6.2: "marketplace.json exists; bump `plugins[0].version` 0.1.0 → 0.2.0. No top-level version field." Mark Q7 RESOLVED.

### N4. §5.3 debugger heading misleading

Heading "`debugger` SKILL.md sync" implies action; actually no skill exists. Rename to "`debugger` skill deferred — not in scope" to signal no-op.

### N5. §5.1 line count off-by-one

Spec says current 130; actual `wc -l skills/autonomous-loop/SKILL.md = 129`.

### N6. AC#5 grep `≥ 6` matches threshold fragile

"ralph" appears once in current trigger field; boost adds 3 mode names × 2 mentions = 6 → exactly meets ≥6. Brittle. Increase to ≥9 or use per-keyword counts.

---

## 3. ⚪ PUSH-BACK

P1. Spec body using `oh-my-claudecode:*` strings in mapping tables — correct documentation usage. AC#2 targets `skills/**`, not `docs/specs/`. No conflict. Add clarifying note to §2.2.

P2. Spec B vs Spec C `team` skill overlap — no conflict (Spec B = wizard for provider selection; Spec C `team` = multi-agent dispatch). Different layers.

P3. autonomous-loop boost size (129 → ~240 lines) — acceptable. Token cost OK up to ~400 lines.

---

## What's Missing

1. No absolute source-path root declared (B2).
2. No verification of `task` parallel semantics in deep-dive despite Q2/Q4 admitting open (B3).
3. No protocol for `references/` files recursive sweep (B1).
4. No coverage of `commands/` dir for omc refs.
5. No regression test ensuring `superpowers:*` refs KEPT (citation-only).
6. No coverage of `skills/*/AGENTS.md` if any.
7. No cite of `pi-oven:tracer` agent file (Spec A §4 line 331) in deep-dive scope.
8. AC#9 yaml parseability check doesn't validate schema fields.
9. Multiple `team` directories — choose canonical (`external_harness/oh-my-claudecode/skills/team/`).
10. plugin.json `commands` array — does it grow with new skills?

---

## Path to ACCEPT (cycle 2)

1. §2.1 + AC#2: recursive grep; add `gate-detail.md:38`.
2. §2.4: source path absolute root.
3. §4 all omc sources anchored; §4.3 `team/` rationale.
4. §4.2 parallel dispatch cite + Q2/Q4 resolved.
5. AC#1 regex hardened.
6. §6.2 marketplace.json corrected; Q7 RESOLVED.
7. Apply 6 NITs.

---

## Source references

- `skills/pre-commit-gate/references/gate-detail.md:38` (B1)
- `skills/large-task-delegation/SKILL.md:51` (B3 evidence)
- `external_harness/oh-my-claudecode/skills/{deepinit,deep-dive,team,omc-teams}/SKILL.md` (B2 paths)
- `.claude-plugin/marketplace.json plugins[0].version = "0.1.0"` (N3)
