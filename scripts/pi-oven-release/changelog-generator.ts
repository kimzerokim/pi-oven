import { existsSync, readFileSync, writeFileSync } from "node:fs";

export interface SpawnResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export type SpawnFn = (cmd: string, args: string[]) => SpawnResult;

export interface ChangelogOptions {
  version: string;
  fromTag?: string;
  dryRun: boolean;
  updateChangelog: boolean;
  spawnFn: SpawnFn;
  date?: string;
}

export interface ChangelogResult {
  updated: boolean;
  commits: string[];
  contentPreview?: string;
}

const CHANGELOG_PATH = "CHANGELOG.md";

function getCommitLines(fromTag: string | undefined, spawnFn: SpawnFn): string[] {
  const range = fromTag ? `${fromTag}..HEAD` : "HEAD";
  const result = spawnFn("git", ["log", range, "--pretty=format:%s"]);
  if (result.exitCode !== 0) {
    throw new Error(`git log failed: ${result.stderr || result.stdout}`);
  }

  return result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function formatEntry(version: string, commits: string[], date: string): string {
  const lines = [`## v${version} - ${date}`, ""];
  if (commits.length === 0) {
    lines.push("- No user-visible changes");
  } else {
    for (const commit of commits) {
      lines.push(`- ${commit}`);
    }
  }
  lines.push("");
  return lines.join("\n");
}

export function updateChangelog(options: ChangelogOptions): ChangelogResult {
  const commits = getCommitLines(options.fromTag, options.spawnFn);
  if (!options.updateChangelog) {
    return { updated: false, commits };
  }

  const date = options.date ?? new Date().toISOString().slice(0, 10);
  const entry = formatEntry(options.version, commits, date);

  const prev = existsSync(CHANGELOG_PATH) ? readFileSync(CHANGELOG_PATH, "utf8") : "# Changelog\n\n";
  const next = prev.includes("# Changelog") ? prev.replace("# Changelog\n\n", `# Changelog\n\n${entry}`) : `# Changelog\n\n${entry}${prev}`;

  if (!options.dryRun) {
    writeFileSync(CHANGELOG_PATH, next, "utf8");
  }

  return {
    updated: true,
    commits,
    contentPreview: entry,
  };
}
