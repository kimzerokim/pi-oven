import { describe, it, expect } from "bun:test";
import { decideGate, type GateInput, type FsmStateView } from "../../../.omp/extensions/pi-oven-runtime/gate";
import { normalizeCommand } from "../../../.omp/extensions/pi-oven-runtime/git-normalize";

// ---------------------------------------------------------------------------
// gate.ts — PURE decision (Spec §3 Layer 1 B2/B3, §5.4)
//
// decideGate(input) consumes:
//   - the NormalizedCommand (verbs + forbidden matches)
//   - a FsmStateView discriminated union: ABSENT | CORRUPT | OK(state)
//   - env flags (PI_OVEN_PUSH_CONSENT, PI_OVEN_GATE_BYPASS)
//   - a fileConsentValid flag (the FSM-state module decides validity/TTL)
// and returns { block, reason?, consumeFileConsent? }.
//
// CRITICAL B2 refinement: gate is ACTIVE only when state is OK and active:true.
// ABSENT file → gate INACTIVE → ALLOW ALL gated verbs.
// CORRUPT (present-but-unreadable) → fail-CLOSED for commit/push.
// Forbidden floor is ALWAYS-ON regardless of FSM/bypass.
// ---------------------------------------------------------------------------

function ok(partial: Partial<FsmStateView & { kind: "OK" }> & { commit?: string; regression?: string; active?: boolean }): FsmStateView {
  return {
    kind: "OK",
    state: {
      active: partial.active ?? true,
      gateCache: { commit: partial.commit ?? "FAIL", regression: partial.regression ?? "FAIL" },
    },
  } as FsmStateView;
}

function input(command: string, overrides: Partial<GateInput> = {}): GateInput {
  return {
    normalized: normalizeCommand(command),
    fsm: ok({ commit: "FAIL", regression: "FAIL", active: true }),
    env: {},
    fileConsentValid: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// AC1 — commit gate
// ---------------------------------------------------------------------------

describe("decideGate — commit gate (AC1)", () => {
  it("blocks `git commit` when active and commit/regression gate is not fully PASS", () => {
    const r = decideGate(input("git commit -m x", { fsm: ok({ commit: "PASS", regression: "FAIL", active: true }) }));
    expect(r.block).toBe(true);
    expect(r.reason).toBeDefined();
  });

  it("allows `git commit` when active and gateCache.commit/regression are both PASS", () => {
    const r = decideGate(input("git commit -m x", { fsm: ok({ commit: "PASS", regression: "PASS", active: true }) }));
    expect(r.block).toBe(false);
  });

  it("blocks `git commit` when active and commit PASS but regression is missing (schema compatibility default)", () => {
    const r = decideGate(input("git commit -m x", { fsm: ok({ commit: "PASS", regression: undefined, active: true }) }));
    expect(r.block).toBe(true);
    expect(r.reason).toMatch(/full regression gate/i);
  });

  it("allows a non-git command unconditionally", () => {
    const r = decideGate(input("ls -la", { fsm: ok({ commit: "FAIL", regression: "FAIL", active: true }) }));
    expect(r.block).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AC6 — state failure policy (decision-layer slice)
// ---------------------------------------------------------------------------

describe("decideGate — B2 absent=allow / corrupt=fail-closed (AC6)", () => {
  it("ABSENT file → gate INACTIVE → ALLOWS git commit (normal dev session)", () => {
    const r = decideGate(input("git commit -m x", { fsm: { kind: "ABSENT" } }));
    expect(r.block).toBe(false);
  });

  it("ABSENT file → ALLOWS git push", () => {
    const r = decideGate(input("git push origin main", { fsm: { kind: "ABSENT" } }));
    expect(r.block).toBe(false);
  });

  it("OK but active:false → gate INACTIVE → ALLOWS git commit", () => {
    const r = decideGate(input("git commit -m x", { fsm: ok({ commit: "FAIL", regression: "FAIL", active: false }) }));
    expect(r.block).toBe(false);
  });

  it("CORRUPT (present-but-unreadable) → fail-CLOSED, blocks git commit", () => {
    const r = decideGate(input("git commit -m x", { fsm: { kind: "CORRUPT" } }));
    expect(r.block).toBe(true);
    expect(r.reason).toMatch(/unreadable|fail-closed/i);
  });

  it("CORRUPT → fail-CLOSED, blocks git push", () => {
    const r = decideGate(input("git push", { fsm: { kind: "CORRUPT" } }));
    expect(r.block).toBe(true);
  });

  it("PI_OVEN_GATE_BYPASS=1 allows commit even under CORRUPT (anti-brick)", () => {
    const r = decideGate(input("git commit -m x", { fsm: { kind: "CORRUPT" }, env: { PI_OVEN_GATE_BYPASS: "1" } }));
    expect(r.block).toBe(false);
    expect(r.bypassed).toBe(true);
  });

  it("PI_OVEN_GATE_BYPASS=1 allows push even under CORRUPT (anti-brick)", () => {
    const r = decideGate(input("git push", { fsm: { kind: "CORRUPT" }, env: { PI_OVEN_GATE_BYPASS: "1" } }));
    expect(r.block).toBe(false);
    expect(r.bypassed).toBe(true);
  });

  it("PI_OVEN_GATE_BYPASS=1 allows commit when active+FAIL (anti-brick covers active gate too)", () => {
    const r = decideGate(input("git commit -m x", { fsm: ok({ commit: "FAIL", regression: "FAIL", active: true }), env: { PI_OVEN_GATE_BYPASS: "1" } }));
    expect(r.block).toBe(false);
    expect(r.bypassed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Forbidden floor ALWAYS-ON (AC6 last clause)
// ---------------------------------------------------------------------------

describe("decideGate — forbidden floor always-on (AC6)", () => {
  it("blocks `rm -rf /` when FSM ABSENT (forbidden does not depend on gateCache)", () => {
    const r = decideGate(input("rm -rf /", { fsm: { kind: "ABSENT" } }));
    expect(r.block).toBe(true);
    expect(r.reason).toMatch(/forbidden/i);
  });

  it("blocks `rm -rf /` even under PI_OVEN_GATE_BYPASS=1 (floor NOT lifted by bypass)", () => {
    const r = decideGate(input("rm -rf /", { fsm: { kind: "CORRUPT" }, env: { PI_OVEN_GATE_BYPASS: "1" } }));
    expect(r.block).toBe(true);
    expect(r.reason).toMatch(/forbidden/i);
  });

  it("blocks a prod-access pattern when FSM ABSENT", () => {
    const r = decideGate(input("aws sts assume-role --role-arn x", { fsm: { kind: "ABSENT" } }));
    expect(r.block).toBe(true);
    expect(r.reason).toMatch(/forbidden/i);
  });

  it("forbidden floor takes precedence over a PASS commit cache", () => {
    // command both has a forbidden match and would otherwise be allowed
    const r = decideGate(input("rm -rf / && git commit -m x", { fsm: ok({ commit: "PASS", regression: "PASS", active: true }) }));
    expect(r.block).toBe(true);
    expect(r.reason).toMatch(/forbidden/i);
  });
});

// ---------------------------------------------------------------------------
// AC5 — push consent decision (env vs file)
// ---------------------------------------------------------------------------

describe("decideGate — push consent (AC5)", () => {
  it("blocks `git push` when active and no consent (env unset, file invalid)", () => {
    const r = decideGate(input("git push origin main", { fsm: ok({ commit: "PASS", regression: "PASS", active: true }) }));
    expect(r.block).toBe(true);
  });

  it("allows `git push` with PI_OVEN_PUSH_CONSENT env set; does NOT consume the file", () => {
    const r = decideGate(input("git push origin main", {
      fsm: ok({ commit: "PASS", regression: "PASS", active: true }),
      env: { PI_OVEN_PUSH_CONSENT: "deadbeef" },
    }));
    expect(r.block).toBe(false);
    expect(r.consumeFileConsent).toBeFalsy();
    expect(r.consentSource).toBe("env");
  });

  it("allows `git push` with a valid consent FILE and flags consume-on-use", () => {
    const r = decideGate(input("git push origin main", {
      fsm: ok({ commit: "PASS", regression: "PASS", active: true }),
      fileConsentValid: true,
    }));
    expect(r.block).toBe(false);
    expect(r.consumeFileConsent).toBe(true);
    expect(r.consentSource).toBe("file");
  });

  it("env consent takes precedence over file (does not consume file when both present)", () => {
    const r = decideGate(input("git push origin main", {
      fsm: ok({ commit: "PASS", regression: "PASS", active: true }),
      env: { PI_OVEN_PUSH_CONSENT: "x" },
      fileConsentValid: true,
    }));
    expect(r.block).toBe(false);
    expect(r.consentSource).toBe("env");
    expect(r.consumeFileConsent).toBeFalsy();
  });

  it("an invalid/expired file consent (fileConsentValid=false) → blocks push", () => {
    const r = decideGate(input("git push", {
      fsm: ok({ commit: "PASS", regression: "PASS", active: true }),
      fileConsentValid: false,
    }));
    expect(r.block).toBe(true);
  });
});
