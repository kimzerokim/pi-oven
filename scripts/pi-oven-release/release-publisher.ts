import type { SpawnFn } from "./changelog-generator";
import { createReleaseCommit, type GitRunResult } from "./git-ops";

export interface PrepareOptions {
  version: string;
  prepare: boolean;
  dryRun: boolean;
  currentBranch?: string;
  spawnFn: SpawnFn;
}

export interface PrepareResult {
  prepared: boolean;
  commit?: GitRunResult;
}

export const RELEASE_VALIDATION_COMMANDS = [
  ["bun", "install", "--frozen-lockfile"],
  ["bun", "run", "contract:check"],
  ["bun", "run", "check"],
  ["bun", "run", "lint:agents"],
  ["bun", "run", "lint:skills"],
  ["bun", "run", "build"],
  ["bun", "run", "test:hermetic", "--", "--only-failures"],
] as const;

function validateReleaseCandidate(version: string, spawnFn: SpawnFn): void {
  const commands: ReadonlyArray<readonly string[]> = [
    RELEASE_VALIDATION_COMMANDS[0],
    ["bun", "run", "release:contract", "--", "--tag", `v${version}`, "--check-only"],
    ...RELEASE_VALIDATION_COMMANDS.slice(1),
  ];
  for (const [command, ...args] of commands) {
    const result = spawnFn(command, [...args]);
    if (result.exitCode !== 0) {
      throw new Error(
        `release validation failed: ${command} ${args.join(" ")}: ${result.stderr || result.stdout}`,
      );
    }
  }
}

export function prepareReleaseCommit(options: PrepareOptions): PrepareResult {
  if (!options.prepare) {
    return { prepared: false };
  }

  const currentBranch = options.currentBranch?.trim();
  if (!options.dryRun && !currentBranch) {
    throw new Error("Refusing release: could not resolve current git branch");
  }

  if (!options.dryRun) validateReleaseCandidate(options.version, options.spawnFn);

  const commit = createReleaseCommit(options.version, options.dryRun, options.spawnFn);

  return {
    prepared: true,
    commit,
  };
}
