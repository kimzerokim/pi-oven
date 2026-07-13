#!/usr/bin/env bun
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SENTINEL = "pi-oven hermetic original HOME sentinel\n";

export interface HermeticTestResult {
  exitCode: number;
  originalHome: string;
}

/**
 * Launch the suite with HOME pointing at a file, not a directory. The Bun test
 * preload must replace it before importing any suite module. Any stale
 * module-load HOME resolution therefore fails instead of touching user state.
 */
export function runHermeticTests(args: string[] = Bun.argv.slice(2)): HermeticTestResult {
  const harnessRoot = mkdtempSync(join(tmpdir(), "pi-oven-hermetic-runner-"));
  const originalHome = join(harnessRoot, "inaccessible-original-home");
  writeFileSync(originalHome, SENTINEL, "utf8");

  try {
    const env = { ...process.env, HOME: originalHome, PI_OVEN_HERMETIC_SUBPROCESS: "1" };
    const child = Bun.spawnSync([process.execPath, "test", ...args], {
      cwd: process.cwd(),
      env,
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    });
    if (readFileSync(originalHome, "utf8") !== SENTINEL) {
      throw new Error("Hermetic suite modified the inaccessible original HOME sentinel");
    }
    return { exitCode: child.exitCode, originalHome };
  } finally {
    rmSync(harnessRoot, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  process.exitCode = runHermeticTests().exitCode;
}
