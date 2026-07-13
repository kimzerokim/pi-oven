/**
 * Default model map for all 24 pi-oven roles.
 * pi-oven runtime/setup now exposes a single codex-only routing surface.
 */

import {
  EXPECTED_ROLE_COUNT,
  ROLE_NAMES,
  type RoleName,
} from "../../.omp/extensions/pi-oven-runtime/runtime-contract";

export const EXPECTED_AGENT_COUNT = EXPECTED_ROLE_COUNT; // compatibility alias
export const ROLES = ROLE_NAMES; // one-release compatibility alias
export type Role = RoleName;

export interface ModelEntry {
  primary: string;
  thinkingLevel: "low" | "medium" | "high" | "xhigh";
  tools: string[];
  blocked_tools: string[];
}

export type ProfileMap = Record<Role, ModelEntry>;
const EXECUTOR_DEBUGGER_TOOLS = [
  "read",
  "search",
  "find",
  "write",
  "edit",
  "lsp",
  "ast_grep",
  "debug",
  "eval",
  "bash",
] as const;

const TEST_ENGINEER_TOOLS = [...EXECUTOR_DEBUGGER_TOOLS, "browser"] as const;

const DESIGNER_TOOLS = [
  "read",
  "search",
  "find",
  "write",
  "edit",
  "bash",
  "browser",
  "inspect_image",
  "task",
  "web_search",
] as const;

const CODE_SIMPLIFIER_TOOLS = [
  "read",
  "search",
  "find",
  "write",
  "edit",
  "lsp",
  "ast_grep",
  "eval",
  "bash",
] as const;

const QA_TESTER_TOOLS = [
  "read",
  "search",
  "find",
  "bash",
  "browser",
  "inspect_image",
  "task",
] as const;

/**
 * Codex-only default routing matrix.
 * Pins all 24 roles to codex-family selectors so large executor/explorer/review
 * waves do not depend on mixed-provider auth.
 * Model tier and thinking effort are deliberately decoupled:
 *   - gpt-5.5 for implementation, causal investigation, review, planning,
 *     architecture, advisory, and deep research roles.
 *   - gpt-5.4 for fast fan-out, docs/search/vision/git/data-runner roles.
 *   - xhigh only for high-value review/security/verification/oracle/deep-research
 *     rollouts where extra latency buys correctness.
 *   - medium for retrieval, docs, writing, git, and vision fan-out.
 * This biases routing for aggressive subagent batching. The policy target stays
 * 8-12 dependency-safe siblings per wave; OMP `task.maxConcurrency` and
 * provider/runtime admission determine actual live-worker capacity.
 */
export const DEFAULT_PROFILE: ProfileMap = {
  executor: {
    primary: "openai-codex/gpt-5.5",
    thinkingLevel: "high",
    tools: [...EXECUTOR_DEBUGGER_TOOLS],
    blocked_tools: [],
  },
  explorer: {
    primary: "openai-codex/gpt-5.4",
    thinkingLevel: "medium",
    tools: ["read", "search", "find", "bash", "web_search", "lsp", "ast_grep"],
    blocked_tools: ["write", "edit", "apply_patch", "task"],
  },
  verifier: {
    primary: "openai-codex/gpt-5.5",
    thinkingLevel: "xhigh",
    tools: ["read", "search", "find", "bash", "recall", "task", "report_finding", "lsp"],
    blocked_tools: ["write", "edit", "apply_patch"],
  },
  critic: {
    primary: "openai-codex/gpt-5.5",
    thinkingLevel: "xhigh",
    tools: ["read", "search", "find", "report_finding", "recall", "web_search"],
    blocked_tools: ["write", "edit", "apply_patch", "bash", "task"],
  },
  planner: {
    primary: "openai-codex/gpt-5.5",
    thinkingLevel: "high",
    tools: ["read", "search", "find", "bash", "recall", "task", "lsp", "ast_grep", "web_search"],
    blocked_tools: ["write", "edit", "apply_patch"],
  },
  "code-reviewer": {
    primary: "openai-codex/gpt-5.5",
    thinkingLevel: "high",
    tools: ["read", "search", "find", "bash", "lsp", "ast_grep", "recall", "report_finding"],
    blocked_tools: ["write", "edit", "apply_patch", "task"],
  },
  debugger: {
    primary: "openai-codex/gpt-5.5",
    thinkingLevel: "high",
    tools: [...EXECUTOR_DEBUGGER_TOOLS],
    blocked_tools: [],
  },
  "test-engineer": {
    primary: "openai-codex/gpt-5.5",
    thinkingLevel: "high",
    tools: [...TEST_ENGINEER_TOOLS],
    blocked_tools: [],
  },
  "security-reviewer": {
    primary: "openai-codex/gpt-5.5",
    thinkingLevel: "xhigh",
    tools: ["read", "search", "find", "bash", "recall", "web_search", "lsp", "ast_grep"],
    blocked_tools: ["write", "edit", "apply_patch", "task"],
  },
  writer: {
    primary: "openai-codex/gpt-5.4",
    thinkingLevel: "medium",
    tools: ["read", "search", "find", "write", "edit", "web_search"],
    blocked_tools: ["apply_patch", "bash", "task"],
  },
  designer: {
    primary: "openai-codex/gpt-5.4",
    thinkingLevel: "high",
    tools: [...DESIGNER_TOOLS],
    blocked_tools: [],
  },
  "code-simplifier": {
    primary: "openai-codex/gpt-5.5",
    thinkingLevel: "high",
    tools: [...CODE_SIMPLIFIER_TOOLS],
    blocked_tools: [],
  },
  "qa-tester": {
    // thinkingLevel=high; all gpt-5.4 variants have vision per survey — no vision bump needed
    primary: "openai-codex/gpt-5.4",
    thinkingLevel: "high",
    tools: [...QA_TESTER_TOOLS],
    blocked_tools: [],
  },
  "git-master": {
    primary: "openai-codex/gpt-5.4",
    thinkingLevel: "medium",
    tools: ["read", "search", "find", "bash"],
    blocked_tools: ["write", "edit", "apply_patch", "task"],
  },
  "document-specialist": {
    primary: "openai-codex/gpt-5.4",
    thinkingLevel: "medium",
    tools: ["read", "search", "find", "bash", "recall", "web_search"],
    blocked_tools: ["write", "edit", "apply_patch", "task"],
  },
  tracer: {
    primary: "openai-codex/gpt-5.5",
    thinkingLevel: "high",
    tools: ["read", "search", "find", "bash", "lsp", "ast_grep", "eval", "debug"],
    blocked_tools: ["write", "edit", "apply_patch", "task"],
  },
  analyst: {
    primary: "openai-codex/gpt-5.5",
    thinkingLevel: "high",
    tools: ["read", "search", "find", "bash", "eval", "recall", "lsp", "ast_grep"],
    blocked_tools: ["write", "edit", "apply_patch", "task"],
  },
  architect: {
    primary: "openai-codex/gpt-5.5",
    thinkingLevel: "high",
    tools: ["read", "search", "find", "bash", "lsp", "ast_grep", "recall", "retain", "web_search"],
    blocked_tools: ["write", "edit", "apply_patch", "task"],
  },
  librarian: {
    primary: "openai-codex/gpt-5.4",
    thinkingLevel: "medium",
    tools: ["read", "search", "find", "bash", "lsp", "web_search", "ast_grep", "recall"],
    blocked_tools: ["write", "edit", "apply_patch", "task"],
  },
  "multimodal-looker": {
    // thinkingLevel=medium; gpt-5.4 has vision per survey — no vision bump needed
    primary: "openai-codex/gpt-5.4",
    thinkingLevel: "medium",
    tools: ["read", "search", "find", "bash", "inspect_image"],
    blocked_tools: ["write", "edit", "apply_patch", "task"],
  },
  oracle: {
    primary: "openai-codex/gpt-5.5",
    thinkingLevel: "xhigh",
    tools: ["read", "search", "find", "bash", "recall", "retain", "lsp", "ast_grep", "web_search"],
    blocked_tools: ["write", "edit", "apply_patch", "task"],
  },
  metis: {
    primary: "openai-codex/gpt-5.5",
    thinkingLevel: "high",
    tools: ["read", "search", "find", "bash", "recall", "task"],
    blocked_tools: ["write", "edit", "apply_patch"],
  },
  "deep-researcher": {
    primary: "openai-codex/gpt-5.5",
    thinkingLevel: "xhigh",
    tools: ["read", "search", "find", "web_search", "retain", "recall", "reflect"],
    blocked_tools: ["write", "edit", "apply_patch", "task"],
  },
  "data-runner": {
    primary: "openai-codex/gpt-5.4",
    thinkingLevel: "high",
    tools: ["bash", "eval", "read", "write", "retain"],
    blocked_tools: ["edit", "apply_patch", "task"],
  },
};


export interface OrchestratorModels {
  default: string;
  title: string;
}

export const DEFAULT_ORCHESTRATOR: OrchestratorModels = {
  default: "openai-codex/gpt-5.4:high",
  title: "openai-codex/gpt-5.4:medium",
};

export const DEFAULT_FALLBACK_CHAINS: Record<string, string[]> = {
  default: [],
  title: [],
};
