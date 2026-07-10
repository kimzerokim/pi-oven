import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { runImport, validateImport } from "../../../scripts/pi-oven-setup/import";

let tempDir: string | null = null;

function makeTempDir(): string {
  tempDir = mkdtempSync(join(tmpdir(), "pi-oven-import-"));
  return tempDir;
}

function writeJson(obj: unknown): string {
  const dir = tempDir ?? makeTempDir();
  const file = join(dir, "config.json");
  writeFileSync(file, JSON.stringify(obj, null, 2), "utf-8");
  return file;
}

function modelsFixture(ids: string[]): string {
  return [
    "Canonical models",
    "  canonical  selected                 provider",
    ...ids.map((id, idx) => `  ${idx + 1}          ${id}     openai-codex`),
    "",
  ].join("\n");
}

afterEach(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = null;
});

describe("validateImport", () => {
  it("accepts primary and optional thinkingLevel for openai-codex selectors", () => {
    const result = validateImport({
      "pi-oven": {
        models: {
          executor: {
            primary: "openai-codex/gpt-5.5:high",
            thinkingLevel: "high",
          },
        },
      },
    });

    expect(result.ok).toBe(true);
  });

  it("rejects profile, non-codex primary, and alternate registry keys", () => {
    const alternateKey = "registry" + "_alternate";
    const result = validateImport({
      "pi-oven": {
        profile: "C",
        models: {
          executor: {
            primary: "anthropic/claude-opus-4-8",
            [alternateKey]: "anthropic/claude-opus-4-8",
          },
        },
      },
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain(
      "profile is not importable; use /pi-oven:setup --profile for baseline routing"
    );
    expect(result.errors.some((error) => error.includes("must be an openai-codex"))).toBe(true);
    expect(result.errors).toContain("pi-oven.models.executor: alternate registry keys are unsupported");
  });
});

describe("runImport", () => {
  it("writes canonical pov overrides and skills.includeSkills", async () => {
    makeTempDir();
    const file = writeJson({
      "pi-oven": {
        models: {
          executor: { primary: "openai-codex/gpt-5.5:high" },
        },
      },
    });
    const calls: string[][] = [];
    const spawnFn = (_cmd: string, args: string[]) => {
      calls.push(args);
      if (args[0] === "config" && args[1] === "get") {
        const value = args[2] === "skills.includeSkills" ? [] : {};
        return {
          exitCode: 0,
          stdout: Buffer.from(JSON.stringify({ type: Array.isArray(value) ? "array" : "record", value })),
          stderr: Buffer.from(""),
        };
      }
      return { exitCode: 0, stdout: Buffer.from(""), stderr: Buffer.from("") };
    };

    const result = await runImport(file, {
      spawnFn,
      listModelsOutput: modelsFixture(["openai-codex/gpt-5.5"]),
    });

    expect(result.exitCode).toBe(0);
    const overrideWrite = calls.find(
      (args) => args[0] === "config" && args[1] === "set" && args[2] === "task.agentModelOverrides"
    );
    expect(overrideWrite).toBeDefined();
    expect(JSON.parse(overrideWrite![3])).toEqual({
      "pov:executor": "openai-codex/gpt-5.5:high",
    });
    const includeWrite = calls.find((args) => args[2] === "skills.includeSkills");
    expect(JSON.parse(includeWrite![3])).toEqual(["pov:*"]);
  });

  it("rejects unresolvable base model ids without writing", async () => {
    makeTempDir();
    const file = writeJson({
      "pi-oven": {
        models: {
          executor: { primary: "openai-codex/missing:high" },
        },
      },
    });
    const calls: string[][] = [];
    const result = await runImport(file, {
      spawnFn: (_cmd, args) => {
        calls.push(args);
        return { exitCode: 0, stdout: Buffer.from(""), stderr: Buffer.from("") };
      },
      listModelsOutput: modelsFixture(["openai-codex/gpt-5.5"]),
    });

    expect(result.exitCode).toBe(1);
    expect(calls.some((args) => args[0] === "config" && args[1] === "set")).toBe(false);
  });
});
