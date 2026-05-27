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
    primary: "opencode-zen/gpt-5.3-codex",
    registry_alternate: "openai-codex/gpt-5.3-codex",
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
    registry_alternate: "opencode-zen/gpt-5.4",
    thinkingLevel: "high",
  },
  planner: {
    primary: "opencode-zen/claude-sonnet-4-6",
    registry_alternate: "opencode-zen/claude-opus-4-7",
    thinkingLevel: "medium",
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
    thinkingLevel: "medium",
  },
  "security-reviewer": {
    primary: "opencode-zen/claude-opus-4-7",
    registry_alternate: "opencode-zen/claude-sonnet-4-6",
    thinkingLevel: "high",
  },
  writer: {
    primary: "opencode-zen/claude-haiku-4-5",
    registry_alternate: "opencode-zen/claude-sonnet-4-6",
    thinkingLevel: "low",
  },
  designer: {
    primary: "opencode-zen/claude-sonnet-4-6",
    registry_alternate: "opencode-zen/claude-opus-4-7",
    thinkingLevel: "medium",
  },
  "code-simplifier": {
    primary: "opencode-zen/claude-opus-4-7",
    registry_alternate: "opencode-zen/claude-sonnet-4-6",
    thinkingLevel: "medium",
  },
  "qa-tester": {
    primary: "opencode-zen/claude-sonnet-4-6",
    registry_alternate: "opencode-zen/claude-haiku-4-5",
    thinkingLevel: "medium",
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
    thinkingLevel: "medium",
  },
  analyst: {
    primary: "opencode-zen/claude-opus-4-7",
    registry_alternate: "opencode-zen/claude-sonnet-4-6",
    thinkingLevel: "high",
  },
  scientist: {
    primary: "opencode-zen/claude-opus-4-7",
    registry_alternate: "opencode-zen/claude-sonnet-4-6",
    thinkingLevel: "high",
  },
  architect: {
    primary: "opencode-zen/claude-opus-4-7",
    registry_alternate: "opencode-zen/claude-sonnet-4-6",
    thinkingLevel: "xhigh",
  },
  librarian: {
    primary: "opencode-zen/glm-5",
    registry_alternate: "opencode-zen/claude-sonnet-4-6",
    thinkingLevel: "minimal",
  },
  "multimodal-looker": {
    primary: "opencode-zen/claude-sonnet-4-6",
    registry_alternate: "opencode-zen/claude-opus-4-7",
    thinkingLevel: "low",
  },
  oracle: {
    primary: "opencode-zen/claude-opus-4-7",
    registry_alternate: "opencode-zen/claude-sonnet-4-6",
    thinkingLevel: "xhigh",
  },
  metis: {
    primary: "opencode-zen/claude-opus-4-7",
    registry_alternate: "opencode-zen/claude-sonnet-4-6",
    thinkingLevel: "high",
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
    thinkingLevel: "high",
  },
  planner: {
    primary: "anthropic/claude-sonnet-4-6",
    registry_alternate: "opencode-zen/claude-sonnet-4-6",
    thinkingLevel: "medium",
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
    thinkingLevel: "medium",
  },
  "security-reviewer": {
    primary: "anthropic/claude-opus-4-7",
    registry_alternate: "opencode-zen/claude-opus-4-7",
    thinkingLevel: "high",
  },
  writer: {
    primary: "anthropic/claude-haiku-4-5",
    registry_alternate: "opencode-zen/claude-haiku-4-5",
    thinkingLevel: "low",
  },
  designer: {
    primary: "anthropic/claude-sonnet-4-6",
    registry_alternate: "opencode-zen/claude-sonnet-4-6",
    thinkingLevel: "medium",
  },
  "code-simplifier": {
    primary: "anthropic/claude-opus-4-7",
    registry_alternate: "opencode-zen/claude-opus-4-7",
    thinkingLevel: "medium",
  },
  "qa-tester": {
    primary: "anthropic/claude-sonnet-4-6",
    registry_alternate: "opencode-zen/claude-sonnet-4-6",
    thinkingLevel: "medium",
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
    thinkingLevel: "medium",
  },
  analyst: {
    primary: "anthropic/claude-opus-4-7",
    registry_alternate: "opencode-zen/claude-opus-4-7",
    thinkingLevel: "high",
  },
  scientist: {
    primary: "anthropic/claude-opus-4-7",
    registry_alternate: "opencode-zen/claude-opus-4-7",
    thinkingLevel: "high",
  },
  architect: {
    primary: "anthropic/claude-opus-4-7",
    registry_alternate: "opencode-zen/claude-opus-4-7",
    thinkingLevel: "xhigh",
  },
  librarian: {
    primary: "opencode-zen/glm-5",
    registry_alternate: "anthropic/claude-haiku-4-5",
    thinkingLevel: "minimal",
  },
  "multimodal-looker": {
    primary: "anthropic/claude-sonnet-4-6",
    registry_alternate: "opencode-zen/claude-sonnet-4-6",
    thinkingLevel: "low",
  },
  oracle: {
    primary: "anthropic/claude-opus-4-7",
    registry_alternate: "opencode-zen/claude-opus-4-7",
    thinkingLevel: "xhigh",
  },
  metis: {
    primary: "anthropic/claude-opus-4-7",
    registry_alternate: "opencode-zen/claude-opus-4-7",
    thinkingLevel: "high",
  },
};
