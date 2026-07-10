import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { runApply } from "../../../scripts/pi-oven-setup/apply";
import {
  DEFAULT_FALLBACK_CHAINS,
  DEFAULT_ORCHESTRATOR,
  DEFAULT_PROFILE,
  ROLES,
} from "../../../scripts/pi-oven-setup/profiles";

let tempDir: string | null = null;

function makeTempDir(): string {
  tempDir = mkdtempSync(join(tmpdir(), "pi-oven-apply-"));
  return tempDir;
}

afterEach(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = null;
});

function makeSpawnRecorder() {
  const writes: Record<string, unknown> = {};
  const spawnFn = (_cmd: string, args: string[]) => {
    if (args[0] === "config" && args[1] === "get") {
      const key = args[2];
      const value = writes[key] ?? (key === "skills.includeSkills" ? [] : {});
      const type = Array.isArray(value) ? "array" : "record";
      return {
        exitCode: 0,
        stdout: Buffer.from(JSON.stringify({ key, value, type })),
        stderr: Buffer.from(""),
      };
    }
    if (args[0] === "config" && args[1] === "set") {
      try {
        writes[args[2]] = JSON.parse(args[3]);
      } catch {
        writes[args[2]] = args[3];
      }
      return { exitCode: 0, stdout: Buffer.from(""), stderr: Buffer.from("") };
    }
    if (args[0] === "models") {
      return {
        exitCode: 0,
        stdout: Buffer.from(
          [
            "Canonical models",
            "  canonical  selected                 provider",
            "  1          openai-codex/gpt-5.5     openai-codex",
            "  2          openai-codex/gpt-5.4     openai-codex",
            "",
          ].join("\n")
        ),
        stderr: Buffer.from(""),
      };
    }
    return { exitCode: 0, stdout: Buffer.from(""), stderr: Buffer.from("") };
  };
  return { spawnFn, writes };
}

function makeAgentFile(dir: string, role: string): void {
  writeFileSync(
    join(dir, `pov-${role}.md`),
    [
      "---",
      `name: pov:${role}`,
      "description: test",
      "model:",
      "  - old/model",
      "thinkingLevel: medium",
      "mode: subagent",
      "tools: [\"read\"]",
      "blocked_tools: []",
      "---",
      "",
      "Body.",
      "",
    ].join("\n")
  );
}

describe("runApply", () => {
  it("rewrites agent frontmatter from DEFAULT_PROFILE on maintainer path", async () => {
    const dir = makeTempDir();
    makeAgentFile(dir, "executor");

    const result = await runApply({ agentsDir: dir, validateMode: "none" });

    expect(result.exitCode).toBe(0);
    const content = readFileSync(join(dir, "pov-executor.md"), "utf-8");
    expect(content).toContain(`  - ${DEFAULT_PROFILE.executor.primary}`);
    expect(content).toContain(`thinkingLevel: ${DEFAULT_PROFILE.executor.thinkingLevel}`);
    expect(content).not.toContain("old/model");
  });

  it("writes default global routing and ignores legacy profile values", async () => {
    const { spawnFn, writes } = makeSpawnRecorder();

    const result = await runApply({ profile: "D", validateMode: "smoke", spawnFn });

    expect(result.exitCode).toBe(0);
    expect(writes.modelRoles).toEqual(DEFAULT_ORCHESTRATOR);
    expect(writes["retry.fallbackChains"]).toEqual(DEFAULT_FALLBACK_CHAINS);
    expect(writes["skills.includeSkills"]).toEqual(["pov:*"]);
    const overrides = writes["task.agentModelOverrides"] as Record<string, string>;
    for (const role of ROLES) {
      expect(overrides[`pov:${role}`]).toBe(
        `${DEFAULT_PROFILE[role].primary}:${DEFAULT_PROFILE[role].thinkingLevel}`
      );
    }
  });

  it("writes project routing to .omp/settings.json", async () => {
    const cwd = makeTempDir();
    const { spawnFn } = makeSpawnRecorder();
    const result = await runApply({ scope: "project", cwd, validateMode: "none", spawnFn });

    expect(result.exitCode).toBe(0);
    const settings = JSON.parse(readFileSync(join(cwd, ".omp", "settings.json"), "utf-8"));
    expect(settings.modelRoles).toEqual(DEFAULT_ORCHESTRATOR);
    expect(settings.retry.fallbackChains).toEqual(DEFAULT_FALLBACK_CHAINS);
    expect(settings.skills.includeSkills).toEqual(["pov:*"]);
    expect(settings.task.agentModelOverrides["pov:executor"]).toBe(
      `${DEFAULT_PROFILE.executor.primary}:${DEFAULT_PROFILE.executor.thinkingLevel}`
    );
  });
});
