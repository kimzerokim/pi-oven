# Spec A Critic Review — Cycle 4

- Date: 2026-05-28
- Reviewer: oh-my-claudecode:critic (opus)
- Spec: `/Users/kimzerokim/work/personal/pi-oven/docs/specs/2026-05-28-pi-oven-agent-registry.md` (1268 lines)
- Previous: `docs/research/codex-reviews/2026-05-28-pi-oven-agent-registry-critic-review-3.md`
- Cycle: 4
- BLOCKERs resolved since cycle 3: 1/1 ✓
- Verdict: **ACCEPT (PASS gate)** — 0 BLOCKERs, 0 structural changes, 6 cosmetic NITs

---

## Cycle 3 verification matrix

| Item | Status | Evidence |
|---|---|---|
| B5-NEW §6 numbering | ✓ RESOLVED | L556→L564→L605→L617 match physical order (6.1 → 6.2 → 6.3 auth-fallback hole → 6.4 runtime enforcement). All cross-refs (L25, L249, L721, L1084, L1127, L1166, L1168) point to correct content. |
| N1 mock surface | ✓ RESOLVED | L1084 AC#9 + L1104 `auth-fallback.test.ts` specify `modelRegistry` stub `{authed: false}`, assert dispatch = `parentActiveModelPattern`, negate fallback to second array entry. |
| N2 CI lint tooling | ✓ RESOLVED | L983–998: `package.json scripts.lint:agents` + `scripts/lint-agents.ts` + `.github/workflows/ci.yml`. L1081 AC#6 hard-clause matches. |
| N3 registry_alternate | ✓ RESOLVED | All 23 §5 JSON entries (L394–504) renamed. §15.2 (L1133) updated. L387 rationale. |
| N4 error message order | ✓ RESOLVED | L943: "Profile A guarantee broken" first interpolated line. |
| N5 §16.0 subsection | ✓ RESOLVED | L1162 `### §16.0 Resolved / Documented Limitations`. Known Limitation 1 (L1164) + Q-new-2 (L1170). |
| N6 §2.5 wording | ✓ RESOLVED | L145: "Claude Code plugin (omc, if installed)". |

---

## 1. 🔴 BLOCKER

**none**

No new structural changes introduced this cycle. Section renumber in §6 was the resolution of B5-NEW (not a new structural change); §16.0 subsection insertion was anticipated by cycle 3 NIT-5 and is content-additive only. §5 key rename is a string substitution within an already-existing structure. All other cycle-4 deltas are intra-section additions explicitly demanded by cycle 3.

---

## 2. 🟡 NIT (cosmetic, optional)

1. L998 vs L1081 CI step phrasing drift — same intent, slightly different wording.
2. `bun test` already runs in CI; `lint:agents` not yet wired — Spec A drives upcoming wiring (forward-looking, not a flaw).
3. `package.json` currently has `check / build / eval` — `lint:agents` path non-conflicting.
4. L1084 AC#9 mock uses `modelRegistry.getAuthed(...)`; L225 prose uses `modelRegistry.getAvailable()`. Two correctly distinguished surfaces. Optional cross-link AC#9 → §3.2 Outcome 2.
5. L517 "alternate thinkingLevel" callout still uses bare "alternate". For consistency with N3 rename, could read "registry_alternate thinkingLevel". Cosmetic.
6. §15.2 (L1133) lists `pi-oven.models.<role>.{primary,registry_alternate}` but `thinkingLevel` absent. Add third line for Spec B wizard authors.

---

## 3. ⚪ PUSH-BACK

None.

---

## Cross-cutting checks

- §6 cross-references all align with new physical position.
- `registry_alternate` key consistency: §5 JSON (×23), §15.2, prose L383/L387 all use new key. Narrative word "alternate" elsewhere unchanged (correct — concept term, not key).
- `scripts/lint-agents.ts`: path valid relative to repo root; no collision.
- §16.0 numbering reads cleanly.
- Spec A ↔ Spec B interface surface stable. Minor gap: `thinkingLevel` absent from §15.2 (NIT-6).
- Spec A ↔ Spec C scope (L1145–1152) consistent.

---

## Verdict justification

**ACCEPT**.

- 1/1 cycle-3 BLOCKER resolved (§6 numbering).
- All 6 cycle-3 NITs addressed.
- No new structural changes introduced this cycle. Deltas (section renumber, JSON key rename, AC mock surface expansion, CI tooling concrete naming, §16.0 subsection, §2.5 wording, error message reorder) all targeted content fixes responding to cycle-3 feedback.
- Verdict rule satisfied: BLOCKER == 0 AND no structural change → **ACCEPT**.
- 6 cycle-4 NITs cosmetic/optional; do not block acceptance per gate rule.

Operated in THOROUGH mode. No CRITICAL findings, no systemic issues. Realist check: no findings to downgrade.

Spec A is ready as frozen baseline; Spec B and Spec C can now branch from stable interface contract.

---

## Open Questions (genuinely open)

- `lint-agents.ts` script content not in spec body (implementation detail — contract: walk `agents/pi-oven-*.md`, fail on missing `model:`, exit 1).
- Q3 (`ExtensionContext.agentName`) and Q-new-3 (main-session resolution path) remain open in §16.

---

**VERDICT: ACCEPT (PASS gate) — Spec A ready for implementation.**
