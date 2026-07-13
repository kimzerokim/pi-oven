#!/usr/bin/env bun
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import type { ShippedManifest } from "./release-contract";

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export function verifyInstalledManifest(root: string, manifest: ShippedManifest): void {
  for (const file of manifest.files) {
    const path = resolve(root, file.path);
    if (!path.startsWith(`${resolve(root)}/`)) throw new Error(`Unsafe shipped path: ${file.path}`);
    if (sha256(path) !== file.sha256) throw new Error(`Shipped manifest checksum mismatch: ${file.path}`);
  }
}

function run(command: string[], cwd: string, env: Record<string, string>): void {
  const result = Bun.spawnSync(command, { cwd, env, stdout: "inherit", stderr: "inherit" });
  if (result.exitCode !== 0) throw new Error(`${command.join(" ")} failed with exit ${result.exitCode}`);
}

export function runFreshInstallSmoke(
  archivePath: string,
  manifestPath: string,
  cacheDir?: string,
): void {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as ShippedManifest;
  if (basename(archivePath) !== manifest.archive) throw new Error("Archive name does not match shipped manifest");
  const scratch = mkdtempSync(join(tmpdir(), "pi-oven-release-smoke-"));
  const install = join(scratch, "install");
  const home = join(scratch, "home");
  mkdirSync(install, { recursive: true });
  mkdirSync(home, { recursive: true });
  run(["tar", "-xzf", resolve(archivePath), "-C", install], process.cwd(), { ...process.env } as Record<string, string>);
  const packageRoot = join(install, `pi-oven-v${manifest.version}`);
  verifyInstalledManifest(packageRoot, manifest);
  const env = {
    ...process.env,
    HOME: home,
    XDG_CONFIG_HOME: join(home, ".config"),
    XDG_CACHE_HOME: join(home, ".cache"),
    XDG_DATA_HOME: join(home, ".local", "share"),
    BUN_INSTALL_CACHE_DIR: cacheDir ? resolve(cacheDir) : join(home, ".bun", "install", "cache"),
  } as Record<string, string>;
  run(["bun", "install", "--frozen-lockfile"], packageRoot, env);
  run(["bun", "run", "check"], packageRoot, env);
  run(["bun", "run", "build"], packageRoot, env);
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      archive: { type: "string" },
      manifest: { type: "string" },
      "cache-dir": { type: "string" },
    },
    strict: true,
  });
  if (!values.archive || !values.manifest) throw new Error("--archive and --manifest are required");
  runFreshInstallSmoke(values.archive, values.manifest, values["cache-dir"]);
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
