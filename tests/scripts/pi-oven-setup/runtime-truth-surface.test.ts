import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  collectRuntimeTruthSurface,
  formatRuntimeTruthSurface,
} from "../../../scripts/pi-oven-setup/standalone-truth-surface";
import { runStatus } from "../../../scripts/pi-oven-setup/status";
import {
  buildDoctorReport,
  MIN_OMP_VERSION,
  type DoctorFacts,
} from "../../../scripts/pi-oven-doctor";
import { SUPPORTED_OMP_VERSION } from "../../../.omp/extensions/pi-oven-runtime/runtime-contract";

const roots: string[] = [];

function temporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "pi-oven-runtime-truth-"));
  roots.push(root);
  return root;
}

function absentConfigSpawn(cmd: string, args: string[]) {
  if (cmd === "omp" && args[0] === "--version") {
    return { exitCode: 0, stdout: Buffer.from("15.5.3\n"), stderr: Buffer.from("") };
  }
  return { exitCode: 1, stdout: Buffer.from(""), stderr: Buffer.from("missing key") };
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("shared doctor/status runtime truth surface", () => {
  test("active doctor/status source does not name removed scheduler implementations", async () => {
    const root = resolve(import.meta.dir, "../../..");
    const forbidden = [
      ["pi", "oven", "team"].join("-"),
      ["nativeWorkers", "maxWorkers"].join("."),
    ];
    for (const file of [
      "scripts/pi-oven-setup/standalone-truth-surface.ts",
      "scripts/pi-oven-setup/status.ts",
      "scripts/pi-oven-doctor.ts",
    ]) {
      const source = await Bun.file(join(root, file)).text();
      for (const token of forbidden) expect(source).not.toContain(token);
    }
  });

  test("reports current contracts with only PASS/WARN/FAIL/NOT RUN labels", async () => {
    const projectRoot = temporaryRoot();
    const pluginRoot = resolve(import.meta.dir, "../../..");

    const report = await collectRuntimeTruthSurface({
      pluginAssetPath: pluginRoot,
      projectRoot,
      homeDir: projectRoot,
      spawnFn: absentConfigSpawn,
    });
    const byName = new Map(report.checks.map((check) => [check.name, check]));

    expect(byName.get("RuntimeContract")?.status).toBe("PASS");
    expect(byName.get("RuntimeContract")?.detail).toContain("runtime-contract@1");
    expect(byName.get("role registry")?.detail).toContain("24/24");
    expect(byName.get("namespace migration")?.detail).toContain("24/24 canonical agents");
    expect(byName.get("capability policy / agent parity")?.status).toBe("PASS");
    expect(byName.get("offline eval discrimination")?.status).toBe("PASS");
    expect(byName.get("live dispatch canary")?.status).toBe("NOT RUN");
    expect(byName.get("OMP package")?.detail).toContain("15.5.3");
    const packageVersion = JSON.parse(await Bun.file(join(pluginRoot, "package.json")).text()).version;
    expect(byName.get("release metadata")?.detail).toContain(`immutable ref v${packageVersion}`);
    expect(byName.get("native team")?.detail).toBe("removed; OMP task owns dispatch");
    expect(new Set(report.checks.map((check) => check.status))).toEqual(
      new Set(["PASS", "WARN", "NOT RUN"]),
    );

    const output = formatRuntimeTruthSurface(report);
    expect(output).not.toMatch(/\[(?:INFO|INACTIVE|ACTIVE|NOT_RUN)\]/);
    expect(output).toContain("[NOT RUN] live dispatch canary:");
    expect(output).not.toMatch(/fix:.*(?:rm -rf|reset --hard|git clean)/i);
  }, 20_000);

  test("preserves the last live canary PASS/FAIL/NOT RUN status without inventing PASS", async () => {
    const projectRoot = temporaryRoot();
    const pluginRoot = resolve(import.meta.dir, "../../..");
    const receipt = join(projectRoot, "canary.json");
    mkdirSync(projectRoot, { recursive: true });

    for (const [stored, expected] of [
      ["PASS", "PASS"],
      ["FAIL", "FAIL"],
      ["NOT_RUN", "NOT RUN"],
    ] as const) {
      writeFileSync(receipt, `${JSON.stringify({ status: stored, reason: "fixture" })}\n`);
      const report = await collectRuntimeTruthSurface({
        pluginAssetPath: pluginRoot,
        projectRoot,
        homeDir: projectRoot,
        liveCanaryReceiptPath: receipt,
        spawnFn: absentConfigSpawn,
      });
      expect(report.checks.find((check) => check.name === "live dispatch canary")?.status).toBe(
        expected,
      );
    }
  }, 20_000);

  test("fails generated parity and counts a stale legacy namespace key without rewriting it", async () => {
    const projectRoot = temporaryRoot();
    const incompletePluginRoot = temporaryRoot();
    mkdirSync(join(incompletePluginRoot, ".claude-plugin"), { recursive: true });
    writeFileSync(
      join(incompletePluginRoot, ".claude-plugin", "plugin.json"),
      JSON.stringify({ version: "0.2.4", skills: [] }),
    );
    writeFileSync(
      join(incompletePluginRoot, "package.json"),
      JSON.stringify({ version: "0.2.4", dependencies: { "@oh-my-pi/pi-coding-agent": "15.5.3" } }),
    );
    writeFileSync(
      join(incompletePluginRoot, ".claude-plugin", "marketplace.json"),
      JSON.stringify({ plugins: [{ version: "0.2.4", source: { ref: "v0.2.4" } }] }),
    );
    mkdirSync(join(projectRoot, ".omp"), { recursive: true });
    writeFileSync(
      join(projectRoot, ".omp", "settings.json"),
      JSON.stringify({ task: { agentModelOverrides: { "pi-oven:critic": "openai-codex/gpt-5.5" } } }),
    );

    const report = await collectRuntimeTruthSurface({
      pluginAssetPath: incompletePluginRoot,
      projectRoot,
      homeDir: projectRoot,
      spawnFn: absentConfigSpawn,
    });

    expect(report.checks.find((check) => check.name === "RuntimeContract")?.status).toBe("FAIL");
    expect(report.checks.find((check) => check.name === "namespace migration")?.detail).toContain(
      "1 known stale config keys",
    );
    expect(
      JSON.parse(await Bun.file(join(projectRoot, ".omp", "settings.json")).text()).task
        .agentModelOverrides,
    ).toHaveProperty("pi-oven:critic");
  }, 20_000);

  test("setup status renders the shared report instead of independent ledger/transaction labels", async () => {
    const projectRoot = temporaryRoot();
    const pluginRoot = resolve(import.meta.dir, "../../..");
    const result = await runStatus({
      cwd: projectRoot,
      homeDir: projectRoot,
      pluginAssetPath: pluginRoot,
      spawnFn: absentConfigSpawn,
    });

    expect(result.output).toContain("Runtime contract truth surface:");
    expect(result.output).toContain("[PASS] RuntimeContract: runtime-contract@1");
    expect(result.output).toContain("[NOT RUN] live dispatch canary:");
    expect(result.output).not.toContain("[INACTIVE] run ledger:");
    expect(result.output.match(/setup transaction \(project\)/g)).toHaveLength(1);
  }, 20_000);

  test("doctor renders the same source report and derives its minimum OMP version", async () => {
    const projectRoot = temporaryRoot();
    const pluginRoot = resolve(import.meta.dir, "../../..");
    const facts: DoctorFacts = {
      omp: { present: true, version: "15.5.3" },
      bun: { present: true, version: "1.3.14" },
      git: { present: true, version: "2.50.0", insideRepo: true },
      auth: { opencode_zen: false, openai_codex: true, anthropic: false },
      mcp: { servers: ["local"] },
      skills: { skillMdCount: 23, pluginSkillsCount: 23, missingFromManifest: [], extraInManifest: [], keywordIndexLoadedCount: 23, keywordIndexIssueCount: 0, keywordIndexIssues: [] },
      agents: { agentCount: 24, expectedCount: 24, lintClean: true, legacyAgentCount: 0, namespaceDrift: [] },
      stateDir: { writable: true, path: join(projectRoot, ".pi-oven") },
      evalRunner: { runnerPresent: true, smokeScenarioCount: 1 },
      opsConnector: { missingSkills: [], credentialFile: ".external-credentials" },
      memory: { backend: "mnemopi", noEmbeddingsPresent: true, llmModePresent: true, asyncEnabled: true, taskEnableLsp: true },
    };

    const result = await buildDoctorReport({
      facts,
      pluginRoot,
      projectRoot,
      homeDir: projectRoot,
      spawnFn: absentConfigSpawn,
    });

    expect(MIN_OMP_VERSION).toBe(SUPPORTED_OMP_VERSION);
    expect(result.output).toContain("Runtime contract truth surface:");
    expect(result.output).toContain("[PASS] RuntimeContract: runtime-contract@1");
    expect(result.output).toContain("[NOT RUN] live dispatch canary:");
    expect(result.output.match(/Summary:/g)).toHaveLength(1);
    expect(result.output).toMatch(/Summary:.*NOT RUN.*overall WARN/);
  }, 20_000);
});
