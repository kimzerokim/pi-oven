import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  REHEARSAL_CASE_IDS,
  runReleaseRehearsal,
  writeReleaseRehearsalReceipt,
} from "../../scripts/rehearse-release";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("runtime contract release rehearsal", () => {
  test("runs the complete ten-case matrix without turning absent credentials into a pass", async () => {
    const scratchRoot = mkdtempSync(join(tmpdir(), "pi-oven-release-rehearsal-test-"));
    roots.push(scratchRoot);

    const receipt = await runReleaseRehearsal({
      root: resolve(import.meta.dir, "../.."),
      scratchRoot,
      candidateInstaller: ({ packageRoot }) => {
        symlinkSync(resolve(import.meta.dir, "../../node_modules"), join(packageRoot, "node_modules"), "dir");
        return {
          exitCode: 0,
          stdout: "",
          stderr: "",
          evidence: "integration-test preinstalled dependency fixture",
        };
      },
    });

    expect(receipt.status).toBe("PASS");
    expect(receipt.cases.map((entry) => entry.id)).toEqual([...REHEARSAL_CASE_IDS]);
    expect(receipt.cases).toHaveLength(10);
    expect(receipt.cases.every((entry) => entry.status === "PASS")).toBe(true);
    expect(receipt.cases.find((entry) => entry.id === "provider-canary")?.evidence).toMatchObject({
      available: "PASS",
      unavailable: "NOT RUN",
    });
    expect(receipt.rollbackProof.every((entry) => entry.status === "PASS")).toBe(true);
    expect(receipt.contractCounts).toEqual({
      staleLegacyAgentReferences: 0,
      staleSlashCommands: 0,
      invalidTaskExamples: 0,
      providerTierAliases: 0,
    });
    expect(receipt.checksums.archive).toMatch(/^[a-f0-9]{64}$/);
    expect(receipt.checksums.bundle).toMatch(/^[a-f0-9]{64}$/);
    const output = join(scratchRoot, "artifacts", "rehearsal.json");
    await writeReleaseRehearsalReceipt(output, receipt);
    expect(existsSync(output)).toBe(true);
    expect(JSON.parse(readFileSync(output, "utf8"))).toEqual(receipt);
  }, 30_000);
});
