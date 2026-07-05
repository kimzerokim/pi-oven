export const RUNTIME_TRACE_PRIMITIVES = [
  "trace_function",
  "summarize_failure_path",
  "set_breakpoint_at_symbol",
  "list_changed_runtime_state",
] as const;

export type RuntimeTracePrimitiveId = (typeof RUNTIME_TRACE_PRIMITIVES)[number];

export type RuntimeMutationScope =
  | "none"
  | "docs_only"
  | "other_code"
  | "remediation_evidence"
  | "agent_surface"
  | "eval_surface"
  | "setup_surface"
  | "team_runtime"
  | "runtime_contract";

export interface RuntimeFunctionTrace {
  primitive: "trace_function";
  name: string;
  path?: string;
}

export interface RuntimeBreakpointTrace {
  primitive: "set_breakpoint_at_symbol";
  symbol: string;
  path?: string;
}

export interface RuntimeStateChange {
  primitive: "list_changed_runtime_state";
  key: string;
  before: unknown;
  after: unknown;
}

export interface RuntimeFailurePath {
  primitive: "summarize_failure_path";
  surface: string;
  message: string;
  functions: string[];
  symbols: string[];
  stateKeys: string[];
  summary: string;
}


export interface RuntimeTraceSnapshot {
  primitives: readonly RuntimeTracePrimitiveId[];
  touchedPaths: string[];
  mutationScope: RuntimeMutationScope;
  materialEdit: boolean;
  functions: RuntimeFunctionTrace[];
  breakpoints: RuntimeBreakpointTrace[];
  stateChanges: RuntimeStateChange[];
  failurePath?: RuntimeFailurePath;
}

const SCOPE_PRECEDENCE: Record<RuntimeMutationScope, number> = {
  none: 0,
  docs_only: 1,
  other_code: 2,
  remediation_evidence: 3,
  agent_surface: 4,
  eval_surface: 5,
  setup_surface: 6,
  team_runtime: 7,
  runtime_contract: 8,
};

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "");
}

function isDocsOnlyPath(path: string): boolean {
  return /\.md$/i.test(path);
}


function isCodeLikePath(path: string): boolean {
  return /\.(?:[cm]?tsx?|jsx?|mjs|cjs|py|rb|go|rs|java|kt|swift|php|yaml|yml|json)$/i.test(path);
}

function stableStringify(value: unknown): string {
  if (value === undefined) return "__undefined__";
  return JSON.stringify(value, (_key, nestedValue) => {
    if (
      nestedValue &&
      typeof nestedValue === "object" &&
      !Array.isArray(nestedValue) &&
      Object.getPrototypeOf(nestedValue) === Object.prototype
    ) {
      const sorted: Record<string, unknown> = {};
      for (const key of Object.keys(nestedValue as Record<string, unknown>).sort()) {
        sorted[key] = (nestedValue as Record<string, unknown>)[key];
      }
      return sorted;
    }
    return nestedValue;
  });
}


function dominantMutationScope(
  left: RuntimeMutationScope,
  right: RuntimeMutationScope
): RuntimeMutationScope {
  return SCOPE_PRECEDENCE[right] > SCOPE_PRECEDENCE[left] ? right : left;
}

export function classifyMutationScope(path: string | null | undefined): RuntimeMutationScope {
  if (typeof path !== "string" || path.trim().length === 0) return "none";
  const normalized = normalizePath(path.trim());

  if (normalized.startsWith(".omp/extensions/pi-oven-runtime/")) return "runtime_contract";
  if (normalized.startsWith("scripts/pi-oven-team/")) return "team_runtime";
  if (normalized.startsWith("scripts/pi-oven-setup/")) return "setup_surface";
  if (normalized.startsWith("agents/")) return "agent_surface";
  if (normalized.startsWith("evals/")) return "eval_surface";
  if (
    /\.md$/i.test(normalized) &&
    (normalized.startsWith("docs/harness/surveys/") || normalized.startsWith("docs/research/"))
  ) {
    return "remediation_evidence";
  }
  if (isDocsOnlyPath(normalized)) return "docs_only";
  if (isCodeLikePath(normalized)) return "other_code";
  return "other_code";
}

export function isMaterialEditScope(scope: RuntimeMutationScope): boolean {
  return scope !== "none" && scope !== "docs_only";
}

export function createRuntimeTraceSnapshot(): RuntimeTraceSnapshot {
  return {
    primitives: RUNTIME_TRACE_PRIMITIVES,
    touchedPaths: [],
    mutationScope: "none",
    materialEdit: false,
    functions: [],
    breakpoints: [],
    stateChanges: [],
  };
}

export function recordTouchedPath(
  snapshot: RuntimeTraceSnapshot,
  path: string | null | undefined
): RuntimeTraceSnapshot {
  if (typeof path !== "string" || path.trim().length === 0) return snapshot;
  const normalized = normalizePath(path);
  const scope = classifyMutationScope(normalized);
  return {
    ...snapshot,
    touchedPaths: snapshot.touchedPaths.includes(normalized)
      ? snapshot.touchedPaths
      : [...snapshot.touchedPaths, normalized],
    mutationScope: dominantMutationScope(snapshot.mutationScope, scope),
    materialEdit: snapshot.materialEdit || isMaterialEditScope(scope),
  };
}

export function traceFunction(
  snapshot: RuntimeTraceSnapshot,
  name: string,
  path?: string
): RuntimeTraceSnapshot {
  const trace: RuntimeFunctionTrace = { primitive: "trace_function", name, ...(path ? { path } : {}) };
  if (
    snapshot.functions.some(
      (entry) => entry.name === trace.name && entry.path === trace.path
    )
  ) {
    return snapshot;
  }
  return {
    ...snapshot,
    functions: [...snapshot.functions, trace],
  };
}

export function setBreakpointAtSymbol(
  snapshot: RuntimeTraceSnapshot,
  symbol: string,
  path?: string
): RuntimeTraceSnapshot {
  const trace: RuntimeBreakpointTrace = {
    primitive: "set_breakpoint_at_symbol",
    symbol,
    ...(path ? { path } : {}),
  };
  if (
    snapshot.breakpoints.some(
      (entry) => entry.symbol === trace.symbol && entry.path === trace.path
    )
  ) {
    return snapshot;
  }
  return {
    ...snapshot,
    breakpoints: [...snapshot.breakpoints, trace],
  };
}

export function listChangedRuntimeState(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  keys: string[]
): RuntimeStateChange[] {
  const changes: RuntimeStateChange[] = [];
  for (const key of keys) {
    const segments = key.split(".");
    let beforeValue: unknown = before;
    let afterValue: unknown = after;
    for (const segment of segments) {
      beforeValue =
        typeof beforeValue === "object" && beforeValue !== null && !Array.isArray(beforeValue)
          ? (beforeValue as Record<string, unknown>)[segment]
          : undefined;
      afterValue =
        typeof afterValue === "object" && afterValue !== null && !Array.isArray(afterValue)
          ? (afterValue as Record<string, unknown>)[segment]
          : undefined;
    }
    if (stableStringify(beforeValue) === stableStringify(afterValue)) continue;
    changes.push({
      primitive: "list_changed_runtime_state",
      key,
      before: beforeValue,
      after: afterValue,
    });
  }
  return changes;
}

export function summarizeFailurePath(input: {
  surface: string;
  message: string;
  functions?: string[];
  symbols?: string[];
  stateKeys?: string[];
}): RuntimeFailurePath {
  const functions = input.functions ?? [];
  const symbols = input.symbols ?? [];
  const stateKeys = input.stateKeys ?? [];
  const segments = [
    functions.length > 0 ? `functions=${functions.join(",")}` : null,
    symbols.length > 0 ? `symbols=${symbols.join(",")}` : null,
    stateKeys.length > 0 ? `state=${stateKeys.join(",")}` : null,
  ].filter((segment): segment is string => segment !== null);
  return {
    primitive: "summarize_failure_path",
    surface: input.surface,
    message: input.message,
    functions,
    symbols,
    stateKeys,
    summary:
      segments.length > 0
        ? `${input.surface}: ${input.message} (${segments.join("; ")})`
        : `${input.surface}: ${input.message}`,
  };
}

export function attachFailurePath(
  snapshot: RuntimeTraceSnapshot,
  failurePath: RuntimeFailurePath
): RuntimeTraceSnapshot {
  return {
    ...snapshot,
    failurePath,
  };
}

