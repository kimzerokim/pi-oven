import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "../..");

describe("release surface", () => {
  it("pins every direct dependency exactly and has one marketplace catalog", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    expect(pkg.dependencies).toEqual({
      "@oh-my-pi/pi-coding-agent": "15.5.3",
      zod: "4.4.3",
    });
    expect(pkg.devDependencies).toEqual({
      "bun-types": "1.3.14",
      "fast-check": "4.9.0",
      typescript: "5.9.3",
    });
    expect(existsSync(join(ROOT, "marketplace.json"))).toBe(false);
    expect(existsSync(join(ROOT, ".claude-plugin/marketplace.json"))).toBe(true);
  });

  it("uses only full-SHA action refs and publishes only from version tags", () => {
    for (const relative of [".github/workflows/ci.yml", ".github/workflows/release.yml"]) {
      const source = readFileSync(join(ROOT, relative), "utf8");
      for (const match of source.matchAll(/^\s*-?\s*uses:\s*[^@\s]+@([^\s]+)/gm)) {
        expect(match[1]).toMatch(/^[a-f0-9]{40}$/);
      }
    }
    const release = readFileSync(join(ROOT, ".github/workflows/release.yml"), "utf8");
    expect(release).toContain('      - "v*"');
    expect(release).not.toContain("workflow_dispatch");
    expect(release).toContain("persist-credentials: false");
    expect(release).toContain("attest-build-provenance@");
    expect(release).toContain("attest-sbom@");
    expect(release).toContain("fresh-install-smoke.ts");
  });
});
