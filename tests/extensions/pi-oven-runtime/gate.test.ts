import { describe, it, expect } from "bun:test";
import {
  BRANCH_CONTRACT_BOOTSTRAP_TARGET,
  decideGate,
  type GateInput,
  type FsmStateView,
} from "../../../.omp/extensions/pi-oven-runtime/gate";
import { normalizeCommand } from "../../../.omp/extensions/pi-oven-runtime/git-normalize";
import { fingerprintExternalExecSecret } from "../../../.omp/extensions/pi-oven-runtime/gate-state";


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
  const gateCache: { commit?: string; regression?: string } = { commit: partial.commit ?? "FAIL" };
  if (Object.prototype.hasOwnProperty.call(partial, "regression")) {
    gateCache.regression = partial.regression;
  } else {
    gateCache.regression = "FAIL";
  }
  return {
    kind: "OK",
    state: { active: partial.active ?? true, gateCache },
  } as FsmStateView;
}

function input(
  command: string,
  overrides: Partial<GateInput> = {}
): GateInput {
  return {
    normalized: normalizeCommand(command),
    fsm: ok({ commit: "FAIL", regression: "FAIL", active: true }),
    env: {},
    fileConsentValid: false,
    ...overrides,
  };
}
type TestConsent = NonNullable<GateInput["externalExecConsent"]>;

function consent(
  scope: TestConsent["scope"],
  overrides: Partial<TestConsent> = {}
): TestConsent {
  return {
    sourceMessageId: "u1",
    scope,
    remainingUses: 1,
    ...overrides,
  };
}

function tempConsent(
  scope: TestConsent["scope"],
  overrides: Partial<NonNullable<TestConsent["tempCredentials"]>> = {}
): TestConsent {
  return consent(scope, {
    tempCredentials: {
      provider: "aws",
      accessKeyId: "ASIAIOSFODNN7EXAMPLE",
      sessionTokenFingerprint: fingerprintExternalExecSecret("session123"),
      secretAccessKeyFingerprint: fingerprintExternalExecSecret("secret"),
      expiresAt: Date.now() + 60_000,
      ...overrides,
    },
  });
}

// ---------------------------------------------------------------------------
// AC1 — commit gate
// ---------------------------------------------------------------------------

describe("decideGate — commit gate (AC1)", () => {
  it("blocks `git commit` when active and commit gate is not PASS", () => {
    const r = decideGate(input("git commit -m x", { fsm: ok({ commit: "FAIL", regression: "PASS", active: true }) }));
    expect(r.block).toBe(true);
    expect(r.reason).toBeDefined();
  });

  it("allows `git commit` when active and commit+heavy-verifier cache are PASS", () => {
    const r = decideGate(input("git commit -m x", { fsm: ok({ commit: "PASS", regression: "PASS", active: true }) }));
    expect(r.block).toBe(false);
  });

  it("allows `git commit` when active and heavy-verifier cache is absent (targeted verifier path)", () => {
    const r = decideGate(input("git commit -m x", { fsm: ok({ commit: "PASS", regression: undefined, active: true }) }));
    expect(r.block).toBe(false);
  });

  it("blocks `git commit` when active and heavy-verifier cache is present but not PASS", () => {
    const r = decideGate(input("git commit -m x", { fsm: ok({ commit: "PASS", regression: "FAIL", active: true }) }));
    expect(r.block).toBe(true);
    expect(r.reason).toMatch(/pre-commit gate has not PASSED/i);
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

// ---------------------------------------------------------------------------
// External execution consent gate
// ---------------------------------------------------------------------------

describe("decideGate — external execution consent", () => {
  const tempCommand =
    "AWS_ACCESS_KEY_ID=ASIAIOSFODNN7EXAMPLE AWS_SECRET_ACCESS_KEY=secret AWS_SESSION_TOKEN=session123 aws s3 ls";
  const tempMutationCommand =
    "AWS_ACCESS_KEY_ID=ASIAIOSFODNN7EXAMPLE AWS_SECRET_ACCESS_KEY=secret AWS_SESSION_TOKEN=session123 aws s3 cp ./artifact.tgz s3://example-bucket/artifact.tgz";
  const tempSessionCommand =
    "AWS_ACCESS_KEY_ID=ASIAIOSFODNN7EXAMPLE AWS_SECRET_ACCESS_KEY=secret AWS_SESSION_TOKEN=session123 aws sts assume-role --role-arn x";

  it("blocks `aws sts assume-role --role-arn x` by default even when FSM is ABSENT", () => {
    const r = decideGate(input("aws sts assume-role --role-arn x", { fsm: { kind: "ABSENT" } }));
    expect(r.block).toBe(true);
    expect(r.reason).toMatch(/external-session|latest user message|direct external access command/i);
    expect(r.reason).not.toMatch(/PI_OVEN_EXTERNAL_EXEC/i);
  });

  it("allows `aws sts assume-role --role-arn x` with access consent and marks single-use consumption", () => {
    const r = decideGate(
      input("aws sts assume-role --role-arn x", {
        fsm: { kind: "ABSENT" },
        externalExecConsent: consent("access"),
      })
    );
    expect(r.block).toBe(false);
    expect(r.consumeExternalExecConsent).toBe(true);
  });
  it("allows external-session commands when the exact temporary bundle prefixes the same shell segment", () => {
    const allowed = decideGate(
      input(tempSessionCommand, {
        fsm: { kind: "ABSENT" },
        externalExecConsent: tempConsent("access"),
      })
    );
    expect(allowed.block).toBe(false);
    expect(allowed.consumeExternalExecConsent).toBeFalsy();
  });

  it("blocks external-session commands when temporary consent falls back to ambient credentials", () => {
    const blocked = decideGate(
      input("aws sts assume-role --role-arn x", {
        fsm: { kind: "ABSENT" },
        externalExecConsent: tempConsent("access"),
      })
    );
    expect(blocked.block).toBe(true);
    expect(blocked.reason).toMatch(/exact same unexpired inline bundle|external-session/i);
  });

  it("blocks external execution when consent is exhausted", () => {
    const r = decideGate(
      input("aws sts assume-role --role-arn x", {
        fsm: { kind: "ABSENT" },
        externalExecConsent: consent("access", { remainingUses: 0 }),
      })
    );
    expect(r.block).toBe(true);
    expect(r.reason).toMatch(/latest user message|direct external access command/i);
    expect(r.reason).not.toMatch(/PI_OVEN_EXTERNAL_EXEC/i);
  });

  it("blocks `aws s3 ls` with mutation-only consent but allows it with read consent", () => {
    const blocked = decideGate(
      input("aws s3 ls", {
        externalExecConsent: consent("mutation"),
      })
    );
    expect(blocked.block).toBe(true);
    expect(blocked.reason).toMatch(/external-read/i);

    const allowed = decideGate(
      input("aws s3 ls", {
        externalExecConsent: consent("read"),
      })
    );
    expect(allowed.block).toBe(false);
    expect(allowed.consumeExternalExecConsent).toBe(true);
  });

  it("allows matching AWS temporary credentials at access scope for read commands until expiresAt without consuming parent-only consent", () => {
    const allowed = decideGate(
      input(tempCommand, {
        externalExecConsent: tempConsent("access"),
      })
    );
    expect(allowed.block).toBe(false);
    expect(allowed.consumeExternalExecConsent).toBeFalsy();
  });
  it("blocks external-read commands when temporary consent falls back to ambient credentials", () => {
    const blocked = decideGate(
      input("aws s3 ls", {
        externalExecConsent: tempConsent("read"),
      })
    );
    expect(blocked.block).toBe(true);
    expect(blocked.reason).toMatch(/exact same unexpired inline bundle|external-read/i);
  });

  it("blocks external-read commands when access key + session token omit AWS_SECRET_ACCESS_KEY", () => {
    const blocked = decideGate(
      input(
        "AWS_ACCESS_KEY_ID=ASIAIOSFODNN7EXAMPLE AWS_SESSION_TOKEN=session123 aws s3 ls",
        {
          externalExecConsent: tempConsent("read", { secretAccessKeyFingerprint: undefined }),
        }
      )
    );
    expect(blocked.block).toBe(true);
    expect(blocked.reason).toMatch(/exact same unexpired inline bundle|external-read|AWS_SECRET_ACCESS_KEY/i);
  });

  it("blocks expired AWS temporary credentials", () => {
    const blocked = decideGate(
      input(tempCommand, {
        externalExecConsent: tempConsent("read", { expiresAt: Date.now() - 1_000 }),
      })
    );
    expect(blocked.block).toBe(true);
    expect(blocked.reason).toMatch(/latest consented AWS temporary credentials|expired|unexpired/i);
    expect(blocked.reason).not.toMatch(/PI_OVEN_EXTERNAL_EXEC/i);
  });

  it("blocks AWS temporary credentials when the pasted session token is missing", () => {
    const blocked = decideGate(
      input(
        "AWS_ACCESS_KEY_ID=ASIAIOSFODNN7EXAMPLE AWS_SECRET_ACCESS_KEY=secret aws s3 ls",
        {
          externalExecConsent: tempConsent("read"),
        }
      )
    );
    expect(blocked.block).toBe(true);
    expect(blocked.reason).toMatch(/AWS_SESSION_TOKEN|inline secret/i);
  });

  it("blocks AWS temporary credentials when the pasted session token does not match consent", () => {
    const blocked = decideGate(
      input(
        "AWS_ACCESS_KEY_ID=ASIAIOSFODNN7EXAMPLE AWS_SECRET_ACCESS_KEY=secret AWS_SESSION_TOKEN=other-session aws s3 ls",
        {
          externalExecConsent: tempConsent("read"),
        }
      )
    );
    expect(blocked.block).toBe(true);
    expect(blocked.reason).toMatch(/exact same unexpired inline bundle|ambient or local credentials cannot be reused/i);
  });
  it("blocks pasted AWS_SECRET_ACCESS_KEY values when consent omitted its fingerprint", () => {
    const blocked = decideGate(
      input(tempCommand, {
        externalExecConsent: tempConsent("read", { secretAccessKeyFingerprint: undefined }),
      })
    );
    expect(blocked.block).toBe(true);
    expect(blocked.reason).toMatch(/exact same unexpired inline bundle|ambient or local credentials cannot be reused/i);
  });

  it("blocks external-session commands when access key + session token omit AWS_SECRET_ACCESS_KEY", () => {
    const blocked = decideGate(
      input(
        "AWS_ACCESS_KEY_ID=ASIAIOSFODNN7EXAMPLE AWS_SESSION_TOKEN=session123 aws sts assume-role --role-arn x",
        {
          fsm: { kind: "ABSENT" },
          externalExecConsent: tempConsent("access", { secretAccessKeyFingerprint: undefined }),
        }
      )
    );
    expect(blocked.block).toBe(true);
    expect(blocked.reason).toMatch(/exact same unexpired inline bundle|external-session|AWS_SECRET_ACCESS_KEY/i);
  });


  it("allows mutation commands when the full temporary bundle prefixes the same shell segment", () => {
    const allowed = decideGate(
      input(tempMutationCommand, {
        externalExecConsent: tempConsent("mutation"),
      })
    );
    expect(allowed.block).toBe(false);
    expect(allowed.consumeExternalExecConsent).toBeFalsy();
  });

  it("blocks mutation commands when a matching temporary bundle appears only in an earlier shell segment", () => {
    const blocked = decideGate(
      input(
        "AWS_ACCESS_KEY_ID=ASIAIOSFODNN7EXAMPLE AWS_SECRET_ACCESS_KEY=secret AWS_SESSION_TOKEN=session123; aws s3 cp ./artifact.tgz s3://example-bucket/artifact.tgz",
        {
          externalExecConsent: tempConsent("mutation"),
        }
      )
    );
    expect(blocked.block).toBe(true);
    expect(blocked.reason).toMatch(/external-mutation/i);
  });

  it("blocks mutation consent when its temporary credential bundle omits the secret access key fingerprint", () => {
    const blocked = decideGate(
      input(tempMutationCommand, {
        externalExecConsent: tempConsent("mutation", { secretAccessKeyFingerprint: undefined }),
      })
    );
    expect(blocked.block).toBe(true);
    expect(blocked.reason).toMatch(/aws_secret_access_key|temporary credential bundle|external-mutation/i);
  });

  it("blocks mutation commands when the inline temporary credential bundle omits AWS_SECRET_ACCESS_KEY", () => {
    const blocked = decideGate(
      input(
        "AWS_ACCESS_KEY_ID=ASIAIOSFODNN7EXAMPLE AWS_SESSION_TOKEN=session123 aws s3 cp ./artifact.tgz s3://example-bucket/artifact.tgz",
        {
          externalExecConsent: tempConsent("mutation"),
        }
      )
    );
    expect(blocked.block).toBe(true);
    expect(blocked.reason).toMatch(/aws_secret_access_key|temporary credential bundle|external-mutation/i);
  });

  it("still blocks unrelated inline secrets even when AWS temporary credentials match consent", () => {
    const blocked = decideGate(
      input(
        "AWS_ACCESS_KEY_ID=ASIAIOSFODNN7EXAMPLE AWS_SECRET_ACCESS_KEY=secret AWS_SESSION_TOKEN=session123 API_TOKEN=abc123 aws s3 ls",
        {
          externalExecConsent: tempConsent("read"),
        }
      )
    );
    expect(blocked.block).toBe(true);
    expect(blocked.reason).toMatch(/Unrelated inline secrets remain blocked|inline secret/i);
  });

  it("blocks pasted permanent AWS access keys even when temporary consent exists", () => {
    const blocked = decideGate(
      input(
        "AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE AWS_SECRET_ACCESS_KEY=secret AWS_SESSION_TOKEN=session123 aws s3 ls",
        {
          externalExecConsent: tempConsent("read"),
        }
      )
    );
    expect(blocked.block).toBe(true);
    expect(blocked.reason).toMatch(/Permanent AWS access keys remain blocked|inline secret/i);
  });

  it("still blocks pasted AWS temporary credentials when consent scope does not match", () => {
    const blocked = decideGate(
      input(tempCommand, {
        externalExecConsent: tempConsent("mutation"),
      })
    );
    expect(blocked.block).toBe(true);
    expect(blocked.reason).toMatch(/external-read/i);
  });

  it("blocks chained external subcommands in one bash call even with broad consent", () => {
    const r = decideGate(
      input("aws s3 ls && aws sts assume-role --role-arn x", {
        fsm: { kind: "ABSENT" },
        externalExecConsent: consent("all"),
      })
    );
    expect(r.block).toBe(true);
    expect(r.reason).toMatch(/split/i);
    expect(r.consumeExternalExecConsent).toBeFalsy();
  });

  for (const scope of ["mutation", "all"] as const) {
    it(`blocks \`./scripts/deploy.sh --region singapore --warp on\` with local ${scope} consent`, () => {
      const result = decideGate(
        input("./scripts/deploy.sh --region singapore --warp on", {
          externalExecConsent: consent(scope),
        })
      );
      expect(result.block).toBe(true);
      expect(result.reason).toMatch(/Local-credential consent cannot authorize mutation|external-mutation/i);
    });
  }

  for (const scope of ["mutation", "all"] as const) {
    it(`blocks \`./scripts/deploy.sh --region singapore --warp on\` with temporary ${scope} consent when the command does not use the consented temp bundle`, () => {
      const result = decideGate(
        input("./scripts/deploy.sh --region singapore --warp on", {
          externalExecConsent: tempConsent(scope),
        })
      );
      expect(result.block).toBe(true);
      expect(result.reason).toMatch(/exact temporary credential bundle inline|external-mutation/i);
    });
  }
  for (const scope of ["mutation", "all"] as const) {
    it(`allows a mutation command that uses the consented temporary bundle with ${scope} consent`, () => {
      const result = decideGate(
        input(tempMutationCommand, {
          externalExecConsent: tempConsent(scope),
        })
      );
      expect(result.block).toBe(false);
    });
  }

  it("blocks inline secret literals even with all-scope local consent", () => {
    const r = decideGate(
      input("AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE aws s3 ls", {
        externalExecConsent: consent("all"),
      })
    );
    expect(r.block).toBe(true);
    expect(r.reason).toMatch(/inline secret/i);
  });
});

// ---------------------------------------------------------------------------
// WS5 — branch-contract and skill-read gate
// ---------------------------------------------------------------------------

describe("decideGate — code-write branch-contract and skill-read gate", () => {
  it("blocks code-write when the autonomous branch-contract marker is absent", () => {
    const r = decideGate(
      input("", {
        toolName: "edit",
        branchContract: { kind: "ABSENT" },
        requiredSkills: [],
        skillReads: [],
      })
    );
    expect(r.block).toBe(true);
    expect(r.reason).toMatch(/branch-contract\.json/i);
    expect(r.autonomyStopBoundary).toEqual({
      blockedReason: {
        kind: "branch-contract",
        message:
          "pi-oven: code-write blocked — the control-plane front door requires .pi-oven/state/branch-contract.json with destination/branch/pr_mode first.",
      },
      nextAction: {
        kind: "write-branch-contract",
        message:
          "Write .pi-oven/state/branch-contract.json with destination, branch, and pr_mode, then retry the write.",
      },
    });
  });

  it("allows bootstrap write of the branch-contract marker before the marker exists", () => {
    expect(BRANCH_CONTRACT_BOOTSTRAP_TARGET).toBe(".pi-oven/state/branch-contract.json");
    const r = decideGate(
      input("", {
        toolName: "write",
        targetPath: BRANCH_CONTRACT_BOOTSTRAP_TARGET,
        branchContract: { kind: "ABSENT" },
        requiredSkills: [],
        skillReads: [],
      })
    );
    expect(r.block).toBe(false);
  });

  it("treats ast_edit as a code-write tool subject to the same branch-contract gate", () => {
    const r = decideGate(
      input("", {
        toolName: "ast_edit",
        branchContract: { kind: "ABSENT" },
        requiredSkills: [],
        skillReads: [],
      })
    );
    expect(r.block).toBe(true);
    expect(r.reason).toMatch(/branch-contract\.json/i);
  });

  it("blocks code-write when exact plugin-owned skill proof targets remain unread", () => {
    const autonomousTarget = "/plugin/skills/autonomous-loop/SKILL.md";
    const delegationTarget = "/plugin/skills/large-task-delegation/SKILL.md";
    const r = decideGate(
      input("", {
        toolName: "edit",
        branchContract: {
          kind: "OK",
          contract: { destination: "worktree", branch: "feature/ws5", pr_mode: "draft" },
        },
        requiredSkills: ["pov:autonomous-loop", "pov:large-task-delegation"],
        ownedSkillReadTargets: [autonomousTarget, delegationTarget],
        skillReads: [autonomousTarget, "skill://pov:large-task-delegation"],
      })
    );
    expect(r.block).toBe(true);
    expect(r.reason).toMatch(/capability proof|owned skill proof/i);
    expect(r.reason).toContain(delegationTarget);
    expect(r.autonomyStopBoundary?.blockedReason.kind).toBe("skill-proof-incomplete");
    expect(r.autonomyStopBoundary?.nextAction).toEqual({
      kind: "complete-skill-proof",
      message: "Read the exact plugin-owned SKILL.md targets first, then retry the write.",
    });
  });

  it("blocks code-write when a required skill has no plugin-owned proof target", () => {
    const r = decideGate(
      input("", {
        toolName: "edit",
        branchContract: {
          kind: "OK",
          contract: { destination: "worktree", branch: "feature/ws5", pr_mode: "draft" },
        },
        requiredSkills: ["pov:autonomous-loop"],
        ownedSkillReadTargets: [],
        skillReads: [],
      })
    );
    expect(r.block).toBe(true);
    expect(r.reason).toMatch(/ownership/i);
    expect(r.reason).toMatch(/autonomous-loop/i);
    expect(r.autonomyStopBoundary?.nextAction).toEqual({
      kind: "complete-skill-proof",
      message:
        "Repair the exact plugin-owned skill proof surface so every required skill has a matching owned SKILL target, then retry the write.",
    });
  });

  it("allows code-write once the branch contract exists and every exact owned proof target was read", () => {
    const autonomousTarget = "/plugin/skills/autonomous-loop/SKILL.md";
    const r = decideGate(
      input("", {
        toolName: "edit",
        branchContract: {
          kind: "OK",
          contract: { destination: "worktree", branch: "feature/ws5", pr_mode: "draft" },
        },
        requiredSkills: ["pov:autonomous-loop"],
        ownedSkillReadTargets: [autonomousTarget],
        skillReads: [autonomousTarget],
      })
    );
    expect(r.block).toBe(false);
  });
});

describe("decideGate — brainstorming mutation guard", () => {
  const specPath = "docs/specs/2026-07-06-workflow-optimization-design.md";
  const branchContract = {
    kind: "OK" as const,
    contract: { destination: "worktree", branch: "feature/ws5", pr_mode: "draft" },
  };

  it("blocks code-write while deep-interview is actively converging", () => {
    const r = decideGate(
      input("", {
        toolName: "write",
        targetPath: "src/example.ts",
        branchContract,
        deepInterview: {
          version: 2,
          interviewId: "di-1",
          active: true,
          phase: "interviewing",
          threshold: 0.35,
          thresholdSource: "session",
          pendingQuestion: {
            roundKey: "di-1::rid:round-1",
            question: "What is the weakest unresolved dimension?",
            askedAt: "2026-07-06T00:00:00.000Z",
            meta: {
              interviewId: "di-1",
              round: 1,
              roundId: "round-1",
              questionId: "q-round-1",
              stage: "round",
              component: "runtime-routing",
              dimension: "criteria",
              milestone: "refined",
            },
          },
          state: {
            rounds: [],
            establishedFacts: [],
            ontologySnapshots: [],
            milestone: "refined",
            nextTarget: {
              componentId: "runtime-routing",
              dimension: "criteria",
              rationale: "Resolve the weakest unresolved dimension.",
            },
          },
        },
      })
    );
    expect(r.block).toBe(true);
    expect(r.reason).toMatch(/brainstorming|deep-interview|docs\/specs/i);
    expect(r.autonomyStopBoundary).toEqual({
      blockedReason: {
        kind: "approval-pending",
        message: r.reason!,
      },
      nextAction: {
        kind: "resolve-approval",
        message:
          "Resolve the pending approval/deep-interview handoff through the sanctioned runtime completion path before retrying the write.",
      },
    });
  });

  it("blocks direct docs/specs writes during handoff; only the runtime-owned sanctioned completion path may persist them", () => {
    const r = decideGate(
      input("", {
        toolName: "write",
        targetPath: specPath,
        branchContract,
        deepInterview: {
          version: 2,
          interviewId: "di-1",
          active: true,
          phase: "handoff",
          pendingQuestion: {
            roundKey: "di-1::rid:closure",
            question: "Can we restate the final spec and move into approval?",
            askedAt: "2026-07-06T00:03:00.000Z",
            meta: {
              interviewId: "di-1",
              round: 3,
              roundId: "closure",
              questionId: "q-closure",
              stage: "closure",
              milestone: "ready",
            },
          },
          state: {
            rounds: [
              {
                roundKey: "di-1::rid:closure",
                interviewId: "di-1",
                round: 3,
                roundId: "closure",
                questionId: "q-closure",
                stage: "closure",
                question: "Can we restate the final spec and move into approval?",
                questionHash: "qhash-closure",
                lifecycle: "answered",
                askedAt: "2026-07-06T00:02:00.000Z",
                answeredAt: "2026-07-06T00:03:00.000Z",
                selected: "Yes",
                answerHash: "ahash-closure",
                milestone: "ready",
              },
            ],
            establishedFacts: [],
            ontologySnapshots: [],
            milestone: "ready",
          },
        },
      })
    );
    expect(r.block).toBe(true);
    expect(r.reason).toMatch(/runtime-owned|sanctioned completion action|docs\/specs/i);
  });

  it("lifts the deep-interview guard once sanctioned spec persistence completed even if approvalFlow is still pending", () => {
    const r = decideGate(
      input("", {
        toolName: "edit",
        targetPath: "src/example.ts",
        branchContract,
        deepInterview: {
          version: 2,
          interviewId: "di-1",
          active: false,
          phase: "complete",
          spec: {
            path: specPath,
            sha256: "abc123",
            persistedAt: "2026-07-06T00:04:00.000Z",
            stage: "final",
          },
          state: {
            rounds: [],
            establishedFacts: [],
            ontologySnapshots: [],
            milestone: "ready",
          },
        },
        approvalFlow: {
          version: 1,
          active: true,
          kind: "spec-handoff",
          source: "brainstorming",
          decisionKey: "approve-workflow-optimization-spec-v1",
          summary:
            "Approve workflow optimization + gajae-style deep-interview redesign direction for spec/plan drafting",
          status: "pending",
          requestedAt: "2026-07-06T00:04:00.000Z",
          resumedFrom: {
            interviewId: "di-1",
            specPath,
          },
        },
      })
    );
    expect(r.block).toBe(false);
  });
  it("does not block code-write after a sanctioned final spec handoff resolves through a legacy localized affirmative answer", () => {
    const r = decideGate(
      input("", {
        toolName: "edit",
        targetPath: "src/example.ts",
        branchContract,
        deepInterview: {
          version: 2,
          interviewId: "di-approval-root",
          active: false,
          phase: "complete",
          spec: {
            path: specPath,
            sha256: "abc123",
            persistedAt: "2026-07-06T00:04:00.000Z",
            stage: "final",
          },
          state: {
            rounds: [],
            establishedFacts: [],
            ontologySnapshots: [],
            milestone: "ready",
          },
        },
        approvalFlow: {
          version: 1,
          active: false,
          kind: "spec-handoff",
          source: "manual",
          decisionKey: "approve-runtime-cutover",
          summary: "Approve the runtime cutover after root approvalFlow persistence.",
          status: "approved",
          requestedAt: "2026-07-06T00:04:00.000Z",
          resolvedAt: "2026-07-06T00:05:00.000Z",
          resumedFrom: {
            interviewId: "di-approval-root",
            specPath,
          },
          resolved: {
            selected: "approve",
            displayLabel: "이대로 진행",
            customInput: null,
          },
        },
      })
    );
    expect(r.block).toBe(false);
  });
});
