import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildReleaseArtifacts,
  selectReleaseFiles,
  validateReleaseTagContract,
} from "../../../scripts/pi-oven-release/release-contract";
import { verifyInstalledManifest } from "../../../scripts/pi-oven-release/fresh-install-smoke";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), "pi-oven-release-contract-"));
  roots.push(root);
  mkdirSync(join(root, ".claude-plugin"), { recursive: true });
  mkdirSync(join(root, "skills", "tdd-strict"), { recursive: true });
  mkdirSync(join(root, "evals", "tdd-strict", "scenarios"), { recursive: true });
  mkdirSync(join(root, "tests"), { recursive: true });
  writeFileSync(join(root, "package.json"), '{"name":"pi-oven","version":"1.2.3"}\n');
  writeFileSync(join(root, ".claude-plugin", "plugin.json"), '{"version":"1.2.3"}\n');
  writeFileSync(join(root, "skills", "tdd-strict", "SKILL.md"), "# TDD\n");
  writeFileSync(join(root, "evals", "tdd-strict", "scenarios", "smoke.yaml"), "name: smoke\n");
  writeFileSync(join(root, "tests", "not-shipped.test.ts"), "throw new Error();\n");
  return root;
}

describe("release artifact contract", () => {
  it("accepts only tag/version/immutable-ref parity", () => {
    expect(() => validateReleaseTagContract("v1.2.3", "1.2.3", "v1.2.3")).not.toThrow();
    expect(() => validateReleaseTagContract("v1.2.4", "1.2.3", "v1.2.3")).toThrow("tag/version");
    expect(() => validateReleaseTagContract("v1.2.3", "1.2.3", "main")).toThrow("marketplace ref");
  });

  it("uses an explicit allowlist and excludes tests, git state, plans, and secrets", () => {
    expect(
      selectReleaseFiles([
        "package.json",
        ".claude-plugin/plugin.json",
        "skills/tdd-strict/SKILL.md",
        "evals/tdd-strict/scenarios/smoke.yaml",
        "tests/not-shipped.test.ts",
        "docs/plans/private.md",
        ".git/config",
        ".env",
      ]),
    ).toEqual([
      ".claude-plugin/plugin.json",
      "evals/tdd-strict/scenarios/smoke.yaml",
      "package.json",
      "skills/tdd-strict/SKILL.md",
    ]);
  });

  it("builds byte-identical tarballs and sorted shipped-file/SBOM metadata", () => {
    const root = fixture();
    const first = buildReleaseArtifacts({ root, outDir: join(root, "out-a"), version: "1.2.3" });
    const second = buildReleaseArtifacts({ root, outDir: join(root, "out-b"), version: "1.2.3" });

    expect(readFileSync(first.archivePath)).toEqual(readFileSync(second.archivePath));
    expect(first.archiveSha256).toBe(second.archiveSha256);
    expect(first.manifest.files.map((file) => file.path)).toEqual([
      ".claude-plugin/plugin.json",
      "evals/tdd-strict/scenarios/smoke.yaml",
      "package.json",
      "skills/tdd-strict/SKILL.md",
    ]);
    expect(first.spdx.spdxVersion).toBe("SPDX-2.3");
    expect(first.spdx.files.map((file) => file.fileName)).toEqual(first.manifest.files.map((file) => file.path));
    expect(readFileSync(first.checksumPath, "utf8")).toBe(
      `${first.archiveSha256}  pi-oven-v1.2.3.tar.gz\n`,
    );
  });

  it("detects any installed file that differs from the shipped manifest", () => {
    const root = fixture();
    const result = buildReleaseArtifacts({ root, outDir: join(root, "out"), version: "1.2.3" });
    expect(() => verifyInstalledManifest(root, result.manifest)).not.toThrow();
    writeFileSync(join(root, "package.json"), '{"version":"tampered"}\n');
    expect(() => verifyInstalledManifest(root, result.manifest)).toThrow("checksum mismatch");
  });
});
