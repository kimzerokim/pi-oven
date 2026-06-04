/**
 * Profile A/B default model maps for all 24 pi-oven roles.
 * Source of truth: Spec B §4 (Profile A) and §5 (Profile B).
 */

export const EXPECTED_AGENT_COUNT = 24; // matches Spec A §4 taxonomy

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
  "deep-researcher",
  "data-runner",
] as const;

export type Role = (typeof ROLES)[number];

export interface ModelEntry {
  primary: string;
  registry_alternate: string;
  thinkingLevel: "low" | "medium" | "high" | "xhigh";
  tools: string[];
  blocked_tools: string[];
}

export type ProfileMap = Record<Role, ModelEntry>;

/**
 * Profile A — Release default.
 * Benchmark + cost-optimized routing.
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
    registry_alternate: "opencode-zen/gpt-5.4",
    thinkingLevel: "high",
    tools: ["*"],
    blocked_tools: [],
  },
  explorer: {
    primary: "opencode-zen/gemini-3-flash",
    registry_alternate: "opencode-zen/claude-haiku-4-5",
    thinkingLevel: "medium",
    tools: ["read", "search", "find", "bash", "web_search", "lsp", "ast_grep"],
    blocked_tools: ["write", "edit", "apply_patch", "task"],
  },
  verifier: {
    primary: "opencode-zen/glm-5.1",
    registry_alternate: "opencode-zen/claude-sonnet-4-6",
    thinkingLevel: "high",
    tools: ["read", "search", "find", "bash", "recall", "task", "report_finding"],
    blocked_tools: ["write", "edit", "apply_patch"],
  },
  critic: {
    primary: "anthropic/claude-opus-4-8",
    registry_alternate: "opencode-zen/claude-opus-4-8",
    thinkingLevel: "xhigh",
    tools: ["read", "search", "find", "report_finding", "recall"],
    blocked_tools: ["write", "edit", "apply_patch", "bash", "task"],
  },
  planner: {
    primary: "anthropic/claude-opus-4-8",
    registry_alternate: "openai-codex/gpt-5.4",
    thinkingLevel: "high",
    tools: ["read", "search", "find", "bash", "recall", "task"],
    blocked_tools: ["write", "edit", "apply_patch"],
  },
  "code-reviewer": {
    primary: "opencode-zen/glm-5.1",
    registry_alternate: "opencode-zen/claude-sonnet-4-6",
    thinkingLevel: "high",
    tools: ["read", "search", "find", "bash", "lsp", "ast_grep", "recall", "report_finding"],
    blocked_tools: ["write", "edit", "apply_patch", "task"],
  },
  debugger: {
    primary: "openai-codex/gpt-5.4",
    registry_alternate: "opencode-zen/gpt-5.4",
    thinkingLevel: "high",
    tools: ["*"],
    blocked_tools: [],
  },
  "test-engineer": {
    primary: "openai-codex/gpt-5.4",
    registry_alternate: "opencode-zen/gpt-5.4",
    thinkingLevel: "high",
    tools: ["*"],
    blocked_tools: [],
  },
  "security-reviewer": {
    primary: "anthropic/claude-opus-4-8",
    registry_alternate: "opencode-zen/claude-opus-4-8",
    thinkingLevel: "xhigh",
    tools: ["read", "search", "find", "bash", "recall", "web_search"],
    blocked_tools: ["write", "edit", "apply_patch", "task"],
  },
  writer: {
    primary: "opencode-zen/gemini-3-flash",
    registry_alternate: "opencode-zen/claude-haiku-4-5",
    thinkingLevel: "medium",
    tools: ["read", "search", "find", "write", "edit", "web_search"],
    blocked_tools: ["apply_patch", "bash", "task"],
  },
  designer: {
    primary: "opencode-zen/glm-5.1",
    registry_alternate: "opencode-zen/claude-sonnet-4-6",
    thinkingLevel: "high",
    tools: ["*"],
    blocked_tools: [],
  },
  "code-simplifier": {
    primary: "opencode-zen/glm-5.1",
    registry_alternate: "opencode-zen/claude-sonnet-4-6",
    thinkingLevel: "xhigh",
    tools: ["*"],
    blocked_tools: [],
  },
  "qa-tester": {
    primary: "opencode-zen/gemini-3.5-flash",
    registry_alternate: "opencode-zen/claude-haiku-4-5",
    thinkingLevel: "high",
    tools: ["*"],
    blocked_tools: [],
  },
  "git-master": {
    primary: "opencode-zen/claude-haiku-4-5",
    registry_alternate: "opencode-zen/claude-sonnet-4-6",
    thinkingLevel: "low",
    tools: ["read", "search", "find", "bash"],
    blocked_tools: ["write", "edit", "apply_patch", "task"],
  },
  "document-specialist": {
    primary: "opencode-zen/gemini-3-flash",
    registry_alternate: "opencode-zen/claude-haiku-4-5",
    thinkingLevel: "medium",
    tools: ["read", "search", "find", "bash", "recall", "web_search"],
    blocked_tools: ["write", "edit", "apply_patch", "task"],
  },
  tracer: {
    primary: "opencode-zen/glm-5.1",
    registry_alternate: "opencode-zen/claude-sonnet-4-6",
    thinkingLevel: "high",
    tools: ["read", "search", "find", "bash"],
    blocked_tools: ["write", "edit", "apply_patch", "task"],
  },
  analyst: {
    primary: "opencode-zen/glm-5.1",
    registry_alternate: "opencode-zen/claude-sonnet-4-6",
    thinkingLevel: "xhigh",
    tools: ["read", "search", "find", "bash", "eval", "recall"],
    blocked_tools: ["write", "edit", "apply_patch", "task"],
  },
  architect: {
    primary: "openai-codex/gpt-5.4",
    registry_alternate: "opencode-zen/gpt-5.4",
    thinkingLevel: "xhigh",
    tools: ["read", "search", "find", "bash", "lsp", "ast_grep", "recall", "retain"],
    blocked_tools: ["write", "edit", "apply_patch", "task"],
  },
  librarian: {
    primary: "opencode-zen/glm-5.1",
    registry_alternate: "opencode-zen/claude-sonnet-4-6",
    thinkingLevel: "medium",
    tools: ["read", "search", "find", "bash", "lsp", "web_search", "ast_grep", "recall"],
    blocked_tools: ["write", "edit", "apply_patch", "task"],
  },
  "multimodal-looker": {
    primary: "opencode-zen/gemini-3-flash",
    registry_alternate: "opencode-zen/claude-sonnet-4-6",
    thinkingLevel: "medium",
    tools: ["read", "search", "find", "bash", "inspect_image"],
    blocked_tools: ["write", "edit", "apply_patch", "task"],
  },
  oracle: {
    primary: "anthropic/claude-opus-4-8",
    registry_alternate: "opencode-zen/claude-opus-4-8",
    thinkingLevel: "xhigh",
    tools: ["read", "search", "find", "bash", "recall", "retain"],
    blocked_tools: ["write", "edit", "apply_patch", "task"],
  },
  metis: {
    primary: "openai-codex/gpt-5.4",
    registry_alternate: "opencode-zen/gpt-5.4",
    thinkingLevel: "xhigh",
    tools: ["read", "search", "find", "bash", "recall", "task"],
    blocked_tools: ["write", "edit", "apply_patch"],
  },
  "deep-researcher": {
    primary: "opencode-zen/gemini-3-flash",
    registry_alternate: "opencode-zen/claude-sonnet-4-6",
    thinkingLevel: "high",
    tools: ["read", "search", "find", "web_search", "retain", "recall", "reflect"],
    blocked_tools: ["write", "edit", "apply_patch", "task"],
  },
  "data-runner": {
    primary: "openai-codex/gpt-5.4",
    registry_alternate: "opencode-zen/gpt-5.4",
    thinkingLevel: "high",
    tools: ["bash", "eval", "read", "write", "retain"],
    blocked_tools: ["edit", "apply_patch", "task"],
  },
};

/**
 * The MAIN ORCHESTRATOR (top-level session) model pair, distinct from the 24
 * subagent roles above. Maps to omp `modelRoles.default` (the launched session /
 * orchestrator model, resolved at main.ts:575 / sdk.ts:1003) and
 * `modelRoles.title` (the cheap model omp uses to auto-title sessions). These
 * live OUTSIDE ProfileMap so it stays exactly 24 roles for lint-agents.
 * Written by `/pi-oven:setup --profile` (the user-setup apply path), NOT by the
 * maintainer agent-frontmatter generate path. PROFILE_B reuses only ids that
 * PROFILE_B already declares (B is DEFERRED — no new B ids introduced here).
 *
 * PROFILE_A uses CANONICAL model ids (no provider prefix) for the orchestrator:
 * with an empty `modelProviderOrder`, omp resolves canonical `gpt-5.4` /
 * `gpt-5.4-mini` openai-codex-first (registry order) and falls back to
 * opencode-zen — both providers carry these models. The subagent codex roles
 * get the same primary→fallback ordering via their frontmatter model array
 * ([openai-codex/gpt-5.4, opencode-zen/gpt-5.4]).
 */
export interface OrchestratorModels {
  default: string;
  title: string;
}

export const PROFILE_A_ORCHESTRATOR: OrchestratorModels = {
  default: "gpt-5.4:high",
  title: "gpt-5.4-mini:low",
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
    tools: ["*"],
    blocked_tools: [],
  },
  explorer: {
    primary: "anthropic/claude-haiku-4-5",
    registry_alternate: "opencode-zen/claude-haiku-4-5",
    thinkingLevel: "medium",
    tools: ["read", "search", "find", "bash", "web_search", "lsp", "ast_grep"],
    blocked_tools: ["write", "edit", "apply_patch", "task"],
  },
  verifier: {
    primary: "opencode-zen/glm-5.1",
    registry_alternate: "opencode-zen/claude-sonnet-4-6",
    thinkingLevel: "high",
    tools: ["read", "search", "find", "bash", "recall", "task", "report_finding"],
    blocked_tools: ["write", "edit", "apply_patch"],
  },
  critic: {
    primary: "anthropic/claude-opus-4-7",
    registry_alternate: "opencode-zen/claude-opus-4-7",
    thinkingLevel: "xhigh",
    tools: ["read", "search", "find", "report_finding", "recall"],
    blocked_tools: ["write", "edit", "apply_patch", "bash", "task"],
  },
  planner: {
    primary: "anthropic/claude-opus-4-7",
    registry_alternate: "openai-codex/gpt-5.4",
    thinkingLevel: "high",
    tools: ["read", "search", "find", "bash", "recall", "task"],
    blocked_tools: ["write", "edit", "apply_patch"],
  },
  "code-reviewer": {
    primary: "anthropic/claude-sonnet-4-6",
    registry_alternate: "opencode-zen/claude-sonnet-4-6",
    thinkingLevel: "high",
    tools: ["read", "search", "find", "bash", "lsp", "ast_grep", "recall", "report_finding"],
    blocked_tools: ["write", "edit", "apply_patch", "task"],
  },
  debugger: {
    primary: "anthropic/claude-sonnet-4-6",
    registry_alternate: "opencode-zen/claude-sonnet-4-6",
    thinkingLevel: "high",
    tools: ["*"],
    blocked_tools: [],
  },
  "test-engineer": {
    primary: "anthropic/claude-sonnet-4-6",
    registry_alternate: "opencode-zen/claude-sonnet-4-6",
    thinkingLevel: "high",
    tools: ["*"],
    blocked_tools: [],
  },
  "security-reviewer": {
    primary: "anthropic/claude-opus-4-7",
    registry_alternate: "opencode-zen/claude-opus-4-7",
    thinkingLevel: "xhigh",
    tools: ["read", "search", "find", "bash", "recall", "web_search"],
    blocked_tools: ["write", "edit", "apply_patch", "task"],
  },
  writer: {
    primary: "anthropic/claude-haiku-4-5",
    registry_alternate: "opencode-zen/claude-haiku-4-5",
    thinkingLevel: "medium",
    tools: ["read", "search", "find", "write", "edit", "web_search"],
    blocked_tools: ["apply_patch", "bash", "task"],
  },
  designer: {
    primary: "opencode-zen/glm-5.1",
    registry_alternate: "opencode-zen/claude-sonnet-4-6",
    thinkingLevel: "high",
    tools: ["*"],
    blocked_tools: [],
  },
  "code-simplifier": {
    primary: "opencode-zen/glm-5.1",
    registry_alternate: "opencode-zen/claude-sonnet-4-6",
    thinkingLevel: "xhigh",
    tools: ["*"],
    blocked_tools: [],
  },
  "qa-tester": {
    primary: "anthropic/claude-haiku-4-5",
    registry_alternate: "opencode-zen/claude-haiku-4-5",
    thinkingLevel: "high",
    tools: ["*"],
    blocked_tools: [],
  },
  "git-master": {
    primary: "anthropic/claude-haiku-4-5",
    registry_alternate: "opencode-zen/claude-haiku-4-5",
    thinkingLevel: "low",
    tools: ["read", "search", "find", "bash"],
    blocked_tools: ["write", "edit", "apply_patch", "task"],
  },
  "document-specialist": {
    primary: "anthropic/claude-haiku-4-5",
    registry_alternate: "opencode-zen/claude-haiku-4-5",
    thinkingLevel: "medium",
    tools: ["read", "search", "find", "bash", "recall", "web_search"],
    blocked_tools: ["write", "edit", "apply_patch", "task"],
  },
  tracer: {
    primary: "anthropic/claude-sonnet-4-6",
    registry_alternate: "opencode-zen/claude-sonnet-4-6",
    thinkingLevel: "high",
    tools: ["read", "search", "find", "bash"],
    blocked_tools: ["write", "edit", "apply_patch", "task"],
  },
  analyst: {
    primary: "opencode-zen/glm-5.1",
    registry_alternate: "opencode-zen/claude-sonnet-4-6",
    thinkingLevel: "xhigh",
    tools: ["read", "search", "find", "bash", "eval", "recall"],
    blocked_tools: ["write", "edit", "apply_patch", "task"],
  },
  architect: {
    primary: "anthropic/claude-sonnet-4-6",
    registry_alternate: "opencode-zen/claude-sonnet-4-6",
    thinkingLevel: "xhigh",
    tools: ["read", "search", "find", "bash", "lsp", "ast_grep", "recall", "retain"],
    blocked_tools: ["write", "edit", "apply_patch", "task"],
  },
  librarian: {
    primary: "opencode-zen/glm-5.1",
    registry_alternate: "opencode-zen/claude-sonnet-4-6",
    thinkingLevel: "medium",
    tools: ["read", "search", "find", "bash", "lsp", "web_search", "ast_grep", "recall"],
    blocked_tools: ["write", "edit", "apply_patch", "task"],
  },
  "multimodal-looker": {
    primary: "anthropic/claude-haiku-4-5",
    registry_alternate: "opencode-zen/claude-sonnet-4-6",
    thinkingLevel: "medium",
    tools: ["read", "search", "find", "bash", "inspect_image"],
    blocked_tools: ["write", "edit", "apply_patch", "task"],
  },
  oracle: {
    primary: "anthropic/claude-opus-4-7",
    registry_alternate: "opencode-zen/claude-opus-4-7",
    thinkingLevel: "xhigh",
    tools: ["read", "search", "find", "bash", "recall", "retain"],
    blocked_tools: ["write", "edit", "apply_patch", "task"],
  },
  metis: {
    primary: "anthropic/claude-sonnet-4-6",
    registry_alternate: "opencode-zen/claude-sonnet-4-6",
    thinkingLevel: "xhigh",
    tools: ["read", "search", "find", "bash", "recall", "task"],
    blocked_tools: ["write", "edit", "apply_patch"],
  },
  "deep-researcher": {
    primary: "anthropic/claude-haiku-4-5",
    registry_alternate: "opencode-zen/claude-sonnet-4-6",
    thinkingLevel: "high",
    tools: ["read", "search", "find", "web_search", "retain", "recall", "reflect"],
    blocked_tools: ["write", "edit", "apply_patch", "task"],
  },
  "data-runner": {
    primary: "anthropic/claude-sonnet-4-6",
    registry_alternate: "opencode-zen/claude-sonnet-4-6",
    thinkingLevel: "high",
    tools: ["bash", "eval", "read", "write", "retain"],
    blocked_tools: ["edit", "apply_patch", "task"],
  },
};
