import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  readAgentFiles,
  rewriteAgentFile,
  rewriteAllAgents,
} from "../../../scripts/pi-oven-setup/agent-rewriter";
import { DEFAULT_PROFILE } from "../../../scripts/pi-oven-setup/profiles";

let tempDir: string | null = null;

function makeTempDir(): string {
  tempDir = mkdtempSync(join(tmpdir(), "pi-oven-agent-rewriter-"));
  return tempDir;
}

function makeAgentFile(dir: string, role: string, model = "old/model", thinking = "medium"): string {
  const file = join(dir, `pov-${role}.md`);
  writeFileSync(
    file,
    [
      "---",
      `name: pov:${role}`,
      "description: test",
      "model:",
      `  - ${model}`,
      `thinkingLevel: ${thinking}`,
      "mode: subagent",
      "tools: [\"read\"]",
      "blocked_tools: []",
      "---",
      "",
      "Body.",
      "",
    ].join("\n")
  );
  return file;
}

afterEach(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = null;
});

describe("agent-rewriter", () => {
  it("reads single-primary model frontmatter", async () => {
    const dir = makeTempDir();
    makeAgentFile(dir, "executor", DEFAULT_PROFILE.executor.primary, DEFAULT_PROFILE.executor.thinkingLevel);

    const entries = await readAgentFiles(dir);

    expect(entries).toHaveLength(1);
    expect(entries[0].currentModel).toEqual([DEFAULT_PROFILE.executor.primary]);
    expect(entries[0].currentThinkingLevel).toBe(DEFAULT_PROFILE.executor.thinkingLevel);
  });

  it("rewrites model, thinking level, tools, and blocked tools from DEFAULT_PROFILE", async () => {
    const dir = makeTempDir();
    const file = makeAgentFile(dir, "planner");

    await rewriteAgentFile(file, DEFAULT_PROFILE.planner);

    const content = readFileSync(file, "utf-8");
    expect(content).toContain(`  - ${DEFAULT_PROFILE.planner.primary}`);
    expect(content).not.toContain("old/model");
    expect(content).toContain(`thinkingLevel: ${DEFAULT_PROFILE.planner.thinkingLevel}`);
    expect(content).toContain(`tools: ${JSON.stringify(DEFAULT_PROFILE.planner.tools)}`);
    expect(content).toContain(`blocked_tools: ${JSON.stringify(DEFAULT_PROFILE.planner.blocked_tools)}`);
  });

  it("rewrites all available canonical agent files and reports skipped roles", async () => {
    const dir = makeTempDir();
    makeAgentFile(dir, "executor");
    makeAgentFile(dir, "critic");

    const result = await rewriteAllAgents(dir, DEFAULT_PROFILE);

    expect(result.rewritten.sort()).toEqual(["critic", "executor"]);
    expect(result.skipped).toContain("planner");
  });
});
