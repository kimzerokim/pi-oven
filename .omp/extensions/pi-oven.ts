import {
  readdirSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  rmSync,
  statSync,
  existsSync,
} from "fs";
import * as os from "os";
import * as path from "path";
import { fileURLToPath } from "url";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import {
  KEYWORD_SKILL_DEDUP_KEY,
  buildKeywordMatchedSkillsPrompt,
  createSkillKeywordLoaderState,
  loadSkillKeywordIndex,
  matchSkillsForText,
  updateSkillKeywordLoaderOnTurnStart,
} from "./pi-oven-runtime/skill-keyword-loader";
import {
  STOP_GUARD_MESSAGE,
  createStopGuardState,
  decideStopGuardOnTurnEnd,
  extractTextFromContent,
  updateStopGuardOnTurnStart,
} from "./pi-oven-runtime/autonomous-stop-guard";
import { RulesInjector } from "./pi-oven-runtime/rules-injector";
import { GateStateStore } from "./pi-oven-runtime/gate-state";
import { createGateHandler } from "./pi-oven-runtime/gate-handler";
import { registerPiOvenAsk } from "./pi-oven-runtime/pi-oven-ask";
import { resolveLanguage } from "./pi-oven-runtime/language";

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
 * Returns unique prefixes (everything before the first hyphen) from all
 * pi-oven-*.md agent files.
 */
export function getAllowedPrefixes(agentFiles: AgentFileEntry[]): string[] {
  const KNOWN_ALLOWED = ["opencode-zen", "openai-codex", "anthropic"];
  const present = new Set<string>();
  for (const agent of agentFiles) {
    for (const modelId of agent.modelArray) {
      const slashIdx = modelId.indexOf("/");
      if (slashIdx === -1) continue;
      const prefix = modelId.substring(0, slashIdx);
      if (KNOWN_ALLOWED.includes(prefix)) {
        present.add(prefix);
      }
    }
  }
  return Array.from(present).sort();
}

// ---------------------------------------------------------------------------
// Frontmatter helpers
// ---------------------------------------------------------------------------

function parseFrontmatter(content: string): Record<string, unknown> {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const yaml = match[1];
  const result: Record<string, unknown> = {};
  const lines = yaml.split("\n");
  let currentKey: string | null = null;
  for (const line of lines) {
    // Check for "  - value" (list item)
    if (line.startsWith("  - ") && currentKey) {
      const val = line.substring(4).trim().replace(/^["']|["']$/g, "");
      const existing = result[currentKey];
      if (Array.isArray(existing)) {
        existing.push(val);
      } else {
        result[currentKey] = [val];
      }
      continue;
    }
    const colonIdx = line.indexOf(":");
    if (colonIdx !== -1) {
      const key = line.substring(0, colonIdx).trim();
      const val = line.substring(colonIdx + 1).trim();
      currentKey = key;
      if (val === "") {
        // Potential multiline list start
        continue;
      }
      if (val.startsWith("[") && val.endsWith("]")) {
        result[key] = val
          .slice(1, -1)
          .split(",")
          .map((s) => s.trim().replace(/^["']|["']$/g, ""));
      } else {
        result[key] = val.replace(/^["']|["']$/g, "");
      }
    }
  }
  return result;
}

function extractModels(frontmatter: Record<string, unknown>): string[] {
  const models = frontmatter.model;
  if (Array.isArray(models)) return models.map(String);
  if (typeof models === "string") return [models];
  return [];
}

// ---------------------------------------------------------------------------
// validateAgentRegistry (two-pass — Spec B §10.5)
// ---------------------------------------------------------------------------

/**
 * Validate all pi-oven-*.md agent files in agentsDir.
 * Pass 1: Parse all files and extract models.
 * Pass 2: Ensure all models use an allowed provider prefix.
 * Errors are logged via pi.logger.error.
 */
export function validateAgentRegistry(
  agentsDir: string,
  logger: { error(msg: string): void }
): void {
  const agentFiles: AgentFileEntry[] = [];
  try {
    const files = readdirSync(agentsDir).filter(isPiOvenAgentFile);
    for (const file of files) {
      const content = readFileSync(path.join(agentsDir, file), "utf-8");
      const frontmatter = parseFrontmatter(content);
      agentFiles.push({ modelArray: extractModels(frontmatter) });
    }
  } catch (err) {
    logger.error(`pi-oven: failed to read agent registry: ${err}`);
    return;
  }
  const allowed = getAllowedPrefixes(agentFiles);
  const ABSOLUTE_BLACKLIST = ["google"];
  for (const agent of agentFiles) {
    if (agent.modelArray.length === 0) {
      logger.error(
        `Profile A guarantee broken — agent file missing "model" field.`
      );
      continue;
    }
    for (const modelId of agent.modelArray) {
      const slashIdx = modelId.indexOf("/");
      if (slashIdx === -1) continue;
      const prefix = modelId.substring(0, slashIdx);
      if (ABSOLUTE_BLACKLIST.includes(prefix)) {
        logger.error(
          `pi-oven: agent registry contains WHITELIST VIOLATION: unallowed provider prefix "${prefix}" (model: ${modelId}). Allowed: ${allowed.join(", ")}`
        );
      } else if (!allowed.includes(prefix)) {
        logger.error(
          `pi-oven: agent registry contains provider mismatch: prefix "${prefix}" not in allowed set (model: ${modelId}). Allowed: ${allowed.join(", ")}`
        );
      }
    }
  }
}

/**
 * Mirror all pi-oven-*.md agent files from sourceDir to two targets:
 * 1. Project-local: `<projectDir>/.omp/agents/` (for repo-root reference)
 * 2. User-global: `<homeDir>/.omp/agent/agents/` (for machine-global resolution)
 *
 * Removes stale pi-oven-*.md files from targets that no longer exist in source.
 * Leaves non-pi-oven files (e.g. user custom agents) untouched.

  return result;
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
  const data: SessionModelCapture = {
    model: modelId,
    capturedAt: Date.now(),
  };
  mkdirSync(path.dirname(targetPath), { recursive: true });
  // Ensure parent directory exists before writing session capture
  writeFileSync(targetPath, JSON.stringify(data, null, 2), "utf-8");
}

function isPiOvenAgentFile(name: string): boolean {
  return name.startsWith("pi-oven-") && name.endsWith(".md");
}

// ---------------------------------------------------------------------------
// readProjectInstructions — repo-root CLAUDE.md reader (project-local)
// ---------------------------------------------------------------------------

/**
 * Read the repo-root project instructions file `<repoRoot>/CLAUDE.md`.
 * Returns the content as a string, or null if the file is absent or too large.
 */
export function readProjectInstructions(
  repoRoot: string,
  maxBytes: number = 256 * 1024
): string | null {
  const claudePath = path.resolve(repoRoot, "CLAUDE.md");
  try {
    // Check size before reading to avoid blowing up memory on a massive file.
    if (!existsSync(claudePath)) return null;
    const stats = statSync(claudePath);
    if (stats.size > maxBytes || stats.size === 0) return null;
    const content = readFileSync(claudePath, "utf-8");
    return content.length > 0 ? content : null;
  } catch {
    return null;
  }
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

  const repoRoot = process.cwd();
  const stateRoot = path.resolve(repoRoot, ".pi-oven");
  const store = new GateStateStore(stateRoot);
  const injector = new RulesInjector();

  // -------------------------------------------------------------------------
  // Setup detection: effectiveSetupComplete = true iff the user has RUN setup
  // (i.e. setupCompletedAt is a non-empty string in either the global config
  // ~/.pi-oven/config.json OR the project-local .pi-oven/config.json).
  // Mere installation (agent files present) does NOT count as setup complete.
  // Fail-soft: any FS/parse error → treat as NOT complete so the notice shows.
  let effectiveSetupComplete = false;
  const globalConfigPath = path.resolve(os.homedir(), ".pi-oven", "config.json");
  const projectConfigPath = path.resolve(repoRoot, ".pi-oven", "config.json");
  try {
    const raw = readFileSync(globalConfigPath, "utf-8");
    const parsed = JSON.parse(raw) as { setupCompletedAt?: unknown };
    if (typeof parsed.setupCompletedAt === "string" && parsed.setupCompletedAt.length > 0) {
      effectiveSetupComplete = true;
    }
  } catch {
    // not present or unreadable — keep false
  }
  if (!effectiveSetupComplete) {
    try {
      const raw = readFileSync(projectConfigPath, "utf-8");
      const parsed = JSON.parse(raw) as { setupCompletedAt?: unknown };
      if (typeof parsed.setupCompletedAt === "string" && parsed.setupCompletedAt.length > 0) {
        effectiveSetupComplete = true;
      }
    } catch {
      // not present or unreadable — keep false
    }
  }

  // Read config: GLOBAL language first, then PROJECT-LOCAL overrides.
  // Resolution order: project language > global language > no language set.
  // resolveLanguage re-validates the persisted string so a hand-edited
  // config.json can never poison the system prompt. Fail-open on any fault.
  let projectInstructionsEnabled = true;
  try {
    const raw = readFileSync(globalConfigPath, "utf-8");
    const parsed = JSON.parse(raw) as { language?: unknown };
    const resolved =
      typeof parsed.language === "string" ? resolveLanguage(parsed.language) : null;
    if (resolved) injector.setLanguage(resolved);
  } catch {
    // global config absent or unreadable — no language set from global
  }
  try {
    const raw = readFileSync(projectConfigPath, "utf-8");
    const parsed = JSON.parse(raw) as {
      language?: unknown;
      projectInstructions?: unknown;
    };
    const resolved =
      typeof parsed.language === "string" ? resolveLanguage(parsed.language) : null;
    if (resolved) injector.setLanguage(resolved);
    if (parsed.projectInstructions === false) projectInstructionsEnabled = false;
  } catch (err) {
    pi.logger.debug(`pi-oven: project config not read (ambient respected): ${err}`);
  }

  // Inject the repo-root CLAUDE.md (project-local instructions) unless opted out.
  // omp does not read it natively; the global ~/.claude/CLAUDE.md is untouched.
  if (projectInstructionsEnabled) {
    try {
      const projectInstructions = readProjectInstructions(repoRoot);
      if (projectInstructions) {
        injector.setProjectInstructions(projectInstructions);
        pi.logger.debug(
          `pi-oven: injected project CLAUDE.md (${projectInstructions.length} chars)`
        );
      }
    } catch (err) {
      pi.logger.debug(`pi-oven: project CLAUDE.md not read: ${err}`);
    }
  }

  const isParentSession = !process.env.PI_BLOCKED_AGENT;
  let skillKeywordState = createSkillKeywordLoaderState();
  let skillKeywordIndex = [] as ReturnType<typeof loadSkillKeywordIndex>;
  try {
    skillKeywordIndex = loadSkillKeywordIndex(repoRoot);
    pi.logger.debug(`pi-oven: loaded skill keyword index (${skillKeywordIndex.length} skills)`);
  } catch (err) {
    pi.logger.debug(`pi-oven: skill keyword index not loaded: ${err}`);
  }
  let stopGuardState = createStopGuardState();

  const gateHandler = createGateHandler({
    store,
    logger: pi.logger,
    getEnv: () => process.env,
    isParentSession,
    roots: { repoRoot, homeDir: os.homedir() },
  });

  pi.on("tool_call", async (event) => {
    try {
      return await gateHandler(event as never);
    } catch (err) {
      pi.logger.warn(`pi-oven: gate handler self-deadline / fault — fail-closed: ${err}`);
      throw err;
    }
  });

  pi.on("before_agent_start", async (event) => {
    try {
      const promptMatchedSkills = isParentSession
        ? matchSkillsForText(event.prompt ?? "", skillKeywordIndex)
        : [];
      const effectiveMatchedSkills =
        promptMatchedSkills.length > 0 ? promptMatchedSkills : skillKeywordState.matchedSkills;

      if (isParentSession) {
        const fsm = await store.readState();
        const remainingFromState =
          fsm.kind === "OK"
            ? (fsm.state.requiredSkills ?? []).filter(
                (name) => !(fsm.state.skillReads ?? []).includes(name)
              )
            : [];
        const remainingSkills =
          remainingFromState.length > 0
            ? remainingFromState
            : effectiveMatchedSkills.map((skill) => skill.name);
        const reminders: string[] = [];
        const branchContract = await store.readBranchContract();
        const needsAutonomousReminder =
          (fsm.kind === "OK" && fsm.state.active) ||
          effectiveMatchedSkills.some((skill) => skill.name === "autonomous-loop");
        if (needsAutonomousReminder) {
          if (branchContract.kind !== "OK") {
            reminders.push(
              "Before code-write, write `.pi-oven/state/branch-contract.json` with `destination`, `branch`, and `pr_mode`."
            );
          }
          if (remainingSkills.length > 0) {
            reminders.push(
              `Before code-write, read ${remainingSkills.map((name) => `skill://${name}`).join(", ")}.`
            );
          }
        }
        injector.setReminder(reminders.length > 0 ? reminders.join(" ") : null);
      }

      let systemPrompt = injector.applyToSystemPrompt(event.systemPrompt ?? []);
      if (isParentSession) {
        const keywordPrompt = buildKeywordMatchedSkillsPrompt(effectiveMatchedSkills);
        if (
          keywordPrompt !== null &&
          !systemPrompt.some((entry) => entry.includes(KEYWORD_SKILL_DEDUP_KEY))
        ) {
          systemPrompt = [...systemPrompt, keywordPrompt];
        }
      }
      return { systemPrompt };
    } catch (err) {
      pi.logger.debug(`pi-oven: before_agent_start inject skipped: ${err}`);
      return undefined;
    }
  });

  pi.on("session.compacting", async () => {
    try {
      return { preserveData: injector.buildPreserveData() };
    } catch (err) {
      pi.logger.debug(`pi-oven: session.compacting preserve skipped: ${err}`);
      return undefined;
    }
  });

  pi.on("session_before_compact", async (event) => {
    try {
      const entries = (event as unknown as { branchEntries?: unknown[] }).branchEntries;
      if (Array.isArray(entries)) {
        injector.rehydrateFromBranchEntries(entries as never);
      }
    } catch (err) {
      pi.logger.debug(`pi-oven: session_before_compact rehydrate skipped: ${err}`);
    }
    return undefined;
  });

  pi.on("session_start", async (_event, ctx) => {
    try {
      const uiCtx = ctx as unknown as {
        hasUI?: boolean;
        ui?: { notify?: (message: string, level: string) => void };
      };
      if (
        uiCtx.hasUI &&
        uiCtx.ui &&
        typeof uiCtx.ui.notify === "function" &&
        !effectiveSetupComplete
      ) {
        uiCtx.ui.notify(
          "pi-oven is not set up for this project. Run /pi-oven:setup to configure it — or, if you don't want to see this, uninstall the plugin with: omp plugin uninstall pi-oven@kzk",
          "warning"
        );
      }
    } catch (err) {
      pi.logger.debug(`pi-oven: setup-state notice skipped: ${err}`);
    }

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

    try {
      const evtAny = _event as unknown as { preserveData?: Record<string, unknown> };
      if (evtAny.preserveData) {
        injector.rehydrateFromPreserveData(evtAny.preserveData);
      }
    } catch (err) {
      pi.logger.debug(`pi-oven: session_start rehydrate skipped: ${err}`);
    }
  });

  pi.on("turn_start", async (_event, ctx) => {
    if (!isParentSession) return;
    const branchEntries = ctx.sessionManager.getBranch() as never;
    stopGuardState = updateStopGuardOnTurnStart(stopGuardState, branchEntries);
    skillKeywordState = updateSkillKeywordLoaderOnTurnStart(
      skillKeywordState,
      branchEntries,
      skillKeywordIndex
    );
    await store.mutate((current) => {
      const requiredSkills = skillKeywordState.matchedSkills.map((skill) => skill.name);
      const sameUserMessage = current.requiredSkillsMessageId === skillKeywordState.lastUserMessageId;
      const persistedReads = sameUserMessage ? current.skillReads ?? [] : [];
      return {
        ...current,
        active: stopGuardState.autonomousActive,
        version: current.version + 1,
        schemaVersion: current.schemaVersion ?? 1,
        requiredSkills,
        skillReads: persistedReads.filter((name) => requiredSkills.includes(name)),
        requiredSkillsMessageId: skillKeywordState.lastUserMessageId,
      };
    });
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

  try {
    registerPiOvenAsk(pi);
  } catch (err) {
    pi.logger.debug(`pi-oven: pi-oven_ask registration skipped: ${err}`);
  }

  pi.setLabel("pi-oven v0.1.6");
  pi.logger.info("pi-oven loaded");

}
