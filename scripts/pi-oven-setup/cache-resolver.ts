/**
 * Cache resolver for the omp pi-oven plugin install cache.
 * Locates the latest installed version via semver sort and checks agent population.
 * Spec B §10.6 version discovery algorithm.
 */

import { promises as fs } from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { EXPECTED_AGENT_COUNT } from "./profiles";

const DEFAULT_CACHE_ROOT = path.resolve(
  os.homedir(),
  ".omp/plugins/cache/plugins"
);

/**
 * Compare two semver strings (e.g. "0.1.0", "0.10.0").
 * Returns negative if a < b, positive if a > b, 0 if equal.
 * Missing segments are treated as 0 (e.g. "0.1" == "0.1.0").
 */
export function compareSemver(a: string, b: string): number {
  const pa = a.split(".").map((n) => parseInt(n, 10));
  const pb = b.split(".").map((n) => parseInt(n, 10));
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const va = pa[i] ?? 0;
    const vb = pb[i] ?? 0;
    if (va !== vb) return va - vb;
  }
  return 0;
}

/**
 * Resolves the agents/ directory of the latest installed pi-oven plugin version.
 * Returns null if no kzk___pi-oven___* directory exists under cacheRoot.
 *
 * This tool ONLY resolves from the global plugin cache. Project-local installs
 * are unsupported.
 */
export async function resolveCacheAgentsDir(
  cacheRoot?: string
): Promise<string | null> {
  const root = cacheRoot ?? DEFAULT_CACHE_ROOT;
  const dirs = await fs.readdir(root).catch(() => [] as string[]);
  const piOvenDirs = dirs.filter((d) => d.startsWith("kzk___pi-oven___"));
  if (piOvenDirs.length === 0) return null;
  // Pick latest installed version by semver sort (descending)
  piOvenDirs.sort((a, b) => {
    const va = a.split("___")[2] ?? "0.0.0";
    const vb = b.split("___")[2] ?? "0.0.0";
    return compareSemver(vb, va);
  });
  return path.join(root, piOvenDirs[0], "agents");
}

/**
 * Resolve the agents/ directory to READ for display purposes (e.g. --status),
 * independent of the caller's cwd. The setup script ships at
 * `<pluginRoot>/scripts/pi-oven-setup.ts`, so its sibling `agents/` is always
 * `<pluginRoot>/agents` regardless of where the user invokes it from. This is
 * the fix for "setup looks at the local cwd, not the omp install location":
 * pass the script's own `import.meta.dir` and we self-locate the install tree.
 *
 * Resolution order:
 *   1. `<scriptDir>/../agents` if it holds pi-oven-*.md files (covers BOTH dev
 *      checkout and marketplace install cache — the script always sits one level
 *      under the plugin root).
 *   2. the latest install-cache agents dir (covers a stray/relocated script).
 *   3. the script-relative path as a last resort (status then degrades to
 *      "(no agent file)" rather than throwing).
 *
 * NOTE: this is for READ-ONLY display resolution. It must NOT be wired into the
 * apply path's maintainer-vs-user mode selector, which keys on whether an
 * agentsDir was explicitly provided.
 */
export async function resolveDefaultAgentsDir(
  _scriptDir: string,
  cacheRoot?: string
): Promise<string> {
  // Global-only: resolve from cache first. Project-local lookup is unsupported.
  const cache = await resolveCacheAgentsDir(cacheRoot);
  if (cache) return cache;
  // Fallback to relative path ONLY for local development / testing scenarios
  // where the plugin is run directly from its source tree.
  return path.resolve(_scriptDir, "..", "agents");
}

/**
 * Checks whether the pi-oven plugin agents cache is populated with the expected
 * number of agent files.
 *
 * @param opts.cacheRoot  Override the default cache root (for tests).
 * @param opts.expected   Override the expected agent count (default: EXPECTED_AGENT_COUNT).
 */
export async function checkAgentsCachePopulated(opts?: {
  cacheRoot?: string;
  expected?: number;
}): Promise<{
  ok: boolean;
  cachePath: string;
  foundCount: number;
  expectedCount: number;
}> {
  const expectedCount = opts?.expected ?? EXPECTED_AGENT_COUNT;
  const agentsDir = await resolveCacheAgentsDir(opts?.cacheRoot);

  if (agentsDir === null) {
    return {
      ok: false,
      cachePath: "(no pi-oven install cache)",
      foundCount: 0,
      expectedCount,
    };
  }

  const files = await fs.readdir(agentsDir).catch(() => [] as string[]);
  const piOvenAgents = files.filter(
    (f) => f.startsWith("pi-oven-") && f.endsWith(".md")
  );
  const foundCount = piOvenAgents.length;

  return {
    ok: foundCount >= expectedCount,
    cachePath: agentsDir,
    foundCount,
    expectedCount,
  };
}
