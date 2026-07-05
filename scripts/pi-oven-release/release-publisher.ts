import type { SpawnFn } from "./changelog-generator";
import { createReleaseCommit, createReleaseTag, pushRelease, type GitRunResult } from "./git-ops";

export interface PublishOptions {
  version: string;
  publish: boolean;
  dryRun: boolean;
  currentBranch?: string;
  spawnFn: SpawnFn;
}

export interface PublishResult {
  performed: boolean;
  commit?: GitRunResult;
  tag?: GitRunResult;
  pushes: GitRunResult[];
}

export function publishRelease(options: PublishOptions): PublishResult {
  if (!options.publish) {
    return { performed: false, pushes: [] };
  }

  const currentBranch = options.currentBranch?.trim();
  if (!options.dryRun && !currentBranch) {
    throw new Error("Refusing release: could not resolve current git branch");
  }

  const commit = createReleaseCommit(options.version, options.dryRun, options.spawnFn);
  const tag = createReleaseTag(options.version, options.dryRun, options.spawnFn);
  const pushes = pushRelease(options.version, currentBranch, options.dryRun, options.spawnFn);

  return {
    performed: true,
    commit,
    tag,
    pushes,
  };
}
