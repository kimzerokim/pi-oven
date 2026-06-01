import { readFileSync, writeFileSync } from "node:fs";

export interface ManifestSyncOptions {
  version: string;
  dryRun: boolean;
  syncLabel: boolean;
}

export interface ManifestSyncResult {
  filesChecked: string[];
  filesUpdated: string[];
  labelUpdated: boolean;
}

const VERSION_FILES = [
  "package.json",
  ".claude-plugin/plugin.json",
  ".claude-plugin/marketplace.json",
] as const;

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

function updateMarketplaceVersion(raw: unknown, version: string): { changed: boolean; next: unknown } {
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
  const prev = plugin.version;
  if (typeof prev !== "string") {
    throw new Error("marketplace.json.plugins[0].version must be a string");
  }
  if (prev === version) {
    return { changed: false, next: raw };
  }
  plugin.version = version;
  return { changed: true, next: root };
}

export function readCurrentVersionFromSoT(): string {
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

  const marketplace = readJson(".claude-plugin/marketplace.json");
  const { next } = updateMarketplaceVersion(marketplace, packageVersion);
  const root = assertObject(next, ".claude-plugin/marketplace.json");
  const plugins = root.plugins as unknown[];
  const marketVersion = (plugins[0] as Record<string, unknown>).version;

  if (typeof marketVersion !== "string") {
    throw new Error(".claude-plugin/marketplace.json plugins[0].version must be a string");
  }

  if (packageVersion !== pluginVersion || packageVersion !== marketVersion) {
    throw new Error(
      `Version SoT mismatch: package.json=${packageVersion}, plugin.json=${pluginVersion}, marketplace.json=${marketVersion}`,
    );
  }

  return packageVersion;
}

function syncVersionFile(path: string, version: string, dryRun: boolean): boolean {
  if (path === ".claude-plugin/marketplace.json") {
    const current = readJson(path);
    const { changed, next } = updateMarketplaceVersion(current, version);
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
  const path = ".omp/extensions/pi-oven.ts";
  const source = readFileSync(path, "utf8");
  const next = source.replace(/pi\.setLabel\("pi-oven v[^"]+"\);/, `pi.setLabel("pi-oven v${version}");`);
  if (next === source) {
    return false;
  }
  if (!dryRun) {
    writeFileSync(path, next, "utf8");
  }
  return true;
}

export function syncReleaseManifests(options: ManifestSyncOptions): ManifestSyncResult {
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
  };
}
