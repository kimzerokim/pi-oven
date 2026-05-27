# Spec A Critic Review — Cycle 3

- Date: 2026-05-28
- Reviewer: oh-my-claudecode:critic (opus)
- Spec: `/Users/kimzerokim/work/personal/pi-oven/docs/specs/2026-05-28-pi-oven-agent-registry.md` (1249 lines)
- Previous: `docs/research/codex-reviews/2026-05-28-pi-oven-agent-registry-critic-review-2.md`
- Cycle: 3
- BLOCKERs resolved since cycle 2: 2/2 ✓
- Verdict: **REJECT (CONTINUE)** — 1 new BLOCKER (B5-NEW: structural; §6 section ordering), 6 NITs

---

## 1. 🔴 BLOCKER

### B5-NEW. §6 section numbering broken — §6.4 inserted before §6.3

**Evidence**: physical line order in spec:
- Line 554: `### 6.1 허용 provider 목록`
- Line 562: `### 6.2 Plugin load-time 화이트리스트 검증`
- Line 603: `### 6.4 Auth-fallback whitelist hole — documented limitation`  ← out of order
- Line 615: `### 6.3 Runtime enforcement: 'before_agent_start' 이벤트`

§6.4 appears before §6.3 in document order. This is a **structural change** introduced this cycle (§6.4 is new content from B1 fix). Per spec-and-review gate rule: any structural change blocks ACCEPT.

**Fix**: (a) renumber §6.4 → §6.3 and old §6.3 → §6.4, OR (b) keep numbering but move §6.4 block to follow §6.3 in physical order. Option (a) cleaner — match numbering to physical position.

---

## 2. 🟡 NIT

1. §14 AC#9 + `auth-fallback.test.ts` lack concrete mock surface. Specify: "Mock `modelRegistry` to return `{authed: false}` for `opencode-zen/gpt-5.3-codex`; assert dispatch uses `parentActiveModelPattern`."

2. CI-time lint mentioned 5 times but tooling unspecified. Pick: `package.json scripts.lint:agents` running tsx script, OR `.github/workflows/lint.yml` step. Required for AC#6 "testable contract" gate.

3. §5 JSON key `"alternate"` — could rename to `"registry_alternate"` to encode "registry-not-found only" semantic at key level. Optional defensive.

4. §13.3 Layer 1 user-facing error message order — "Profile A guarantee broken" should be first line, not buried.

5. §16 "Known Limitation 1" inside "Open Questions" — confusing. Move to new §16.0 "Resolved / Documented Limitations" subsection OR into §1 prelude.

6. §2.5 line 142 — "omc bundled" should say "Claude Code plugin (omc, if installed)" since omc isn't part of omp's discovery path.

---

## 3. ⚪ PUSH-BACK

None.

---

## Cycle 2 BLOCKER verification

### B1-NEW (auth-fallback-to-parent): RESOLVED ✓

Three-outcome framing consistent across §1, §3.2, §5, §6.4, §9.1, §15.1, §16. Code references verified:
- `model-resolver.ts:716` — `resolveModelOverride` ✓
- `model-resolver.ts:758` — `resolveModelOverrideWithAuthFallback` ✓
- `model-resolver.ts:779` — `parentActiveModelPattern` fallback ✓

§6.4 honestly discloses whitelist hole as known limitation. §15.1 propagates warning to Spec B consumers.

### B4-NEW (missing-model soft enforcement): RESOLVED ✓

§13.3 Layer 1 describes load-time soft + CI-time hard lint. §14 AC#6 has two clauses. New AC#9 + `auth-fallback.test.ts` cover the path. NIT-2 above flags CI lint tooling not yet named.

---

## Path to ACCEPT (cycle 4)

1. Fix §6 numbering (option a recommended: renumber §6.4 → §6.3, old §6.3 → §6.4).
2. NIT-1: AC#9 mock specification.
3. NIT-2: CI lint tooling concrete spec.
4. NIT-3 / NIT-4 / NIT-5 / NIT-6 cleanup.

Cycle 4 should ACCEPT cleanly if these 6 items addressed.

---

## Source references

- `model-resolver.ts:716, 758, 779` — auth-fallback semantics
- `types.ts:941` — `pi.setLabel` confirmed exists (resolves Q-new-2)
- `discovery/helpers.ts:222–272` — `parseAgentFields` schema
