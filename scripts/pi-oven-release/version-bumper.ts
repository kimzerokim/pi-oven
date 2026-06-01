export type BumpType = "major" | "minor" | "patch";

const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)$/;

export function parseSemver(version: string): [number, number, number] {
  const m = SEMVER_RE.exec(version);
  if (!m) {
    throw new Error(`Invalid semver: ${version}`);
  }
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

export function bumpVersion(version: string, bump: BumpType): string {
  const [major, minor, patch] = parseSemver(version);
  if (bump === "major") return `${major + 1}.0.0`;
  if (bump === "minor") return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}
