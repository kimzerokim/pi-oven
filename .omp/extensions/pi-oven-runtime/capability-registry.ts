export const CAPABILITY_IDS = [
  "code_write",
  "owned_write_lane",
  "shared_write_lane",
  "external_read",
  "external_mutation",
  "ask",
  "autonomous_continuation",
  "verification_completion",
  "debug_trace",
  "release_install_sync",
] as const;

export type CapabilityId = (typeof CAPABILITY_IDS)[number];

/** Increment whenever a rule, classification, validator, or approval contract changes. */
export const CAPABILITY_POLICY_VERSION = 1 as const;

export type CapabilityRisk =
  | "read"
  | "local-write"
  | "external-read"
  | "external-mutation";
export type CapabilityAudience = "parent" | "worker";
export type CapabilityApproval = "none" | "state-proof" | "user-consent";

export type CapabilityArgsResult =
  | { valid: true }
  | { valid: false; reason: string };

export interface CapabilityRule {
  toolName: string;
  capability: CapabilityId;
  risk: CapabilityRisk;
  audiences: CapabilityAudience[];
  validateArgs(input: unknown): CapabilityArgsResult;
  approval: CapabilityApproval;
}

export const CAPABILITY_TAGS = ["deep-interview", "verification", "runtime-routing", "gate"] as const;

export type CapabilityTag = (typeof CAPABILITY_TAGS)[number];

export const CAPABILITY_TAGS_BY_ID: Readonly<Record<CapabilityId, readonly CapabilityTag[]>> = {
  code_write: ["gate", "runtime-routing"],
  owned_write_lane: ["runtime-routing"],
  shared_write_lane: ["runtime-routing"],
  external_read: ["gate", "runtime-routing"],
  external_mutation: ["gate", "runtime-routing"],
  ask: ["deep-interview", "runtime-routing"],
  autonomous_continuation: ["verification", "runtime-routing"],
  verification_completion: ["verification", "runtime-routing"],
  debug_trace: ["verification", "runtime-routing"],
  release_install_sync: ["verification", "runtime-routing"],
};

const CAPABILITIES_BY_TAG: Readonly<Record<CapabilityTag, readonly CapabilityId[]>> = {
  "deep-interview": CAPABILITY_IDS.filter((capability) =>
    CAPABILITY_TAGS_BY_ID[capability].includes("deep-interview")
  ),
  verification: CAPABILITY_IDS.filter((capability) =>
    CAPABILITY_TAGS_BY_ID[capability].includes("verification")
  ),
  "runtime-routing": CAPABILITY_IDS.filter((capability) =>
    CAPABILITY_TAGS_BY_ID[capability].includes("runtime-routing")
  ),
  gate: CAPABILITY_IDS.filter((capability) => CAPABILITY_TAGS_BY_ID[capability].includes("gate")),
};

export function getCapabilityTags(capability: CapabilityId): readonly CapabilityTag[] {
  return CAPABILITY_TAGS_BY_ID[capability];
}

export function getCapabilitiesByTag(tag: CapabilityTag): readonly CapabilityId[] {
  return CAPABILITIES_BY_TAG[tag];
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

function requireRecord(input: unknown): CapabilityArgsResult {
  return isRecord(input)
    ? { valid: true }
    : { valid: false, reason: "input must be an object" };
}

function requireStringField(
  field: string,
  alternatives: readonly string[] = []
): (input: unknown) => CapabilityArgsResult {
  const fields = [field, ...alternatives];
  return (input) => {
    if (!isRecord(input)) return { valid: false, reason: "input must be an object" };
    if (
      fields.some(
        (candidate) =>
          typeof input[candidate] === "string" && (input[candidate] as string).trim().length > 0
      )
    ) {
      return { valid: true };
    }
    return {
      valid: false,
      reason: `input requires a non-empty ${fields.join(" or ")} string`,
    };
  };
}

function requireAllStringFields(...fields: string[]): (input: unknown) => CapabilityArgsResult {
  return (input) => {
    if (!isRecord(input)) return { valid: false, reason: "input must be an object" };
    const missing = fields.filter(
      (field) => typeof input[field] !== "string" || (input[field] as string).trim().length === 0
    );
    return missing.length === 0
      ? { valid: true }
      : { valid: false, reason: `input requires non-empty ${missing.join(", ")} strings` };
  };
}

function requireNonEmptyArrayField(field: string): (input: unknown) => CapabilityArgsResult {
  return (input) => {
    if (!isRecord(input)) return { valid: false, reason: "input must be an object" };
    return Array.isArray(input[field]) && input[field].length > 0
      ? { valid: true }
      : { valid: false, reason: `input requires a non-empty ${field} array` };
  };
}

function validateEvalArgs(input: unknown): CapabilityArgsResult {
  const arrayResult = requireNonEmptyArrayField("cells")(input);
  if (!arrayResult.valid || !isRecord(input)) return arrayResult;
  const valid = (input.cells as unknown[]).every(
    (cell) =>
      isRecord(cell) &&
      (cell.language === "js" || cell.language === "py") &&
      typeof cell.code === "string" &&
      cell.code.trim().length > 0
  );
  return valid
    ? { valid: true }
    : { valid: false, reason: "each eval cell requires language js|py and non-empty code" };
}

const BOTH_AUDIENCES: CapabilityAudience[] = ["parent", "worker"];

function rule(
  toolName: string,
  capability: CapabilityId,
  risk: CapabilityRisk,
  approval: CapabilityApproval,
  validateArgs: CapabilityRule["validateArgs"] = requireRecord
): CapabilityRule {
  return {
    toolName,
    capability,
    risk,
    audiences: [...BOTH_AUDIENCES],
    validateArgs,
    approval,
  };
}

/**
 * Version-controlled runtime allowlist. The registry classifies the maximum
 * authority of each tool; capability-policy.ts evaluates a concrete call and
 * gate.ts supplies the existing state/consent proof for mutation tools.
 */
export const CAPABILITY_RULES: readonly CapabilityRule[] = [
  rule("read", "verification_completion", "read", "none", requireStringField("path")),
  rule("search", "verification_completion", "read", "none", requireStringField("pattern")),
  rule("find", "verification_completion", "read", "none", requireNonEmptyArrayField("paths")),
  rule("ast_grep", "verification_completion", "read", "none", requireStringField("pat")),
  rule("lsp", "verification_completion", "read", "none"),
  rule("recall", "verification_completion", "read", "none", requireStringField("query")),
  rule("reflect", "verification_completion", "read", "none", requireStringField("query")),
  rule(
    "inspect_image",
    "verification_completion",
    "read",
    "none",
    requireStringField("path", ["image", "url"])
  ),
  rule("web_search", "external_read", "external-read", "none", requireStringField("query")),
  rule("browser", "external_read", "external-read", "none"),
  rule("write", "code_write", "local-write", "state-proof", requireAllStringFields("path", "content")),
  rule("edit", "code_write", "local-write", "state-proof", requireStringField("path")),
  rule("ast_edit", "code_write", "local-write", "state-proof"),
  rule("apply_patch", "code_write", "local-write", "state-proof"),
  rule("eval", "code_write", "local-write", "state-proof", validateEvalArgs),
  rule("debug", "debug_trace", "local-write", "state-proof"),
  rule("retain", "external_mutation", "external-mutation", "user-consent", requireNonEmptyArrayField("items")),
  rule("report_finding", "verification_completion", "read", "none"),
  rule("todo_write", "owned_write_lane", "local-write", "state-proof"),
  rule("task", "autonomous_continuation", "local-write", "state-proof", requireStringField("agent")),
  rule("irc", "autonomous_continuation", "local-write", "state-proof", requireStringField("op")),
  rule("ask", "ask", "local-write", "none"),
  rule("pi-oven_ask", "ask", "local-write", "none", requireAllStringFields("question")),
  rule(
    "bash",
    "external_mutation",
    "external-mutation",
    "user-consent",
    requireStringField("command")
  ),
  rule("generate_image", "external_mutation", "external-mutation", "user-consent"),
] as const;

const CAPABILITY_RULE_BY_TOOL = new Map(
  CAPABILITY_RULES.map((capabilityRule) => [capabilityRule.toolName, capabilityRule] as const)
);

if (CAPABILITY_RULE_BY_TOOL.size !== CAPABILITY_RULES.length) {
  throw new Error("pi-oven capability policy contains duplicate tool rules");
}

export function getCapabilityRule(toolName: string): CapabilityRule | undefined {
  return CAPABILITY_RULE_BY_TOOL.get(toolName);
}

export function hasCapabilityRule(toolName: string): boolean {
  return CAPABILITY_RULE_BY_TOOL.has(toolName);
}
