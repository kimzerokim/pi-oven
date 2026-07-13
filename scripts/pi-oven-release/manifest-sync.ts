import { readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { resolveHomePaths } from "../lib/home-paths";

export interface ManifestSyncOptions {
  version: string;
  dryRun: boolean;
  syncLabel: boolean;
}

export interface ReleaseInstallBoundary {
  sourceRepo: {
    root: string;
    versionFiles: string[];
  };
  releaseArtifact: {
    version: string;
    manifestFiles: string[];
    labelFile: string | null;
  };
  installedCache: {
    mode: "observation-only";
    patchTarget: false;
    touchedByReleaseHelper: false;
  };
}

export interface ManifestSyncResult {
  filesChecked: string[];
  filesUpdated: string[];
  labelUpdated: boolean;
  boundary: ReleaseInstallBoundary;
}

const VERSION_FILES = [
  "package.json",
  ".claude-plugin/plugin.json",
  ".claude-plugin/marketplace.json",
] as const;
const LABEL_FILE = ".omp/extensions/pi-oven.ts";

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

function assertObject(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object") {
    throw new Error(`Invalid JSON object at ${path}`);
  }
  return value as Record<string, unknown>;
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function readMarketplacePlugin(raw: unknown): Record<string, unknown> {
  const root = assertObject(raw, ".claude-plugin/marketplace.json");
  const plugins = root.plugins;
  if (!Array.isArray(plugins) || plugins.length === 0) {
    throw new Error("marketplace.json.plugins must be a non-empty array");
  }
  const first = plugins[0];
  if (!first || typeof first !== "object") {
    throw new Error("marketplace.json.plugins[0] must be an object");
  }
  const plugin = first as Record<string, unknown>;
  return plugin;
}

function updateMarketplaceRelease(raw: unknown, version: string): { changed: boolean; next: unknown } {
  const root = assertObject(raw, ".claude-plugin/marketplace.json");
  const plugin = readMarketplacePlugin(root);
  const prev = plugin.version;
  if (typeof prev !== "string") {
    throw new Error("marketplace.json.plugins[0].version must be a string");
  }
  const source = assertObject(plugin.source, ".claude-plugin/marketplace.json.plugins[0].source");
  const ref = source.ref;
  if (typeof ref !== "string") {
    throw new Error("marketplace.json.plugins[0].source.ref must be a string");
  }
  const expectedRef = `v${version}`;
  if (prev === version && ref === expectedRef) {
    return { changed: false, next: raw };
  }
  plugin.version = version;
  source.ref = expectedRef;
  return { changed: true, next: root };
}

function isInstalledCachePath(root: string): boolean {
  const resolvedRoot = resolve(root);
  const rel = relative(resolveHomePaths().ompPluginCacheDir, resolvedRoot);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

export function assertReleaseRunsFromSourceRepo(root: string = process.cwd()): string {
  const resolvedRoot = resolve(root);
  if (isInstalledCachePath(resolvedRoot)) {
    throw new Error(
      `Refusing release manifest sync from installed cache snapshot: ${resolvedRoot}. Run the helper from the source repo instead.`
    );
  }
  return resolvedRoot;
}

export function buildReleaseInstallBoundary(options: {
  version: string;
  syncLabel: boolean;
  root?: string;
}): ReleaseInstallBoundary {
  const root = assertReleaseRunsFromSourceRepo(options.root);
  const versionFiles = [...VERSION_FILES];
  return {
    sourceRepo: {
      root,
      versionFiles,
    },
    releaseArtifact: {
      version: options.version,
      manifestFiles: versionFiles,
      labelFile: options.syncLabel ? LABEL_FILE : null,
    },
    installedCache: {
      mode: "observation-only",
      patchTarget: false,
      touchedByReleaseHelper: false,
    },
  };
}

export function readCurrentVersionFromSoT(): string {
  assertReleaseRunsFromSourceRepo();
  const pkg = assertObject(readJson("package.json"), "package.json");
  const plugin = assertObject(readJson(".claude-plugin/plugin.json"), ".claude-plugin/plugin.json");

  const packageVersion = pkg.version;
  const pluginVersion = plugin.version;

  if (typeof packageVersion !== "string") {
    throw new Error("package.json version must be a string");
  }
  if (typeof pluginVersion !== "string") {
    throw new Error(".claude-plugin/plugin.json version must be a string");
  }

  const marketplacePlugin = readMarketplacePlugin(readJson(".claude-plugin/marketplace.json"));
  const marketVersion = marketplacePlugin.version;

  if (typeof marketVersion !== "string") {
    throw new Error(".claude-plugin/marketplace.json plugins[0].version must be a string");
  }

  if (packageVersion !== pluginVersion || packageVersion !== marketVersion) {
    throw new Error(
      `Version SoT mismatch: package.json=${packageVersion}, plugin.json=${pluginVersion}, marketplace.json=${marketVersion}`,
    );
  }

  const source = assertObject(
    marketplacePlugin.source,
    ".claude-plugin/marketplace.json.plugins[0].source",
  );
  const marketplaceRef = source.ref;
  if (marketplaceRef !== `v${packageVersion}`) {
    throw new Error(
      `Immutable marketplace ref mismatch: expected v${packageVersion}, got ${String(marketplaceRef)}`,
    );
  }

  return packageVersion;
}

function syncVersionFile(path: string, version: string, dryRun: boolean): boolean {
  if (path === ".claude-plugin/marketplace.json") {
    const current = readJson(path);
    const { changed, next } = updateMarketplaceRelease(current, version);
    if (changed && !dryRun) {
      writeJson(path, next);
    }
    return changed;
  }

  const obj = assertObject(readJson(path), path);
  const prev = obj.version;
  if (typeof prev !== "string") {
    throw new Error(`${path} version must be a string`);
  }
  if (prev === version) {
    return false;
  }
  obj.version = version;
  if (!dryRun) {
    writeJson(path, obj);
  }
  return true;
}

function syncLabelVersion(version: string, dryRun: boolean): boolean {
  const source = readFileSync(LABEL_FILE, "utf8");
  const next = source.replace(/pi\.setLabel\("pi-oven v[^"]+"\);/, `pi.setLabel("pi-oven v${version}");`);
  if (next === source) {
    return false;
  }
  if (!dryRun) {
    writeFileSync(LABEL_FILE, next, "utf8");
  }
  return true;
}

export function syncReleaseManifests(options: ManifestSyncOptions): ManifestSyncResult {
  const boundary = buildReleaseInstallBoundary({
    version: options.version,
    syncLabel: options.syncLabel,
  });
  const filesChecked = [...VERSION_FILES];
  const filesUpdated: string[] = [];

  for (const file of VERSION_FILES) {
    if (syncVersionFile(file, options.version, options.dryRun)) {
      filesUpdated.push(file);
    }
  }

  const labelUpdated = options.syncLabel ? syncLabelVersion(options.version, options.dryRun) : false;

  return {
    filesChecked,
    filesUpdated,
    labelUpdated,
    boundary,
  };
}
