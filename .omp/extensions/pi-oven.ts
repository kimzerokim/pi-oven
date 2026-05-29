import { readdirSync, readFileSync } from "fs";
import { promises as fsPromises } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import * as path from "path";
import * as os from "os";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AgentFileEntry {
  modelArray: string[];
}

export interface SessionModelCapture {
  model: string;
  capturedAt: number;
}

// ---------------------------------------------------------------------------
// getAllowedPrefixes (dynamic — option c from Spec B §10.5)
// ---------------------------------------------------------------------------

/**
 * Compute ALLOWED_PREFIXES from loaded agent files.
 * Base prefixes always included: opencode-zen/, openai-codex/
 * anthropic/ included only if any agent file already has an anthropic/* model.
 * This is the agent-file-presence signal (Spec B §10.5 option c).
 */
export function getAllowedPrefixes(agentFiles: AgentFileEntry[]): string[] {
  const base = ["opencode-zen/", "openai-codex/"];
  const anthropicEnabled = agentFiles.some((a) =>
    a.modelArray.some((m) => m.startsWith("anthropic/"))
  );
  return anthropicEnabled ? [...base, "anthropic/"] : base;
}

// ---------------------------------------------------------------------------
// Frontmatter helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// validateAgentRegistry (two-pass — Spec B §10.5)
// ---------------------------------------------------------------------------

/**
 * Validate all pi-oven-*.md agent files in agentsDir.
 *
 * Pass 1: read all agent files into memory (model arrays).
 * Compute getAllowedPrefixes from them (dynamic — Spec B §10.5).
 * Pass 2: validate each file's model array against the dynamic prefix list.
 *
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
    return;
  }

  // Pass 1: load all files into memory
  const fileData: Array<{ file: string; models: string[] }> = [];
  for (const file of files) {
    const content = readFileSync(join(agentsDir, file), "utf-8");
    const frontmatter = parseFrontmatter(content);
    const models = extractModels(frontmatter);
    fileData.push({ file, models });
  }

  // Compute dynamic allowed prefixes from all loaded agent files
  const agentEntries: AgentFileEntry[] = fileData.map((d) => ({ modelArray: d.models }));
  const allowedPrefixes = getAllowedPrefixes(agentEntries);

  // Pass 2: validate each file against computed prefixes
  for (const { file, models } of fileData) {
    if (models.length === 0) {
      logger.error(
        `Profile A guarantee broken: ${file} has no model field. ` +
          `Runtime fallback to omp default may occur; CI lint should catch this.`
      );
      continue;
    }

    for (const model of models) {
      if (!allowedPrefixes.some((p) => model.startsWith(p))) {
        logger.error(
          `[pi-oven] WHITELIST VIOLATION: ${file} model="${model}" ` +
            `is not in allowed prefixes [${allowedPrefixes.join(", ")}]`
        );
      }
    }
  }
}

// ---------------------------------------------------------------------------
// captureSessionModel — writes parent session model to a JSON file
// ---------------------------------------------------------------------------

/**
 * Writes the parent session model to a JSON file for use by CLI scripts.
 * Spec B §6 Step a.5 / §9.6.
 * Throws on FS error — caller is responsible for catching.
 */
export async function captureSessionModel(
  modelId: string,
  targetPath: string
): Promise<void> {
  const capture: SessionModelCapture = {
    model: modelId,
    capturedAt: Date.now(),
  };
  await fsPromises.writeFile(targetPath, JSON.stringify(capture, null, 2), "utf-8");
}

// ---------------------------------------------------------------------------
// Extension entrypoint
// ---------------------------------------------------------------------------

export default function piOvenPi(pi: ExtensionAPI): void {
  const agentsDir = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    "agents"
  );

  validateAgentRegistry(agentsDir, pi.logger);

  const sessionModelPath = path.resolve(os.homedir(), ".omp/plugins/pi-oven-session-model.json");

  pi.on("session_start", async (_event, ctx) => {
    // Capture parent session model for CLI parent-session check (Spec B §6 Step a.5)
    // ctx.getModel is available at runtime (extensibility/extensions/types.d.ts:800)
    // but not reflected in the bundled @oh-my-pi/pi-coding-agent types.
    const ctxAny = ctx as unknown as { getModel?: () => unknown };
    const activeModel = ctxAny.getModel?.();
    if (activeModel) {
      const modelId: string =
        typeof (activeModel as { id?: unknown }).id === "string"
          ? (activeModel as { id: string }).id
          : String(activeModel);
      try {
        await captureSessionModel(modelId, sessionModelPath);
      } catch (err) {
        pi.logger.debug(`pi-oven: failed to capture parent session model: ${err}`);
      }
    }
  });

  pi.setLabel("pi-oven v0.1.0");
  pi.logger.info("pi-oven loaded");
}
