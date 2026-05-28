/**
 * Profile A/B default model maps for all 23 pi-oven roles.
 * Source of truth: Spec B §4 (Profile A) and §5 (Profile B).
 */

export const EXPECTED_AGENT_COUNT = 23; // matches Spec A §4 taxonomy

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
  "scientist",
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
 * Uses opencode-zen and openai-codex models only. No anthropic models.
 * Verbatim from Spec B §4 table.
 */
export const PROFILE_A: ProfileMap = {
  executor: {
    primary: "openai-codex/gpt-5.3-codex",
    registry_alternate: "opencode-zen/gpt-5.3-codex",
    thinkingLevel: "high",
  },
  explorer: {
    primary: "opencode-zen/glm-5",
    registry_alternate: "opencode-zen/claude-haiku-4-5",
    thinkingLevel: "medium",
  },
  verifier: {
    primary: "opencode-zen/kimi-k2.6",
    registry_alternate: "opencode-zen/claude-sonnet-4-6",
    thinkingLevel: "medium",
  },
  critic: {
    primary: "opencode-zen/claude-opus-4-7",
    registry_alternate: "openai-codex/gpt-5.4",
    thinkingLevel: "xhigh",
  },
  planner: {
    primary: "opencode-zen/claude-sonnet-4-6",
    registry_alternate: "opencode-zen/claude-opus-4-7",
    thinkingLevel: "high",
  },
  "code-reviewer": {
    primary: "opencode-zen/claude-opus-4-7",
    registry_alternate: "opencode-zen/claude-sonnet-4-6",
    thinkingLevel: "high",
  },
  debugger: {
    primary: "opencode-zen/gpt-5.3-codex",
    registry_alternate: "opencode-zen/claude-sonnet-4-6",
    thinkingLevel: "high",
  },
  "test-engineer": {
    primary: "opencode-zen/claude-sonnet-4-6",
    registry_alternate: "opencode-zen/claude-opus-4-7",
    thinkingLevel: "high",
  },
  "security-reviewer": {
    primary: "opencode-zen/claude-opus-4-7",
    registry_alternate: "opencode-zen/claude-sonnet-4-6",
    thinkingLevel: "xhigh",
  },
  writer: {
    primary: "opencode-zen/claude-haiku-4-5",
    registry_alternate: "opencode-zen/claude-sonnet-4-6",
    thinkingLevel: "medium",
  },
  designer: {
    primary: "opencode-zen/claude-sonnet-4-6",
    registry_alternate: "opencode-zen/claude-opus-4-7",
    thinkingLevel: "high",
  },
  "code-simplifier": {
    primary: "opencode-zen/claude-opus-4-7",
    registry_alternate: "opencode-zen/claude-sonnet-4-6",
    thinkingLevel: "xhigh",
  },
  "qa-tester": {
    primary: "opencode-zen/claude-sonnet-4-6",
    registry_alternate: "opencode-zen/claude-haiku-4-5",
    thinkingLevel: "high",
  },
  "git-master": {
    primary: "opencode-zen/claude-haiku-4-5",
    registry_alternate: "opencode-zen/claude-sonnet-4-6",
    thinkingLevel: "minimal",
  },
  "document-specialist": {
    primary: "opencode-zen/claude-sonnet-4-6",
    registry_alternate: "opencode-zen/claude-haiku-4-5",
    thinkingLevel: "medium",
  },
  tracer: {
    primary: "opencode-zen/claude-sonnet-4-6",
    registry_alternate: "opencode-zen/claude-opus-4-7",
    thinkingLevel: "high",
  },
  analyst: {
    primary: "opencode-zen/claude-opus-4-7",
    registry_alternate: "opencode-zen/claude-sonnet-4-6",
    thinkingLevel: "xhigh",
  },
  scientist: {
    primary: "opencode-zen/claude-opus-4-7",
    registry_alternate: "opencode-zen/claude-sonnet-4-6",
    thinkingLevel: "xhigh",
  },
  architect: {
    primary: "opencode-zen/claude-opus-4-7",
    registry_alternate: "opencode-zen/claude-sonnet-4-6",
    thinkingLevel: "xhigh",
  },
  librarian: {
    primary: "opencode-zen/glm-5",
    registry_alternate: "opencode-zen/claude-sonnet-4-6",
    thinkingLevel: "medium",
  },
  "multimodal-looker": {
    primary: "opencode-zen/claude-sonnet-4-6",
    registry_alternate: "opencode-zen/claude-opus-4-7",
    thinkingLevel: "medium",
  },
  oracle: {
    primary: "opencode-zen/claude-opus-4-7",
    registry_alternate: "opencode-zen/claude-sonnet-4-6",
    thinkingLevel: "xhigh",
  },
  metis: {
    primary: "opencode-zen/claude-opus-4-7",
    registry_alternate: "opencode-zen/claude-sonnet-4-6",
    thinkingLevel: "xhigh",
  },
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
    thinkingLevel: "medium",
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
    thinkingLevel: "minimal",
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
  scientist: {
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
