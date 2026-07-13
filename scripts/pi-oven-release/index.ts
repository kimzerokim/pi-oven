#!/usr/bin/env bun
import { parseArgs } from "node:util";
import { bumpVersion, parseSemver, type BumpType } from "./version-bumper";
import {
  buildReleaseInstallBoundary,
  readCurrentVersionFromSoT,
  syncReleaseManifests,
} from "./manifest-sync";
import { updateChangelog } from "./changelog-generator";
import { ensureGitClean, getCurrentBranch, getCurrentTag } from "./git-ops";
import { prepareReleaseCommit } from "./release-publisher";

export type Values = {
  bump?: string;
  version?: string;
  "from-tag"?: string;
  "dry-run"?: boolean;
  publish?: boolean;
  prepare?: boolean;
  "update-changelog"?: boolean;
  "sync-label"?: boolean;
};

export function parseReleaseArgs(args: string[]): Values {
  const { values } = parseArgs({
    args,
    options: {
      bump: { type: "string" },
      version: { type: "string" },
      "from-tag": { type: "string" },
      "dry-run": { type: "boolean" },
      publish: { type: "boolean" },
      prepare: { type: "boolean" },
      "update-changelog": { type: "boolean" },
      "sync-label": { type: "boolean" },
    },
    allowPositionals: false,
  });

  return values as Values;
}

function resolveTargetVersion(values: Values, current: string): string {
  if (values.version) {
    parseSemver(values.version);
    return values.version;
  }

  if (values.bump) {
    if (values.bump !== "major" && values.bump !== "minor" && values.bump !== "patch") {
      throw new Error(`Invalid --bump value: ${values.bump}`);
    }
    return bumpVersion(current, values.bump as BumpType);
  }

  throw new Error("One of --version or --bump major|minor|patch is required");
}

function spawnFn(cmd: string, args: string[]) {
  const proc = Bun.spawnSync([cmd, ...args], { stdout: "pipe", stderr: "pipe" });
  return {
    exitCode: proc.exitCode,
    stdout: Buffer.from(proc.stdout).toString("utf8"),
    stderr: Buffer.from(proc.stderr).toString("utf8"),
  };
}

const defaultReleaseDeps = {
  readCurrentVersionFromSoT,
  getCurrentBranch: () => getCurrentBranch(spawnFn),
  getCurrentTag: () => getCurrentTag(spawnFn),
  ensureGitClean: () => ensureGitClean(spawnFn),
  syncReleaseManifests,
  updateChangelog: (options: {
    version: string;
    fromTag: string | undefined;
    dryRun: boolean;
    updateChangelog: boolean;
  }) => updateChangelog({ ...options, spawnFn }),
  prepareReleaseCommit: (options: {
    version: string;
    prepare: boolean;
    dryRun: boolean;
    currentBranch?: string;
  }) => prepareReleaseCommit({ ...options, spawnFn }),
  buildReleaseInstallBoundary,
};

export function runRelease(values: Values, deps = defaultReleaseDeps) {
  if (values.publish) {
    throw new Error("Publishing is tag workflow only; use --prepare for a local release commit");
  }

  const prepare = values.prepare ?? false;
  const dryRun = values["dry-run"] ?? !prepare;
  const updateChangelogFlag = values["update-changelog"] ?? false;
  const syncLabel = values["sync-label"] ?? false;

  const currentVersion = deps.readCurrentVersionFromSoT();
  const targetVersion = resolveTargetVersion(values, currentVersion);
  const currentBranch = deps.getCurrentBranch();
  const fromTag = values["from-tag"] ?? deps.getCurrentTag();

  if (prepare && !dryRun && !currentBranch?.trim()) {
    throw new Error("Refusing release: could not resolve current git branch");
  }
  if (prepare) {
    deps.ensureGitClean();
  }

  const syncResult = deps.syncReleaseManifests({
    version: targetVersion,
    dryRun,
    syncLabel,
  });

  const changelog = deps.updateChangelog({
    version: targetVersion,
    fromTag,
    dryRun,
    updateChangelog: updateChangelogFlag,
  });

  const prepareResult = deps.prepareReleaseCommit({
    version: targetVersion,
    prepare,
    dryRun,
    currentBranch,
  });

  const boundary = {
    ...deps.buildReleaseInstallBoundary({
      version: targetVersion,
      syncLabel,
    }),
    sourceRepo: {
      ...syncResult.boundary.sourceRepo,
      currentBranch: currentBranch ?? null,
    },
    releaseArtifact: {
      ...syncResult.boundary.releaseArtifact,
      fromTag: fromTag ?? null,
      gitTag: `v${targetVersion}`,
    },
  };

  return {
    safeByDefault: dryRun,
    prepare,
    currentVersion,
    targetVersion,
    fromTag,
    boundary,
    sync: syncResult,
    changelog,
    prepareResult,
  };
}

export async function main(args: string[]) {
  const output = runRelease(parseReleaseArgs(args));
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

if (import.meta.main) {
  main(Bun.argv.slice(2)).catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`${msg}\n`);
    process.exit(1);
  });
}
