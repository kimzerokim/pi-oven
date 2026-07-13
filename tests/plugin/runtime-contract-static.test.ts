import { afterEach, describe, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { inspectAuthoredSurfaces } from "../../scripts/pi-oven-contract/check";
import {
  generatedArtifacts,
  renderGeneratedArtifacts,
} from "../../scripts/pi-oven-contract/generate";

const roots: string[] = [];

function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "pi-oven-contract-static-"));
  roots.push(root);
  for (const [file, content] of Object.entries(files)) {
    const path = join(root, file);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  }
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("authored surface compiler", () => {
  test("returns deterministic structured issues for unhealthy authored prose", async () => {
    const root = fixture({
      ".claude-plugin/plugin.json": JSON.stringify({
        commands: ["./commands/setup.md"],
      }),
      "commands/setup.md": "Run /pi-oven:setup.\n",
      "skills/example/SKILL.md": [
        "---",
        "name: pov:example",
        "---",
        "Dispatch pi-oven:executor with the sonnet tier.",
        "Then run /pi-oven:autonomous.",
        "",
      ].join("\n"),
    });

    const first = await inspectAuthoredSurfaces({ root, checkGenerated: false });
    const second = await inspectAuthoredSurfaces({ root, checkGenerated: false });

    expect(second).toEqual(first);
    expect(first.issues).toEqual([
      {
        code: "legacy-agent-reference",
        file: "skills/example/SKILL.md",
        line: 4,
        column: 10,
        message: "Legacy agent reference pi-oven:executor is not executable.",
        suggestion: "Use pov:executor.",
      },
      {
        code: "provider-tier-alias",
        file: "skills/example/SKILL.md",
        line: 4,
        column: 36,
        message: "Provider-tier routing alias sonnet is not part of the runtime contract.",
        suggestion: "Describe the pov role; task.agentModelOverrides owns model routing.",
      },
      {
        code: "unregistered-slash-command",
        file: "skills/example/SKILL.md",
        line: 5,
        column: 10,
        message: "Slash command /pi-oven:autonomous is not registered by the plugin manifest.",
        suggestion: "Use one of: /pi-oven:setup.",
      },
    ]);
  });

  test("strictly validates tagged task calls and rejects executable unclassified fences", async () => {
    const root = fixture({
      ".claude-plugin/plugin.json": JSON.stringify({ commands: [] }),
      "skills/example/SKILL.md": [
        "---",
        "name: pov:example",
        "---",
        "<!-- pi-oven-contract:task-example -->",
        "```ts",
        "task({",
        '  agent: "pov:executor",',
        "  tasks: [{ id: \"implement\", description: \"Implement\", assignment: \"Implement it.\" }],",
        "});",
        "```",
        "",
        "```ts",
        'task({ prompt: "old shape" });',
        "```",
        "",
        "<!-- pi-oven-contract:task-example -->",
        "```ts",
        'task({ agent: "pov:executor", tasks: [{ id: "x", description: "X", assignment: "Do X", model: "gpt" }] });',
        "```",
      ].join("\n"),
    });

    const report = await inspectAuthoredSurfaces({ root, checkGenerated: false });

    expect(report.issues.map(({ code, line }) => ({ code, line }))).toEqual([
      { code: "unclassified-task-example", line: 13 },
      { code: "invalid-task-example", line: 18 },
    ]);
    expect(report.issues[1]?.message).toContain("tasks.0.model");
  });

  test("requires every shipped agent filename and frontmatter name to use the exact roster", async () => {
    const root = fixture({
      ".claude-plugin/plugin.json": JSON.stringify({ commands: [] }),
      "agents/pov-executor.md": "---\nname: pov:planner\n---\n",
      "agents/pov-phantom.md": "---\nname: pov:phantom\n---\n",
      "agents/phantom.md": "---\nname: pov:phantom\n---\n",
      "agents/notes.md": "not an agent\n",
    });

    const report = await inspectAuthoredSurfaces({ root, checkGenerated: false });

    expect(report.issues.map(({ code, file }) => ({ code, file }))).toEqual([
      { code: "unknown-agent-file", file: "agents/notes.md" },
      { code: "unknown-agent-file", file: "agents/phantom.md" },
      { code: "agent-frontmatter-name-mismatch", file: "agents/pov-executor.md" },
      { code: "unknown-agent-file", file: "agents/pov-phantom.md" },
    ]);
  });

  test("keeps generated runtime documentation and JSON Schema byte-for-byte current", async () => {
    const root = join(import.meta.dir, "../..");
    const expected = renderGeneratedArtifacts();

    for (const file of generatedArtifacts) {
      expect(await Bun.file(join(root, file)).text()).toBe(expected[file]);
    }

    const report = await inspectAuthoredSurfaces({ root, checkGenerated: true });
    expect(report.issues.filter((issue) => issue.code === "generated-content-drift")).toEqual([]);
  });

  test("classifies archive evidence separately and requires a historical syntax banner", async () => {
    const root = fixture({
      ".claude-plugin/plugin.json": JSON.stringify({ commands: [] }),
      "docs/specs/unbannered.md": "# Old spec\n\nDispatch pi-oven:executor.\n",
      "docs/plans/bannered.md": [
        "> Historical; do not copy runtime syntax from this document.",
        "",
        "The old plan dispatched pi-oven:planner.",
        "",
      ].join("\n"),
    });

    const report = await inspectAuthoredSurfaces({ root, checkGenerated: false });

    expect(report.issues.map(({ code, file }) => ({ code, file }))).toEqual([
      { code: "archive-missing-historical-banner", file: "docs/specs/unbannered.md" },
    ]);
  });
});
