import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
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
  evalMemory,
  rollup,
  exitCodeFor,
  gather,
  renderReport,
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
  it("PASS when 24 agents and lint clean", () => {
    const r = evalAgents({ agentCount: 24, expectedCount: 24, lintClean: true });
    expect(r.status).toBe("PASS");
  });

  it("FAIL when agent count mismatch", () => {
    const r = evalAgents({ agentCount: 23, expectedCount: 24, lintClean: true });
    expect(r.status).toBe("FAIL");
    expect(r.detail).toMatch(/23.*24|24.*23/);
  });

  it("FAIL when count matches but lint dirty", () => {
    const r = evalAgents({ agentCount: 24, expectedCount: 24, lintClean: false });
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
// (11) memory / killer-tools — WARN-only native memory/async readiness
// ---------------------------------------------------------------------------

describe("evalMemory", () => {
  it("PASS when mnemopi backend + config keys present + async enabled", () => {
    const r = evalMemory({
      backend: "mnemopi",
      noEmbeddingsPresent: true,
      llmModePresent: true,
      asyncEnabled: true,
    });
    expect(r.status).toBe("PASS");
    expect(r.detail).toMatch(/mnemopi/i);
  });

  it("WARN when backend is not mnemopi (never FAIL)", () => {
    const r = evalMemory({
      backend: null,
      noEmbeddingsPresent: false,
      llmModePresent: false,
      asyncEnabled: false,
    });
    expect(r.status).toBe("WARN");
    expect(r.detail).toMatch(/memory\.backend/);
    expect(r.fix).toBeDefined();
  });

  it("WARN when async disabled even if mnemopi config complete", () => {
    const r = evalMemory({
      backend: "mnemopi",
      noEmbeddingsPresent: true,
      llmModePresent: true,
      asyncEnabled: false,
    });
    expect(r.status).toBe("WARN");
    expect(r.detail).toMatch(/async/i);
  });

  it("WARN when mnemopi config keys absent", () => {
    const r = evalMemory({
      backend: "mnemopi",
      noEmbeddingsPresent: false,
      llmModePresent: true,
      asyncEnabled: true,
    });
    expect(r.status).toBe("WARN");
    expect(r.detail).toMatch(/noEmbeddings|llmMode/);
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

describe("renderReport", () => {
  it("appends standalone truth-surface signals with the shared remediation wording", () => {
    const report = renderReport(
      [mk("PASS")],
      [
        {
          level: "WARN",
          name: "project-scope remediation",
          detail:
            "project routing is active in /tmp/project/.omp/settings.json (24 roles), but the machine-global tool flags are missing: inspect_image.enabled, web_search.enabled.",
          fix:
            "Run /pi-oven:setup --scope global once on this machine to enable those tool flags. Project scope does not write ~/.omp/agent/config.yml.",
        },
        {
          level: "INFO",
          name: "sibling-skill suppression",
          detail:
            "not enabled in ~/.omp/agent/config.yml; sibling marketplace skills remain visible.",
          fix:
            "Optional global-only step: /pi-oven:setup --suppress-sibling-skills",
        },
      ]
    );

    expect(report).toContain("Standalone truth surface:");
    expect(report).toContain("[WARN] project-scope remediation:");
    expect(report).toContain("/pi-oven:setup --scope global");
    expect(report).toContain("[INFO] sibling-skill suppression:");
    expect(report).toContain("--suppress-sibling-skills");
  });
});

describe("gather", () => {
  let tempDir: string;
  let pluginRoot: string;
  let projectRoot: string;

  beforeEach(() => {
    tempDir = join(
      tmpdir(),
      `pi-oven-doctor-topology-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    pluginRoot = join(tempDir, "plugin-root");
    projectRoot = join(tempDir, "project-root");
    mkdirSync(pluginRoot, { recursive: true });
    mkdirSync(projectRoot, { recursive: true });

    mkdirSync(join(pluginRoot, "skills", "foo"), { recursive: true });
    writeFileSync(join(pluginRoot, "skills", "foo", "SKILL.md"), "# skill\n", "utf-8");
    mkdirSync(join(pluginRoot, ".claude-plugin"), { recursive: true });
    writeFileSync(
      join(pluginRoot, ".claude-plugin", "plugin.json"),
      JSON.stringify({ skills: ["./skills/foo/SKILL.md"] }, null, 2) + "\n",
      "utf-8"
    );
    mkdirSync(join(pluginRoot, "agents"), { recursive: true });
    writeFileSync(join(pluginRoot, "agents", "pi-oven-executor.md"), "---\nname: pi-oven:executor\n", "utf-8");
    mkdirSync(join(pluginRoot, "scripts"), { recursive: true });
    writeFileSync(join(pluginRoot, "scripts", "run-eval.ts"), "// runner\n", "utf-8");
    mkdirSync(join(pluginRoot, "evals", "foo", "scenarios"), { recursive: true });
    writeFileSync(
      join(pluginRoot, "package.json"),
      JSON.stringify({ name: "doctor-topology-fixture", scripts: { "lint:agents": "true" } }, null, 2) + "\n",
      "utf-8"
    );
    writeFileSync(
      join(pluginRoot, "evals", "foo", "scenarios", "smoke.yaml"),
      "name: smoke\ntag: smoke\n",
      "utf-8"
    );
    for (const rel of [
      "skills/aws/SKILL.md",
      "skills/bitbucket-pipeline/SKILL.md",
      "skills/cloudflare/SKILL.md",
    ]) {
      mkdirSync(join(pluginRoot, dirname(rel)), { recursive: true });
      writeFileSync(join(pluginRoot, rel), "# connector\n", "utf-8");
    }

    mkdirSync(join(projectRoot, ".pi"), { recursive: true });
    writeFileSync(
      join(projectRoot, ".pi", "mcp.json"),
      JSON.stringify({ mcpServers: { local: {} } }, null, 2) + "\n",
      "utf-8"
    );
    writeFileSync(join(projectRoot, ".external-credentials"), "token\n", "utf-8");
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("separates plugin assets from project-local state in an installed topology", async () => {
    const facts = await gather(pluginRoot, projectRoot);

    expect(facts.skills.skillMdCount).toBe(4);
    expect(facts.skills.pluginSkillsCount).toBe(1);
    expect(facts.agents.agentCount).toBe(1);
    expect(facts.evalRunner.runnerPresent).toBe(true);
    expect(facts.evalRunner.smokeScenarioCount).toBe(1);
    expect(facts.opsConnector.credentialFile).toBe(".external-credentials");
    expect(facts.stateDir.path).toBe(join(projectRoot, ".pi-oven"));
  });
});

// ---------------------------------------------------------------------------
// Type-shape guard: gather() facts feed each evaluator
// ---------------------------------------------------------------------------

describe("DoctorFacts → evaluators integration (pure, injected facts)", () => {
  it("produces exactly 11 checks from a full facts object", () => {
    const facts: DoctorFacts = {
      omp: { present: true, version: "15.5.10" },
      bun: { present: true, version: "1.2.0" },
      git: { present: true, version: "2.44.0", insideRepo: true },
      auth: { opencode_zen: true, openai_codex: false, anthropic: false },
      mcp: { servers: ["playwright"] },
      skills: { skillMdCount: 22, pluginSkillsCount: 22, missingFromManifest: [], extraInManifest: [] },
      agents: { agentCount: 24, expectedCount: 24, lintClean: true },
      stateDir: { writable: true, path: ".pi-oven" },
      evalRunner: { runnerPresent: true, smokeScenarioCount: 15 },
      opsConnector: { missingSkills: [], credentialFile: ".external-credentials" },
      memory: { backend: "mnemopi", noEmbeddingsPresent: true, llmModePresent: true, asyncEnabled: true },
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
      evalMemory(facts.memory),
    ];
    expect(checks).toHaveLength(11);
    expect(exitCodeFor(checks)).toBe(0);
  });
});
