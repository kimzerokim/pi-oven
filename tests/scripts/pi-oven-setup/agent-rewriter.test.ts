import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  readAgentFiles,
  rewriteAgentFile,
  rewriteAllAgents,
} from "../../../scripts/pi-oven-setup/agent-rewriter";
import { ROLES, PROFILE_A, PROFILE_B, type Role } from "../../../scripts/pi-oven-setup/profiles";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  const dir = join(
    tmpdir(),
    `agent-rewriter-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Minimal but realistic agent file matching the production pi-oven-executor.md format.
 * Verbatim frontmatter structure — YAML block list for model, thinkingLevel key.
 */
function makeAgentFileContent(
  role: string,
  primary: string,
  registryAlternate: string,
  thinkingLevel: string
): string {
  return `---
name: pi-oven:${role}
description: Test agent for ${role}
model:
  - ${primary}
  - ${registryAlternate}
thinkingLevel: ${thinkingLevel}
mode: subagent
tools: ["*"]
blocked_tools: []
---

## Role

You are pi-oven:${role}. This is the system prompt body.

It must be preserved verbatim after rewrite.
Multi-line content here.
`;
}

/**
 * Creates pi-oven-<role>.md files for a given set of roles inside agentsDir.
 */
function populateAgentsDir(
  agentsDir: string,
  roles: readonly Role[],
  primaryFn: (role: Role) => string,
  alternateFn: (role: Role) => string,
  thinkingFn: (role: Role) => string
): void {
  for (const role of roles) {
    const content = makeAgentFileContent(
      role,
      primaryFn(role),
      alternateFn(role),
      thinkingFn(role)
    );
    writeFileSync(join(agentsDir, `pi-oven-${role}.md`), content, "utf-8");
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("readAgentFiles", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = makeTempDir();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("reads N fake pi-oven-*.md files and returns N entries with parsed model arrays", async () => {
    const testRoles: Role[] = ["executor", "critic", "planner"];
    populateAgentsDir(
      tempDir,
      testRoles,
      (r) => PROFILE_A[r].primary,
      (r) => PROFILE_A[r].registry_alternate,
      (r) => PROFILE_A[r].thinkingLevel
    );

    const entries = await readAgentFiles(tempDir);
    expect(entries.length).toBe(3);

    const executorEntry = entries.find((e) => e.role === "executor");
    expect(executorEntry).toBeDefined();
    expect(executorEntry!.currentModel).toEqual([
      PROFILE_A.executor.primary,
      PROFILE_A.executor.registry_alternate,
    ]);
    expect(executorEntry!.currentThinkingLevel).toBe(PROFILE_A.executor.thinkingLevel);
  });

  it("returns empty array for empty directory", async () => {
    const entries = await readAgentFiles(tempDir);
    expect(entries.length).toBe(0);
  });

  it("ignores non-pi-oven-*.md files", async () => {
    writeFileSync(join(tempDir, "README.md"), "not an agent");
    writeFileSync(join(tempDir, "other.txt"), "also not an agent");
    populateAgentsDir(
      tempDir,
      ["executor"],
      () => PROFILE_A.executor.primary,
      () => PROFILE_A.executor.registry_alternate,
      () => PROFILE_A.executor.thinkingLevel
    );
    const entries = await readAgentFiles(tempDir);
    expect(entries.length).toBe(1);
  });
});

describe("rewriteAgentFile", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = makeTempDir();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("updates model array in place; reread shows new values", async () => {
    const filePath = join(tempDir, "pi-oven-executor.md");
    writeFileSync(
      filePath,
      makeAgentFileContent(
        "executor",
        PROFILE_A.executor.primary,
        PROFILE_A.executor.registry_alternate,
        PROFILE_A.executor.thinkingLevel
      ),
      "utf-8"
    );

    await rewriteAgentFile(filePath, PROFILE_B.executor);

    const entries = await readAgentFiles(tempDir);
    const entry = entries.find((e) => e.role === "executor")!;
    expect(entry.currentModel[0]).toBe(PROFILE_B.executor.primary);
    expect(entry.currentModel[1]).toBe(PROFILE_B.executor.registry_alternate);
    expect(entry.currentThinkingLevel).toBe(PROFILE_B.executor.thinkingLevel);
  });

  it("preserves systemPrompt body verbatim after rewrite", async () => {
    const filePath = join(tempDir, "pi-oven-executor.md");
    const original = makeAgentFileContent(
      "executor",
      PROFILE_A.executor.primary,
      PROFILE_A.executor.registry_alternate,
      PROFILE_A.executor.thinkingLevel
    );
    writeFileSync(filePath, original, "utf-8");

    await rewriteAgentFile(filePath, PROFILE_B.executor);

    const rewritten = readFileSync(filePath, "utf-8");
    // Body after the closing --- must be unchanged
    const originalBody = original.split("---").slice(2).join("---");
    const rewrittenBody = rewritten.split("---").slice(2).join("---");
    expect(rewrittenBody).toBe(originalBody);
  });

  it("is idempotent: rewrite same profile twice produces no diff", async () => {
    const filePath = join(tempDir, "pi-oven-executor.md");
    writeFileSync(
      filePath,
      makeAgentFileContent(
        "executor",
        PROFILE_A.executor.primary,
        PROFILE_A.executor.registry_alternate,
        PROFILE_A.executor.thinkingLevel
      ),
      "utf-8"
    );

    await rewriteAgentFile(filePath, PROFILE_B.executor);
    const after1 = readFileSync(filePath, "utf-8");

    await rewriteAgentFile(filePath, PROFILE_B.executor);
    const after2 = readFileSync(filePath, "utf-8");

    expect(after2).toBe(after1);
  });
});

describe("rewriteAllAgents", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = makeTempDir();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("rewrites all 22 agent files to PROFILE_B; subsequent read shows anthropic primary on executor", async () => {
    // Start with Profile A files
    populateAgentsDir(
      tempDir,
      ROLES,
      (r) => PROFILE_A[r].primary,
      (r) => PROFILE_A[r].registry_alternate,
      (r) => PROFILE_A[r].thinkingLevel
    );

    const { rewritten, skipped } = await rewriteAllAgents(tempDir, PROFILE_B);
    expect(rewritten.length).toBe(22);
    expect(skipped.length).toBe(0);

    // Verify executor now has anthropic primary
    const entries = await readAgentFiles(tempDir);
    const executor = entries.find((e) => e.role === "executor")!;
    expect(executor.currentModel[0]).toBe("anthropic/claude-sonnet-4-6");
  });

  it("skips roles whose files do not exist", async () => {
    // Only create 3 of the 22 files
    const subset: Role[] = ["executor", "critic", "planner"];
    populateAgentsDir(
      tempDir,
      subset,
      (r) => PROFILE_A[r].primary,
      (r) => PROFILE_A[r].registry_alternate,
      (r) => PROFILE_A[r].thinkingLevel
    );

    const { rewritten, skipped } = await rewriteAllAgents(tempDir, PROFILE_B);
    expect(rewritten.length).toBe(3);
    expect(skipped.length).toBe(19);
  });
});

