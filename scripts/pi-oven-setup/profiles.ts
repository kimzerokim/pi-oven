/**
 * Profile A/B default model maps for all 22 pi-oven roles.
 * Source of truth: Spec B §4 (Profile A) and §5 (Profile B).
 */

export const EXPECTED_AGENT_COUNT = 22; // matches Spec A §4 taxonomy

export const ROLES = [
  "executor",
  "explorer",
  "verifier",
  "critic",
  "planner",
  "code-reviewer",
  "debugger",
  "test-engineer",
  "security-reviewer",
  "writer",
  "designer",
  "code-simplifier",
  "qa-tester",
  "git-master",
  "document-specialist",
  "tracer",
  "analyst",
  "architect",
  "librarian",
  "multimodal-looker",
  "oracle",
  "metis",
] as const;

export type Role = (typeof ROLES)[number];

export interface ModelEntry {
  primary: string;
  registry_alternate: string;
  thinkingLevel: "minimal" | "low" | "medium" | "high" | "xhigh";
}

export type ProfileMap = Record<Role, ModelEntry>;

/**
 * Profile A — Release default.
 * Benchmark + cost-optimized routing (2026-05-29 OPTIMIZED-MODEL revision).
 * 3 high-stakes roles (critic, security-reviewer, oracle) use anthropic/ primary.
 * 5 roles use openai-codex/ subscription as primary
 * (executor/debugger/test-engineer = gpt-5.4;
 *  architect/metis = gpt-5.4; planner alternate = gpt-5.4).
 * 6 reasoning roles (verifier, code-reviewer, code-simplifier, tracer,
 *  analyst, librarian) use opencode-zen/glm-5.1 as primary.
 * Default fallback policy: opencode-zen/ wrapper of the same model id.
 * Exception: planner falls back to openai-codex/gpt-5.4 for codex-review
 * cross-validation per user policy.
 * Provider mix: anthropic 4 (planner primary + critic + security-reviewer + oracle), openai-codex 5, opencode-zen 13.
 */
export const PROFILE_A: ProfileMap = {
  executor: {
    primary: "openai-codex/gpt-5.4",
    registry_alternate: "opencode-zen/gpt-5.4-pro",
    thinkingLevel: "high",
  },
  explorer: {
    primary: "opencode-zen/gemini-3-flash",
    registry_alternate: "opencode-zen/claude-haiku-4-5",
    thinkingLevel: "medium",
  },
  verifier: {
    primary: "opencode-zen/glm-5.1",
    registry_alternate: "opencode-zen/claude-sonnet-4-6",
    thinkingLevel: "high",
  },
  critic: {
    primary: "anthropic/claude-opus-4-8",
    registry_alternate: "opencode-zen/claude-opus-4-8",
    thinkingLevel: "xhigh",
  },
  planner: {
    primary: "anthropic/claude-opus-4-8",
    registry_alternate: "openai-codex/gpt-5.4",
    thinkingLevel: "high",
  },
  "code-reviewer": {
    primary: "opencode-zen/glm-5.1",
    registry_alternate: "opencode-zen/claude-sonnet-4-6",
    thinkingLevel: "high",
  },
  debugger: {
    primary: "openai-codex/gpt-5.4",
    registry_alternate: "opencode-zen/gpt-5.4-pro",
    thinkingLevel: "high",
  },
  "test-engineer": {
    primary: "openai-codex/gpt-5.4",
    registry_alternate: "opencode-zen/gpt-5.4-pro",
    thinkingLevel: "high",
  },
  "security-reviewer": {
    primary: "anthropic/claude-opus-4-8",
    registry_alternate: "opencode-zen/claude-opus-4-8",
    thinkingLevel: "xhigh",
  },
  writer: {
    primary: "opencode-zen/gemini-3-flash",
    registry_alternate: "opencode-zen/claude-haiku-4-5",
    thinkingLevel: "medium",
  },
  designer: {
    primary: "opencode-zen/glm-5.1",
    registry_alternate: "opencode-zen/claude-sonnet-4-6",
    thinkingLevel: "high",
  },
  "code-simplifier": {
    primary: "opencode-zen/glm-5.1",
    registry_alternate: "opencode-zen/claude-sonnet-4-6",
    thinkingLevel: "xhigh",
  },
  "qa-tester": {
    primary: "opencode-zen/gemini-3.5-flash",
    registry_alternate: "opencode-zen/claude-haiku-4-5",
    thinkingLevel: "high",
  },
  "git-master": {
    primary: "opencode-zen/claude-haiku-4-5",
    registry_alternate: "opencode-zen/claude-sonnet-4-6",
    thinkingLevel: "low",
  },
  "document-specialist": {
    primary: "opencode-zen/gemini-3-flash",
    registry_alternate: "opencode-zen/claude-haiku-4-5",
    thinkingLevel: "medium",
  },
  tracer: {
    primary: "opencode-zen/glm-5.1",
    registry_alternate: "opencode-zen/claude-sonnet-4-6",
    thinkingLevel: "high",
  },
  analyst: {
    primary: "opencode-zen/glm-5.1",
    registry_alternate: "opencode-zen/claude-sonnet-4-6",
    thinkingLevel: "xhigh",
  },
  architect: {
    primary: "openai-codex/gpt-5.4",
    registry_alternate: "opencode-zen/gpt-5.4",
    thinkingLevel: "xhigh",
  },
  librarian: {
    primary: "opencode-zen/glm-5.1",
    registry_alternate: "opencode-zen/claude-sonnet-4-6",
    thinkingLevel: "medium",
  },
  "multimodal-looker": {
    primary: "opencode-zen/gemini-3-flash",
    registry_alternate: "opencode-zen/claude-sonnet-4-6",
    thinkingLevel: "medium",
  },
  oracle: {
    primary: "anthropic/claude-opus-4-8",
    registry_alternate: "opencode-zen/claude-opus-4-8",
    thinkingLevel: "xhigh",
  },
  metis: {
    primary: "openai-codex/gpt-5.4",
    registry_alternate: "opencode-zen/gpt-5.4",
    thinkingLevel: "xhigh",
  },
};

/**
 * The MAIN ORCHESTRATOR (top-level session) model pair, distinct from the 22
 * subagent roles above. Maps to omp `modelRoles.default` (the launched session /
 * orchestrator model, resolved at main.ts:575 / sdk.ts:1003) and
 * `modelRoles.title` (the cheap model omp uses to auto-title sessions). These
 * live OUTSIDE ProfileMap so it stays exactly 22 roles for lint-agents.
 * Written by `/pi-oven:setup --profile` (the user-setup apply path), NOT by the
 * maintainer agent-frontmatter generate path. PROFILE_B reuses only ids that
 * PROFILE_B already declares (B is DEFERRED — no new B ids introduced here).
 */
export interface OrchestratorModels {
  default: string;
  title: string;
}

export const PROFILE_A_ORCHESTRATOR: OrchestratorModels = {
  default: "openai-codex/gpt-5.4:high",
  title: "openai-codex/gpt-5.4-mini:low",
};

export const PROFILE_B_ORCHESTRATOR: OrchestratorModels = {
  default: "anthropic/claude-opus-4-7:high",
  title: "anthropic/claude-haiku-4-5:low",
};

/**
 * Profile B — Anthropic opt-in.
 * Promotes Anthropic models to primary for reasoning-heavy roles.
 * Preserves opencode-zen/glm-5 for explorer and librarian (1M context window).
 * Verbatim from Spec B §5 table.
 */
export const PROFILE_B: ProfileMap = {
  executor: {
    primary: "anthropic/claude-sonnet-4-6",
    registry_alternate: "opencode-zen/claude-sonnet-4-6",
    thinkingLevel: "high",
  },
  explorer: {
    primary: "opencode-zen/glm-5",
    registry_alternate: "anthropic/claude-haiku-4-5",
    thinkingLevel: "medium",
  },
  verifier: {
    primary: "anthropic/claude-sonnet-4-6",
    registry_alternate: "opencode-zen/claude-sonnet-4-6",
    thinkingLevel: "high",
  },
  critic: {
    primary: "anthropic/claude-opus-4-7",
    registry_alternate: "opencode-zen/claude-opus-4-7",
    thinkingLevel: "xhigh",
  },
  planner: {
    primary: "anthropic/claude-sonnet-4-6",
    registry_alternate: "opencode-zen/claude-sonnet-4-6",
    thinkingLevel: "high",
  },
  "code-reviewer": {
    primary: "anthropic/claude-opus-4-7",
    registry_alternate: "opencode-zen/claude-opus-4-7",
    thinkingLevel: "high",
  },
  debugger: {
    primary: "anthropic/claude-sonnet-4-6",
    registry_alternate: "opencode-zen/claude-sonnet-4-6",
    thinkingLevel: "high",
  },
  "test-engineer": {
    primary: "anthropic/claude-sonnet-4-6",
    registry_alternate: "opencode-zen/claude-sonnet-4-6",
    thinkingLevel: "high",
  },
  "security-reviewer": {
    primary: "anthropic/claude-opus-4-7",
    registry_alternate: "opencode-zen/claude-opus-4-7",
    thinkingLevel: "xhigh",
  },
  writer: {
    primary: "anthropic/claude-haiku-4-5",
    registry_alternate: "opencode-zen/claude-haiku-4-5",
    thinkingLevel: "medium",
  },
  designer: {
    primary: "anthropic/claude-sonnet-4-6",
    registry_alternate: "opencode-zen/claude-sonnet-4-6",
    thinkingLevel: "high",
  },
  "code-simplifier": {
    primary: "anthropic/claude-opus-4-7",
    registry_alternate: "opencode-zen/claude-opus-4-7",
    thinkingLevel: "xhigh",
  },
  "qa-tester": {
    primary: "anthropic/claude-sonnet-4-6",
    registry_alternate: "opencode-zen/claude-sonnet-4-6",
    thinkingLevel: "high",
  },
  "git-master": {
    primary: "anthropic/claude-haiku-4-5",
    registry_alternate: "opencode-zen/claude-haiku-4-5",
    thinkingLevel: "low",
  },
  "document-specialist": {
    primary: "anthropic/claude-sonnet-4-6",
    registry_alternate: "opencode-zen/claude-sonnet-4-6",
    thinkingLevel: "medium",
  },
  tracer: {
    primary: "anthropic/claude-sonnet-4-6",
    registry_alternate: "opencode-zen/claude-sonnet-4-6",
    thinkingLevel: "high",
  },
  analyst: {
    primary: "anthropic/claude-opus-4-7",
    registry_alternate: "opencode-zen/claude-opus-4-7",
    thinkingLevel: "xhigh",
  },
  architect: {
    primary: "anthropic/claude-opus-4-7",
    registry_alternate: "opencode-zen/claude-opus-4-7",
    thinkingLevel: "xhigh",
  },
  librarian: {
    primary: "opencode-zen/glm-5",
    registry_alternate: "anthropic/claude-haiku-4-5",
    thinkingLevel: "medium",
  },
  "multimodal-looker": {
    primary: "anthropic/claude-sonnet-4-6",
    registry_alternate: "opencode-zen/claude-sonnet-4-6",
    thinkingLevel: "medium",
  },
  oracle: {
    primary: "anthropic/claude-opus-4-7",
    registry_alternate: "opencode-zen/claude-opus-4-7",
    thinkingLevel: "xhigh",
  },
  metis: {
    primary: "anthropic/claude-opus-4-7",
    registry_alternate: "opencode-zen/claude-opus-4-7",
    thinkingLevel: "xhigh",
  },
};
