import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import {
  formatRemediationBaselineReport,
  inspectRemediationBaseline,
} from "../../scripts/check-remediation-baseline";

describe("runtime contract remediation baseline", () => {
  test("records the completed authored-surface migration", async () => {
    expect(await inspectRemediationBaseline()).toEqual({
      legacyHealthyAgentRefs: 0,
      staleSlashCommands: 0,
      invalidTaskExamples: 0,
      providerTierAliases: 0,
    });
  });

  test("is deterministic", async () => {
    const first = await inspectRemediationBaseline();
    const second = await inspectRemediationBaseline();

    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  test("formats deterministic machine-readable JSON", async () => {
    const report = await inspectRemediationBaseline();

    expect(formatRemediationBaselineReport(report)).toBe(`${JSON.stringify(report, null, 2)}\n`);
  });

  test("preserves the checked-in before inventory and matches the after artifact", async () => {
    const artifact = JSON.parse(
      readFileSync(
        resolve(import.meta.dir, "../../docs/runtime-contracts/remediation-baseline.json"),
        "utf8",
      ),
    ) as { before: unknown; after: unknown };

    expect(artifact.before).toEqual({
      legacyHealthyAgentRefs: 239,
      staleSlashCommands: 2,
      invalidTaskExamples: 11,
      providerTierAliases: 16,
    });
    expect(artifact.after).toEqual(await inspectRemediationBaseline());
  });

  test("inspects the injected root instead of the checkout", async () => {
    const root = mkdtempSync(join(tmpdir(), "pi-oven-remediation-baseline-"));
    const requiredFiles = [
      "agents/pov-metis.md",
      "skills/codebase-survey/SKILL.md",
      "skills/subagent-driven-development/references/prompts.md",
      "skills/spec-and-review/references/pattern-loop.md",
      "skills/large-task-delegation/references/dispatch-anatomy.md",
    ];

    try {
      for (const file of requiredFiles) {
        const path = join(root, file);
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, "# clean fixture\n");
      }

      expect(await inspectRemediationBaseline(root)).toEqual({
        legacyHealthyAgentRefs: 0,
        staleSlashCommands: 0,
        invalidTaskExamples: 0,
        providerTierAliases: 0,
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
