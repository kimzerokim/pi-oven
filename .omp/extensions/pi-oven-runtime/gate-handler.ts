// ---------------------------------------------------------------------------
// gate-handler.ts — the wired Layer-1 `tool_call` handler (Spec F §3 Layer 1)
//
// Composes the pure decision (gate.ts) with the FSM store (gate-state.ts), the
// command normalizer (git-normalize.ts), env-flag reads, consent consume-on-use
// inside the single-writer mutex, audit logging, and the 1500 ms self-deadline.
//
// Contract honored here:
//   - emitToolCall is UN-TIMED in omp (§2 row 7). All handler work is wrapped in
//     a Promise.race against a self-deadline (default 1500 ms). On overrun the
//     handler THROWS → omp converts to {block:true} = fail-CLOSED (SAFE).
//   - Bash calls are inspected for commit/push/forbidden gating. Task calls are
//     inspected for strict pi-oven identity (allow exact `pi-oven:<role>` only;
//     block bare aliases and foreign namespaces). Any other tool, or any
//   - Subagent sessions (isParentSession=false) are still GATED (read-only
//     lookup) but NEVER mutate the FSM (single-writer rule, B4).
//   - File push-consent is consumed (single-use) inside the mutex before the
//     allow decision is returned.
//   - The forbidden floor is enforced regardless of FSM/bypass.
// ---------------------------------------------------------------------------

import {
  getLeadingEnvVarForGitVerb,
  normalizeCommand,
  type NormalizeRoots,
  type NormalizedCommand,
} from "./git-normalize";
import {
  CODE_WRITE_TOOLS,
  decideGate,
  type GateEnv,
  type FsmStateView as GateFsmView,
} from "./gate";
import type { GateStateStore, FsmStateView, OwnershipTraceEntry } from "./gate-state";
import {
  attachFailurePath,
  createRuntimeTraceSnapshot,
  recordTouchedPath,
  summarizeFailurePath,
  traceFunction,
  type RuntimeTraceSnapshot,
} from "./trace-primitives";
import {
  decideVerifierDepth,
  deriveVerifierRisk,
  type VerifierDepthDecision,
} from "./verifier-depth-policy";

export interface GateLogger {
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
  debug(msg: string): void;
}

export interface GateHandlerDeps {
  store: GateStateStore;
  logger: GateLogger;
  /** Read the current process env flags fresh on every invocation. */
  getEnv: () => Record<string, string | undefined>;
  /** Parent session may mutate the FSM; subagents are read-only (B4). */
  isParentSession: boolean;
  /**
   * Concrete repo-root / HOME-dir paths the forbidden `rm -rf` matcher resolves
   * against. Wired from `process.cwd()` / `os.homedir()` in pi-oven.ts. Optional so
   * tests can supply synthetic roots; absent → only the symbolic/system-root
   * `rm -rf` patterns are matched.
   */
  roots?: NormalizeRoots;
  /** Self-deadline in ms (default 1500). Lower in tests for fault injection. */
  deadlineMs?: number;
  onRuntimeContractUpdate?: (update: {
    trace: RuntimeTraceSnapshot;
    verifierDepth: VerifierDepthDecision;
  }) => void;
}

/** Minimal structural view of the parts of a ToolCallEvent we read. */
interface ToolCallEventLike {
  type: "tool_call";
  toolCallId: string;
  toolName: string;
  input?: { command?: string } & Record<string, unknown>;
}

interface ToolCallResultLike {
  block?: boolean;
  reason?: string;
}

interface GateRuntimeState {
  trace: RuntimeTraceSnapshot;
}

const EMPTY_NORMALIZED_COMMAND: NormalizedCommand = { gitVerbs: [], forbiddenMatches: [], externalMatches: [], inlineSecretMatches: [] };

export function isCodeWriteTool(toolName: string): boolean {
  return CODE_WRITE_TOOLS.has(toolName);
}

export function getTargetPath(input: ToolCallEventLike["input"]): string | null {
  return typeof input?.path === "string" ? input.path : null;
}

export function getSkillReadName(event: ToolCallEventLike): string | null {
  if (event.toolName !== "read") return null;
  const targetPath = event.input?.path;
  if (typeof targetPath !== "string") return null;
  const prefix = "skill://pi-oven:";
  if (!targetPath.startsWith(prefix)) return null;
  const remainder = targetPath.slice(prefix.length);
  const end = remainder.search(/[:/?#]/);
  const name = (end === -1 ? remainder : remainder.slice(0, end)).trim();
  return name.length > 0 ? name : null;
}

function decideCurrentVerifierDepth(
  trace: RuntimeTraceSnapshot,
  fsm: GateFsmView
): VerifierDepthDecision {
  const mode = fsm.kind === "OK" && fsm.state.active ? "autonomous" : "interactive";
  const risk = deriveVerifierRisk({
    mutationScope: trace.mutationScope,
    materialEdit: trace.materialEdit,
  });
  return decideVerifierDepth({
    mode,
    risk,
    mutationScope: trace.mutationScope,
    materialEdit: trace.materialEdit,
  });
}

const PI_OVEN_AGENT_PREFIX = "pi-oven:";
const CANONICAL_AGENT_PATTERN = /^[a-z0-9-]+:[a-z0-9-]+$/;
const BARE_AGENT_ROLE_PATTERN = /^[a-z0-9-]+$/;

interface TaskAgentDecision {
  block: boolean;
  reason?: string;
  nextAgent?: string;
  trace: OwnershipTraceEntry;
}

function normalizeAgentName(agent: string): string {
  return agent.trim().toLowerCase();
}

function classifyTaskAgent(
  agent: string,
  explicitForeignAgents: string[]
): TaskAgentDecision {
  const requested = agent.trim();
  const normalized = normalizeAgentName(agent);
  const explicitForeign = new Set(explicitForeignAgents.map(normalizeAgentName));

  if (explicitForeign.has(normalized)) {
    return {
      block: false,
      nextAgent: requested,
      trace: {
        origin: "user-explicit",
        kind: "agent",
        requested,
        canonical: normalized,
        resolved: requested,
        status: "resolved",
        reason: "preserved exact user-explicit foreign agent dispatch",
      },
    };
  }

  if (normalized.startsWith(PI_OVEN_AGENT_PREFIX) && CANONICAL_AGENT_PATTERN.test(normalized)) {
    return {
      block: false,
      nextAgent: normalized,
      trace: {
        origin: "pi-oven-auto",
        kind: "agent",
        requested,
        canonical: normalized,
        resolved: normalized,
        status: normalized === requested ? "resolved" : "rewritten",
        reason:
          normalized === requested
            ? "resolved pi-oven-owned agent dispatch"
            : "canonicalized pi-oven agent dispatch casing",
      },
    };
  }

  if (BARE_AGENT_ROLE_PATTERN.test(normalized)) {
    const canonical = `${PI_OVEN_AGENT_PREFIX}${normalized}`;
    return {
      block: false,
      nextAgent: canonical,
      trace: {
        origin: "pi-oven-auto",
        kind: "agent",
        requested,
        canonical,
        resolved: canonical,
        status: "rewritten",
        reason: "canonicalized bare agent dispatch to pi-oven namespace",
      },
    };
  }

  return {
    block: true,
    reason:
      `pi-oven: task dispatch blocked — automatic flows must resolve to the exact registered pi-oven name \`pi-oven:<role>\`; foreign namespaces require an exact user-explicit allowlist entry (received \`${requested}\`).`,
    trace: {
      origin: "foreign-auto",
      kind: "agent",
      requested,
      canonical: normalized.length > 0 ? normalized : requested,
      resolved: requested,
      status: "blocked",
      reason: "foreign namespace requires exact user-explicit allowlist",
    },
  };
}

async function appendOwnershipTrace(
  deps: GateHandlerDeps,
  trace: OwnershipTraceEntry
): Promise<void> {
  if (!deps.isParentSession) return;
  await deps.store.mutate((current) => ({
    ...current,
    version: current.version + 1,
    ownershipTrace: [...(current.ownershipTrace ?? []), trace],
  }));
}

async function decideForTaskDispatch(
  deps: GateHandlerDeps,
  event: ToolCallEventLike
): Promise<ToolCallResultLike | void> {
  if (event.toolName !== "task") return undefined;
  const agent = event.input?.agent;
  if (typeof agent !== "string" || agent.trim().length === 0) return { block: false };
  const currentState = deps.isParentSession ? await deps.store.readState() : { kind: "ABSENT" as const };
  const explicitForeignAgents =
    currentState.kind === "OK" ? (currentState.state.explicitForeignAgents ?? []) : [];
  const decision = classifyTaskAgent(agent, explicitForeignAgents);
  if (decision.nextAgent !== undefined && event.input !== undefined) {
    event.input = { ...event.input, agent: decision.nextAgent };
  }
  await appendOwnershipTrace(deps, decision.trace);
  return decision.block ? { block: true, reason: decision.reason } : { block: false };
}

export function toGateFsmView(view: FsmStateView): GateFsmView {
  if (view.kind === "CORRUPT") return { kind: "CORRUPT" };
  if (view.kind === "ABSENT") return { kind: "ABSENT" };
  const { active, gateCache } = view.state;
  return { kind: "OK", state: { active, gateCache } };
}

async function observeSkillRead(deps: GateHandlerDeps, skillReadTarget: string): Promise<void> {
  if (!deps.isParentSession) return;
  const currentView = await deps.store.readState();
  if (currentView.kind !== "OK" || !currentView.state.active) return;
  const allowedProofTargets = new Set(currentView.state.ownedSkillReadTargets ?? []);
  if (!allowedProofTargets.has(skillReadTarget)) return;
  await deps.store.mutate((current) => {
    const nextProofReads = new Set(current.skillReads ?? []);
    nextProofReads.add(skillReadTarget);
    return {
      ...current,
      version: current.version + 1,
      skillReads: [...nextProofReads],
    };
  });
}

async function decideForCodeWrite(
  deps: GateHandlerDeps,
  runtimeState: GateRuntimeState,
  event: ToolCallEventLike
): Promise<ToolCallResultLike | void> {
  const targetPath = getTargetPath(event.input);
  const traceWithFunction = traceFunction(
    runtimeState.trace,
    "decideForCodeWrite",
    ".omp/extensions/pi-oven-runtime/gate-handler.ts"
  );
  const env: GateEnv = {
    PI_OVEN_PUSH_CONSENT: deps.getEnv().PI_OVEN_PUSH_CONSENT,
    PI_OVEN_GATE_BYPASS: deps.getEnv().PI_OVEN_GATE_BYPASS,
  };
  const fsmRaw = await deps.store.readState();
  const fsm = toGateFsmView(fsmRaw);
  const verifierDepth = decideCurrentVerifierDepth(traceWithFunction, fsm);
  const decision = decideGate({
    normalized: EMPTY_NORMALIZED_COMMAND,
    fsm,
    env,
    fileConsentValid: false,
    toolName: event.toolName,
    targetPath,
    branchContract: await deps.store.readBranchContract(),
    requiredSkills: fsmRaw.kind === "OK" ? fsmRaw.state.requiredSkills : [],
    ownedSkillReadTargets: fsmRaw.kind === "OK" ? fsmRaw.state.ownedSkillReadTargets : [],
    skillReads: fsmRaw.kind === "OK" ? fsmRaw.state.skillReads : [],
    verifierDepth,
  });
  runtimeState.trace = decision.block
    ? attachFailurePath(
        traceWithFunction,
        summarizeFailurePath({
          surface: "code-write-gate",
          message: decision.reason ?? "code-write blocked",
          functions: ["decideForCodeWrite", "decideGate"],
          stateKeys: ["requiredSkills", "ownedSkillReadTargets", "skillReads"],
        })
      )
    : recordTouchedPath(traceWithFunction, targetPath);
  deps.onRuntimeContractUpdate?.({
    trace: runtimeState.trace,
    verifierDepth: decideCurrentVerifierDepth(runtimeState.trace, fsm),
  });
  return { block: decision.block, reason: decision.reason };
}

async function decideForToolCall(
  deps: GateHandlerDeps,
  runtimeState: GateRuntimeState,
  event: ToolCallEventLike
): Promise<ToolCallResultLike | void> {
  const skillReadTarget = event.toolName === "read" ? getTargetPath(event.input) : null;
  if (skillReadTarget !== null) {
    await observeSkillRead(deps, skillReadTarget);
    return { block: false };
  }

  const taskDecision = await decideForTaskDispatch(deps, event);
  if (taskDecision !== undefined) {
    return taskDecision;
  }

  if (isCodeWriteTool(event.toolName)) {
    return decideForCodeWrite(deps, runtimeState, event);
  }

  if (event.toolName !== "bash") return undefined;
  const command = event.input?.command;
  if (typeof command !== "string" || command.length === 0) return undefined;
  return decideForCommand(deps, runtimeState, command);
}


const DEFAULT_DEADLINE_MS = 1500;

class DeadlineError extends Error {
  constructor(ms: number) {
    super(`pi-oven gate handler exceeded ${ms}ms self-deadline (fail-closed)`);
    this.name = "DeadlineError";
  }
}

function externalExecConsumeBlockReason(
  result: "missing" | "source-message-mismatch"
): string {
  switch (result) {
    case "source-message-mismatch":
      return "pi-oven: external execution blocked — stored consent sourceMessageId changed before consume, so the approving user message no longer matches this command.";
    case "missing":
      return "pi-oven: external execution blocked — matching consent is no longer active or was already consumed.";
  }
}

/**
 * Create the Layer-1 `tool_call` handler. Returns a function suitable for
 * `pi.on("tool_call", handler)`.
 */
export function createGateHandler(
  deps: GateHandlerDeps
): (event: ToolCallEventLike) => Promise<ToolCallResultLike | void> {
  const deadlineMs = deps.deadlineMs ?? DEFAULT_DEADLINE_MS;
  const runtimeState: GateRuntimeState = {
    trace: createRuntimeTraceSnapshot(),
  };

  return async function handler(
    event: ToolCallEventLike
  ): Promise<ToolCallResultLike | void> {
    // Wrap ALL work in a self-deadline. On overrun → THROW → omp fail-closes.
    const deadline = new Promise<never>((_resolve, reject) => {
      const t = setTimeout(() => reject(new DeadlineError(deadlineMs)), deadlineMs);
      // unref where available so the timer never keeps the process alive
      (t as unknown as { unref?: () => void }).unref?.();
    });

    return Promise.race([decideForToolCall(deps, runtimeState, event), deadline]);
  };
}

async function decideForCommand(
  deps: GateHandlerDeps,
  runtimeState: GateRuntimeState,
  command: string
): Promise<ToolCallResultLike | void> {
  const normalized = normalizeCommand(command, deps.roots);

  // Fast exit for the overwhelmingly-common case: not a gated verb, not a
  // forbidden command, and not an external/inline-secret command. Avoids any
  // FS read on the hot path (keeps p95 low).
  if (
    normalized.gitVerbs.length === 0 &&
    normalized.forbiddenMatches.length === 0 &&
    (normalized.externalMatches?.length ?? 0) === 0 &&
    (normalized.inlineSecretMatches?.length ?? 0) === 0
  ) {
    return { block: false };
  }

  runtimeState.trace = traceFunction(
    runtimeState.trace,
    "decideForCommand",
    ".omp/extensions/pi-oven-runtime/gate-handler.ts"
  );
  const wantsPush = normalized.gitVerbs.includes("push");
  const wantsCommit = normalized.gitVerbs.includes("commit");
  const inlinePushConsent = wantsPush
    ? getLeadingEnvVarForGitVerb(command, "push", "PI_OVEN_PUSH_CONSENT")
    : undefined;
  const env: GateEnv = {
    PI_OVEN_PUSH_CONSENT: inlinePushConsent,
    PI_OVEN_GATE_BYPASS: deps.getEnv().PI_OVEN_GATE_BYPASS,
  };

  const fsmRaw = await deps.store.readState();
  const fsm = toGateFsmView(fsmRaw);
  const externalExecConsent = fsmRaw.kind === "OK" ? fsmRaw.state.externalExecConsent : undefined;
  const verifierDepth = decideCurrentVerifierDepth(runtimeState.trace, fsm);
  const fileConsent = wantsPush ? await deps.store.readFileConsent() : { valid: false };
  const decision = decideGate({
    normalized,
    fsm,
    env,
    fileConsentValid: fileConsent.valid,
    externalExecConsent,
    verifierDepth,
  });
  if (decision.block && wantsCommit) {
    runtimeState.trace = attachFailurePath(
      runtimeState.trace,
      summarizeFailurePath({
        surface: "commit-gate",
        message: decision.reason ?? "git commit blocked",
        functions: ["decideForCommand", "decideGate", "decideVerifierDepth"],
        stateKeys: ["gateCache.commit", "gateCache.regression"],
      })
    );
  }
  if (!decision.block && decision.consumeExternalExecConsent && !deps.isParentSession) {
    return {
      block: true,
      reason:
        "pi-oven: external execution blocked in subagent session — matching consent is single-use and can only be consumed by the parent session.",
    };
  }

  // --- Audit logging ---
  const auditCommand =
    (normalized.inlineSecretMatches?.length ?? 0) > 0
      ? "[redacted inline secret command]"
      : command;
  if (decision.bypassed) {
    deps.logger.warn(
      `pi-oven: PI_OVEN_GATE_BYPASS active — allowed gated command "${truncate(auditCommand)}" (recovery mode).`
    );
  }
  if ((normalized.inlineSecretMatches?.length ?? 0) > 0) {
    deps.logger.warn(`pi-oven: inline secret BLOCKED — command="${truncate(auditCommand)}"`);
  }
  const externalKinds =
    (normalized.externalMatches?.length ?? 0) > 0
      ? normalized.externalMatches?.map((match) => match.kind).join(",") ?? "external"
      : undefined;
  if (externalKinds && decision.block) {
    deps.logger.info(
      `pi-oven: external execution BLOCKED — kinds=${externalKinds} command="${truncate(auditCommand)}"`
    );
  }
  if (wantsPush) {
    const branch = normalized.pushTarget ?? fileConsent.branch ?? "(unknown)";
    if (decision.block) {
      deps.logger.info(`pi-oven: git push BLOCKED — source=none branch=${branch}`);
    } else {
      const source = decision.consentSource ?? (decision.bypassed ? "bypass" : "none");
      deps.logger.info(`pi-oven: git push ALLOWED — source=${source} branch=${branch}`);
    }
  }

  // --- Consume-on-use inside the mutex ---
  if (!decision.block && deps.isParentSession && (decision.consumeExternalExecConsent || decision.consumeFileConsent)) {
    const consumed = await deps.store.runExclusive(async () => {
      if (decision.consumeExternalExecConsent) {
        const consumeResult = await deps.store.consumeExternalExecConsent(
          externalExecConsent?.sourceMessageId ?? ""
        );
        if (consumeResult !== "consumed") {
          return { externalOk: false, reason: externalExecConsumeBlockReason(consumeResult) };
        }
      }
      if (decision.consumeFileConsent) {
        const stillValid = await deps.store.readFileConsent();
        if (stillValid.valid) {
          await deps.store.consumeFileConsent();
        }
      }
      return { externalOk: true as const };
    });
    if (decision.consumeExternalExecConsent && !consumed.externalOk) {
      if (externalKinds) {
        deps.logger.info(
          `pi-oven: external execution BLOCKED — kinds=${externalKinds} reason=${consumed.reason} command="${truncate(auditCommand)}"`
        );
      }
      return {
        block: true,
        reason: consumed.reason,
      };
    }
  }
  if (externalKinds && !decision.block) {
    deps.logger.info(
      `pi-oven: external execution ALLOWED — kinds=${externalKinds} source=state command="${truncate(auditCommand)}"`
    );
  }
  if (
    wantsCommit &&
    !decision.block &&
    verifierDepth.requiresRegressionGate &&
    fsmRaw.kind === "OK" &&
    fsmRaw.state.gateCache.regression === "PASS"
  ) {
    runtimeState.trace = createRuntimeTraceSnapshot();
  }
  deps.onRuntimeContractUpdate?.({
    trace: runtimeState.trace,
    verifierDepth: decideCurrentVerifierDepth(runtimeState.trace, fsm),
  });

  return { block: decision.block, reason: decision.reason };
}

function truncate(s: string, max = 120): string {
  return s.length <= max ? s : s.slice(0, max) + "…";
}
