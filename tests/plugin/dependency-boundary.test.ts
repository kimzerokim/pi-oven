import { describe, expect, it } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { extname, join, relative } from "node:path";

const REPO_ROOT = join(import.meta.dir, "../..");
const FIRST_PARTY_ROOTS = [".omp", "scripts", "tests"];
const SOURCE_EXTENSIONS = new Set([".js", ".jsx", ".mjs", ".mts", ".ts", ".tsx"]);

function sourceFiles(root: string): string[] {
  const files: string[] = [];

  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...sourceFiles(path));
    } else if (entry.isFile() && SOURCE_EXTENSIONS.has(extname(entry.name))) {
      files.push(path);
    }
  }

  return files;
}

function hasInternalSourceImport(source: string): boolean {
  const internalSourceImport = /(?:from\s+|import\s*\()(["'])[^"']*node_modules\/[^"']*\/src\/[^"']*\1/;
  return internalSourceImport.test(source);
}

describe("dependency boundary", () => {
  it("recognizes static and dynamic imports of package-manager internals", () => {
    const internalPath = ["..", "node_modules", "pkg", "src", "internal"].join("/");
    expect(hasInternalSourceImport(`import { x } from "${internalPath}"`)).toBe(true);
    expect(hasInternalSourceImport(`await import('${internalPath}')`)).toBe(true);
    expect(hasInternalSourceImport('import { x } from "pkg/public-api"')).toBe(false);
  });

  it("does not import package-manager internals from first-party code or tests", () => {
    const forbiddenImports: string[] = [];

    for (const root of FIRST_PARTY_ROOTS) {
      for (const file of sourceFiles(join(REPO_ROOT, root))) {
        const source = readFileSync(file, "utf8");
        if (hasInternalSourceImport(source)) {
          forbiddenImports.push(relative(REPO_ROOT, file));
        }
      }
    }

    expect(forbiddenImports).toEqual([]);
  });
});
