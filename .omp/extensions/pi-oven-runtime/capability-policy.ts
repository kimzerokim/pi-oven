import {
  CAPABILITY_POLICY_VERSION,
  getCapabilityRule,
  type CapabilityApproval,
  type CapabilityAudience,
  type CapabilityRule,
} from "./capability-registry";

export type CapabilityPolicyMode = "interactive" | "autonomous";

export interface CapabilityPolicyInput {
  toolName: string;
  input: unknown;
  mode: CapabilityPolicyMode;
  audience: CapabilityAudience;
  /** A trusted runtime classifier may mark a new tool call as mutating. */
  mutationIntent?: boolean;
}

export interface CapabilityPolicyDecision {
  block: boolean;
  reason?: string;
  policyVersion: typeof CAPABILITY_POLICY_VERSION;
  rule?: CapabilityRule;
  approval?: CapabilityApproval;
}

const MUTATION_TOKEN =
  /(?:^|[_-])(apply|commit|create|delete|deploy|edit|exec|execute|install|mutate|patch|publish|push|release|remove|rm|run|save|send|set|shell|update|upload|write)(?:$|[_-])/i;

const MUTATION_ARGUMENT_KEYS = new Set([
  "changes",
  "content",
  "data",
  "destination",
  "edits",
  "patch",
  "payload",
  "replacement",
]);

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

/** Conservative fallback used only for tools not present in the registry. */
export function inferUnknownMutation(toolName: string, input: unknown): boolean {
  if (MUTATION_TOKEN.test(toolName)) return true;
  if (!isRecord(input)) return false;
  if (input.mutation === true || input.mutate === true || input.write === true) return true;
  if (Object.keys(input).some((key) => MUTATION_ARGUMENT_KEYS.has(key))) return true;
  for (const key of ["action", "operation", "command", "method"] as const) {
    const value = input[key];
    if (typeof value === "string" && MUTATION_TOKEN.test(value)) return true;
  }
  return false;
}

/**
 * Evaluate only the versioned tool/risk/argument boundary. A non-blocking
 * mutation decision is not authorization: gate.ts must still establish the
 * rule's state proof or user-consent obligation for the concrete call.
 */
export function evaluateCapabilityPolicy(
  input: CapabilityPolicyInput
): CapabilityPolicyDecision {
  const rule = getCapabilityRule(input.toolName);
  if (!rule) {
    if (input.mode === "autonomous") {
      return {
        block: true,
        policyVersion: CAPABILITY_POLICY_VERSION,
        reason:
          `pi-oven: unknown tool \`${input.toolName}\` blocked in autonomous mode ` +
          `(capability policy v${CAPABILITY_POLICY_VERSION} default deny). Add a versioned rule, risk classification, and argument tests before retrying.`,
      };
    }
    const mutation =
      input.mutationIntent === true || inferUnknownMutation(input.toolName, input.input);
    return {
      block: true,
      policyVersion: CAPABILITY_POLICY_VERSION,
      reason: mutation
        ? `pi-oven: unknown mutation tool \`${input.toolName}\` blocked in interactive mode. ` +
          "Explicit user action must update the versioned capability policy before this mutation can run."
        : `pi-oven: unknown tool \`${input.toolName}\` has no classified interactive policy rule. ` +
          "Explicit user action must add a versioned rule before this call can run.",
    };
  }

  if (!rule.audiences.includes(input.audience)) {
    return {
      block: true,
      policyVersion: CAPABILITY_POLICY_VERSION,
      rule,
      approval: rule.approval,
      reason: `pi-oven: tool \`${input.toolName}\` is not allowed for the ${input.audience} audience by capability policy v${CAPABILITY_POLICY_VERSION}.`,
    };
  }

  try {
    const args = rule.validateArgs(input.input);
    if (!args.valid) {
      return {
        block: true,
        policyVersion: CAPABILITY_POLICY_VERSION,
        rule,
        approval: rule.approval,
        reason: `pi-oven: malformed arguments blocked for \`${input.toolName}\`: ${args.reason}.`,
      };
    }
  } catch {
    return {
      block: true,
      policyVersion: CAPABILITY_POLICY_VERSION,
      rule,
      approval: rule.approval,
      reason: `pi-oven: argument validation failed closed for \`${input.toolName}\`.`,
    };
  }

  return {
    block: false,
    policyVersion: CAPABILITY_POLICY_VERSION,
    rule,
    approval: rule.approval,
  };
}
