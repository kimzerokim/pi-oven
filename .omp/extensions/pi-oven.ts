import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import * as path from "path";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";

const ALLOWED_PREFIXES = [
  "opencode-zen/",
  "openai-codex/",
  "anthropic/",
];

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

/**
 * Validate all pi-oven-*.md agent files in agentsDir.
 * Logs errors via logger.error for:
 *   - Missing or empty model: field ("Profile A guarantee broken: ...")
 *   - model value not starting with an allowed prefix (WHITELIST VIOLATION)
 * Does NOT throw — soft-error at load time. Hard enforcement is CI lint.
 */
export function validateAgentRegistry(
  agentsDir: string,
  logger: { error(msg: string): void }
): void {
  let files: string[];
  try {
    files = readdirSync(agentsDir).filter(
      (f) => f.startsWith("pi-oven-") && f.endsWith(".md")
    );
  } catch {
    // Directory missing — treat as empty (no agents to validate)
    return;
  }

  for (const file of files) {
    const content = readFileSync(join(agentsDir, file), "utf-8");
    const frontmatter = parseFrontmatter(content);
    const models = extractModels(frontmatter);

    if (models.length === 0) {
      logger.error(
        `Profile A guarantee broken: ${file} has no model field. ` +
          `Runtime fallback to omp default may occur; CI lint should catch this.`
      );
      continue;
    }

    for (const model of models) {
      if (!ALLOWED_PREFIXES.some((p) => model.startsWith(p))) {
        logger.error(
          `[pi-oven] WHITELIST VIOLATION: ${file} model="${model}" ` +
            `is not in allowed prefixes [${ALLOWED_PREFIXES.join(", ")}]`
        );
      }
    }
  }
}

export default function piOvenPi(pi: ExtensionAPI): void {
  const agentsDir = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    "agents"
  );

  validateAgentRegistry(agentsDir, pi.logger);

  pi.setLabel("pi-oven v0.1.0");
  pi.logger.info("pi-oven loaded");
}
