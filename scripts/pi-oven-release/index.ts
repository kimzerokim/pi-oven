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
import { publishRelease } from "./release-publisher";

export type Values = {
  bump?: string;
  version?: string;
  "from-tag"?: string;
  "dry-run"?: boolean;
  publish?: boolean;
  "update-changelog"?: boolean;
  "sync-label"?: boolean;
};

function parseCli(): Values {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      bump: { type: "string" },
      version: { type: "string" },
      "from-tag": { type: "string" },
      "dry-run": { type: "boolean" },
      publish: { type: "boolean" },
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
  publishRelease: (options: {
    version: string;
    publish: boolean;
    dryRun: boolean;
    currentBranch?: string;
  }) => publishRelease({ ...options, spawnFn }),
  buildReleaseInstallBoundary,
};

export function runRelease(values: Values, deps = defaultReleaseDeps) {
  const dryRun = values["dry-run"] ?? !values.publish;
  const updateChangelogFlag = values["update-changelog"] ?? false;
  const syncLabel = values["sync-label"] ?? false;
  const publish = values.publish ?? false;

  const currentVersion = deps.readCurrentVersionFromSoT();
  const targetVersion = resolveTargetVersion(values, currentVersion);
  const currentBranch = deps.getCurrentBranch();
  const fromTag = values["from-tag"] ?? deps.getCurrentTag();

  if (publish && !dryRun && !currentBranch?.trim()) {
    throw new Error("Refusing release: could not resolve current git branch");
  }
  if (publish) {
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

  const publishResult = deps.publishRelease({
    version: targetVersion,
    publish,
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
    publish,
    currentVersion,
    targetVersion,
    fromTag,
    boundary,
    sync: syncResult,
    changelog,
    publishResult,
  };
}

async function main() {
  const output = runRelease(parseCli());
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

if (import.meta.main) {
  main().catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`${msg}\n`);
    process.exit(1);
  });
}
