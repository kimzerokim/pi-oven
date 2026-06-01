import { readdirSync, readFileSync } from "fs";
import { promises as fsPromises } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import * as path from "path";
import * as os from "os";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { GateStateStore } from "./pi-oven-runtime/gate-state";
import { createGateHandler } from "./pi-oven-runtime/gate-handler";
import { RulesInjector } from "./pi-oven-runtime/rules-injector";
import { registerPiOvenAsk } from "./pi-oven-runtime/pi-oven-ask";
import {
  STOP_GUARD_MESSAGE,
  createStopGuardState,
  decideStopGuardOnTurnEnd,
  extractTextFromContent,
  updateStopGuardOnTurnStart,
} from "./pi-oven-runtime/autonomous-stop-guard";

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

export interface AgentMirrorSyncResult {
  mirroredFiles: number;
  removedStaleFiles: number;
  targetsTouched: string[];
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
// Agent mirror sync + session model capture helpers
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

function isPiOvenAgentFile(name: string): boolean {
  return name.startsWith("pi-oven-") && name.endsWith(".md");
}

function buildMirrorTargets(cwd: string, homeDir: string): string[] {
  return [
    path.resolve(cwd, ".omp", "agents"),
    path.resolve(homeDir, ".omp", "agent", "agents"),
  ];
}

/**
 * Mirror pi-oven agent files into discovery-stable directories so task dispatch
 * can resolve `pi-oven:*` regardless of plugin-scope discovery quirks.
 *
 * - source: extension-local `agents/` directory
 * - targets: project `.omp/agents` + user `~/.omp/agent/agents`
 * - only mirrors `pi-oven-*.md`
 * - removes stale mirrored `pi-oven-*.md` files that no longer exist at source
 * - preserves non-pi-oven files in targets
 */
export async function syncPiOvenAgentMirrors(
  sourceAgentsDir: string,
  cwd: string,
  homeDir: string
): Promise<AgentMirrorSyncResult> {
  const sourceEntries = await fsPromises.readdir(sourceAgentsDir).catch(() => [] as string[]);
  const sourceFiles = sourceEntries.filter(isPiOvenAgentFile);
  if (sourceFiles.length === 0) {
    return { mirroredFiles: 0, removedStaleFiles: 0, targetsTouched: [] };
  }

  const sourceContent = new Map<string, string>();
  for (const name of sourceFiles) {
    const content = await fsPromises.readFile(path.join(sourceAgentsDir, name), "utf-8");
    sourceContent.set(name, content);
  }

  const targets = Array.from(new Set(buildMirrorTargets(cwd, homeDir)));
  let mirroredFiles = 0;
  let removedStaleFiles = 0;
  const targetsTouched: string[] = [];

  for (const targetDir of targets) {
    await fsPromises.mkdir(targetDir, { recursive: true });
    const existingEntries = await fsPromises.readdir(targetDir).catch(() => [] as string[]);
    const existingPiOven = existingEntries.filter(isPiOvenAgentFile);

    for (const stale of existingPiOven) {
      if (!sourceContent.has(stale)) {
        await fsPromises.unlink(path.join(targetDir, stale)).catch(() => {});
        removedStaleFiles++;
        if (!targetsTouched.includes(targetDir)) targetsTouched.push(targetDir);
      }
    }

    for (const [name, content] of sourceContent.entries()) {
      const targetPath = path.join(targetDir, name);
      const previous = await fsPromises.readFile(targetPath, "utf-8").catch(() => null as string | null);
      if (previous !== content) {
        await fsPromises.writeFile(targetPath, content, "utf-8");
        mirroredFiles++;
        if (!targetsTouched.includes(targetDir)) targetsTouched.push(targetDir);
      }
    }
  }

  return { mirroredFiles, removedStaleFiles, targetsTouched };
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

  // -------------------------------------------------------------------------
  // Plan 3 runtime / discipline layer (Spec F — minimal v1 scope)
  //   Layer 1: tool_call gate (commit/push/forbidden) — the only hard lever.
  //   Layer 4: discipline-rule injection + compaction-survival (rules-injector).
  // The FSM state lives at <repo>/.pi-oven/state/. The repo root is the process
  // cwd at extension load (omp runs the extension from the workspace root).
  // -------------------------------------------------------------------------
  const repoRoot = process.cwd();
  const stateRoot = path.resolve(repoRoot, ".pi-oven");
  const store = new GateStateStore(stateRoot);
  const injector = new RulesInjector();

  // Per-project default RESPONSE language (Plan 2026-06-02). Read the
  // machine-local <repoRoot>/.pi-oven/config.json synchronously at load and,
  // ONLY when it carries a valid "ko"/"en", set the injector's language.
  // Absent/invalid => leave null => the injector injects NOTHING for language
  // (the ambient project/global setting is respected — no imposed default).
  // Fail-open: any FS/parse fault must never break extension load.
  try {
    const configPath = path.resolve(repoRoot, ".pi-oven", "config.json");
    const raw = readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(raw) as { language?: unknown };
    if (parsed.language === "ko" || parsed.language === "en") {
      injector.setLanguage(parsed.language);
    } else {
      pi.logger.debug("pi-oven: .pi-oven/config.json has no valid language — ambient respected");
    }
  } catch (err) {
    pi.logger.debug(`pi-oven: project language config not read (ambient respected): ${err}`);
  }

  // A subagent session is recognized via PI_BLOCKED_AGENT (omp recursion-guard
  // env, task/index.ts:273). Only the parent session may MUTATE the FSM (B4);
  // subagents are still gated (read-only) but never write.
  const isParentSession = !process.env.PI_BLOCKED_AGENT;
  let stopGuardState = createStopGuardState();


  const gateHandler = createGateHandler({
    store,
    logger: pi.logger,
    getEnv: () => process.env,
    isParentSession,
    // Concrete roots for the always-on forbidden `rm -rf` floor. Supplied by
    // the caller (not read inside the pure normalizer) so the matcher resolves
    // an rm target against the real repo root + HOME and flags a destructive
    // wipe of either, while a subdir cleanup stays allowed.
    roots: { repoRoot, homeDir: os.homedir() },
  });

  // Layer 1 — the hard tool-boundary gate. The handler self-deadlines (1500 ms)
  // and throws on overrun; omp converts a throw → {block:true} = fail-CLOSED.
  // Any unexpected error on the NON-gated path fails OPEN inside the handler so
  // a normal omp session is never broken.
  pi.on("tool_call", async (event) => {
    try {
      return await gateHandler(event as never);
    } catch (err) {
      // A thrown error here is the intentional self-deadline fail-closed: omp
      // turns it into {block:true}. Re-throw so the gated tool fail-closes.
      pi.logger.warn(`pi-oven: gate handler self-deadline / fault — fail-closed: ${err}`);
      throw err;
    }
  });

  // Layer 4 — inject the discipline-rule block every turn (dedup key ensures
  // exactly-once per systemPrompt across re-injection / compaction rehydration).
  pi.on("before_agent_start", async (event) => {
    try {
      const systemPrompt = injector.applyToSystemPrompt(event.systemPrompt ?? []);
      return { systemPrompt };
    } catch (err) {
      pi.logger.debug(`pi-oven: before_agent_start inject skipped: ${err}`);
      return undefined; // fail-open: never break the turn
    }
  });

  // Layer 4 — preserve the FSM phase + active rule IDs across compaction. The
  // returned preserveData lands in the resulting CompactionEntry.
  pi.on("session.compacting", async () => {
    try {
      return { preserveData: injector.buildPreserveData() };
    } catch (err) {
      pi.logger.debug(`pi-oven: session.compacting preserve skipped: ${err}`);
      return undefined;
    }
  });

  // Layer 4 — rehydrate preserved discipline rules from a prior CompactionEntry
  // surfaced via SessionBeforeCompactEvent.branchEntries (the corrected
  // data-flow: before_agent_start carries NO branchEntries).
  pi.on("session_before_compact", async (event) => {
    try {
      const entries = (event as unknown as { branchEntries?: unknown[] }).branchEntries;
      if (Array.isArray(entries)) {
        injector.rehydrateFromBranchEntries(entries as never);
      }
    } catch (err) {
      pi.logger.debug(`pi-oven: session_before_compact rehydrate skipped: ${err}`);
    }
    return undefined; // do not cancel/alter the compaction
  });

  pi.on("session_start", async (_event, ctx) => {
    // Capture parent session model for CLI parent-session check (Spec B §6 Step a.5)
    // ctx.getModel is available at runtime (extensibility/extensions/types.d.ts:800)
    // Ensure pi-oven:* agents are discoverable in both project/user scopes even
    // when plugin-root discovery is unavailable in this runtime.
    try {
      const mirror = await syncPiOvenAgentMirrors(agentsDir, repoRoot, os.homedir());
      if (mirror.targetsTouched.length > 0) {
        pi.logger.info(
          `pi-oven: synced agent mirror (${mirror.mirroredFiles} updated, ${mirror.removedStaleFiles} removed) -> ${mirror.targetsTouched.join(", ")}`
        );
      }
    } catch (err) {
      pi.logger.debug(`pi-oven: agent mirror sync skipped: ${err}`);
    }

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

    // Layer 4 — rehydrate discipline rules from session_start hot-context
    // preserveData (the alternate path to branchEntries).
    try {
      const evtAny = _event as unknown as { preserveData?: Record<string, unknown> };
      if (evtAny.preserveData) {
        injector.rehydrateFromPreserveData(evtAny.preserveData);
      }
    } catch (err) {
      pi.logger.debug(`pi-oven: session_start rehydrate skipped: ${err}`);
    }
  });
  // Runtime autonomous stop-guard — for parent session only.
  // If autonomous mode is active and the assistant ends with a polite-stop,
  // queue an immediate hidden continuation turn.
  pi.on("turn_start", async (_event, ctx) => {
    if (!isParentSession) return;
    stopGuardState = updateStopGuardOnTurnStart(
      stopGuardState,
      ctx.sessionManager.getBranch() as never
    );
  });

  pi.on("turn_end", async (event) => {
    if (!isParentSession) return;

    const message = event.message as { content?: unknown; stopReason?: string };
    const decision = decideStopGuardOnTurnEnd(stopGuardState, {
      stopReason: message.stopReason,
      assistantText: extractTextFromContent(message.content),
    });
    stopGuardState = decision.state;

    if (!decision.shouldQueueContinuation) return;

    pi.sendMessage(
      {
        customType: "pi-oven-autonomous-stop-guard",
        content: [{ type: "text", text: STOP_GUARD_MESSAGE }],
        display: true,
        details: { reason: decision.reason },
      },
      { deliverAs: "nextTurn", triggerTurn: true }
    );

    pi.logger.info(`pi-oven: autonomous stop-guard queued continuation (${decision.reason})`);
  });


  // Register the pi-oven_ask tool (single-select question with per-option
  // descriptions). Fail-open: a registration fault must never break load.
  try {
    registerPiOvenAsk(pi);
  } catch (err) {
    pi.logger.debug(`pi-oven: pi-oven_ask registration skipped: ${err}`);
  }

  pi.setLabel("pi-oven v0.1.0");
  pi.logger.info("pi-oven loaded");
}
