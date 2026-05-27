# autonomous-loop state machine

Source: pi-oven autonomous-loop v0.1.0, ported from autonomous-loop v1.11.0 + autonomous-boundary v1.14.0.

---

## State enum

| State | Entry condition | Exit condition | Allowed next states |
|---|---|---|---|
| `PRE_CONTRACT` | Autonomous keyword received | All 3 ASK-FIRST slots confirmed | `CONTRACTED` |
| `CONTRACTED` | Slots confirmed; first tool call dispatched | First cycle tool call completes | `ACTIVE` |
| `ACTIVE` | In-cycle work executing | Cycle work complete OR interrupt received | `RATE_LIMIT_WAIT`, `EXIT_GATE`, `HALTED` |
| `RATE_LIMIT_WAIT` | Provider 429 or dispatch fail received | `ScheduleWakeup(600)` fires; restate arg present | `ACTIVE` |
| `EXIT_GATE` | All cycle tasks marked complete | Verifier opus returns PASS | `COMPLETE` |
| `HALTED` | Q-VERIFIER-FAIL (2× consecutive), Q-MIGRATION-HALT, user explicit stop, or spec cycle ≥ 5 with BLOCKERs | User resolves halt condition | `ACTIVE` or terminal |
| `COMPLETE` | Verifier PASS confirmed | — | terminal |

---

## Transitions

```
                    ┌──────────────┐
                    │ PRE_CONTRACT │  ← autonomous keyword received
                    └──────┬───────┘
                           │ all 3 slots confirmed +
                           │ first tool call dispatched
                    ┌──────▼───────┐
                    │  CONTRACTED  │
                    └──────┬───────┘
                           │ first tool call completes
                    ┌──────▼───────┐
               ┌───►│    ACTIVE    │◄──────────────────┐
               │    └──┬───┬───┬──┘                    │
               │       │   │   │                       │
               │  429 / │   │   │ cycle                 │
               │  fail  │   │   │ complete              │ wakeup fires
               │    ┌───▼─┐ │   │                       │
               │    │RATE  │ │   │                       │
               └────┤LIMIT │ │   │                       │
                    │WAIT  ├─┘   │                       │
                    └─────┘      │              (ScheduleWakeup 600s)
                           ┌─────▼──────┐
                           │ EXIT_GATE  │  ← verifier opus dispatched
                           └─────┬──────┘
                          PASS   │   FAIL (2×)
                   ┌─────────────┴──────────────┐
                   │                            │
            ┌──────▼──────┐            ┌────────▼───────┐
            │  COMPLETE   │            │    HALTED      │
            └─────────────┘            └────────────────┘
                                        (user resolves → ACTIVE or terminal)
```

---

## Source attribution

This state machine is a direct port of the following upstream sources:

- **autonomous-loop v1.11.0** (harness-share.md §12/§13/§14) — polite-stop ban (9 canonical examples), rate-limit ScheduleWakeup pattern, auto /compact at ≥50% with remaining-tasks arg, multi-compact allowance, Plan A→N auto-continuation.
- **autonomous-boundary v1.14.0** (harness-share.md §2 + §33) — ASK-FIRST 3-slot branch contract, halt condition codes (Q-VERIFIER-FAIL, Q-MIGRATION-HALT), post-contract first-tool-call-in-same-turn mandate, cycle-exit 4-sub-check mandate, destructive-op guardrails.
- **omc/ralph** — orchestrator loop skeleton; `RATE_LIMIT_WAIT` wakeup pattern and restate arg convention adopted directly.
- **omo Sisyphus (full-style)** — Phase 0 intent gate, multi-model routing, and orchestrator/executor separation. Note: Sisyphus `system-reminder` wake pattern is omo-specific and is NOT adopted here; pi-oven uses `ScheduleWakeup(600)` instead.

**Sisyphus full vs Junior decision:** pi-oven `autonomous-loop` aligns with Sisyphus full-style (primary orchestrator, Phase 0 intent gate, multi-model routing). Junior-style (focused executor, no recursive delegation, hard stop after first verification) is not used here.

---

## Deferred to Plan 3

The following items are tracked but not implemented in this version:

- Sisyphus model-overlay prompts (per-state model pinning beyond basic routing)
- omc `prd.json` story tracking integration
- code-review-graph (CRG) sequencing inside per-cycle survey dispatch
