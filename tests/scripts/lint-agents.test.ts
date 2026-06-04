import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { spawnSync } from "bun";
import { join } from "path";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";

const LINT = join(import.meta.dir, "../../scripts/lint-agents.ts");

function runLint(dir: string): { code: number; stderr: string } {
  const r = spawnSync({ cmd: [process.execPath, LINT, dir] });
  return { code: r.exitCode, stderr: r.stderr.toString() };
}

// A non-ROLES role name keeps the SoT model/thinkingLevel/name checks from
// firing (the loop `continue`s for unknown roles), isolating the
// instructed-but-not-granted check under test. A model field is still required.
function agent(tools: string, body: string, blocked?: string): string {
  const bt = blocked ? `\nblocked_tools: ${blocked}` : "";
  return `---\nname: pi-oven:zzfixture\nmodel: ["x/y"]\nthinkingLevel: low\nmode: subagent\ntools: ${tools}${bt}\n---\n\n## Role\n\n${body}\n`;
}

describe("lint-agents instructed-but-not-granted", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "lint-agents-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("flags a tool instructed in the body but not granted", () => {
    writeFileSync(join(dir, "pi-oven-zzfixture.md"), agent(`["read"]`, "Use `web_search` to look things up."));
    const { code, stderr } = runLint(dir);
    expect(code).toBe(1);
    expect(stderr).toContain("web_search");
  });

  it("passes when the instructed tool is granted", () => {
    writeFileSync(join(dir, "pi-oven-zzfixture.md"), agent(`["read", "web_search"]`, "Use `web_search` to look things up."));
    expect(runLint(dir).code).toBe(0);
  });

  it("passes when tools is [\"*\"] (grants everything)", () => {
    writeFileSync(join(dir, "pi-oven-zzfixture.md"), agent(`["*"]`, "Use `web_search` and `debug` and `eval`."));
    expect(runLint(dir).code).toBe(0);
  });

  it("does not flag a tool named in a negation (prohibition) context", () => {
    writeFileSync(join(dir, "pi-oven-zzfixture.md"), agent(`["read"]`, "Injection guidance: never use `eval` in production code."));
    expect(runLint(dir).code).toBe(0);
  });

  it("does not flag a blocked tool mentioned as a prohibition", () => {
    writeFileSync(join(dir, "pi-oven-zzfixture.md"), agent(`["read"]`, "`task` tool is blocked — no recursive dispatch.", `["task"]`));
    expect(runLint(dir).code).toBe(0);
  });

  it("ignores backtick spans that are not tool names", () => {
    writeFileSync(join(dir, "pi-oven-zzfixture.md"), agent(`["read"]`, "Run `git commit` and read `package.json`."));
    expect(runLint(dir).code).toBe(0);
  });
});
