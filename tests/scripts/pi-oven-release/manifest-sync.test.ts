import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertReleaseRunsFromSourceRepo,
  readCurrentVersionFromSoT,
  syncReleaseManifests,
} from "../../../scripts/pi-oven-release/manifest-sync";

let cwd = "";
let tempDir = "";

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

beforeEach(() => {
  cwd = process.cwd();
  tempDir = mkdtempSync(join(tmpdir(), "pi-oven-release-manifest-"));
  mkdirSync(join(tempDir, ".claude-plugin"), { recursive: true });
  mkdirSync(join(tempDir, ".omp/extensions"), { recursive: true });

  writeJson(join(tempDir, "package.json"), { name: "pi-oven", version: "0.4.0" });
  writeJson(join(tempDir, ".claude-plugin/plugin.json"), { version: "0.4.0" });
  writeJson(join(tempDir, ".claude-plugin/marketplace.json"), { plugins: [{ version: "0.4.0" }] });
  writeFileSync(join(tempDir, ".omp/extensions/pi-oven.ts"), 'pi.setLabel("pi-oven v0.4.0");\n', "utf8");

  process.chdir(tempDir);
});

afterEach(() => {
  process.chdir(cwd);
  rmSync(tempDir, { recursive: true, force: true });
});

describe("manifest-sync", () => {
  it("validates SoT consistency", () => {
    expect(readCurrentVersionFromSoT()).toBe("0.4.0");
  });

  it("fails on SoT mismatch", () => {
    writeJson(join(tempDir, ".claude-plugin/plugin.json"), { version: "0.4.1" });
    expect(() => readCurrentVersionFromSoT()).toThrow("Version SoT mismatch");
  });

  it("refuses installed cache paths as release authoring roots", () => {
    expect(() =>
      assertReleaseRunsFromSourceRepo(join(homedir(), ".omp/plugins/cache/plugins/kzk___pi-oven___0.4.0"))
    ).toThrow("installed cache");
  });

  it("syncs manifests and label", () => {
    const result = syncReleaseManifests({ version: "0.5.0", dryRun: false, syncLabel: true });
    expect(result.filesUpdated.length).toBe(3);
    expect(result.labelUpdated).toBe(true);

    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { version: string };
    const plugin = JSON.parse(readFileSync(".claude-plugin/plugin.json", "utf8")) as { version: string };
    const market = JSON.parse(readFileSync(".claude-plugin/marketplace.json", "utf8")) as { plugins: Array<{ version: string }> };
    expect(pkg.version).toBe("0.5.0");
    expect(plugin.version).toBe("0.5.0");
    expect(market.plugins[0]?.version).toBe("0.5.0");
    expect(readFileSync(".omp/extensions/pi-oven.ts", "utf8")).toContain('pi-oven v0.5.0');
    expect(result.boundary).toEqual({
      sourceRepo: {
        root: process.cwd(),
        versionFiles: ["package.json", ".claude-plugin/plugin.json", ".claude-plugin/marketplace.json"],
      },
      releaseArtifact: {
        version: "0.5.0",
        manifestFiles: ["package.json", ".claude-plugin/plugin.json", ".claude-plugin/marketplace.json"],
        labelFile: ".omp/extensions/pi-oven.ts",
      },
      installedCache: {
        mode: "observation-only",
        patchTarget: false,
        touchedByReleaseHelper: false,
      },
    });
  });

  it("dry-run does not write files", () => {
    const result = syncReleaseManifests({ version: "0.5.0", dryRun: true, syncLabel: true });
    expect(result.filesUpdated.length).toBe(3);
    expect(result.labelUpdated).toBe(true);

    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { version: string };
    expect(pkg.version).toBe("0.4.0");
    expect(readFileSync(".omp/extensions/pi-oven.ts", "utf8")).toContain('pi-oven v0.4.0');
  });
});
