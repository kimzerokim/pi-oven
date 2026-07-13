import { mock } from "bun:test";
import * as importedFs from "node:fs";
import * as importedFsPromises from "node:fs/promises";
import * as importedOs from "node:os";
import { fileURLToPath } from "node:url";
import {
  applyIsolatedHomePaths,
  assertTestWritePath,
  createIsolatedHomePaths,
} from "../helpers/home-paths";

type PathLike = string | Buffer | URL;

const originalHome = process.env.HOME;
const paths = createIsolatedHomePaths({ workspaceRoot: process.cwd() });
const removedCredentials = applyIsolatedHomePaths(paths);
process.env.PI_OVEN_TEST_ORIGINAL_HOME = originalHome ?? "";
process.env.PI_OVEN_TEST_SCRUBBED_CREDENTIALS = removedCredentials.join(",");

function toPath(value: PathLike): string {
  if (value instanceof URL) return fileURLToPath(value);
  if (Buffer.isBuffer(value)) return value.toString();
  return value;
}

function guard(value: unknown): void {
  if (typeof value === "number" || value === undefined || value === null) return;
  if (typeof value === "string" || Buffer.isBuffer(value) || value instanceof URL) {
    assertTestWritePath(paths, toPath(value));
  }
}

function guardOpen(path: unknown, flags: unknown): void {
  const writes =
    typeof flags === "number"
      ? (flags & (importedFs.constants.O_WRONLY | importedFs.constants.O_RDWR | importedFs.constants.O_CREAT | importedFs.constants.O_TRUNC | importedFs.constants.O_APPEND)) !== 0
      : typeof flags === "string" && /[wa+]/u.test(flags);
  if (writes) guard(path);
}

const rawFs = { ...importedFs } as Record<string, unknown>;
const rawPromises = { ...importedFsPromises } as Record<string, unknown>;

const originalSync = Object.fromEntries(
  Object.entries(rawFs).map(([name, value]) => [
    name,
    typeof value === "function" ? value.bind(importedFs) : value,
  ])
) as Record<string, (...args: unknown[]) => unknown>;
const originalAsync = Object.fromEntries(
  Object.entries(rawPromises).map(([name, value]) => [
    name,
    typeof value === "function" ? value.bind(importedFsPromises) : value,
  ])
) as Record<string, (...args: unknown[]) => unknown>;

const onePathSync = [
  "appendFileSync", "chmodSync", "chownSync", "createWriteStream", "lchmodSync",
  "lchownSync", "lutimesSync", "mkdirSync", "mkdtempSync", "rmSync", "rmdirSync",
  "truncateSync", "unlinkSync", "utimesSync", "writeFileSync",
] as const;
for (const name of onePathSync) {
  const fn = originalSync[name];
  if (!fn) continue;
  rawFs[name] = (...args: unknown[]) => {
    guard(args[0]);
    return fn(...args);
  };
}

for (const name of ["copyFileSync", "cpSync", "linkSync", "renameSync"] as const) {
  const fn = originalSync[name];
  if (!fn) continue;
  rawFs[name] = (...args: unknown[]) => {
    guard(args[1]);
    if (name === "renameSync") guard(args[0]);
    return fn(...args);
  };
}

if (originalSync.symlinkSync) {
  rawFs.symlinkSync = (...args: unknown[]) => {
    guard(args[1]);
    return originalSync.symlinkSync(...args);
  };
}
if (originalSync.openSync) {
  rawFs.openSync = (...args: unknown[]) => {
    guardOpen(args[0], args[1]);
    return originalSync.openSync(...args);
  };
}

const onePathAsync = [
  "appendFile", "chmod", "chown", "lchmod", "lchown", "lutimes", "mkdir", "mkdtemp",
  "rm", "rmdir", "truncate", "unlink", "utimes", "writeFile",
] as const;
for (const name of onePathAsync) {
  const fn = originalAsync[name];
  if (!fn) continue;
  rawPromises[name] = (...args: unknown[]) => {
    guard(args[0]);
    return fn(...args);
  };
}

for (const name of ["copyFile", "cp", "link", "rename"] as const) {
  const fn = originalAsync[name];
  if (!fn) continue;
  rawPromises[name] = (...args: unknown[]) => {
    guard(args[1]);
    if (name === "rename") guard(args[0]);
    return fn(...args);
  };
}
if (originalAsync.symlink) {
  rawPromises.symlink = (...args: unknown[]) => {
    guard(args[1]);
    return originalAsync.symlink(...args);
  };
}
if (originalAsync.open) {
  rawPromises.open = (...args: unknown[]) => {
    guardOpen(args[0], args[1]);
    return originalAsync.open(...args);
  };
}

rawFs.promises = rawPromises;
mock.module("node:fs", () => rawFs);
mock.module("fs", () => rawFs);
mock.module("node:fs/promises", () => rawPromises);
mock.module("fs/promises", () => rawPromises);
mock.module("node:os", () => ({ ...importedOs, homedir: () => paths.homeDir }));
mock.module("os", () => ({ ...importedOs, homedir: () => paths.homeDir }));

process.on("exit", () => {
  const rmSync = originalSync.rmSync;
  if (rmSync) rmSync(paths.isolationRoot, { recursive: true, force: true });
});
