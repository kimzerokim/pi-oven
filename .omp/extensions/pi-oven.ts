import {
  readdirSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  rmSync,
  statSync,
  existsSync,
} from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { createHash, randomUUID } from "crypto";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import {
  KEYWORD_SKILL_DEDUP_KEY,
  buildKeywordMatchedSkillsPrompt,
  createSkillKeywordLoaderState,
  formatSkillKeywordIndexIssues,
  loadSkillKeywordIndexReport,
  updateSkillKeywordLoaderOnTurnStart,
  type SkillKeywordIndexIssue,
} from "./pi-oven-runtime/skill-keyword-loader";
import {
  DEFAULT_MAX_IMPLICIT_ROOTS,
  ExplicitSkillSafetyCeilingError,
  selectSkillsForTurn,
} from "./pi-oven-runtime/skill-selection";
import {
  BOOTSTRAP_PARITY_TRACK_SIGNAL_NAME,
  buildKeywordSkillIntegritySignal,
  collectStandaloneTruthSignals,
  DUAL_PLUGIN_SURFACE_LABEL,
  extractWorkflowSkillOwnershipClassification,
  formatStandaloneTruthSignals,
  HEALTHY_SINGLE_POV_SURFACE_LABEL,
  WORKFLOW_SKILL_OWNERSHIP_SIGNAL_NAME,
  type WorkflowSkillOwnershipClassification,
} from "../../scripts/pi-oven-setup/standalone-truth-surface";
import {
  isLegacyAgentMarkdownFile,
} from "../../scripts/pi-oven-setup/agent-rewriter";
import {
  ROLE_NAMES,
  canonicalAgentName,
  isRuntimeAgentName,
  type RoleName,
  type RuntimeAgentName,
} from "./pi-oven-runtime/runtime-contract";
import {
  buildSetupReadinessNotice as buildSharedSetupReadinessNotice,
  collectSetupReadiness,
  type SetupReadiness,
} from "../../scripts/pi-oven-setup/project-config";
import {
  STOP_GUARD_MESSAGE,
  classifyDurableExternalToolEffect,
  createStopGuardState,
  decideStopGuardOnTurnEnd,
  extractTextFromContent,
  updateStopGuardOnTurnStart,
} from "./pi-oven-runtime/autonomous-stop-guard";
import {
  RulesInjector,
  ORCHESTRATOR_CONDUCT_DEDUP_KEY,
  resolveRuntimePromptMode,
  type RuntimePromptMode,
} from "./pi-oven-runtime/rules-injector";
import {
  GateStateStore,
  deriveAutonomyOwnershipStatus,
  fingerprintExternalExecSecret,
  matchesAutonomyResumeTarget,
  type AutonomyResumeTarget,
  type ExternalExecConsent,
  type FsmState,
  type OwnershipTraceEntry,
} from "./pi-oven-runtime/gate-state";
import {
  createRuntimeTraceSnapshot,
  type RuntimeTraceSnapshot,
} from "./pi-oven-runtime/trace-primitives";
import {
  decideVerifierDepth,
  deriveVerifierRisk,
  type VerifierDepthDecision,
} from "./pi-oven-runtime/verifier-depth-policy";
import { getCapabilitiesByTag } from "./pi-oven-runtime/capability-registry";
import {
  DEEP_INTERVIEW_CONTRACT_DEDUP_KEY,
  buildDeepInterviewContractPrompt,
} from "./pi-oven-runtime/deep-interview-render";
import { isRearmableContinuationMarker } from "./pi-oven-runtime/continuation-marker";
import {
  normalizeApprovalFlowState,
  normalizeDeepInterviewState,
  type ApprovalFlowState,
  type DeepInterviewState,
} from "./pi-oven-runtime/deep-interview-state";

import { createGateHandler, hasPersistedDeepInterviewState } from "./pi-oven-runtime/gate-handler";
import { registerPiOvenAsk } from "./pi-oven-runtime/pi-oven-ask";
import { resolveLanguage } from "./pi-oven-runtime/language";
import {
  SUPPORTED_SESSION_PROVIDER_FAMILIES,
  type SessionProviderFamily,
} from "./pi-oven-runtime/model-routing-approval";
import { resolveHomePaths } from "../../scripts/lib/home-paths";
import { GateStateLedgerAdapter } from "./pi-oven-runtime/gate-state-ledger-adapter";
import { SqliteRunLedger } from "./pi-oven-runtime/sqlite-run-ledger";
import { createWorkerContextFragments } from "./pi-oven-runtime/context-capsule";
import type { PromptFragment } from "./pi-oven-runtime/prompt-compositor";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SessionProviderFamilyResolution {
  sessionProviderFamily: string | null;
  supportedForRouting: boolean;
  diagnostic?: string;
}

export interface SessionModelCapture extends SessionProviderFamilyResolution {
  model: string;
  capturedAt: number;
}

export type RuntimeRunLedgerMode = "json" | "shadow" | "primary";

export function resolveRuntimeRunLedgerMode(
  value: string | undefined = process.env.PI_OVEN_RUN_LEDGER_MODE
): RuntimeRunLedgerMode {
  if (value === undefined || value === "" || value === "off" || value === "json") return "json";
  if (value === "shadow" || value === "primary") return value;
  throw new Error(
    `invalid PI_OVEN_RUN_LEDGER_MODE=${value}; expected json, shadow, or primary`
  );
}

export function autonomousRunLedgerId(repoRoot: string, branch: string): string {
  return `autonomy:${createHash("sha256").update(`${repoRoot}\0${branch}`).digest("hex").slice(0, 24)}`;
}

export interface SetupChecklistNotice {
  message: string;
  level: "info" | "warning";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const INSTALLED_TOPOLOGY_SIGNAL_NAME = "installed topology";
const RUNTIME_GLOBAL_CONFIG_PATH = "~/.omp/agent/config.yml";
const RUNTIME_INSTALLED_TOPOLOGY_FIX =
  "Restore the plugin assets at that path or reinstall pi-oven@kzk.";

const SUPPORTED_SESSION_PROVIDER_FAMILY_FLAGS: Record<SessionProviderFamily, true> = {
  "openai-codex": true,
};

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


export function buildRuntimeKeywordIntegrityNotice(
  pluginRoot: string,
  projectRoot: string,
  issues: SkillKeywordIndexIssue[],
  loadedCount: number,
  shippedSkillCount: number
): SetupChecklistNotice {
  const detail = buildKeywordSkillIntegritySignal({
    pluginAssetPath: pluginRoot,
    keywordIndexTruth: {
      state: loadedCount === 0 ? "unavailable" : "partial",
      loadedCount,
      shippedSkillCount,
      issues:
        shippedSkillCount === 0 && issues.length === 0
          ? ["plugin.json skills[] did not yield any shipped skills"]
          : [formatSkillKeywordIndexIssues(issues)],
    },
  });
  return {
    level: "warning",
    message: [
      "Standalone truth surface:",
      `  [WARN] keyword-skill integrity: ${detail?.detail ?? "runtime keyword index probe failed."} Project state read from ${projectRoot}; machine-global config remains ${RUNTIME_GLOBAL_CONFIG_PATH}.`,
      `         fix: ${detail?.fix ?? "Reinstall pi-oven@kzk if installed assets are stale."}`,
    ].join("\n"),
  };
}

// ---------------------------------------------------------------------------
// Setup onboarding checklist (Spec project-scoped-model-routing §4)
// ---------------------------------------------------------------------------

/**
 * Build the always-shown setup checklist from routing/prerequisite truth.
 *
 * Receipts in `.pi-oven/config.json` remain metadata only; readiness is derived
 * from live routing + prerequisite state.
 */
export function buildSetupChecklistNotice(
  readiness: SetupReadiness,
  opts?: {
    workflowSkillOwnershipStatus?: WorkflowSkillOwnershipClassification | null;
  }
): SetupChecklistNotice {
  const notice = buildSharedSetupReadinessNotice(readiness);
  const workflowSkillOwnershipStatus = opts?.workflowSkillOwnershipStatus;
  if (!workflowSkillOwnershipStatus) {
    return notice;
  }

  const lines = notice.message.split("\n");
  lines.push(`  ↳ workflow-skill ownership: ${workflowSkillOwnershipStatus}`);
  if (!readiness.projectReady) {
    lines.push("  ↳ repo setup state: missing project routing for this repo");
  } else if (workflowSkillOwnershipStatus === "owned-surface active") {
    lines.push(
      `  ↳ repo setup state: healthy setup — ${HEALTHY_SINGLE_POV_SURFACE_LABEL}`
    );
  } else {
    lines.push(
      `  ↳ repo setup state: ${workflowSkillOwnershipStatus} — not the ${HEALTHY_SINGLE_POV_SURFACE_LABEL}`
    );
  }

  return {
    ...notice,
    message: lines.join("\n"),
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
 * Count canonical `pov:*` keys in `<repoRoot>/.omp/settings.json`
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
    return Object.keys(overrides).filter((k) => k.startsWith("pov:")).length;
  } catch {
    return 0;
  }
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

function extractName(frontmatter: Record<string, unknown>): string | undefined {
  const raw = frontmatter.name;
  return typeof raw === "string" ? raw : undefined;
}

export type AgentRegistryIssueCode =
  | "read-error"
  | "missing-role"
  | "unknown-role"
  | "duplicate-role"
  | "legacy-filename"
  | "frontmatter-name"
  | "missing-model"
  | "invalid-model-provider";

export interface AgentRegistryIssue {
  code: AgentRegistryIssueCode;
  file?: string;
  role?: string;
}

export interface AgentRegistryReport {
  ok: boolean;
  roles: RoleName[];
  issues: AgentRegistryIssue[];
}

function roleTokenFromAgentFile(file: string): string | null {
  const match = file.match(/^(?:pov-|pi-oven-)([a-z][a-z0-9-]*)\.md$/);
  return match?.[1] ?? null;
}

/** Inspect the shipped registry without logging or mutating runtime state. */
export function inspectAgentRegistry(agentsDir: string): AgentRegistryReport {
  const issues: AgentRegistryIssue[] = [];
  let files: string[];
  try {
    files = readdirSync(agentsDir).filter((file) => file.endsWith(".md")).sort();
  } catch {
    return { ok: false, roles: [], issues: [{ code: "read-error" }] };
  }

  const occurrences = new Map<RoleName, string[]>();
  const canonicalRoles = new Set<RoleName>();

  for (const file of files) {
    const roleToken = roleTokenFromAgentFile(file);
    if (roleToken === null || !(ROLE_NAMES as readonly string[]).includes(roleToken)) {
      issues.push({ code: "unknown-role", file, role: roleToken ?? undefined });
      continue;
    }

    const role = roleToken as RoleName;
    const roleFiles = occurrences.get(role) ?? [];
    roleFiles.push(file);
    occurrences.set(role, roleFiles);

    if (isLegacyAgentMarkdownFile(file)) {
      issues.push({ code: "legacy-filename", file, role });
    } else {
      canonicalRoles.add(role);
    }

    let content: string;
    try {
      content = readFileSync(path.join(agentsDir, file), "utf-8");
    } catch {
      issues.push({ code: "read-error", file, role });
      continue;
    }
    const frontmatter = parseFrontmatter(content);
    if (extractName(frontmatter) !== canonicalAgentName(role)) {
      issues.push({ code: "frontmatter-name", file, role });
    }
    const models = extractModels(frontmatter);
    if (models.length === 0) {
      issues.push({ code: "missing-model", file, role });
    } else if (models.some((modelId) => !modelId.startsWith("openai-codex/"))) {
      issues.push({ code: "invalid-model-provider", file, role });
    }
  }

  for (const role of ROLE_NAMES) {
    const roleFiles = occurrences.get(role) ?? [];
    if (!canonicalRoles.has(role)) {
      issues.push({ code: "missing-role", role });
    }
    if (roleFiles.length > 1) {
      issues.push({ code: "duplicate-role", role });
    }
  }

  const roles = ROLE_NAMES.filter((role) => canonicalRoles.has(role));
  return { ok: issues.length === 0, roles: [...roles], issues };
}

export class AgentRegistryError extends Error {
  constructor(readonly report: AgentRegistryReport) {
    super(
      `pi-oven: invalid agent registry: ${report.issues
        .map((issue) =>
          [issue.code, issue.file && `file=${issue.file}`, issue.role && `role=${issue.role}`]
            .filter(Boolean)
            .join(" ")
        )
        .join("; ")}`
    );
    this.name = "AgentRegistryError";
  }
}

/** Fail closed before any runtime handler is wired. */
export function assertAgentRegistry(agentsDir: string): void {
  const report = inspectAgentRegistry(agentsDir);
  if (!report.ok) throw new AgentRegistryError(report);
}

// ---------------------------------------------------------------------------
// Agent mirror sync + session model capture helpers
// ---------------------------------------------------------------------------

/**
 * Derive the runtime-visible provider family from the captured parent session
 * model id. This is the execution SoT for provider-family-aware runtime paths.
 */
export function resolveSessionProviderFamily(modelId: string): SessionProviderFamilyResolution {
  const normalizedModelId = modelId.trim();
  const slashIdx = normalizedModelId.indexOf("/");
  if (slashIdx <= 0) {
    return {
      sessionProviderFamily: null,
      supportedForRouting: false,
      diagnostic: `Could not derive current session provider family from session model "${modelId}".`,
    };
  }

  const sessionProviderFamily = normalizedModelId.slice(0, slashIdx).trim().toLowerCase();
  if (!sessionProviderFamily) {
    return {
      sessionProviderFamily: null,
      supportedForRouting: false,
      diagnostic: `Could not derive current session provider family from session model "${modelId}".`,
    };
  }

  if (SUPPORTED_SESSION_PROVIDER_FAMILY_FLAGS[sessionProviderFamily as SessionProviderFamily]) {
    return {
      sessionProviderFamily: sessionProviderFamily as SessionProviderFamily,
      supportedForRouting: true,
    };
  }

  return {
    sessionProviderFamily,
    supportedForRouting: false,
    diagnostic:
      `Current session provider family "${sessionProviderFamily}" is unsupported for runtime routing. ` +
      `Supported families: ${SUPPORTED_SESSION_PROVIDER_FAMILIES.join(", ")}.`,
  };
}

/**
 * Writes the parent session model to a JSON file for use by CLI scripts.
 * Spec B §6 Step a.5 / §9.6.
 * Throws on FS error — caller is responsible for catching.
 */
export async function captureSessionModel(
  modelId: string,
  targetPath: string
): Promise<void> {
  const providerFamily = resolveSessionProviderFamily(modelId);
  const data: SessionModelCapture = {
    model: modelId,
    ...providerFamily,
    capturedAt: Date.now(),
  };
  mkdirSync(path.dirname(targetPath), { recursive: true });
  // Ensure parent directory exists before writing session capture
  writeFileSync(targetPath, JSON.stringify(data, null, 2), "utf-8");
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
  const existingIndex = systemPrompt.findIndex((entry) =>
    entry.includes(ORCHESTRATOR_CONDUCT_DEDUP_KEY)
  );
  if (existingIndex >= 0) {
    return [
      systemPrompt[existingIndex]!,
      ...systemPrompt.filter((_entry, index) => index !== existingIndex),
    ];
  }
  return [
    injector.buildOrchestratorConductBlock({ autonomousActive: opts.autonomousActive }),
    ...systemPrompt,
  ];
}

export function resolveWorkerRuntimeRole(value: string | undefined): RuntimeAgentName {
  if (isRuntimeAgentName(value)) return value;
  if (value && (ROLE_NAMES as readonly string[]).includes(value)) {
    return canonicalAgentName(value as RoleName);
  }
  throw new Error(
    `pi-oven worker context requires PI_BLOCKED_AGENT to name a canonical pov role; received ${value ?? "unset"}`
  );
}

function promptFragment(
  id: string,
  dedupKey: string,
  content: string,
  options: { priority: number; required: boolean }
): PromptFragment {
  return {
    id,
    audience: "parent",
    phase: "always",
    priority: options.priority,
    required: options.required,
    dedupKey,
    render: () => content,
  };
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

const EXPLICIT_FOREIGN_AGENT_NEGATION_CONTEXT =
  /\b(?:do\s+not|don't|dont|never|avoid|without|instead of|rather than)\b[^.!?\n;]*$/;
const EXPLICIT_FOREIGN_AGENT_ILLUSTRATIVE_CONTEXT =
  /\b(?:example|examples|for example|e\.g\.|such as)\b[^.!?\n;]*$/;

function shouldSuppressExplicitForeignAgentMention(text: string, matchIndex: number): boolean {
  const clauseStart = Math.max(
    text.lastIndexOf(".", matchIndex - 1),
    text.lastIndexOf("!", matchIndex - 1),
    text.lastIndexOf("?", matchIndex - 1),
    text.lastIndexOf(";", matchIndex - 1),
    text.lastIndexOf("\n", matchIndex - 1)
  );
  const clause = text.slice(clauseStart + 1, matchIndex).toLowerCase();
  if (clause.trim().length === 0) return false;
  return (
    EXPLICIT_FOREIGN_AGENT_NEGATION_CONTEXT.test(clause) ||
    EXPLICIT_FOREIGN_AGENT_ILLUSTRATIVE_CONTEXT.test(clause)
  );
}

export function extractExplicitForeignAgents(text: string): string[] {
  const seen = new Set<string>();
  const explicitForeignAgents: string[] = [];
  for (const match of text.matchAll(/\b[a-z0-9-]+:[a-z0-9-]+\b/gi)) {
    const requested = match[0];
    if (!requested) continue;
    if (shouldSuppressExplicitForeignAgentMention(text, match.index ?? 0)) continue;
    const normalized = requested.toLowerCase();
    const namespace = normalized.split(":", 1)[0];
    if (namespace === "pi-oven" || namespace === "pov") continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    explicitForeignAgents.push(normalized);
  }
  return explicitForeignAgents;
}

const EXTERNAL_EXEC_SCOPE_VALUES = new Set<ExternalExecConsent["scope"]>([
  "all",
  "read",
  "access",
  "mutation",
]);
const TEMP_ACCESS_KEY_FIELD_NAMES = ["accesskeyid", "awsaccesskeyid"] as const;
const TEMP_SECRET_ACCESS_KEY_FIELD_NAMES = ["secretaccesskey", "awssecretaccesskey"] as const;
const TEMP_SESSION_TOKEN_FIELD_NAMES = ["sessiontoken", "awssessiontoken"] as const;
const TEMP_EXPIRY_FIELD_NAMES = ["expiresat", "expiration", "expiry"] as const;
const EXTERNAL_EXEC_SCOPE_FIELD_NAMES = ["scope"] as const;
const EXTERNAL_EXEC_CREDS_FIELD_NAMES = ["creds"] as const;

function normalizeExternalExecFieldName(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function stripOptionalQuotes(value: string): string {
  if (
    value.length >= 2 &&
    ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'")))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function buildStructuredExternalExecFieldPattern(name: string): RegExp {
  const normalizedName = normalizeExternalExecFieldName(name);
  const flexibleName = normalizedName
    .split("")
    .map((char) => char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("[^a-z0-9]*");
  return new RegExp(
    `\\b${flexibleName}\\s*[:=]\\s*("(?:[^"\\\\]|\\\\.)*"|'(?:[^'\\\\]|\\\\.)*'|[^\\s]+)`,
    "i"
  );
}

function getStructuredFieldValue(text: string, candidates: readonly string[]): string | undefined {
  for (const name of candidates) {
    const value = buildStructuredExternalExecFieldPattern(name).exec(text)?.[1];
    if (value && value.length > 0) return stripOptionalQuotes(value);
  }
  return undefined;
}

function parseExternalExecExpiry(raw: string | undefined): number | null {
  if (!raw) return null;
  if (/^\d+$/.test(raw)) {
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return null;
    return raw.length <= 10 ? parsed * 1000 : parsed;
  }
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

const EXTERNAL_EXEC_APPROVAL_PATTERNS: ReadonlyArray<RegExp> = [
  /(?:^|[\n.!?]\s*)(?:you may|you can|please|go ahead(?: and)?|proceed(?: with| and)?|use (?:my|this)|run|execute)\b/i,
  /(?:^|[\n.!?]\s*)(?:직접 실행해|직접 돌려|실행해도 돼|실행해줘)/u,
];
const EXTERNAL_EXEC_DENIAL_PATTERNS: ReadonlyArray<RegExp> = [
  /\b(?:don't|dont|do not|never)\b[^.!?\n]{0,80}\b(?:run|execute|use|inspect|read|access|allow|approve)\b/i,
  /\bno\b[^.!?\n]{0,80}\b(?:direct|external|local credentials?|temporary aws|aws credential bundle)\b/i,
  /(?:직접|외부|로컬 자격증명|로컬 인증|임시 AWS)[^.!?\n]{0,40}(?:하지\s*마|하지마|쓰지\s*마|쓰지마|사용하지\s*마|사용하지마|실행하지\s*마|실행하지마|안\s*돼|안돼|허용하지\s*마|허용하지마|허용하지\s*않|승인하지\s*마|승인하지마|승인하지\s*않|금지)/u,
  /(?:하지\s*마|하지마|쓰지\s*마|쓰지마|사용하지\s*마|사용하지마|실행하지\s*마|실행하지마|안\s*돼|안돼|허용하지\s*마|허용하지마|허용하지\s*않|승인하지\s*마|승인하지마|승인하지\s*않|금지)[^.!?\n]{0,40}(?:직접|외부|로컬 자격증명|로컬 인증|임시 AWS)/u,
];
const DIRECT_EXTERNAL_TARGET_PATTERNS: ReadonlyArray<RegExp> = [
  /\b(?:direct|directly|external|yourself)\b/i,
  /(?:직접|외부)/u,
];
const LOCAL_CREDENTIAL_PATTERNS: ReadonlyArray<RegExp> = [
  /\blocal credentials?\b/i,
  /\blocal credential files?\b/i,
  /(?:로컬 자격증명|로컬 인증)/u,
];
const ALL_SCOPE_PATTERNS: ReadonlyArray<RegExp> = [
  /\ball direct external commands?\b/i,
  /\ball scopes?\b/i,
  /\bscope\s+all\b/i,
  /(?:모든 외부 명령|전체 범위)/u,
];
const READ_SCOPE_PATTERNS: ReadonlyArray<RegExp> = [/\bread\b/i, /\bread-only\b/i, /(?:읽기|조회)/u];
const ACCESS_SCOPE_PATTERNS: ReadonlyArray<RegExp> = [
  /\baccess\b/i,
  /\bexternal session\b/i,
  /(?:접근|세션)/u,
];
const MUTATION_SCOPE_PATTERNS: ReadonlyArray<RegExp> = [
  /\bmutation\b/i,
  /\bmutat(?:e|ing)\b/i,
  /(?:변경|수정|삭제|생성)/u,
];

function detectNaturalExternalExecScope(
  text: string
): ExternalExecConsent["scope"] | undefined {
  const matches: ExternalExecConsent["scope"][] = [];
  if (ALL_SCOPE_PATTERNS.some((pattern) => pattern.test(text))) matches.push("all");
  if (READ_SCOPE_PATTERNS.some((pattern) => pattern.test(text))) matches.push("read");
  if (ACCESS_SCOPE_PATTERNS.some((pattern) => pattern.test(text))) matches.push("access");
  if (MUTATION_SCOPE_PATTERNS.some((pattern) => pattern.test(text))) matches.push("mutation");
  return matches.length === 1 ? matches[0] : undefined;
}


export function extractExternalExecConsent(
  text: string,
  sourceMessageId: string
): ExternalExecConsent | undefined {
  const scopeRaw = getStructuredFieldValue(text, EXTERNAL_EXEC_SCOPE_FIELD_NAMES)?.toLowerCase();
  const scope =
    scopeRaw && EXTERNAL_EXEC_SCOPE_VALUES.has(scopeRaw as ExternalExecConsent["scope"])
      ? (scopeRaw as ExternalExecConsent["scope"])
      : detectNaturalExternalExecScope(text);
  const hasStructuredApproval = /^\s*PI_OVEN_EXTERNAL_EXEC:/im.test(text);
  const mentionsDirectExternalTarget = DIRECT_EXTERNAL_TARGET_PATTERNS.some((pattern) => pattern.test(text));
  const hasExplicitDenial = EXTERNAL_EXEC_DENIAL_PATTERNS.some((pattern) => pattern.test(text));
  const hasNaturalApproval =
    mentionsDirectExternalTarget &&
    EXTERNAL_EXEC_APPROVAL_PATTERNS.some((pattern) => pattern.test(text));
  const hasNaturalDenial = mentionsDirectExternalTarget && hasExplicitDenial;
  const accessKeyId = getStructuredFieldValue(text, TEMP_ACCESS_KEY_FIELD_NAMES);
  const secretAccessKey = getStructuredFieldValue(text, TEMP_SECRET_ACCESS_KEY_FIELD_NAMES);
  const sessionToken = getStructuredFieldValue(text, TEMP_SESSION_TOKEN_FIELD_NAMES);
  const expiresAt = parseExternalExecExpiry(getStructuredFieldValue(text, TEMP_EXPIRY_FIELD_NAMES));
  const hasValidTemporaryAwsBundle =
    accessKeyId !== undefined &&
    /^ASIA[0-9A-Z]{12,}$/i.test(accessKeyId) &&
    secretAccessKey !== undefined &&
    sessionToken !== undefined &&
    expiresAt != null &&
    Date.now() < expiresAt;
  const hasBundleAutoAcceptDenial = hasValidTemporaryAwsBundle && hasExplicitDenial;
  const tempScope = scope ?? "access";
  const tempScopeAutoAllowed = tempScope === "read" || tempScope === "access";
  if (
    hasValidTemporaryAwsBundle &&
    !hasBundleAutoAcceptDenial &&
    (tempScopeAutoAllowed || hasStructuredApproval || hasNaturalApproval)
  ) {
    return {
      sourceMessageId,
      scope: tempScope,
      remainingUses: 1,
      tempCredentials: {
        provider: "aws",
        accessKeyId: accessKeyId.toUpperCase(),
        sessionTokenFingerprint: fingerprintExternalExecSecret(sessionToken),
        secretAccessKeyFingerprint: fingerprintExternalExecSecret(secretAccessKey),
        expiresAt,
      },
    };
  }

  if (!scope || (!hasStructuredApproval && (!hasNaturalApproval || hasNaturalDenial))) {
    return undefined;
  }

  const creds = getStructuredFieldValue(text, EXTERNAL_EXEC_CREDS_FIELD_NAMES)?.toLowerCase();
  const localCredentialConsent =
    creds === "local" || LOCAL_CREDENTIAL_PATTERNS.some((pattern) => pattern.test(text));
  if (localCredentialConsent && (scope === "read" || scope === "access")) {
    return {
      sourceMessageId,
      scope,
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

export const AUTONOMOUS_LOOP_PUBLIC_SKILL_NAME = "pov:autonomous-loop";

export function shouldEnableAutonomousReminder(
  activeFsm: boolean,
  matchedSkills: Array<{ name: string }>
): boolean {
  if (activeFsm) return true;
  for (const skill of matchedSkills) {
    if (skill.name === AUTONOMOUS_LOOP_PUBLIC_SKILL_NAME) return true;
  }
  return false;
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

function readCurrentRepoBranch(repoRoot: string): string {
  const gitPath = path.join(repoRoot, ".git");
  try {
    const gitStat = statSync(gitPath);
    const headPath = (() => {
      if (gitStat.isDirectory()) {
        return path.join(gitPath, "HEAD");
      }
      const gitDirRef = readFileSync(gitPath, "utf-8").trim();
      const match = gitDirRef.match(/^gitdir:\s*(.+)$/i);
      if (!match) return null;
      return path.resolve(repoRoot, match[1].trim(), "HEAD");
    })();
    if (!headPath || !existsSync(headPath)) return "(unknown)";
    const head = readFileSync(headPath, "utf-8").trim();
    const match = head.match(/^ref:\s+refs\/heads\/(.+)$/);
    return match?.[1]?.trim() || "(unknown)";
  } catch {
    return "(unknown)";
  }
}

function buildAutonomyResumeTarget(
  repoRoot: string,
  capturedAt: string = new Date().toISOString()
): AutonomyResumeTarget {
  return {
    repoRoot,
    branch: readCurrentRepoBranch(repoRoot),
    capturedAt,
  };
}

function buildSessionStartAutonomyReplay(state: FsmState): {
  message: Record<string, unknown>;
  options?: { deliverAs: "nextTurn"; triggerTurn: true };
} | null {
  if (
    state.blockedReason &&
    state.nextAction &&
    state.blockedReason.kind !== "verifier-pending"
  ) {
    const ownershipStatus =
      state.ownershipStatus ??
      deriveAutonomyOwnershipStatus(state.requiredSkills, state.ownedSkillReadTargets);
    return {
      message: {
        customType: "pi-oven-autonomous-blocked-state",
        content: [
          {
            type: "text",
            text: [
              "pi-oven resumed the last blocked autonomy state for this repo/branch.",
              `Ownership status: ${ownershipStatus}`,
              `Blocked reason: ${state.blockedReason.message}`,
              `Next action: ${state.nextAction.message}`,
            ].join("\n"),
          },
        ],
        display: true,
        details: {
          ownershipStatus,
          blockedReason: state.blockedReason.kind,
          nextAction: state.nextAction.kind,
          resumeTarget: state.resumeTarget,
        },
      },
    };
  }
  if (isRearmableContinuationMarker(state.continuationMarker)) {
    const reason =
      state.continuationMarker.kind === "autonomous-loop-resume"
        ? state.continuationMarker.trigger
        : "verifier-pending";
    const text =
      state.continuationMarker.kind === "verifier-pending"
        ? `${STOP_GUARD_MESSAGE}
${state.nextAction?.message ?? "Run the deep verifier lane before exit."}`
        : STOP_GUARD_MESSAGE;
    return {
      message: {
        customType: "pi-oven-autonomous-stop-guard",
        content: [{ type: "text", text }],
        display: true,
        details: {
          reason,
          blockedReason: state.blockedReason?.kind,
          nextAction: state.nextAction?.kind,
          resumeTarget: state.resumeTarget,
        },
      },
      options: { deliverAs: "nextTurn", triggerTurn: true },
    };
  }
  if (state.blockedReason && state.nextAction) {
    const ownershipStatus =
      state.ownershipStatus ??
      deriveAutonomyOwnershipStatus(state.requiredSkills, state.ownedSkillReadTargets);
    return {
      message: {
        customType: "pi-oven-autonomous-blocked-state",
        content: [
          {
            type: "text",
            text: [
              "pi-oven resumed the last blocked autonomy state for this repo/branch.",
              `Ownership status: ${ownershipStatus}`,
              `Blocked reason: ${state.blockedReason.message}`,
              `Next action: ${state.nextAction.message}`,
            ].join("\n"),
          },
        ],
        display: true,
        details: {
          ownershipStatus,
          blockedReason: state.blockedReason.kind,
          nextAction: state.nextAction.kind,
          resumeTarget: state.resumeTarget,
        },
      },
    };
  }
  return null;
}

function buildSessionStartSetupNoticeKey(event: unknown, repoRoot: string): string {
  if (isRecord(event)) {
    const sessionId = event.sessionId;
    if (typeof sessionId === "string" && sessionId.length > 0) {
      return `${repoRoot}::${sessionId}`;
    }
  }
  return `${repoRoot}::session-start`;
}

function getSessionStartNotifier(
  ctx: unknown
): ((message: string, level: "info" | "warning") => void) | null {
  if (!isRecord(ctx) || ctx.hasUI !== true || !isRecord(ctx.ui)) {
    return null;
  }
  const { notify } = ctx.ui;
  if (typeof notify !== "function") {
    return null;
  }
  return (message, level) => notify(message, level);
}

function getSessionStartModel(ctx: unknown): unknown | null {
  if (!isRecord(ctx) || typeof ctx.getModel !== "function") {
    return null;
  }
  return ctx.getModel();
}

function getSessionStartPreserveData(event: unknown): Record<string, unknown> | null {
  if (!isRecord(event) || !isRecord(event.preserveData)) {
    return null;
  }
  return event.preserveData;
}

function stringifySessionModelId(activeModel: unknown): string {
  if (typeof activeModel === "string") {
    return activeModel;
  }
  if (isRecord(activeModel) && typeof activeModel.id === "string") {
    return activeModel.id;
  }
  return String(activeModel);
}

export function emitSessionStartSetupNotice(
  notify: (message: string, level: "info" | "warning") => void,
  event: unknown,
  repoRoot: string,
  readiness: SetupReadiness,
  truthSignals: Array<{ name: string; detail: string; level: "INFO" | "WARN" }>,
  emittedKeys: Set<string>
): void {
  const noticeKey = buildSessionStartSetupNoticeKey(event, repoRoot);
  if (emittedKeys.has(noticeKey)) {
    return;
  }
  const workflowSkillOwnershipStatus = extractWorkflowSkillOwnershipClassification(
    truthSignals.find((signal) => signal.name === WORKFLOW_SKILL_OWNERSHIP_SIGNAL_NAME)?.detail ?? ""
  );
  const notice = buildSetupChecklistNotice(readiness, {
    workflowSkillOwnershipStatus,
  });
  notify(notice.message, notice.level);
  emittedKeys.add(noticeKey);
}

function notifySessionStartTruthSignals(
  notify: (message: string, level: "info" | "warning") => void,
  truthSignals: Array<{ name: string; detail: string; level: "INFO" | "WARN" }>
): void {
  for (const signal of truthSignals) {
    notify(
      formatStandaloneTruthSignals([signal]).join("\n"),
      signal.level === "WARN" ? "warning" : "info"
    );
  }
}

function notifySessionStartAuxiliaryNotice(
  notify: (message: string, level: "info" | "warning") => void,
  notice: SetupChecklistNotice | null
): void {
  if (!notice) {
    return;
  }
  notify(notice.message, notice.level);
}

function isSessionTruthSignal(
  signal: { name: string }
): signal is { name: string; detail: string; level: "INFO" | "WARN" } {
  return shouldNotifySessionStartTruthSignal(signal.name);
}

export function shouldNotifySessionStartTruthSignal(name: string): boolean {
  return (
    name === WORKFLOW_SKILL_OWNERSHIP_SIGNAL_NAME ||
    name === BOOTSTRAP_PARITY_TRACK_SIGNAL_NAME
  );
}

// ---------------------------------------------------------------------------
// Extension entrypoint
// ---------------------------------------------------------------------------

export default function piOvenPi(
  pi: ExtensionAPI,
  opts?: {
    pluginRoot?: string;
    runLedgerMode?: RuntimeRunLedgerMode;
    runLedgerOwnerId?: string;
    promptMode?: RuntimePromptMode;
  }
): void {
  const pluginRoot = opts?.pluginRoot ?? resolvePluginRoot(import.meta.url);
  const agentsDir = path.resolve(pluginRoot, "agents");

  assertAgentRegistry(agentsDir);
  const homePaths = resolveHomePaths();

  const sessionModelPath = path.resolve(
    homePaths.ompConfigRoot,
    "plugins/pi-oven-session-model.json"
  );

  const repoRoot = process.cwd();
  const stateRoot = path.resolve(repoRoot, ".pi-oven");
  const runLedgerMode = opts?.runLedgerMode ?? resolveRuntimeRunLedgerMode();
  const promptMode = opts?.promptMode ?? resolveRuntimePromptMode();
  const currentBranch = readCurrentRepoBranch(repoRoot);
  const runLedgerId = autonomousRunLedgerId(repoRoot, currentBranch);
  let ledgerAdapter: GateStateLedgerAdapter | undefined;
  const store: GateStateStore = (() => {
    if (runLedgerMode === "json") return new GateStateStore(stateRoot);
    const ledger = new SqliteRunLedger(
      path.resolve(stateRoot, "state", "run-ledger.sqlite")
    );
    ledgerAdapter = new GateStateLedgerAdapter(stateRoot, ledger, {
      runId: runLedgerId,
      ownerId: opts?.runLedgerOwnerId ?? `${process.pid}:${randomUUID()}`,
      repoRoot,
      branch: currentBranch,
      readSource: runLedgerMode === "primary" ? "ledger" : "json",
      writeTarget: "shadow",
      jsonFallbackRead: runLedgerMode === "primary",
    });
    pi.logger.info(
      `pi-oven: autonomous run ledger ${runLedgerMode} mode — ${ledgerAdapter.ledgerHealth().detail}`
    );
    return ledgerAdapter;
  })();
  const injector = new RulesInjector();

  // -------------------------------------------------------------------------
  // Project/global `.pi-oven/config.json` remain the language + metadata store.
  // Setup readiness no longer trusts `setupCompletedAt`; session_start now reads
  // live routing + prerequisite facts through `collectSetupReadiness`.
  const globalConfigPath = path.resolve(homePaths.piOvenConfigDir, "config.json");
  const projectConfigPath = path.resolve(repoRoot, ".pi-oven", "config.json");

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
  const workerRuntimeRole = isParentSession
    ? undefined
    : resolveWorkerRuntimeRole(process.env.PI_BLOCKED_AGENT);
  let skillKeywordState = createSkillKeywordLoaderState();
  let skillKeywordIndex = [] as ReturnType<typeof loadSkillKeywordIndexReport>["index"];
  let installedTopologyNotice: SetupChecklistNotice | null = null;
  let keywordIntegrityNotice: SetupChecklistNotice | null = null;
  const emittedSessionStartSetupNoticeKeys = new Set<string>();
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
  let runtimeTraceState = { trace: createRuntimeTraceSnapshot(), cachedFsm: undefined };
  let runtimeTrace: RuntimeTraceSnapshot = runtimeTraceState.trace;
  let verifierDepth: VerifierDepthDecision = decideVerifierDepth({
    mode: "interactive",
    risk: deriveVerifierRisk({ mutationScope: "none", materialEdit: false }),
    mutationScope: "none",
    materialEdit: false,
  });

  const syncRuntimeTrace = (
    trace: RuntimeTraceSnapshot,
    nextVerifierDepth?: VerifierDepthDecision
  ) => {
    runtimeTraceState.trace = trace;
    runtimeTrace = trace;
    verifierDepth =
      nextVerifierDepth ??
      decideVerifierDepth({
        mode: stopGuardState.autonomousActive ? "autonomous" : "interactive",
        risk: deriveVerifierRisk({
          mutationScope: trace.mutationScope,
          materialEdit: trace.materialEdit,
        }),
        mutationScope: trace.mutationScope,
        materialEdit: trace.materialEdit,
      });
  };

  const gateHandler = createGateHandler({
    store,
    logger: pi.logger,
    getEnv: () => process.env,
    getAutonomyResumeTarget: async () => buildAutonomyResumeTarget(repoRoot),
    isParentSession,
    roots: { repoRoot, homeDir: homePaths.homeDir },
    runtimeTraceState,
    onRuntimeContractUpdate: (update) => {
      syncRuntimeTrace(update.trace, update.verifierDepth);
    },
  });

  pi.on("tool_call", async (event) => {
    try {
      const gateResult = await gateHandler(event as never);
      if (
        ledgerAdapter &&
        stopGuardState.autonomousActive &&
        !(gateResult as { block?: boolean } | undefined)?.block
      ) {
        const toolEvent = event as unknown as {
          toolCallId: string;
          toolName: string;
          input: Record<string, unknown>;
        };
        const durableEffect = classifyDurableExternalToolEffect(
          toolEvent.toolName,
          toolEvent.input,
          { repoRoot, homeDir: homePaths.homeDir }
        );
        if (durableEffect) {
          const idempotencyKey = `tool:${toolEvent.toolCallId}`;
          const existing = ledgerAdapter.readEffect(idempotencyKey);
          if (existing) {
            return {
              block: true,
              reason:
                existing.status === "completed"
                  ? `pi-oven: external mutation ${idempotencyKey} already has a completion receipt; duplicate execution blocked.`
                  : `pi-oven: external mutation ${idempotencyKey} has ${existing.status} state; reconcile the live target before retry.`,
            };
          }
          ledgerAdapter.beginEffect({
            idempotencyKey,
            kind: durableEffect.kind,
            target: durableEffect.target,
            intent: durableEffect.intent,
          });
        }
      }
      return gateResult;
    } catch (err) {
      pi.logger.warn(`pi-oven: gate handler self-deadline / fault — fail-closed: ${err}`);
      throw err;
    }
  });

  if (ledgerAdapter) {
    pi.on("tool_result", async (event) => {
      const toolEvent = event as unknown as {
        toolCallId: string;
        toolName: string;
        input: Record<string, unknown>;
        content?: unknown;
        isError?: boolean;
      };
      const idempotencyKey = `tool:${toolEvent.toolCallId}`;
      if (!ledgerAdapter?.readEffect(idempotencyKey)) return;
      if (toolEvent.isError) {
        ledgerAdapter.markEffectAmbiguous(idempotencyKey, {
          reason: "tool result reported an error after external mutation intent",
        });
        return;
      }
      const outputHash = createHash("sha256")
        .update(JSON.stringify(toolEvent.content ?? null))
        .digest("hex");
      ledgerAdapter.completeEffect({
        idempotencyKey,
        status: "completed",
        result: { outputHash },
      });
    });

    pi.on("session_shutdown", async () => {
      await ledgerAdapter?.close();
    });
  }

  pi.on("before_agent_start", async (event) => {
    try {
      const promptSelection = selectSkillsForTurn({
        latestUserText: event.prompt ?? "",
        index: skillKeywordIndex,
        maxImplicitRoots: DEFAULT_MAX_IMPLICIT_ROOTS,
      });
      const hasPromptSelection =
        (promptSelection.explicit.length > 0 ||
          promptSelection.implicitRoot.length > 0 ||
          promptSelection.deferred.length > 0 ||
          promptSelection.dropped.length > 0);
      const promptRootSkills = [...promptSelection.explicit, ...promptSelection.implicitRoot];
      const effectiveMatchedSkills = hasPromptSelection
        ? promptRootSkills
        : skillKeywordState.matchedSkills;
      const effectiveDeferredSkillObligations =
        hasPromptSelection
          ? promptSelection.deferred
          : skillKeywordState.deferredSkillObligations;

      // Hoisted to the outer handler scope so the SAME boolean drives BOTH the
      // autonomous reminder block and the orchestrator-conduct injection below
      // (parent-only; false for non-parent sessions). Single definition — never
      // re-declared at the injection point.
      let needsAutonomousReminder = false;
      let persistedDeepInterviewState: DeepInterviewState | undefined;
      let persistedApprovalFlow: ApprovalFlowState | undefined;

      if (isParentSession) {
        const fsm = await store.readState();
        if (fsm.kind === "OK") {
          const fsmRecord = fsm.state as unknown as Record<string, unknown>;
          if (fsmRecord.deepInterview !== undefined) {
            const normalized = normalizeDeepInterviewState(fsmRecord.deepInterview);
            if (hasPersistedDeepInterviewState(normalized)) {
              persistedDeepInterviewState = normalized;
            }
          }
          persistedApprovalFlow = normalizeApprovalFlowState(
            fsmRecord.approvalFlow,
            persistedDeepInterviewState
          );
        }
        

        const remainingSkillReadTargets =
          fsm.kind === "OK"
            ? getRemainingOwnedSkillReadTargets(
                fsm.state.ownedSkillReadTargets,
                fsm.state.skillReads
              )
            : effectiveMatchedSkills.map((skill) => skill.ownedReadTarget);
        const reminders: string[] = [];
        const branchContract = await store.readBranchContract();
        needsAutonomousReminder = shouldEnableAutonomousReminder(
          fsm.kind === "OK" && fsm.state.active,
          effectiveMatchedSkills
        );
        if (needsAutonomousReminder) {
          if (branchContract.kind !== "OK") {
            reminders.push(
              "Before code-write, satisfy the control-plane front door by writing `.pi-oven/state/branch-contract.json` with `destination`, `branch`, and `pr_mode`."
            );
          }
          if (remainingSkillReadTargets.length > 0) {
            reminders.push(
              "Before code-write, complete the skill capability proof surface: " +
                `read ${remainingSkillReadTargets.join(", ")} so ` +
                "`requiredSkills` + `ownedSkillReadTargets` can be proven through `skillReads`."
            );
          }
        }
        injector.setReminder(reminders.length > 0 ? reminders.join(" ") : null);
      }

      if (!isParentSession) {
        const workerRole = workerRuntimeRole!;
        const selectedSkillTargets = [
          ...effectiveMatchedSkills.map((skill) => skill.ownedReadTarget),
          ...effectiveDeferredSkillObligations.map((skill) => skill.ownedReadTarget),
        ];
        const composition = injector.composeSystemPrompt({
          systemPrompt: event.systemPrompt ?? [],
          audience: "worker",
          includeDiscipline: false,
          includeLanguage: false,
          includeProjectInstructions: false,
          mode: promptMode,
          additionalFragments: createWorkerContextFragments({
            role: workerRole,
            assignment: event.prompt ?? "",
            selectedSkillTargets,
            phase: injector.getPromptPhase(),
          }),
        });
        pi.logger.debug(
          `pi-oven: prompt composition ${promptMode} receipt ${JSON.stringify(composition.receipt)}`
        );
        return { systemPrompt: composition.systemPrompt };
      }

      const additionalFragments: PromptFragment[] = [];
      if (isParentSession) {
        const keywordPrompt = buildKeywordMatchedSkillsPrompt(
          effectiveMatchedSkills,
          effectiveDeferredSkillObligations
        );
        if (keywordPrompt !== null) {
          additionalFragments.push(promptFragment(
            "keyword-skills",
            KEYWORD_SKILL_DEDUP_KEY,
            keywordPrompt,
            { priority: 75, required: true }
          ));
        }
        if (installedTopologyNotice) {
          additionalFragments.push(promptFragment(
            "installed-topology-notice",
            "[WARN] installed topology:",
            installedTopologyNotice.message,
            { priority: 20, required: false }
          ));
        }
        if (keywordIntegrityNotice) {
          additionalFragments.push(promptFragment(
            "keyword-integrity-notice",
            "[WARN] keyword-skill integrity:",
            keywordIntegrityNotice.message,
            { priority: 21, required: false }
          ));
        }
        const hasPendingApprovalFlow =
          persistedApprovalFlow?.status === "pending" || persistedApprovalFlow?.active === true;
        const shouldInjectDeepInterviewContract =
          getCapabilitiesByTag("deep-interview").includes("ask") &&
          (effectiveMatchedSkills.length > 0 ||
            persistedDeepInterviewState !== undefined ||
            hasPendingApprovalFlow);
        if (shouldInjectDeepInterviewContract) {
          additionalFragments.push(promptFragment(
            "deep-interview-contract",
            DEEP_INTERVIEW_CONTRACT_DEDUP_KEY,
            buildDeepInterviewContractPrompt(persistedDeepInterviewState, persistedApprovalFlow),
            { priority: 70, required: true }
          ));
        }
      }
      const composition = injector.composeSystemPrompt({
        systemPrompt: event.systemPrompt ?? [],
        audience: "parent",
        autonomousActive: needsAutonomousReminder,
        mode: promptMode,
        additionalFragments,
      });
      const systemPrompt = applyOrchestratorConduct(composition.systemPrompt, injector, {
        isParentSession,
        autonomousActive: needsAutonomousReminder,
      });
      pi.logger.debug(
        `pi-oven: prompt composition ${promptMode} receipt ${JSON.stringify(composition.receipt)}`
      );
      return { systemPrompt };
    } catch (err) {
      if (err instanceof ExplicitSkillSafetyCeilingError) {
        pi.logger.warn(err.message);
        throw err;
      }
      if (!isParentSession) throw err;
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
      const notify = getSessionStartNotifier(ctx);
      if (notify) {
        const standaloneTruthSignals = await collectStandaloneTruthSignals({
          pluginAssetPath: pluginRoot,
          projectRoot: repoRoot,
        });
        const truthSignals = standaloneTruthSignals.filter(isSessionTruthSignal);
        const pluginSurfaceDriftSignal =
          standaloneTruthSignals.find((signal) => signal.name === DUAL_PLUGIN_SURFACE_LABEL) ?? null;
        emitSessionStartSetupNotice(
          notify,
          _event,
          repoRoot,
          await collectSetupReadiness({ cwd: repoRoot }),
          truthSignals,
          emittedSessionStartSetupNoticeKeys
        );
        notifySessionStartAuxiliaryNotice(notify, installedTopologyNotice);
        notifySessionStartAuxiliaryNotice(notify, keywordIntegrityNotice);
        notifySessionStartAuxiliaryNotice(
          notify,
          pluginSurfaceDriftSignal
            ? {
                level: "warning",
                message: formatStandaloneTruthSignals([pluginSurfaceDriftSignal]).join("\n"),
              }
            : null
        );
        notifySessionStartTruthSignals(notify, truthSignals);
      }
    } catch (err) {
      pi.logger.debug(`pi-oven: setup-state notice skipped: ${err}`);
    }

    const activeModel = getSessionStartModel(ctx);
    if (activeModel !== null) {
      try {
        await captureSessionModel(stringifySessionModelId(activeModel), sessionModelPath);
      } catch (err) {
        pi.logger.debug(`pi-oven: failed to capture parent session model: ${err}`);
      }
    }

    try {
      const preserveData = getSessionStartPreserveData(_event);
      if (preserveData) {
        injector.rehydrateFromPreserveData(preserveData);
      }
    } catch (err) {
      pi.logger.debug(`pi-oven: session_start rehydrate skipped: ${err}`);
    }

    if (!isParentSession) return;
    try {
      const ledgerResume = ledgerAdapter?.loadResume();
      if (ledgerResume?.action === "manual-review") {
        await store.mutate((current) => ({
          ...current,
          active: false,
          version: current.version + 1,
          blockedReason: {
            kind: "ambiguous-effect",
            message:
              "pi-oven: autonomy paused — an external effect has an intent but no trustworthy completion receipt.",
          },
          nextAction: {
            kind: "reconcile-external-effect",
            message:
              "Observe the actual repository or remote ref, then record complete/retry/manual-review before continuing.",
          },
          resumeTarget: buildAutonomyResumeTarget(repoRoot),
        }));
      }
      const stateView = await store.readState();
      if (stateView.kind === "OK" && stateView.state.resumeTarget) {
        const currentBranch = readCurrentRepoBranch(repoRoot);
        if (!matchesAutonomyResumeTarget(stateView.state.resumeTarget, repoRoot, currentBranch)) {
          await store.mutate((current) => ({
            ...current,
            active: false,
            version: current.version + 1,
            blockedReason: undefined,
            nextAction: undefined,
            resumeTarget: undefined,
            continuationMarker: undefined,
          }));
          pi.logger.info(
            `pi-oven: discarded stale autonomy resume state for ${stateView.state.resumeTarget.repoRoot}#${stateView.state.resumeTarget.branch}`
          );
          return;
        }
        const replay = buildSessionStartAutonomyReplay(stateView.state);
        if (replay) {
          pi.sendMessage(replay.message as never, replay.options as never);
          pi.logger.info(
            `pi-oven: replayed persisted autonomy ${
              (replay.message as { customType?: string }).customType === "pi-oven-autonomous-stop-guard"
                ? "continuation"
                : "blocked-state"
            } for ${repoRoot}#${currentBranch}`
          );
        }
        if (stateView.state.ownershipStatus === undefined) {
          await store.mutate((current) => ({
            ...current,
            version: current.version + 1,
            ownershipStatus: deriveAutonomyOwnershipStatus(
              current.requiredSkills,
              current.ownedSkillReadTargets
            ),
          }));
        }
      }
    } catch (err) {
      pi.logger.debug(`pi-oven: session_start autonomy replay skipped: ${err}`);
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
    runtimeTraceState.cachedFsm = undefined;
    await store.mutate((current) => {
      const requiredSkills = skillKeywordState.matchedSkills.map((skill) => skill.name);
      const ownedSkillReadTargets = skillKeywordState.matchedSkills.map(
        (skill) => skill.ownedReadTarget
      );
      const deferredSkillObligations = skillKeywordState.deferredSkillObligations.map(
        (skill) => ({
          skill: skill.name,
          ownedReadTarget: skill.ownedReadTarget,
          phases: skill.phases ?? ["mutate", "verify"],
          reason: "keyword-matched child/deferred skill",
        })
      );
      const ownershipStatus = deriveAutonomyOwnershipStatus(requiredSkills, ownedSkillReadTargets);
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
      const continuationMarker =
        stopGuardState.continuationMarker ??
        (sameUserMessage ? current.continuationMarker : undefined);
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
        deferredSkillObligations,
        phaseReceipts: sameUserMessage ? current.phaseReceipts ?? [] : [],
        ownershipStatus,
        blockedReason: sameUserMessage ? current.blockedReason : undefined,
        nextAction: sameUserMessage ? current.nextAction : undefined,
        resumeTarget: sameUserMessage ? current.resumeTarget : undefined,
        externalExecConsent,
        consumedExternalExecConsentMessageId,
        continuationMarker,
      };
    });
  });

  pi.on("turn_end", async (event) => {
    if (!isParentSession) return;

    const message = event.message as { content?: unknown; stopReason?: string };
    const decision = decideStopGuardOnTurnEnd(stopGuardState, {
      stopReason: message.stopReason,
      assistantText: extractTextFromContent(message.content),
      runtimeTrace,
      verifierDepth,
    });
    stopGuardState = decision.state;
    await store.mutate((current) => ({
      ...current,
      version: current.version + 1,
      continuationMarker: decision.state.continuationMarker,
      ownershipStatus:
        current.ownershipStatus ??
        deriveAutonomyOwnershipStatus(current.requiredSkills, current.ownedSkillReadTargets),
      blockedReason: decision.blockedReason,
      nextAction: decision.nextAction,
      resumeTarget:
        decision.state.continuationMarker !== undefined || decision.blockedReason !== undefined
          ? buildAutonomyResumeTarget(repoRoot)
          : undefined,
    }));

    if (!decision.shouldQueueContinuation) return;

    const stopGuardMessage =
      decision.reason === "verifier-pending"
        ? `${STOP_GUARD_MESSAGE}\nRun the deep verifier lane before exit.`
        : STOP_GUARD_MESSAGE;

    pi.sendMessage(
      {
        customType: "pi-oven-autonomous-stop-guard",
        content: [{ type: "text", text: stopGuardMessage }],
        display: true,
        details: { reason: decision.reason, note: decision.note },
      },
      { deliverAs: "nextTurn", triggerTurn: true }
    );

    pi.logger.info(
      `pi-oven: autonomous stop-guard queued continuation (${decision.reason}${
        decision.note ? ` — ${decision.note}` : ""
      })`
    );
  });

  try {
    registerPiOvenAsk(pi, { onRuntimeTrace: syncRuntimeTrace });
  } catch (err) {
    pi.logger.debug(`pi-oven: pi-oven_ask registration skipped: ${err}`);
  }

  pi.setLabel("pi-oven v0.2.4");
  pi.logger.info("pi-oven loaded");

}
