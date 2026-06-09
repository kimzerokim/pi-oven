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
//     inspected for agent-namespace compatibility (allow `pi-oven:*` and bare names;
//     block only foreign namespaced refs). Any other tool, or any
//   - Subagent sessions (isParentSession=false) are still GATED (read-only
//     lookup) but NEVER mutate the FSM (single-writer rule, B4).
//   - File push-consent is consumed (single-use) inside the mutex before the
//     allow decision is returned.
//   - The forbidden floor is enforced regardless of FSM/bypass.
// ---------------------------------------------------------------------------

import {
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
import type { GateStateStore } from "./gate-state";

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

const EMPTY_NORMALIZED_COMMAND: NormalizedCommand = { gitVerbs: [], forbiddenMatches: [] };

export function isCodeWriteTool(toolName: string): boolean {
  return CODE_WRITE_TOOLS.has(toolName);
}

export function getTargetPath(input: ToolCallEventLike["input"]): string | null {
  return typeof input?.path === "string" ? input.path : null;
}

export function getSkillReadName(event: ToolCallEventLike): string | null {
  if (event.toolName !== "read") return null;
  const path = event.input?.path;
  if (typeof path !== "string") return null;
  const match = /^skill:\/\/([^/?#]+)/.exec(path);
  if (!match) return null;
  const host = match[1].replace(/^pi-oven:/, ""); // strip the pi-oven: namespace (one prefix)
  const name = host.split(":")[0];                // drop any :line-range suffix
  return name.length > 0 ? name : null;
}

export function toGateFsmView(view: Awaited<ReturnType<GateStateStore["readState"]>>): GateFsmView {
  return view.kind === "OK"
    ? { kind: "OK", state: { active: view.state.active, gateCache: view.state.gateCache } }
    : view.kind === "CORRUPT"
      ? { kind: "CORRUPT" }
      : { kind: "ABSENT" };
}

async function observeSkillRead(deps: GateHandlerDeps, skillName: string): Promise<void> {
  if (!deps.isParentSession) return;
  const currentView = await deps.store.readState();
  if (currentView.kind !== "OK" || !currentView.state.active) return;
  if (!(currentView.state.requiredSkills ?? []).includes(skillName)) return;
  await deps.store.mutate((current) => {
    const nextReads = new Set(current.skillReads ?? []);
    nextReads.add(skillName);
    return {
      ...current,
      version: current.version + 1,
      skillReads: [...nextReads],
    };
  });
}

async function decideForCodeWrite(
  deps: GateHandlerDeps,
  event: ToolCallEventLike
): Promise<ToolCallResultLike | void> {
  const env: GateEnv = {
    PI_OVEN_PUSH_CONSENT: deps.getEnv().PI_OVEN_PUSH_CONSENT,
    PI_OVEN_GATE_BYPASS: deps.getEnv().PI_OVEN_GATE_BYPASS,
  };
  const fsmRaw = await deps.store.readState();
  const decision = decideGate({
    normalized: EMPTY_NORMALIZED_COMMAND,
    fsm: toGateFsmView(fsmRaw),
    env,
    fileConsentValid: false,
    toolName: event.toolName,
    targetPath: getTargetPath(event.input),
    branchContract: await deps.store.readBranchContract(),
    requiredSkills: fsmRaw.kind === "OK" ? fsmRaw.state.requiredSkills : [],
    skillReads: fsmRaw.kind === "OK" ? fsmRaw.state.skillReads : [],
  });
  return { block: decision.block, reason: decision.reason };
}

async function decideForToolCall(
  deps: GateHandlerDeps,
  event: ToolCallEventLike
): Promise<ToolCallResultLike | void> {
  const skillName = getSkillReadName(event);
  if (skillName !== null) {
    await observeSkillRead(deps, skillName);
    return { block: false };
  }

  if (isCodeWriteTool(event.toolName)) {
    return decideForCodeWrite(deps, event);
  }

  if (event.toolName !== "bash") return undefined;
  const command = event.input?.command;
  if (typeof command !== "string" || command.length === 0) return undefined;
  return decideForCommand(deps, command);
}


const DEFAULT_DEADLINE_MS = 1500;

class DeadlineError extends Error {
  constructor(ms: number) {
    super(`pi-oven gate handler exceeded ${ms}ms self-deadline (fail-closed)`);
    this.name = "DeadlineError";
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

  return async function handler(
    event: ToolCallEventLike
  ): Promise<ToolCallResultLike | void> {
    // Task dispatch compatibility guard:
    // - allow `pi-oven:*` when the runtime registry provides it
    // - allow bare names (`executor`, `planner`, ...) for harness-fixed registries
    // - block foreign namespaced refs (`oh-my-claudecode:*`, `omo:*`, ...)
    if (event.toolName === "task") {
      const agent = event.input?.agent;
      if (typeof agent !== "string" || agent.length === 0) return { block: false };
      if (!agent.includes(":") || agent.startsWith("pi-oven:")) return { block: false };
      return {
        block: true,
        reason:
          'pi-oven: task dispatch blocked — unsupported namespaced agent. Use bare built-in names (e.g. "executor") or `pi-oven:*` aliases when registered.',
      };
    }
    // Wrap ALL work in a self-deadline. On overrun → THROW → omp fail-closes.
    const deadline = new Promise<never>((_resolve, reject) => {
      const t = setTimeout(() => reject(new DeadlineError(deadlineMs)), deadlineMs);
      // unref where available so the timer never keeps the process alive
      (t as unknown as { unref?: () => void }).unref?.();
    });

    return Promise.race([decideForToolCall(deps, event), deadline]);
  };
}

async function decideForCommand(
  deps: GateHandlerDeps,
  command: string
): Promise<ToolCallResultLike | void> {
  const normalized = normalizeCommand(command, deps.roots);

  // Fast exit for the overwhelmingly-common case: not a gated verb and not a
  // forbidden command. Avoids any FS read on the hot path (keeps p95 low).
  if (normalized.gitVerbs.length === 0 && normalized.forbiddenMatches.length === 0) {
    return { block: false };
  }

  const env: GateEnv = {
    PI_OVEN_PUSH_CONSENT: deps.getEnv().PI_OVEN_PUSH_CONSENT,
    PI_OVEN_GATE_BYPASS: deps.getEnv().PI_OVEN_GATE_BYPASS,
  };

  const fsmRaw = await deps.store.readState();
  const fsm = toGateFsmView(fsmRaw);

  const wantsPush = normalized.gitVerbs.includes("push");
  const fileConsent = wantsPush ? await deps.store.readFileConsent() : { valid: false };

  const decision = decideGate({
    normalized,
    fsm,
    env,
    fileConsentValid: fileConsent.valid,
  });

  // --- Audit logging ---
  if (decision.bypassed) {
    deps.logger.warn(
      `pi-oven: PI_OVEN_GATE_BYPASS active — allowed gated command "${truncate(command)}" (recovery mode).`
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

  // --- Consume-on-use for file consent (single-use), inside the mutex ---
  // Only the parent session mutates state; consume is a state-adjacent write
  // and is therefore also parent-only. A subagent that was authorized by a
  // file consent does not consume it (it never writes); but in practice push
  // authorization happens on the parent. We guard on isParentSession to honor
  // the single-writer rule (B4).
  if (!decision.block && decision.consumeFileConsent && deps.isParentSession) {
    await deps.store.runExclusive(async () => {
      // Re-validate inside the mutex to avoid a double-consume race, then delete.
      const stillValid = await deps.store.readFileConsent();
      if (stillValid.valid) {
        await deps.store.consumeFileConsent();
      }
    });
  }

  return { block: decision.block, reason: decision.reason };
}

function truncate(s: string, max = 120): string {
  return s.length <= max ? s : s.slice(0, max) + "…";
}
