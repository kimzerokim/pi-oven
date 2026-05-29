#!/usr/bin/env bun
/**
 * CI-time hard lint for pi-oven agent files.
 * Usage: bun scripts/lint-agents.ts [agentsDir]
 * Walks agentsDir for pi-oven-*.md files. Validates each has a non-empty model:
 * field AND that model/thinkingLevel match profiles.ts PROFILE_A (SoT).
 * Exits 0 on success, 1 on any violation.
 */

import { readdirSync } from "fs";
import { join } from "path";
import { PROFILE_A, ROLES, type Role } from "./pi-oven-setup/profiles";

const agentsDir = process.argv[2] ?? join(import.meta.dir, "..", "agents");

function parseFrontmatter(content: string): Record<string, unknown> {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  return Bun.YAML.parse(match[1]) as Record<string, unknown>;
}

function extractModels(frontmatter: Record<string, unknown>): string[] {
  const raw = frontmatter["model"];
  if (Array.isArray(raw)) return raw.filter((v) => typeof v === "string") as string[];
  if (typeof raw === "string") return raw.length > 0 ? [raw] : [];
  return [];
}

function extractThinkingLevel(frontmatter: Record<string, unknown>): string | undefined {
  const raw = frontmatter["thinkingLevel"];
  return typeof raw === "string" ? raw : undefined;
}

function extractName(frontmatter: Record<string, unknown>): string | undefined {
  const raw = frontmatter["name"];
  return typeof raw === "string" ? raw : undefined;
}

let files: string[];
try {
  files = readdirSync(agentsDir).filter(
    (f) => f.startsWith("pi-oven-") && f.endsWith(".md")
  );
} catch {
  // Directory does not exist — treat as empty (no violations)
  files = [];
}

let violations = 0;
const roleSet = new Set<string>(ROLES as readonly string[]);

for (const file of files) {
  const content = await Bun.file(join(agentsDir, file)).text();
  const frontmatter = parseFrontmatter(content);
  const models = extractModels(frontmatter);

  if (models.length === 0) {
    console.error(
      `lint-agents: ERROR: ${file} has no non-empty model: field. ` +
        `All pi-oven-*.md files must declare model: <provider>/<name>.`
    );
    violations++;
  }

  // SoT alignment: agent file model + thinkingLevel must match PROFILE_A.
  // profiles.ts is the source of truth; agent files are derived artifacts.
  const role = file.replace(/^pi-oven-/, "").replace(/\.md$/, "");
  if (!roleSet.has(role)) continue;

  // Colon-name invariant: frontmatter `name` must equal "pi-oven:" + role.
  // This ensures the omp registry key (colon form) matches the override key
  // used by task.agentModelOverrides — preventing silent hyphen/colon mismatch.
  // Scope: PROFILE_A baseline only. Does NOT read user-global ~/.omp/agent/config.yml.
  const name = extractName(frontmatter);
  const expectedName = `pi-oven:${role}`;
  if (name !== expectedName) {
    console.error(
      `lint-agents: ERROR: ${file} name="${name ?? "(missing)"}" must equal "${expectedName}" (colon registry key invariant).`
    );
    violations++;
  }

  const expected = PROFILE_A[role as Role];
  const expectedModels = [expected.primary, expected.registry_alternate];
  if (models[0] !== expectedModels[0] || models[1] !== expectedModels[1]) {
    console.error(
      `lint-agents: ERROR: ${file} model drift from profiles.ts PROFILE_A. ` +
        `file=[${models.join(", ")}] expected=[${expectedModels.join(", ")}]`
    );
    violations++;
  }

  const thinking = extractThinkingLevel(frontmatter);
  if (thinking !== expected.thinkingLevel) {
    console.error(
      `lint-agents: ERROR: ${file} thinkingLevel="${thinking ?? "(missing)"}" ` +
        `does not match profiles.ts PROFILE_A.${role}.thinkingLevel="${expected.thinkingLevel}".`
    );
    violations++;
  }
}

if (violations > 0) {
  process.exit(1);
}
