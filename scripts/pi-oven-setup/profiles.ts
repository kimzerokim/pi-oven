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
 * Benchmark + cost-optimized heterogeneous routing.
 * - anthropic/claude-opus-4-8: critic, planner, security-reviewer, oracle.
 * - openai-codex/gpt-5.4: executor, debugger, test-engineer, architect, metis, data-runner.
 * - openai-codex/gpt-5.4-mini: multimodal-looker, qa-tester.
 * - opencode-zen/minimax-m2.5: explorer, writer, document-specialist,
 *   deep-researcher, librarian, git-master.
 * - opencode-zen/glm-5.1: designer, code-simplifier.
 * - opencode-zen/kimi-k2.6: verifier, code-reviewer, analyst, tracer.
 * Default fallback policy: opencode-zen/ wrapper of the same model id where
 * available; Profile A orchestrator fallback chains live outside this map.
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
    primary: "opencode-zen/minimax-m2.5",
    registry_alternate: "opencode-zen/glm-5.1",
    thinkingLevel: "medium",
    tools: ["read", "search", "find", "bash", "web_search", "lsp", "ast_grep"],
    blocked_tools: ["write", "edit", "apply_patch", "task"],
  },
  verifier: {
    primary: "opencode-zen/kimi-k2.6",
    registry_alternate: "opencode-zen/glm-5.1",
    thinkingLevel: "high",
    tools: ["read", "search", "find", "bash", "recall", "task", "report_finding", "lsp"],
    blocked_tools: ["write", "edit", "apply_patch"],
  },
  critic: {
    primary: "anthropic/claude-opus-4-8",
    registry_alternate: "openai-codex/gpt-5.5",
    thinkingLevel: "xhigh",
    tools: ["read", "search", "find", "report_finding", "recall", "web_search"],
    blocked_tools: ["write", "edit", "apply_patch", "bash", "task"],
  },
  planner: {
    primary: "anthropic/claude-opus-4-8",
    registry_alternate: "openai-codex/gpt-5.4",
    thinkingLevel: "high",
    tools: ["read", "search", "find", "bash", "recall", "task", "lsp", "ast_grep", "web_search"],
    blocked_tools: ["write", "edit", "apply_patch"],
  },
  "code-reviewer": {
    primary: "opencode-zen/kimi-k2.6",
    registry_alternate: "opencode-zen/glm-5.1",
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
    registry_alternate: "openai-codex/gpt-5.5",
    thinkingLevel: "xhigh",
    tools: ["read", "search", "find", "bash", "recall", "web_search", "lsp", "ast_grep"],
    blocked_tools: ["write", "edit", "apply_patch", "task"],
  },
  writer: {
    primary: "opencode-zen/minimax-m2.5",
    registry_alternate: "opencode-zen/glm-5.1",
    thinkingLevel: "medium",
    tools: ["read", "search", "find", "write", "edit", "web_search"],
    blocked_tools: ["apply_patch", "bash", "task"],
  },
  designer: {
    primary: "opencode-zen/glm-5.1",
    registry_alternate: "opencode-zen/minimax-m2.5",
    thinkingLevel: "high",
    tools: ["*"],
    blocked_tools: [],
  },
  "code-simplifier": {
    primary: "opencode-zen/glm-5.1",
    registry_alternate: "opencode-zen/minimax-m2.5",
    thinkingLevel: "xhigh",
    tools: ["*"],
    blocked_tools: [],
  },
  "qa-tester": {
    primary: "openai-codex/gpt-5.4-mini",
    registry_alternate: "anthropic/claude-sonnet-4-6",
    thinkingLevel: "high",
    tools: ["*"],
    blocked_tools: [],
  },
  "git-master": {
    primary: "opencode-zen/minimax-m2.5",
    registry_alternate: "opencode-zen/glm-5.1",
    thinkingLevel: "low",
    tools: ["read", "search", "find", "bash"],
    blocked_tools: ["write", "edit", "apply_patch", "task"],
  },
  "document-specialist": {
    primary: "opencode-zen/minimax-m2.5",
    registry_alternate: "opencode-zen/glm-5.1",
    thinkingLevel: "medium",
    tools: ["read", "search", "find", "bash", "recall", "web_search"],
    blocked_tools: ["write", "edit", "apply_patch", "task"],
  },
  tracer: {
    primary: "opencode-zen/kimi-k2.6",
    registry_alternate: "opencode-zen/glm-5.1",
    thinkingLevel: "high",
    tools: ["read", "search", "find", "bash", "lsp", "ast_grep", "eval", "debug"],
    blocked_tools: ["write", "edit", "apply_patch", "task"],
  },
  analyst: {
    primary: "opencode-zen/kimi-k2.6",
    registry_alternate: "opencode-zen/glm-5.1",
    thinkingLevel: "xhigh",
    tools: ["read", "search", "find", "bash", "eval", "recall", "lsp", "ast_grep"],
    blocked_tools: ["write", "edit", "apply_patch", "task"],
  },
  architect: {
    primary: "openai-codex/gpt-5.4",
    registry_alternate: "opencode-zen/gpt-5.4",
    thinkingLevel: "xhigh",
    tools: ["read", "search", "find", "bash", "lsp", "ast_grep", "recall", "retain", "web_search"],
    blocked_tools: ["write", "edit", "apply_patch", "task"],
  },
  librarian: {
    primary: "opencode-zen/minimax-m2.5",
    registry_alternate: "opencode-zen/glm-5.1",
    thinkingLevel: "medium",
    tools: ["read", "search", "find", "bash", "lsp", "web_search", "ast_grep", "recall"],
    blocked_tools: ["write", "edit", "apply_patch", "task"],
  },
  "multimodal-looker": {
    primary: "openai-codex/gpt-5.4-mini",
    registry_alternate: "anthropic/claude-sonnet-4-6",
    thinkingLevel: "medium",
    tools: ["read", "search", "find", "bash", "inspect_image"],
    blocked_tools: ["write", "edit", "apply_patch", "task"],
  },
  oracle: {
    primary: "anthropic/claude-opus-4-8",
    registry_alternate: "openai-codex/gpt-5.5",
    thinkingLevel: "xhigh",
    tools: ["read", "search", "find", "bash", "recall", "retain", "lsp", "ast_grep", "web_search"],
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
    primary: "opencode-zen/minimax-m2.5",
    registry_alternate: "opencode-zen/glm-5.1",
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
 * maintainer agent-frontmatter generate path.
 *
 * PROFILE_A uses provider-qualified `openai-codex/gpt-5.4:high` for the main
 * orchestrator and canonical `gpt-5.4-mini:low` for title generation. Runtime
 * retry fallback chains route default → opencode-zen/kimi-k2.6 and title →
 * opencode-zen/gpt-5.4-mini.
 */
export interface OrchestratorModels {
  default: string;
  title: string;
}

export const PROFILE_A_ORCHESTRATOR: OrchestratorModels = {
  default: "openai-codex/gpt-5.4:high",
  title: "gpt-5.4-mini:low",
};

export const PROFILE_B_ORCHESTRATOR: OrchestratorModels = {
  default: "openai-codex/gpt-5.4:high",
  title: "openai-codex/gpt-5.4:medium",
};

/**
 * Rate-limit failover chains for the orchestrator model roles, keyed by
 * modelRole name. Written to `retry.fallbackChains` by the user-setup apply
 * path. Empty arrays intentionally disable Profile B runtime fallback so the
 * OpenAI-subscription profile does not route usage-limit retries through
 * opencode-zen. Lives OUTSIDE ProfileMap (like the orchestrator consts) so
 * ProfileMap stays exactly 24 roles for lint-agents.
 *
 * Selectors are provider-qualified and omit thinkingLevel so the fallback
 * candidate inherits the current level (agent-session.ts retry path). omp's
 * #resolveRetryFallbackRole matches the active model's base selector against
 * modelRoles.<role>, so a codex subagent whose base equals modelRoles.default
 * (e.g. openai-codex/gpt-5.4) also benefits from the default chain.
 */
export const PROFILE_A_FALLBACK_CHAINS: Record<string, string[]> = {
  default: ["opencode-zen/kimi-k2.6"],
  title: ["opencode-zen/gpt-5.4-mini"],
};

export const PROFILE_B_FALLBACK_CHAINS: Record<string, string[]> = {
  default: [],
  title: [],
};

export const PROFILE_C_ORCHESTRATOR: OrchestratorModels = {
  default: "anthropic/claude-opus-4-8:high",
  title: "anthropic/claude-sonnet-4-6:low",
};

export const PROFILE_C_FALLBACK_CHAINS: Record<string, string[]> = {
  default: ["opencode-zen/claude-opus-4-8"],
  title: ["opencode-zen/claude-sonnet-4-6"],
};

/**
 * Profile B — openai-codex-only, performance-first.
 * Model tier and thinking effort are deliberately decoupled:
 *   - gpt-5.5 for implementation, causal investigation, review, planning,
 *     architecture, advisory, and deep research roles.
 *   - gpt-5.4 for fast fan-out, docs/search/vision/git/data-runner roles.
 *   - xhigh only for high-value review/security/verification/oracle/deep-research
 *     rollouts where extra latency buys correctness.
 *   - medium for retrieval, docs, writing, git, and vision fan-out.
 * registry_alternate = opencode-zen/ mirror of the same model id.
 * tools and blocked_tools copied verbatim from PROFILE_A.
 */
export const PROFILE_B: ProfileMap = {
  executor: {
    primary: "openai-codex/gpt-5.5",
    registry_alternate: "opencode-zen/gpt-5.5",
    thinkingLevel: "high",
    tools: ["*"],
    blocked_tools: [],
  },
  explorer: {
    primary: "openai-codex/gpt-5.4",
    registry_alternate: "opencode-zen/gpt-5.4",
    thinkingLevel: "medium",
    tools: ["read", "search", "find", "bash", "web_search", "lsp", "ast_grep"],
    blocked_tools: ["write", "edit", "apply_patch", "task"],
  },
  verifier: {
    primary: "openai-codex/gpt-5.5",
    registry_alternate: "opencode-zen/gpt-5.5",
    thinkingLevel: "xhigh",
    tools: ["read", "search", "find", "bash", "recall", "task", "report_finding", "lsp"],
    blocked_tools: ["write", "edit", "apply_patch"],
  },
  critic: {
    primary: "openai-codex/gpt-5.5",
    registry_alternate: "opencode-zen/gpt-5.5",
    thinkingLevel: "xhigh",
    tools: ["read", "search", "find", "report_finding", "recall", "web_search"],
    blocked_tools: ["write", "edit", "apply_patch", "bash", "task"],
  },
  planner: {
    primary: "openai-codex/gpt-5.5",
    registry_alternate: "opencode-zen/gpt-5.5",
    thinkingLevel: "xhigh",
    tools: ["read", "search", "find", "bash", "recall", "task", "lsp", "ast_grep", "web_search"],
    blocked_tools: ["write", "edit", "apply_patch"],
  },
  "code-reviewer": {
    primary: "openai-codex/gpt-5.5",
    registry_alternate: "opencode-zen/gpt-5.5",
    thinkingLevel: "xhigh",
    tools: ["read", "search", "find", "bash", "lsp", "ast_grep", "recall", "report_finding"],
    blocked_tools: ["write", "edit", "apply_patch", "task"],
  },
  debugger: {
    primary: "openai-codex/gpt-5.5",
    registry_alternate: "opencode-zen/gpt-5.5",
    thinkingLevel: "xhigh",
    tools: ["*"],
    blocked_tools: [],
  },
  "test-engineer": {
    primary: "openai-codex/gpt-5.5",
    registry_alternate: "opencode-zen/gpt-5.5",
    thinkingLevel: "high",
    tools: ["*"],
    blocked_tools: [],
  },
  "security-reviewer": {
    primary: "openai-codex/gpt-5.5",
    registry_alternate: "opencode-zen/gpt-5.5",
    thinkingLevel: "xhigh",
    tools: ["read", "search", "find", "bash", "recall", "web_search", "lsp", "ast_grep"],
    blocked_tools: ["write", "edit", "apply_patch", "task"],
  },
  writer: {
    primary: "openai-codex/gpt-5.4",
    registry_alternate: "opencode-zen/gpt-5.4",
    thinkingLevel: "medium",
    tools: ["read", "search", "find", "write", "edit", "web_search"],
    blocked_tools: ["apply_patch", "bash", "task"],
  },
  designer: {
    primary: "openai-codex/gpt-5.4",
    registry_alternate: "opencode-zen/gpt-5.4",
    thinkingLevel: "high",
    tools: ["*"],
    blocked_tools: [],
  },
  "code-simplifier": {
    primary: "openai-codex/gpt-5.5",
    registry_alternate: "opencode-zen/gpt-5.5",
    thinkingLevel: "xhigh",
    tools: ["*"],
    blocked_tools: [],
  },
  "qa-tester": {
    // thinkingLevel=high; all gpt-5.4 variants have vision per survey — no vision bump needed
    primary: "openai-codex/gpt-5.4",
    registry_alternate: "opencode-zen/gpt-5.4",
    thinkingLevel: "high",
    tools: ["*"],
    blocked_tools: [],
  },
  "git-master": {
    primary: "openai-codex/gpt-5.4",
    registry_alternate: "opencode-zen/gpt-5.4",
    thinkingLevel: "medium",
    tools: ["read", "search", "find", "bash"],
    blocked_tools: ["write", "edit", "apply_patch", "task"],
  },
  "document-specialist": {
    primary: "openai-codex/gpt-5.4",
    registry_alternate: "opencode-zen/gpt-5.4",
    thinkingLevel: "medium",
    tools: ["read", "search", "find", "bash", "recall", "web_search"],
    blocked_tools: ["write", "edit", "apply_patch", "task"],
  },
  tracer: {
    primary: "openai-codex/gpt-5.5",
    registry_alternate: "opencode-zen/gpt-5.5",
    thinkingLevel: "xhigh",
    tools: ["read", "search", "find", "bash", "lsp", "ast_grep", "eval", "debug"],
    blocked_tools: ["write", "edit", "apply_patch", "task"],
  },
  analyst: {
    primary: "openai-codex/gpt-5.5",
    registry_alternate: "opencode-zen/gpt-5.5",
    thinkingLevel: "xhigh",
    tools: ["read", "search", "find", "bash", "eval", "recall", "lsp", "ast_grep"],
    blocked_tools: ["write", "edit", "apply_patch", "task"],
  },
  architect: {
    primary: "openai-codex/gpt-5.5",
    registry_alternate: "opencode-zen/gpt-5.5",
    thinkingLevel: "xhigh",
    tools: ["read", "search", "find", "bash", "lsp", "ast_grep", "recall", "retain", "web_search"],
    blocked_tools: ["write", "edit", "apply_patch", "task"],
  },
  librarian: {
    primary: "openai-codex/gpt-5.4",
    registry_alternate: "opencode-zen/gpt-5.4",
    thinkingLevel: "medium",
    tools: ["read", "search", "find", "bash", "lsp", "web_search", "ast_grep", "recall"],
    blocked_tools: ["write", "edit", "apply_patch", "task"],
  },
  "multimodal-looker": {
    // thinkingLevel=medium; gpt-5.4 has vision per survey — no vision bump needed
    primary: "openai-codex/gpt-5.4",
    registry_alternate: "opencode-zen/gpt-5.4",
    thinkingLevel: "medium",
    tools: ["read", "search", "find", "bash", "inspect_image"],
    blocked_tools: ["write", "edit", "apply_patch", "task"],
  },
  oracle: {
    primary: "openai-codex/gpt-5.5",
    registry_alternate: "opencode-zen/gpt-5.5",
    thinkingLevel: "xhigh",
    tools: ["read", "search", "find", "bash", "recall", "retain", "lsp", "ast_grep", "web_search"],
    blocked_tools: ["write", "edit", "apply_patch", "task"],
  },
  metis: {
    primary: "openai-codex/gpt-5.5",
    registry_alternate: "opencode-zen/gpt-5.5",
    thinkingLevel: "high",
    tools: ["read", "search", "find", "bash", "recall", "task"],
    blocked_tools: ["write", "edit", "apply_patch"],
  },
  "deep-researcher": {
    primary: "openai-codex/gpt-5.5",
    registry_alternate: "opencode-zen/gpt-5.5",
    thinkingLevel: "xhigh",
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
 * Profile C — Tier-appropriate all-Anthropic.
 * Deliberate Spec E relaxation: `--profile C` (user mode) bulk-writes all 24
 * per-role `task.agentModelOverrides` so every subagent uses an Anthropic model.
 * Tier rule (by thinkingLevel from PROFILE_A):
 *   xhigh | high  → anthropic/claude-opus-4-8
 *   medium | low   → anthropic/claude-sonnet-4-6 (haiku-4-5 unavailable)
 * registry_alternate is always the opencode-zen/ mirror of the same model.
 * tools and blocked_tools are copied verbatim from PROFILE_A.
 * In user-global scope, Profile A is orchestrator-only while Profiles B/C/D
 * write all 24 per-role overrides. Project scope writes all 24 for every profile.
 */
export const PROFILE_C: ProfileMap = {
  executor: {
    primary: "anthropic/claude-opus-4-8",
    registry_alternate: "opencode-zen/claude-opus-4-8",
    thinkingLevel: "high",
    tools: ["*"],
    blocked_tools: [],
  },
  explorer: {
    primary: "anthropic/claude-sonnet-4-6",
    registry_alternate: "opencode-zen/claude-sonnet-4-6",
    thinkingLevel: "medium",
    tools: ["read", "search", "find", "bash", "web_search", "lsp", "ast_grep"],
    blocked_tools: ["write", "edit", "apply_patch", "task"],
  },
  verifier: {
    primary: "anthropic/claude-opus-4-8",
    registry_alternate: "opencode-zen/claude-opus-4-8",
    thinkingLevel: "high",
    tools: ["read", "search", "find", "bash", "recall", "task", "report_finding", "lsp"],
    blocked_tools: ["write", "edit", "apply_patch"],
  },
  critic: {
    primary: "anthropic/claude-opus-4-8",
    registry_alternate: "opencode-zen/claude-opus-4-8",
    thinkingLevel: "xhigh",
    tools: ["read", "search", "find", "report_finding", "recall", "web_search"],
    blocked_tools: ["write", "edit", "apply_patch", "bash", "task"],
  },
  planner: {
    primary: "anthropic/claude-opus-4-8",
    registry_alternate: "opencode-zen/claude-opus-4-8",
    thinkingLevel: "high",
    tools: ["read", "search", "find", "bash", "recall", "task", "lsp", "ast_grep", "web_search"],
    blocked_tools: ["write", "edit", "apply_patch"],
  },
  "code-reviewer": {
    primary: "anthropic/claude-opus-4-8",
    registry_alternate: "opencode-zen/claude-opus-4-8",
    thinkingLevel: "high",
    tools: ["read", "search", "find", "bash", "lsp", "ast_grep", "recall", "report_finding"],
    blocked_tools: ["write", "edit", "apply_patch", "task"],
  },
  debugger: {
    primary: "anthropic/claude-opus-4-8",
    registry_alternate: "opencode-zen/claude-opus-4-8",
    thinkingLevel: "high",
    tools: ["*"],
    blocked_tools: [],
  },
  "test-engineer": {
    primary: "anthropic/claude-opus-4-8",
    registry_alternate: "opencode-zen/claude-opus-4-8",
    thinkingLevel: "high",
    tools: ["*"],
    blocked_tools: [],
  },
  "security-reviewer": {
    primary: "anthropic/claude-opus-4-8",
    registry_alternate: "opencode-zen/claude-opus-4-8",
    thinkingLevel: "xhigh",
    tools: ["read", "search", "find", "bash", "recall", "web_search", "lsp", "ast_grep"],
    blocked_tools: ["write", "edit", "apply_patch", "task"],
  },
  writer: {
    primary: "anthropic/claude-sonnet-4-6",
    registry_alternate: "opencode-zen/claude-sonnet-4-6",
    thinkingLevel: "medium",
    tools: ["read", "search", "find", "write", "edit", "web_search"],
    blocked_tools: ["apply_patch", "bash", "task"],
  },
  designer: {
    primary: "anthropic/claude-opus-4-8",
    registry_alternate: "opencode-zen/claude-opus-4-8",
    thinkingLevel: "high",
    tools: ["*"],
    blocked_tools: [],
  },
  "code-simplifier": {
    primary: "anthropic/claude-opus-4-8",
    registry_alternate: "opencode-zen/claude-opus-4-8",
    thinkingLevel: "xhigh",
    tools: ["*"],
    blocked_tools: [],
  },
  "qa-tester": {
    primary: "anthropic/claude-opus-4-8",
    registry_alternate: "opencode-zen/claude-opus-4-8",
    thinkingLevel: "high",
    tools: ["*"],
    blocked_tools: [],
  },
  "git-master": {
    primary: "anthropic/claude-sonnet-4-6",
    registry_alternate: "opencode-zen/claude-sonnet-4-6",
    thinkingLevel: "low",
    tools: ["read", "search", "find", "bash"],
    blocked_tools: ["write", "edit", "apply_patch", "task"],
  },
  "document-specialist": {
    primary: "anthropic/claude-sonnet-4-6",
    registry_alternate: "opencode-zen/claude-sonnet-4-6",
    thinkingLevel: "medium",
    tools: ["read", "search", "find", "bash", "recall", "web_search"],
    blocked_tools: ["write", "edit", "apply_patch", "task"],
  },
  tracer: {
    primary: "anthropic/claude-opus-4-8",
    registry_alternate: "opencode-zen/claude-opus-4-8",
    thinkingLevel: "high",
    tools: ["read", "search", "find", "bash", "lsp", "ast_grep", "eval", "debug"],
    blocked_tools: ["write", "edit", "apply_patch", "task"],
  },
  analyst: {
    primary: "anthropic/claude-opus-4-8",
    registry_alternate: "opencode-zen/claude-opus-4-8",
    thinkingLevel: "xhigh",
    tools: ["read", "search", "find", "bash", "eval", "recall", "lsp", "ast_grep"],
    blocked_tools: ["write", "edit", "apply_patch", "task"],
  },
  architect: {
    primary: "anthropic/claude-opus-4-8",
    registry_alternate: "opencode-zen/claude-opus-4-8",
    thinkingLevel: "xhigh",
    tools: ["read", "search", "find", "bash", "lsp", "ast_grep", "recall", "retain", "web_search"],
    blocked_tools: ["write", "edit", "apply_patch", "task"],
  },
  librarian: {
    primary: "anthropic/claude-sonnet-4-6",
    registry_alternate: "opencode-zen/claude-sonnet-4-6",
    thinkingLevel: "medium",
    tools: ["read", "search", "find", "bash", "lsp", "web_search", "ast_grep", "recall"],
    blocked_tools: ["write", "edit", "apply_patch", "task"],
  },
  "multimodal-looker": {
    primary: "anthropic/claude-sonnet-4-6",
    registry_alternate: "opencode-zen/claude-sonnet-4-6",
    thinkingLevel: "medium",
    tools: ["read", "search", "find", "bash", "inspect_image"],
    blocked_tools: ["write", "edit", "apply_patch", "task"],
  },
  oracle: {
    primary: "anthropic/claude-opus-4-8",
    registry_alternate: "opencode-zen/claude-opus-4-8",
    thinkingLevel: "xhigh",
    tools: ["read", "search", "find", "bash", "recall", "retain", "lsp", "ast_grep", "web_search"],
    blocked_tools: ["write", "edit", "apply_patch", "task"],
  },
  metis: {
    primary: "anthropic/claude-opus-4-8",
    registry_alternate: "opencode-zen/claude-opus-4-8",
    thinkingLevel: "xhigh",
    tools: ["read", "search", "find", "bash", "recall", "task"],
    blocked_tools: ["write", "edit", "apply_patch"],
  },
  "deep-researcher": {
    primary: "anthropic/claude-opus-4-8",
    registry_alternate: "opencode-zen/claude-opus-4-8",
    thinkingLevel: "high",
    tools: ["read", "search", "find", "web_search", "retain", "recall", "reflect"],
    blocked_tools: ["write", "edit", "apply_patch", "task"],
  },
  "data-runner": {
    primary: "anthropic/claude-opus-4-8",
    registry_alternate: "opencode-zen/claude-opus-4-8",
    thinkingLevel: "high",
    tools: ["bash", "eval", "read", "write", "retain"],
    blocked_tools: ["edit", "apply_patch", "task"],
  },
};

/**
 * Profile D — opencode-zen only, "quality tone" (kimi-k2.6 heavy).
 * Spec: all 24 roles use exclusively enabled opencode-zen models.
 * Tiering rule (thinkingLevel copied verbatim from PROFILE_A):
 *   xhigh + high roles               → opencode-zen/kimi-k2.6 (primary), opencode-zen/glm-5.1 (alt)
 *   medium NON-vision roles           → opencode-zen/minimax-m2.5 (primary), opencode-zen/glm-5.1 (alt)
 *   VISION roles (multimodal-looker, qa-tester) → opencode-zen/gemini-3-flash (primary), opencode-zen/minimax-m2.5 (alt)
 *   low (git-master)                  → opencode-zen/minimax-m2.5 (primary), opencode-zen/glm-5.1 (alt)
 * tools and blocked_tools copied verbatim from PROFILE_A.
 */
export const PROFILE_D: ProfileMap = {
  executor: {
    primary: "opencode-zen/kimi-k2.6",
    registry_alternate: "opencode-zen/glm-5.1",
    thinkingLevel: "high",
    tools: ["*"],
    blocked_tools: [],
  },
  explorer: {
    primary: "opencode-zen/minimax-m2.5",
    registry_alternate: "opencode-zen/glm-5.1",
    thinkingLevel: "medium",
    tools: ["read", "search", "find", "bash", "web_search", "lsp", "ast_grep"],
    blocked_tools: ["write", "edit", "apply_patch", "task"],
  },
  verifier: {
    primary: "opencode-zen/kimi-k2.6",
    registry_alternate: "opencode-zen/glm-5.1",
    thinkingLevel: "high",
    tools: ["read", "search", "find", "bash", "recall", "task", "report_finding", "lsp"],
    blocked_tools: ["write", "edit", "apply_patch"],
  },
  critic: {
    primary: "opencode-zen/kimi-k2.6",
    registry_alternate: "opencode-zen/glm-5.1",
    thinkingLevel: "xhigh",
    tools: ["read", "search", "find", "report_finding", "recall", "web_search"],
    blocked_tools: ["write", "edit", "apply_patch", "bash", "task"],
  },
  planner: {
    primary: "opencode-zen/kimi-k2.6",
    registry_alternate: "opencode-zen/glm-5.1",
    thinkingLevel: "high",
    tools: ["read", "search", "find", "bash", "recall", "task", "lsp", "ast_grep", "web_search"],
    blocked_tools: ["write", "edit", "apply_patch"],
  },
  "code-reviewer": {
    primary: "opencode-zen/kimi-k2.6",
    registry_alternate: "opencode-zen/glm-5.1",
    thinkingLevel: "high",
    tools: ["read", "search", "find", "bash", "lsp", "ast_grep", "recall", "report_finding"],
    blocked_tools: ["write", "edit", "apply_patch", "task"],
  },
  debugger: {
    primary: "opencode-zen/kimi-k2.6",
    registry_alternate: "opencode-zen/glm-5.1",
    thinkingLevel: "high",
    tools: ["*"],
    blocked_tools: [],
  },
  "test-engineer": {
    primary: "opencode-zen/kimi-k2.6",
    registry_alternate: "opencode-zen/glm-5.1",
    thinkingLevel: "high",
    tools: ["*"],
    blocked_tools: [],
  },
  "security-reviewer": {
    primary: "opencode-zen/kimi-k2.6",
    registry_alternate: "opencode-zen/glm-5.1",
    thinkingLevel: "xhigh",
    tools: ["read", "search", "find", "bash", "recall", "web_search", "lsp", "ast_grep"],
    blocked_tools: ["write", "edit", "apply_patch", "task"],
  },
  writer: {
    primary: "opencode-zen/minimax-m2.5",
    registry_alternate: "opencode-zen/glm-5.1",
    thinkingLevel: "medium",
    tools: ["read", "search", "find", "write", "edit", "web_search"],
    blocked_tools: ["apply_patch", "bash", "task"],
  },
  designer: {
    primary: "opencode-zen/kimi-k2.6",
    registry_alternate: "opencode-zen/glm-5.1",
    thinkingLevel: "high",
    tools: ["*"],
    blocked_tools: [],
  },
  "code-simplifier": {
    primary: "opencode-zen/kimi-k2.6",
    registry_alternate: "opencode-zen/glm-5.1",
    thinkingLevel: "xhigh",
    tools: ["*"],
    blocked_tools: [],
  },
  "qa-tester": {
    primary: "opencode-zen/gemini-3-flash",
    registry_alternate: "opencode-zen/minimax-m2.5",
    thinkingLevel: "high",
    tools: ["*"],
    blocked_tools: [],
  },
  "git-master": {
    primary: "opencode-zen/minimax-m2.5",
    registry_alternate: "opencode-zen/glm-5.1",
    thinkingLevel: "low",
    tools: ["read", "search", "find", "bash"],
    blocked_tools: ["write", "edit", "apply_patch", "task"],
  },
  "document-specialist": {
    primary: "opencode-zen/minimax-m2.5",
    registry_alternate: "opencode-zen/glm-5.1",
    thinkingLevel: "medium",
    tools: ["read", "search", "find", "bash", "recall", "web_search"],
    blocked_tools: ["write", "edit", "apply_patch", "task"],
  },
  tracer: {
    primary: "opencode-zen/kimi-k2.6",
    registry_alternate: "opencode-zen/glm-5.1",
    thinkingLevel: "high",
    tools: ["read", "search", "find", "bash", "lsp", "ast_grep", "eval", "debug"],
    blocked_tools: ["write", "edit", "apply_patch", "task"],
  },
  analyst: {
    primary: "opencode-zen/kimi-k2.6",
    registry_alternate: "opencode-zen/glm-5.1",
    thinkingLevel: "xhigh",
    tools: ["read", "search", "find", "bash", "eval", "recall", "lsp", "ast_grep"],
    blocked_tools: ["write", "edit", "apply_patch", "task"],
  },
  architect: {
    primary: "opencode-zen/kimi-k2.6",
    registry_alternate: "opencode-zen/glm-5.1",
    thinkingLevel: "xhigh",
    tools: ["read", "search", "find", "bash", "lsp", "ast_grep", "recall", "retain", "web_search"],
    blocked_tools: ["write", "edit", "apply_patch", "task"],
  },
  librarian: {
    primary: "opencode-zen/minimax-m2.5",
    registry_alternate: "opencode-zen/glm-5.1",
    thinkingLevel: "medium",
    tools: ["read", "search", "find", "bash", "lsp", "web_search", "ast_grep", "recall"],
    blocked_tools: ["write", "edit", "apply_patch", "task"],
  },
  "multimodal-looker": {
    primary: "opencode-zen/gemini-3-flash",
    registry_alternate: "opencode-zen/minimax-m2.5",
    thinkingLevel: "medium",
    tools: ["read", "search", "find", "bash", "inspect_image"],
    blocked_tools: ["write", "edit", "apply_patch", "task"],
  },
  oracle: {
    primary: "opencode-zen/kimi-k2.6",
    registry_alternate: "opencode-zen/glm-5.1",
    thinkingLevel: "xhigh",
    tools: ["read", "search", "find", "bash", "recall", "retain", "lsp", "ast_grep", "web_search"],
    blocked_tools: ["write", "edit", "apply_patch", "task"],
  },
  metis: {
    primary: "opencode-zen/kimi-k2.6",
    registry_alternate: "opencode-zen/glm-5.1",
    thinkingLevel: "xhigh",
    tools: ["read", "search", "find", "bash", "recall", "task"],
    blocked_tools: ["write", "edit", "apply_patch"],
  },
  "deep-researcher": {
    primary: "opencode-zen/kimi-k2.6",
    registry_alternate: "opencode-zen/glm-5.1",
    thinkingLevel: "high",
    tools: ["read", "search", "find", "web_search", "retain", "recall", "reflect"],
    blocked_tools: ["write", "edit", "apply_patch", "task"],
  },
  "data-runner": {
    primary: "opencode-zen/kimi-k2.6",
    registry_alternate: "opencode-zen/glm-5.1",
    thinkingLevel: "high",
    tools: ["bash", "eval", "read", "write", "retain"],
    blocked_tools: ["edit", "apply_patch", "task"],
  },
};

export const PROFILE_D_ORCHESTRATOR: OrchestratorModels = {
  default: "opencode-zen/kimi-k2.6:high",
  title: "opencode-zen/minimax-m2.5:low",
};

export const PROFILE_D_FALLBACK_CHAINS: Record<string, string[]> = {
  default: ["opencode-zen/glm-5.1"],
  title: ["opencode-zen/minimax-m2.5"],
};
