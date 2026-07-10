import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { runOverride } from "../../../scripts/pi-oven-setup/override";
import { projectSettingsPath } from "../../../scripts/pi-oven-setup/project-settings";

const LIST_MODELS_FIXTURE = [
  "Canonical models",
  "  canonical  selected                 provider",
  "  1          openai-codex/gpt-5.5     openai-codex",
  "  2          openai-codex/gpt-5.4     openai-codex",
  "",
].join("\n");

let tempDir: string | null = null;

function makeTempDir(): string {
  tempDir = mkdtempSync(join(tmpdir(), "pi-oven-override-"));
  return tempDir;
}

afterEach(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = null;
});

function makeSpawnRecorder(initialOverrides: Record<string, string> = {}) {
  const calls: string[][] = [];
  const spawnFn = (_cmd: string, args: string[]) => {
    calls.push(args);
    if (args[0] === "config" && args[1] === "get") {
      const value = args[2] === "skills.includeSkills" ? [] : initialOverrides;
      return {
        exitCode: 0,
        stdout: Buffer.from(JSON.stringify({ type: Array.isArray(value) ? "array" : "record", value })),
        stderr: Buffer.from(""),
      };
    }
    return { exitCode: 0, stdout: Buffer.from(""), stderr: Buffer.from("") };
  };
  return { calls, spawnFn };
}

describe("runOverride", () => {
  it("writes codex selectors to canonical global pov keys", async () => {
    const { calls, spawnFn } = makeSpawnRecorder();

    const result = await runOverride({
      entries: ["critic=openai-codex/gpt-5.5:xhigh"],
      listModelsOutput: LIST_MODELS_FIXTURE,
      spawnFn,
    });

    expect(result.exitCode).toBe(0);
    expect(result.applied).toEqual([
      { colonKey: "pov:critic", model: "openai-codex/gpt-5.5:xhigh" },
    ]);
    const write = calls.find((args) => args[0] === "config" && args[1] === "set" && args[2] === "task.agentModelOverrides");
    expect(JSON.parse(write![3])).toEqual({
      "pov:critic": "openai-codex/gpt-5.5:xhigh",
    });
    const includeWrite = calls.find((args) => args[2] === "skills.includeSkills");
    expect(JSON.parse(includeWrite![3])).toEqual(["pov:*"]);
  });

  it("rejects non-codex overrides before writing", async () => {
    const { calls, spawnFn } = makeSpawnRecorder();

    const result = await runOverride({
      entries: ["critic=anthropic/claude-opus-4-8"],
      listModelsOutput: LIST_MODELS_FIXTURE,
      spawnFn,
    });

    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("must be an openai-codex");
    expect(calls.some((args) => args[0] === "config" && args[1] === "set")).toBe(false);
  });

  it("validates all entries before writing", async () => {
    const { calls, spawnFn } = makeSpawnRecorder();

    const result = await runOverride({
      entries: ["critic=openai-codex/gpt-5.5:xhigh", "nope=openai-codex/gpt-5.4"],
      listModelsOutput: LIST_MODELS_FIXTURE,
      spawnFn,
    });

    expect(result.exitCode).toBe(1);
    expect(calls.some((args) => args[0] === "config" && args[1] === "set")).toBe(false);
  });

  it("writes project overrides without omp config calls", async () => {
    const cwd = makeTempDir();
    const { calls, spawnFn } = makeSpawnRecorder();

    const result = await runOverride({
      entries: ["executor=openai-codex/gpt-5.5:high"],
      listModelsOutput: LIST_MODELS_FIXTURE,
      spawnFn,
      scope: "project",
      cwd,
    });

    expect(result.exitCode).toBe(0);
    expect(calls).toHaveLength(0);
    const parsed = JSON.parse(readFileSync(projectSettingsPath(cwd), "utf-8"));
    expect(parsed.task.agentModelOverrides["pov:executor"]).toBe("openai-codex/gpt-5.5:high");
    expect(parsed.skills.includeSkills).toEqual(["pov:*"]);
  });

  it("preserves hand-authored project siblings", async () => {
    const cwd = makeTempDir();
    const settingsPath = projectSettingsPath(cwd);
    mkdirSync(join(cwd, ".omp"), { recursive: true });
    writeFileSync(settingsPath, JSON.stringify({ extensions: ["keep"] }), "utf-8");

    await runOverride({
      entries: ["executor=openai-codex/gpt-5.5:high"],
      listModelsOutput: LIST_MODELS_FIXTURE,
      scope: "project",
      cwd,
    });

    const parsed = JSON.parse(readFileSync(settingsPath, "utf-8"));
    expect(parsed.extensions).toEqual(["keep"]);
    expect(parsed.task.agentModelOverrides["pov:executor"]).toBe("openai-codex/gpt-5.5:high");
  });
});
