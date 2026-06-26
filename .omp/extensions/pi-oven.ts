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
  formatSkillKeywordIndexIssues,
  loadSkillKeywordIndexReport,
  matchSkillsForText,
  updateSkillKeywordLoaderOnTurnStart,
  type SkillKeywordIndexIssue,
} from "./pi-oven-runtime/skill-keyword-loader";
import {
  STOP_GUARD_MESSAGE,
  createStopGuardState,
  decideStopGuardOnTurnEnd,
  extractTextFromContent,
  updateStopGuardOnTurnStart,
} from "./pi-oven-runtime/autonomous-stop-guard";
import {
  RulesInjector,
  ORCHESTRATOR_CONDUCT_DEDUP_KEY,
} from "./pi-oven-runtime/rules-injector";
import {
  GateStateStore,
  type ExternalExecConsent,
  type OwnershipTraceEntry,
} from "./pi-oven-runtime/gate-state";
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

export interface SetupChecklistNotice {
  message: string;
  level: "info" | "warning";
}

const INSTALLED_TOPOLOGY_SIGNAL_NAME = "installed topology";
const RUNTIME_GLOBAL_CONFIG_PATH = "~/.omp/agent/config.yml";
const RUNTIME_INSTALLED_TOPOLOGY_FIX =
  "Restore the plugin assets at that path or reinstall pi-oven@kzk.";

const PLUGIN_ROOT_MARKERS = [
  ".claude-plugin",
  "agents",
  "skills",
  "package.json",
] as const;

function scorePluginRootCandidate(root: string): number {
  let score = 0;
  for (const marker of PLUGIN_ROOT_MARKERS) {
    if (existsSync(path.resolve(root, marker))) score++;
  }
  return score;
}

function formatRuntimeInstalledTopologyCause(reason: unknown): string {
  const message =
    reason instanceof Error
      ? reason.message
      : typeof reason === "string"
        ? reason
        : String(reason);
  const normalized = message.replace(/\s+/g, " ").trim();
  return normalized.length > 0 ? normalized : "unknown asset read failure";
}

function buildRuntimeInstalledTopologyNotice(
  pluginRoot: string,
  projectRoot: string,
  reason: unknown
): SetupChecklistNotice {
  const cause = formatRuntimeInstalledTopologyCause(reason);
  return {
    level: "warning",
    message: [
      "Standalone truth surface:",
      `  [WARN] ${INSTALLED_TOPOLOGY_SIGNAL_NAME}: pi-oven shipped assets could not be read from ${pluginRoot} for the runtime keyword index (${cause}); project state read from ${projectRoot}; machine-global config remains ${RUNTIME_GLOBAL_CONFIG_PATH}. Runtime keyword-matched skills are unavailable.`,
      `         fix: ${RUNTIME_INSTALLED_TOPOLOGY_FIX}`,
    ].join("\n"),
  };
}

const RUNTIME_KEYWORD_INTEGRITY_FIX =
  "Sync .claude-plugin/plugin.json, shipped SKILL frontmatter names, and SKILL_KEYWORD_WHITELIST entries; reinstall pi-oven@kzk if installed assets are stale.";

function buildRuntimeKeywordIntegrityNotice(
  pluginRoot: string,
  projectRoot: string,
  issues: SkillKeywordIndexIssue[],
  loadedCount: number,
  shippedSkillCount: number
): SetupChecklistNotice {
  const availability =
    loadedCount === 0
      ? "Runtime keyword-matched skills are unavailable."
      : "Runtime keyword-matched skills are partially available.";
  const driftDetail =
    shippedSkillCount === 0 && issues.length === 0
      ? "plugin.json skills[] did not yield any shipped skills."
      : `skipped ${issues.length}: ${formatSkillKeywordIndexIssues(issues)}.`;
  return {
    level: "warning",
    message: [
      "Standalone truth surface:",
      `  [WARN] keyword-skill integrity: runtime keyword index loaded ${loadedCount}/${shippedSkillCount} shipped skills from ${pluginRoot}; project state read from ${projectRoot}; machine-global config remains ${RUNTIME_GLOBAL_CONFIG_PATH}; ${driftDetail} ${availability}`,
      `         fix: ${RUNTIME_KEYWORD_INTEGRITY_FIX}`,
    ].join("\n"),
  };
}

// ---------------------------------------------------------------------------
// Setup onboarding checklist (Spec project-scoped-model-routing §4)
// ---------------------------------------------------------------------------

/**
 * Build the always-shown 2-line (optionally 3-line) setup checklist notice.
 *
 * - Line 1: header "pi-oven setup".
 * - Line 2: Global  marker (~/.pi-oven/config.json).
 * - Line 3: Project marker (.pi-oven/config.json) — appends " — run /pi-oven:setup"
 *   only while the project layer is incomplete.
 * - Optional routing line: when the project `.omp/settings.json` declares any
 *   `pi-oven:*` model overrides, append "  ↳ project model routing active (N roles)".
 * - Uninstall hint appended ONLY when neither layer is complete.
 *
 * Level is "info" once the project layer is complete (or both), else "warning".
 */
export function buildSetupChecklistNotice(
  globalComplete: boolean,
  projectComplete: boolean,
  routingRoleCount: number = 0
): SetupChecklistNotice {
  const mark = (done: boolean) => (done ? "✓" : "✗");
  const lines = [
    "pi-oven setup",
    `  [${mark(globalComplete)}] Global   (~/.pi-oven/config.json)`,
    `  [${mark(projectComplete)}] Project  (.pi-oven/config.json)${
      projectComplete ? "" : " — run /pi-oven:setup"
    }`,
  ];
  if (routingRoleCount > 0) {
    lines.push(`  ↳ project model routing active (${routingRoleCount} roles)`);
  }
  if (!globalComplete && !projectComplete) {
    lines.push(
      "  To stop seeing this, uninstall the plugin: omp plugin uninstall pi-oven@kzk"
    );
  }
  return {
    message: lines.join("\n"),
    level: projectComplete ? "info" : "warning",
  };
}

/**
 * Read a `.pi-oven/config.json` and report whether `setupCompletedAt` is a
 * non-empty string. Fail-soft: any FS/parse error → false.
 */
export function readSetupComplete(configPath: string): boolean {
  try {
    const raw = readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(raw) as { setupCompletedAt?: unknown };
    return (
      typeof parsed.setupCompletedAt === "string" &&
      parsed.setupCompletedAt.length > 0
    );
  } catch {
    return false;
  }
}

/**
 * Count `pi-oven:*` keys in `<repoRoot>/.omp/settings.json`
 * `task.agentModelOverrides` (the project model-routing layer). Fail-soft → 0.
 */
export function countProjectRoutingRoles(settingsPath: string): number {
  try {
    const raw = readFileSync(settingsPath, "utf-8");
    const parsed = JSON.parse(raw) as {
      task?: { agentModelOverrides?: Record<string, unknown> };
    };
    const overrides = parsed.task?.agentModelOverrides;
    if (!overrides || typeof overrides !== "object") return 0;
    return Object.keys(overrides).filter((k) => k.startsWith("pi-oven:")).length;
  } catch {
    return 0;
  }
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

export function resolvePluginRoot(importMetaUrl: string): string {
  const baseDir = path.dirname(fileURLToPath(importMetaUrl));
  const candidates = [
    baseDir,
    path.resolve(baseDir, ".."),
    path.resolve(baseDir, "..", ".."),
  ];

  let best = candidates[0];
  let bestScore = -1;
  for (const candidate of candidates) {
    const score = scorePluginRootCandidate(candidate);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}

/**
 * Inject the parent-only orchestrator-conduct block. Pure helper, called AFTER
 * `injector.applyToSystemPrompt(...)` (which APPENDS): for the parent session it
 * UNSHIFTS the conduct block to index 0 so it reads first; for non-parent
 * sessions (subagents) it returns the array unchanged. Deduped on the conduct
 * marker so re-application never produces a second block. Non-mutating.
 */
export function applyOrchestratorConduct(
  systemPrompt: string[],
  injector: RulesInjector,
  opts: { isParentSession: boolean; autonomousActive: boolean }
): string[] {
  if (!opts.isParentSession) return systemPrompt.slice();
  if (systemPrompt.some((s) => s.includes(ORCHESTRATOR_CONDUCT_DEDUP_KEY))) {
    return systemPrompt.slice();
  }
  return [
    injector.buildOrchestratorConductBlock({ autonomousActive: opts.autonomousActive }),
    ...systemPrompt,
  ];
}
const PI_OVEN_SKILL_TRACE_REASON = "matched by pi-oven runtime keyword whitelist";

interface BranchMessageLike {
  id?: unknown;
  type?: unknown;
  message?: { role?: unknown; content?: unknown };
}

function getLatestUserBranchMessage(
  branchEntries: BranchMessageLike[]
): { id: string; text: string } | null {
  for (let i = branchEntries.length - 1; i >= 0; i--) {
    const entry = branchEntries[i];
    if (entry?.type !== "message") continue;
    if (entry.message?.role !== "user") continue;
    const text = extractTextFromContent(entry.message.content);
    const id = typeof entry.id === "string" && entry.id.length > 0 ? entry.id : String(i);
    return { id, text };
  }
  return null;
}

function getLatestTextUserBranchMessage(
  branchEntries: BranchMessageLike[]
): { id: string; text: string } | null {
  for (let i = branchEntries.length - 1; i >= 0; i--) {
    const entry = branchEntries[i];
    if (entry?.type !== "message") continue;
    if (entry.message?.role !== "user") continue;
    const text = extractTextFromContent(entry.message.content);
    if (text.length === 0) continue;
    const id = typeof entry.id === "string" && entry.id.length > 0 ? entry.id : String(i);
    return { id, text };
  }
  return null;
}

export function extractExplicitForeignAgents(text: string): string[] {
  const matches = text.match(/\b[a-z0-9-]+:[a-z0-9-]+\b/gi) ?? [];
  const seen = new Set<string>();
  const explicitForeignAgents: string[] = [];
  for (const match of matches) {
    const normalized = match.toLowerCase();
    const namespace = normalized.split(":", 1)[0];
    if (namespace === "pi-oven") continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    explicitForeignAgents.push(normalized);
  }
  return explicitForeignAgents;
}

const EXTERNAL_EXEC_CONSENT_PHRASES = new Set([
  "you may execute external commands using local credentials",
  "run the external infra command yourself with local credentials",
  "use my local credentials and execute the external command directly",
  "외부 인프라 명령을 로컬 자격증명으로 직접 실행해",
  "로컬 자격증명으로 외부 명령 직접 실행해",
]);

export function extractExternalExecConsent(
  text: string,
  sourceMessageId: string
): ExternalExecConsent | undefined {
  const structuredMatch = text.match(
    /(?:^|\r?\n)\s*PI_OVEN_EXTERNAL_EXEC:\s*once\s+scope=(all|read|access|mutation)\s+creds=local\s*(?=$|\r?\n)/i
  );
  if (structuredMatch) {
    return {
      sourceMessageId,
      scope: structuredMatch[1].toLowerCase() as ExternalExecConsent["scope"],
      remainingUses: 1,
    };
  }

  const normalizedLines = text
    .split(/\r?\n/)
    .map((line) => line.trim().toLowerCase())
    .filter((line) => line.length > 0);
  if (normalizedLines.some((line) => EXTERNAL_EXEC_CONSENT_PHRASES.has(line))) {
    return {
      sourceMessageId,
      scope: "all",
      remainingUses: 1,
    };
  }

  return undefined;
}

function getRemainingOwnedSkillReadTargets(
  ownedSkillReadTargets: string[] | undefined,
  skillReads: string[] | undefined
): string[] {
  if (!ownedSkillReadTargets || ownedSkillReadTargets.length === 0) return [];
  const readSet = new Set(skillReads ?? []);
  return ownedSkillReadTargets.filter((target) => !readSet.has(target));
}

function buildSkillOwnershipTrace(
  matchedSkills: Array<{ name: string; ownedReadTarget: string }>
) {
  return matchedSkills.map((skill) => ({
    origin: "pi-oven-auto" as const,
    kind: "skill" as const,
    requested: skill.name,
    canonical: skill.ownedReadTarget,
    resolved: skill.ownedReadTarget,
    status: "resolved" as const,
    reason: PI_OVEN_SKILL_TRACE_REASON,
  }));
}

function mergeOwnershipTrace(
  currentTrace: OwnershipTraceEntry[] | undefined,
  skillTrace: OwnershipTraceEntry[],
  sameUserMessage: boolean
): OwnershipTraceEntry[] {
  if (!sameUserMessage) return skillTrace;
  const priorAgentTrace = (currentTrace ?? []).filter((entry) => entry.kind !== "skill");
  return [...skillTrace, ...priorAgentTrace];
}

// ---------------------------------------------------------------------------
// Extension entrypoint
// ---------------------------------------------------------------------------

export default function piOvenPi(
  pi: ExtensionAPI,
  opts?: { pluginRoot?: string }
): void {
  const pluginRoot = opts?.pluginRoot ?? resolvePluginRoot(import.meta.url);
  const agentsDir = path.resolve(pluginRoot, "agents");

  validateAgentRegistry(agentsDir, pi.logger);

  const sessionModelPath = path.resolve(os.homedir(), ".omp/plugins/pi-oven-session-model.json");

  const repoRoot = process.cwd();
  const stateRoot = path.resolve(repoRoot, ".pi-oven");
  const store = new GateStateStore(stateRoot);
  const injector = new RulesInjector();

  // -------------------------------------------------------------------------
  // Setup detection: compute the global and project completion markers as two
  // SEPARATE booleans so session_start can render the always-shown checklist
  // (Spec project-scoped-model-routing §4). A layer is "complete" iff
  // `setupCompletedAt` is a non-empty string in its `.pi-oven/config.json`.
  // Mere installation (agent files present) does NOT count as setup complete.
  // Fail-soft: any FS/parse error → treat as NOT complete so the notice shows.
  const globalConfigPath = path.resolve(os.homedir(), ".pi-oven", "config.json");
  const projectConfigPath = path.resolve(repoRoot, ".pi-oven", "config.json");
  const projectSettingsPath = path.resolve(repoRoot, ".omp", "settings.json");
  const globalComplete = readSetupComplete(globalConfigPath);
  const projectComplete = readSetupComplete(projectConfigPath);
  const projectRoutingRoleCount = countProjectRoutingRoles(projectSettingsPath);

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
  let skillKeywordIndex = [] as ReturnType<typeof loadSkillKeywordIndexReport>["index"];
  let installedTopologyNotice: SetupChecklistNotice | null = null;
  let keywordIntegrityNotice: SetupChecklistNotice | null = null;
  try {
    const keywordIndexReport = loadSkillKeywordIndexReport(pluginRoot);
    skillKeywordIndex = keywordIndexReport.index;
    if (keywordIndexReport.issues.length > 0) {
      keywordIntegrityNotice = buildRuntimeKeywordIntegrityNotice(
        pluginRoot,
        repoRoot,
        keywordIndexReport.issues,
        skillKeywordIndex.length,
        keywordIndexReport.shippedSkillCount
      );
      pi.logger.warn(keywordIntegrityNotice.message);
    } else if (skillKeywordIndex.length === 0) {
      keywordIntegrityNotice = buildRuntimeKeywordIntegrityNotice(
        pluginRoot,
        repoRoot,
        [],
        skillKeywordIndex.length,
        keywordIndexReport.shippedSkillCount
      );
      pi.logger.warn(keywordIntegrityNotice.message);
    } else {
      pi.logger.debug(`pi-oven: loaded skill keyword index (${skillKeywordIndex.length} skills)`);
    }
  } catch (err) {
    installedTopologyNotice = buildRuntimeInstalledTopologyNotice(pluginRoot, repoRoot, err);
    pi.logger.warn(installedTopologyNotice.message);
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

      // Hoisted to the outer handler scope so the SAME boolean drives BOTH the
      // autonomous reminder block and the orchestrator-conduct injection below
      // (parent-only; false for non-parent sessions). Single definition — never
      // re-declared at the injection point.
      let needsAutonomousReminder = false;

      if (isParentSession) {
        const fsm = await store.readState();
        const remainingSkillReadTargets =
          fsm.kind === "OK"
            ? getRemainingOwnedSkillReadTargets(
                fsm.state.ownedSkillReadTargets,
                fsm.state.skillReads
              )
            : effectiveMatchedSkills.map((skill) => skill.ownedReadTarget);
        const reminders: string[] = [];
        const branchContract = await store.readBranchContract();
        needsAutonomousReminder =
          (fsm.kind === "OK" && fsm.state.active) ||
          effectiveMatchedSkills.some((skill) => skill.name === "autonomous-loop");
        if (needsAutonomousReminder) {
          if (branchContract.kind !== "OK") {
            reminders.push(
              "Before code-write, write `.pi-oven/state/branch-contract.json` with `destination`, `branch`, and `pr_mode`."
            );
          }
          if (remainingSkillReadTargets.length > 0) {
            reminders.push(
              `Before code-write, read ${remainingSkillReadTargets.join(", ")}.`
            );
          }
        }
        injector.setReminder(reminders.length > 0 ? reminders.join(" ") : null);
      }

      let systemPrompt = injector.applyToSystemPrompt(event.systemPrompt ?? []);
      if (isParentSession) {
        // Parent-only standing conduct block — placed FIRST (unshifted) so it
        // reads before the discipline/keyword blocks. Reuses the SAME
        // needsAutonomousReminder boolean to relax the WAIT/ASK rules under an
        // active autonomous loop.
        systemPrompt = applyOrchestratorConduct(systemPrompt, injector, {
          isParentSession,
          autonomousActive: needsAutonomousReminder,
        });
        const keywordPrompt = buildKeywordMatchedSkillsPrompt(effectiveMatchedSkills);
        if (
          keywordPrompt !== null &&
          !systemPrompt.some((entry) => entry.includes(KEYWORD_SKILL_DEDUP_KEY))
        ) {
          systemPrompt = [...systemPrompt, keywordPrompt];
        }
        if (
          installedTopologyNotice &&
          !systemPrompt.some((entry) => entry.includes("[WARN] installed topology:"))
        ) {
          systemPrompt = [...systemPrompt, installedTopologyNotice.message];
        }
        if (
          keywordIntegrityNotice &&
          !systemPrompt.some((entry) => entry.includes("[WARN] keyword-skill integrity:"))
        ) {
          systemPrompt = [...systemPrompt, keywordIntegrityNotice.message];
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
      if (uiCtx.hasUI && uiCtx.ui && typeof uiCtx.ui.notify === "function") {
        const notice = buildSetupChecklistNotice(
          globalComplete,
          projectComplete,
          projectRoutingRoleCount
        );
        uiCtx.ui.notify(notice.message, notice.level);
        if (installedTopologyNotice) {
          uiCtx.ui.notify(installedTopologyNotice.message, installedTopologyNotice.level);
        }
        if (keywordIntegrityNotice) {
          uiCtx.ui.notify(keywordIntegrityNotice.message, keywordIntegrityNotice.level);
        }
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
    const branchEntries = ctx.sessionManager.getBranch() as BranchMessageLike[];
    const latestUserMessage = getLatestUserBranchMessage(branchEntries);
    const latestTextUserMessage = getLatestTextUserBranchMessage(branchEntries);
    stopGuardState = updateStopGuardOnTurnStart(stopGuardState, branchEntries);
    skillKeywordState = updateSkillKeywordLoaderOnTurnStart(
      skillKeywordState,
      branchEntries,
      skillKeywordIndex
    );
    await store.mutate((current) => {
      const requiredSkills = skillKeywordState.matchedSkills.map((skill) => skill.name);
      const ownedSkillReadTargets = skillKeywordState.matchedSkills.map(
        (skill) => skill.ownedReadTarget
      );
      const sameUserMessage = current.requiredSkillsMessageId === skillKeywordState.lastUserMessageId;
      const persistedReads = sameUserMessage ? current.skillReads ?? [] : [];
      const extractedExternalExecConsent = latestUserMessage
        ? extractExternalExecConsent(latestUserMessage.text, latestUserMessage.id)
        : undefined;
      const sameConsentMessage = latestUserMessage?.id === current.externalExecConsent?.sourceMessageId;
      const sameConsumedConsentMessage =
        latestUserMessage?.id === current.consumedExternalExecConsentMessageId;
      const externalExecConsent = sameConsentMessage
        ? current.externalExecConsent
        : sameConsumedConsentMessage
          ? undefined
          : latestUserMessage
            ? extractedExternalExecConsent
            : current.externalExecConsent;
      const consumedExternalExecConsentMessageId = sameConsumedConsentMessage
        ? current.consumedExternalExecConsentMessageId
        : latestUserMessage
          ? undefined
          : current.consumedExternalExecConsentMessageId;
      return {
        ...current,
        active: stopGuardState.autonomousActive,
        version: current.version + 1,
        schemaVersion: current.schemaVersion ?? 1,
        requiredSkills,
        skillReads: persistedReads.filter((target) => ownedSkillReadTargets.includes(target)),
        requiredSkillsMessageId: skillKeywordState.lastUserMessageId,
        ownershipTrace: mergeOwnershipTrace(
          current.ownershipTrace,
          buildSkillOwnershipTrace(skillKeywordState.matchedSkills),
          sameUserMessage
        ),
        explicitForeignAgents: latestTextUserMessage
          ? extractExplicitForeignAgents(latestTextUserMessage.text)
          : current.explicitForeignAgents ?? [],
        ownedSkillReadTargets,
        externalExecConsent,
        consumedExternalExecConsentMessageId,
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

  pi.setLabel("pi-oven v0.1.17");
  pi.logger.info("pi-oven loaded");

}
