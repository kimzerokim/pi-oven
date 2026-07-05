import type { SpawnFn } from "./changelog-generator";

export interface GitRunResult {
  command: string;
  args: string[];
}

function run(spawnFn: SpawnFn, cmd: string, args: string[]): { stdout: string; stderr: string } {
  const result = spawnFn(cmd, args);
  if (result.exitCode !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  }
  return { stdout: result.stdout, stderr: result.stderr };
}


function requireCurrentBranch(currentBranch: string | undefined): string {
  const branch = currentBranch?.trim();
  if (!branch) {
    throw new Error("Refusing release: could not resolve current git branch");
  }
  return branch;
}

export function getCurrentTag(spawnFn: SpawnFn): string | undefined {
  const result = spawnFn("git", ["describe", "--tags", "--abbrev=0"]);
  if (result.exitCode !== 0) {
    return undefined;
  }
  const tag = result.stdout.trim();
  return tag.length > 0 ? tag : undefined;
}

export function getCurrentBranch(spawnFn: SpawnFn): string | undefined {
  const result = spawnFn("git", ["branch", "--show-current"]);
  if (result.exitCode !== 0) {
    return undefined;
  }
  const branch = result.stdout.trim();
  return branch.length > 0 ? branch : undefined;
}

export function ensureGitClean(spawnFn: SpawnFn): void {
  const { stdout } = run(spawnFn, "git", ["status", "--porcelain"]);
  if (stdout.trim().length > 0) {
    throw new Error("Refusing release: git working tree is dirty");
  }
}

export function createReleaseTag(version: string, dryRun: boolean, spawnFn: SpawnFn): GitRunResult | undefined {
  if (dryRun) {
    return undefined;
  }
  const args = ["tag", `v${version}`];
  run(spawnFn, "git", args);
  return { command: "git", args };
}

export function createReleaseCommit(version: string, dryRun: boolean, spawnFn: SpawnFn): GitRunResult | undefined {
  if (dryRun) {
    return undefined;
  }
  const args = ["commit", "-am", `release: v${version}`];
  run(spawnFn, "git", args);
  return { command: "git", args };
}

export function pushRelease(
  version: string,
  currentBranch: string | undefined,
  dryRun: boolean,
  spawnFn: SpawnFn
): GitRunResult[] {
  if (dryRun) {
    return [];
  }
  const branch = requireCurrentBranch(currentBranch);
  run(spawnFn, "git", ["push", "origin", branch]);
  run(spawnFn, "git", ["push", "origin", `v${version}`]);
  return [
    { command: "git", args: ["push", "origin", branch] },
    { command: "git", args: ["push", "origin", `v${version}`] },
  ];
}
