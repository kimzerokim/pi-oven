import { describe, it, expect } from "bun:test";
import {
  evalOmpVersion,
  evalBinaryPresent,
  evalGit,
  evalAuth,
  evalMcp,
  evalSkills,
  evalAgents,
  evalStateDir,
  evalEvalRunner,
  evalOpsConnector,
  rollup,
  exitCodeFor,
  type CheckResult,
  type DoctorFacts,
} from "../../scripts/pi-oven-doctor";

// ---------------------------------------------------------------------------
// (1) omp version evaluator — PASS / FAIL / WARN
// ---------------------------------------------------------------------------

describe("evalOmpVersion", () => {
  it("PASS when installed version >= min", () => {
    const r = evalOmpVersion({ present: true, version: "15.5.10" }, "15.0.0");
    expect(r.status).toBe("PASS");
    expect(r.detail).toContain("15.5.10");
  });

  it("FAIL when installed version < min", () => {
    const r = evalOmpVersion({ present: true, version: "14.9.0" }, "15.0.0");
    expect(r.status).toBe("FAIL");
    expect(r.fix).toBeDefined();
  });

  it("PASS when exactly equal to min", () => {
    const r = evalOmpVersion({ present: true, version: "15.0.0" }, "15.0.0");
    expect(r.status).toBe("PASS");
  });

  it("WARN when omp CLI absent locally", () => {
    const r = evalOmpVersion({ present: false }, "15.0.0");
    expect(r.status).toBe("WARN");
    expect(r.detail).toMatch(/not found|absent/i);
  });
});

// ---------------------------------------------------------------------------
// (2)/(3) binary presence evaluators
// ---------------------------------------------------------------------------

describe("evalBinaryPresent", () => {
  it("PASS when bun present with version", () => {
    const r = evalBinaryPresent("bun", { present: true, version: "1.2.0" });
    expect(r.status).toBe("PASS");
    expect(r.name).toBe("bun");
  });

  it("FAIL when binary absent", () => {
    const r = evalBinaryPresent("bun", { present: false });
    expect(r.status).toBe("FAIL");
    expect(r.fix).toBeDefined();
  });
});

describe("evalGit", () => {
  it("PASS when git present and inside repo", () => {
    const r = evalGit({ present: true, version: "2.44.0", insideRepo: true });
    expect(r.status).toBe("PASS");
  });

  it("FAIL when git present but not inside a repo", () => {
    const r = evalGit({ present: true, version: "2.44.0", insideRepo: false });
    expect(r.status).toBe("FAIL");
    expect(r.detail).toMatch(/repo/i);
  });

  it("FAIL when git absent", () => {
    const r = evalGit({ present: false, insideRepo: false });
    expect(r.status).toBe("FAIL");
  });
});

// ---------------------------------------------------------------------------
// (4) provider auth — PASS if >=1 whitelisted provider authed
// ---------------------------------------------------------------------------

describe("evalAuth", () => {
  it("PASS when opencode-zen authed", () => {
    const r = evalAuth({ opencode_zen: true, openai_codex: false, anthropic: false });
    expect(r.status).toBe("PASS");
    expect(r.detail).toContain("opencode-zen");
  });

  it("PASS when only anthropic authed", () => {
    const r = evalAuth({ opencode_zen: false, openai_codex: false, anthropic: true });
    expect(r.status).toBe("PASS");
  });

  it("WARN when no whitelisted provider authed", () => {
    const r = evalAuth({ opencode_zen: false, openai_codex: false, anthropic: false });
    expect(r.status).toBe("WARN");
    expect(r.fix).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// (5) MCP servers — informational / WARN
// ---------------------------------------------------------------------------

describe("evalMcp", () => {
  it("PASS when servers configured", () => {
    const r = evalMcp({ servers: ["playwright"] });
    expect(r.status).toBe("PASS");
    expect(r.detail).toContain("playwright");
  });

  it("WARN when no servers configured (informational, never FAIL)", () => {
    const r = evalMcp({ servers: [] });
    expect(r.status).toBe("WARN");
  });
});

// ---------------------------------------------------------------------------
// (6) skills SoT manifest alignment
// ---------------------------------------------------------------------------

describe("evalSkills", () => {
  it("PASS when plugin skill manifest matches SoT set", () => {
    const r = evalSkills({
      skillMdCount: 21,
      pluginSkillsCount: 21,
      missingFromManifest: [],
      extraInManifest: [],
    });
    expect(r.status).toBe("PASS");
    expect(r.detail).toContain("SoT-aligned");
  });

  it("FAIL when SoT-required skills are missing from plugin manifest", () => {
    const r = evalSkills({
      skillMdCount: 21,
      pluginSkillsCount: 19,
      missingFromManifest: ["./skills/autonomous-loop/SKILL.md"],
      extraInManifest: [],
    });
    expect(r.status).toBe("FAIL");
    expect(r.detail).toContain("Missing:");
    expect(r.fix).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// (7) agents count + lint clean
// ---------------------------------------------------------------------------

describe("evalAgents", () => {
  it("PASS when 22 agents and lint clean", () => {
    const r = evalAgents({ agentCount: 22, expectedCount: 22, lintClean: true });
    expect(r.status).toBe("PASS");
  });

  it("FAIL when agent count mismatch", () => {
    const r = evalAgents({ agentCount: 21, expectedCount: 22, lintClean: true });
    expect(r.status).toBe("FAIL");
    expect(r.detail).toMatch(/21.*22|22.*21/);
  });

  it("FAIL when count matches but lint dirty", () => {
    const r = evalAgents({ agentCount: 22, expectedCount: 22, lintClean: false });
    expect(r.status).toBe("FAIL");
    expect(r.detail).toMatch(/lint/i);
    expect(r.fix).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// (8) state dir creatable + writable
// ---------------------------------------------------------------------------

describe("evalStateDir", () => {
  it("PASS when state dir writable", () => {
    const r = evalStateDir({ writable: true, path: ".pi-oven" });
    expect(r.status).toBe("PASS");
  });

  it("FAIL when state dir not writable", () => {
    const r = evalStateDir({ writable: false, path: ".pi-oven", error: "EACCES" });
    expect(r.status).toBe("FAIL");
    expect(r.fix).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// (9) eval runner present + can enumerate smoke scenarios
// ---------------------------------------------------------------------------

describe("evalEvalRunner", () => {
  it("PASS when runner present and smoke scenarios enumerated", () => {
    const r = evalEvalRunner({ runnerPresent: true, smokeScenarioCount: 15 });
    expect(r.status).toBe("PASS");
    expect(r.detail).toContain("15");
  });

  it("FAIL when runner script absent", () => {
    const r = evalEvalRunner({ runnerPresent: false, smokeScenarioCount: 0 });
    expect(r.status).toBe("FAIL");
    expect(r.fix).toBeDefined();
  });

  it("WARN when runner present but zero smoke scenarios enumerable", () => {
    const r = evalEvalRunner({ runnerPresent: true, smokeScenarioCount: 0 });
    expect(r.status).toBe("WARN");
  });
});

// ---------------------------------------------------------------------------
// (10) UC5 ops connector readiness
// ---------------------------------------------------------------------------

describe("evalOpsConnector", () => {
  it("PASS when connector skills exist and credential source exists", () => {
    const r = evalOpsConnector({ missingSkills: [], credentialFile: ".external-credentials" });
    expect(r.status).toBe("PASS");
    expect(r.detail).toContain(".external-credentials");
  });

  it("WARN when connector skills exist but no credential file", () => {
    const r = evalOpsConnector({ missingSkills: [], credentialFile: null });
    expect(r.status).toBe("WARN");
    expect(r.fix).toBeDefined();
  });

  it("FAIL when any required connector skill is missing", () => {
    const r = evalOpsConnector({ missingSkills: ["skills/aws/SKILL.md"], credentialFile: ".external-credentials" });
    expect(r.status).toBe("FAIL");
    expect(r.fix).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Rollup + exit-code logic
// ---------------------------------------------------------------------------

function mk(status: CheckResult["status"]): CheckResult {
  return { name: "x", status, detail: "" };
}

describe("rollup", () => {
  it("overall PASS when all checks PASS", () => {
    const checks = [mk("PASS"), mk("PASS"), mk("PASS")];
    expect(rollup(checks).overall).toBe("PASS");
  });

  it("overall WARN when some WARN but no FAIL", () => {
    const checks = [mk("PASS"), mk("WARN"), mk("PASS")];
    expect(rollup(checks).overall).toBe("WARN");
  });

  it("overall FAIL when any FAIL (even amid WARN/PASS)", () => {
    const checks = [mk("PASS"), mk("WARN"), mk("FAIL")];
    expect(rollup(checks).overall).toBe("FAIL");
  });

  it("counts PASS/WARN/FAIL", () => {
    const r = rollup([mk("PASS"), mk("WARN"), mk("WARN"), mk("FAIL")]);
    expect(r.pass).toBe(1);
    expect(r.warn).toBe(2);
    expect(r.fail).toBe(1);
  });
});

describe("exitCodeFor", () => {
  it("exit 0 when no FAIL (PASS only)", () => {
    expect(exitCodeFor([mk("PASS"), mk("PASS")])).toBe(0);
  });

  it("exit 0 when WARN present but no FAIL", () => {
    expect(exitCodeFor([mk("PASS"), mk("WARN")])).toBe(0);
  });

  it("exit 1 when any FAIL", () => {
    expect(exitCodeFor([mk("PASS"), mk("FAIL")])).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Type-shape guard: gather() facts feed each evaluator
// ---------------------------------------------------------------------------

describe("DoctorFacts → evaluators integration (pure, injected facts)", () => {
  it("produces exactly 10 checks from a full facts object", () => {
    const facts: DoctorFacts = {
      omp: { present: true, version: "15.5.10" },
      bun: { present: true, version: "1.2.0" },
      git: { present: true, version: "2.44.0", insideRepo: true },
      auth: { opencode_zen: true, openai_codex: false, anthropic: false },
      mcp: { servers: ["playwright"] },
      skills: { skillMdCount: 21, pluginSkillsCount: 21, missingFromManifest: [], extraInManifest: [] },
      agents: { agentCount: 22, expectedCount: 22, lintClean: true },
      stateDir: { writable: true, path: ".pi-oven" },
      evalRunner: { runnerPresent: true, smokeScenarioCount: 15 },
      opsConnector: { missingSkills: [], credentialFile: ".external-credentials" },
    };
    const checks = [
      evalOmpVersion(facts.omp, "15.0.0"),
      evalBinaryPresent("bun", facts.bun),
      evalGit(facts.git),
      evalAuth(facts.auth),
      evalMcp(facts.mcp),
      evalSkills(facts.skills),
      evalAgents(facts.agents),
      evalStateDir(facts.stateDir),
      evalEvalRunner(facts.evalRunner),
      evalOpsConnector(facts.opsConnector),
    ];
    expect(checks).toHaveLength(10);
    expect(exitCodeFor(checks)).toBe(0);
  });
});
