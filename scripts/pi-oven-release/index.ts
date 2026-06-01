#!/usr/bin/env bun
import { parseArgs } from "node:util";
import { bumpVersion, parseSemver, type BumpType } from "./version-bumper";
import { readCurrentVersionFromSoT, syncReleaseManifests } from "./manifest-sync";
import { updateChangelog } from "./changelog-generator";
import { ensureGitClean, getCurrentTag } from "./git-ops";
import { publishRelease } from "./release-publisher";

type Values = {
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

async function main() {
  const values = parseCli();
  const dryRun = values["dry-run"] ?? !values.publish;
  const updateChangelogFlag = values["update-changelog"] ?? false;
  const syncLabel = values["sync-label"] ?? false;
  const publish = values.publish ?? false;
  if (publish) {
    ensureGitClean(spawnFn);
  }

  const currentVersion = readCurrentVersionFromSoT();
  const targetVersion = resolveTargetVersion(values, currentVersion);
  const fromTag = values["from-tag"] ?? getCurrentTag(spawnFn);

  const syncResult = syncReleaseManifests({
    version: targetVersion,
    dryRun,
    syncLabel,
  });

  const changelog = updateChangelog({
    version: targetVersion,
    fromTag,
    dryRun,
    updateChangelog: updateChangelogFlag,
    spawnFn,
  });

  const publishResult = publishRelease({
    version: targetVersion,
    publish,
    dryRun,
    spawnFn,
  });

  const output = {
    safeByDefault: dryRun,
    publish,
    currentVersion,
    targetVersion,
    fromTag,
    sync: syncResult,
    changelog,
    publishResult,
  };

  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`${msg}\n`);
  process.exit(1);
});
