// ---------------------------------------------------------------------------
// gate-state.ts — FSM store at .pi-oven/state/autonomous.json (Spec F §3 Layer 1)
//
//  - Atomic write: temp file + rename() (POSIX atomic same-dir rename), so a
//    partial write never produces a torn primary — only an orphan `.tmp`.
//  - Read discrimination: explicit ABSENT vs CORRUPT vs OK. A missing primary
//    is ABSENT (the gate treats this as INACTIVE → allow, per the B2
//    refinement). A present-but-unparseable / schema-invalid primary is CORRUPT
//    (the gate fail-closes commit/push). An orphan `.tmp` is always ignored.
//  - mtimeMs stale-cache: the in-memory cache carries the source mtimeMs; an
//    out-of-band write that advances mtime is re-read on the next lookup.
//  - Single-writer async mutex (promise chain): serializes mutate() so two
//    in-process events cannot interleave a read-modify-write.
//  - File push-consent: read/validate (TTL) + consume-on-use (single-use).
// ---------------------------------------------------------------------------

import { promises as fs } from "fs";
import { join, dirname } from "path";

export interface OwnershipTraceEntry {
  origin: "pi-oven-auto" | "user-explicit" | "foreign-auto";
  kind: "agent" | "skill";
  requested: string;
  canonical: string;
  resolved: string;
  status: "resolved" | "rewritten" | "blocked";
  reason: string;
}

export interface ExternalExecConsent {
  sourceMessageId: string;
  scope: "read" | "access" | "mutation" | "all";
  remainingUses: number;
}

export interface FsmState {
  active: boolean;
  gateCache: { commit?: string; regression?: string };
  version: number;
  schemaVersion: number;
  phase?: string;
  dispatchLog?: unknown[];
  requiredSkills?: string[];
  skillReads?: string[];
  requiredSkillsMessageId?: string | null;
  ownershipTrace?: OwnershipTraceEntry[];
  explicitForeignAgents?: string[];
  ownedSkillReadTargets?: string[];
  externalExecConsent?: ExternalExecConsent;
  consumedExternalExecConsentMessageId?: string;
}
function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isValidOwnershipTraceEntry(value: unknown): value is OwnershipTraceEntry {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Record<string, unknown>;
  return (
    (entry.origin === "pi-oven-auto" ||
      entry.origin === "user-explicit" ||
      entry.origin === "foreign-auto") &&
    (entry.kind === "agent" || entry.kind === "skill") &&
    typeof entry.requested === "string" &&
    typeof entry.canonical === "string" &&
    typeof entry.resolved === "string" &&
    (entry.status === "resolved" || entry.status === "rewritten" || entry.status === "blocked") &&
    typeof entry.reason === "string"
  );
}

function isValidExternalExecConsent(value: unknown): value is ExternalExecConsent {
  if (typeof value !== "object" || value === null) return false;
  const consent = value as Record<string, unknown>;
  return (
    typeof consent.sourceMessageId === "string" &&
    consent.sourceMessageId.length > 0 &&
    (consent.scope === "read" ||
      consent.scope === "access" ||
      consent.scope === "mutation" ||
      consent.scope === "all") &&
    typeof consent.remainingUses === "number" &&
    Number.isInteger(consent.remainingUses) &&
    consent.remainingUses > 0
  );
}

export type FsmStateView =
  | { kind: "ABSENT" }
  | { kind: "CORRUPT" }
  | { kind: "OK"; state: FsmState };

export interface FileConsent {
  valid: boolean;
  branch?: string;
}

interface PushConsentFile {
  grantedAt: number;
  expiresAt: number;
  branch?: string;
}

export interface BranchContract {
  destination: string;
  branch: string;
  pr_mode: string;
}

export type BranchContractView =
  | { kind: "ABSENT" }
  | { kind: "CORRUPT" }
  | { kind: "OK"; contract: BranchContract };

function isValidBranchContract(v: unknown): v is BranchContract {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.destination === "string" &&
    o.destination.length > 0 &&
    typeof o.branch === "string" &&
    o.branch.length > 0 &&
    typeof o.pr_mode === "string" &&
    o.pr_mode.length > 0
  );
}

const STATE_FILE = "autonomous.json";
const CONSENT_FILE = "push-consent.json";
const BRANCH_CONTRACT_FILE = "branch-contract.json";

function isValidState(v: unknown): v is FsmState {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  if (typeof o.active !== "boolean") return false;
  if (typeof o.gateCache !== "object" || o.gateCache === null) return false;
  if (
    o.requiredSkills !== undefined &&
    !isStringArray(o.requiredSkills)
  ) {
    return false;
  }
  if (
    o.skillReads !== undefined &&
    !isStringArray(o.skillReads)
  ) {
    return false;
  }
  if (
    o.requiredSkillsMessageId !== undefined &&
    o.requiredSkillsMessageId !== null &&
    typeof o.requiredSkillsMessageId !== "string"
  ) {
    return false;
  }
  if (
    o.ownershipTrace !== undefined &&
    (!Array.isArray(o.ownershipTrace) ||
      o.ownershipTrace.some((entry) => !isValidOwnershipTraceEntry(entry)))
  ) {
    return false;
  }
  if (
    o.explicitForeignAgents !== undefined &&
    !isStringArray(o.explicitForeignAgents)
  ) {
    return false;
  }
  if (
    o.ownedSkillReadTargets !== undefined &&
    !isStringArray(o.ownedSkillReadTargets)
  ) {
    return false;
  }
  if (
    o.externalExecConsent !== undefined &&
    !isValidExternalExecConsent(o.externalExecConsent)
  ) {
    return false;
  }
  if (
    o.consumedExternalExecConsentMessageId !== undefined &&
    typeof o.consumedExternalExecConsentMessageId !== "string"
  ) {
    return false;
  }
  return true;
}

export class GateStateStore {
  /** `.pi-oven/` root directory. State lives under `<root>/state/`. */
  private readonly root: string;
  private readonly statePath: string;
  private readonly consentPath: string;
  private readonly branchContractPath: string;

  // mtime-keyed cache
  private cache: { mtimeMs: number; view: FsmStateView } | null = null;
  private branchContractCache: { mtimeMs: number; view: BranchContractView } | null = null;

  // single-writer async mutex (promise chain)
  private writeChain: Promise<unknown> = Promise.resolve();

  constructor(root: string) {
    this.root = root;
    this.statePath = join(root, "state", STATE_FILE);
    this.consentPath = join(root, "state", CONSENT_FILE);
    this.branchContractPath = join(root, "state", BRANCH_CONTRACT_FILE);
  }

  /** Read the FSM state, discriminating ABSENT / CORRUPT / OK, with mtime cache. */
  async readState(): Promise<FsmStateView> {
    let stat: { mtimeMs: number };
    try {
      stat = await fs.stat(this.statePath);
    } catch {
      // primary absent (orphan .tmp, if any, is ignored)
      this.cache = null;
      return { kind: "ABSENT" };
    }

    if (this.cache && this.cache.mtimeMs === stat.mtimeMs) {
      return this.cache.view;
    }

    let raw: string;
    try {
      raw = await fs.readFile(this.statePath, "utf-8");
    } catch {
      return { kind: "CORRUPT" };
    }

    let view: FsmStateView;
    try {
      const parsed = JSON.parse(raw);
      view = isValidState(parsed) ? { kind: "OK", state: parsed } : { kind: "CORRUPT" };
    } catch {
      view = { kind: "CORRUPT" };
    }

    // Cache OK and CORRUPT both keyed by mtime; ABSENT is never cached (handled above).
    this.cache = { mtimeMs: stat.mtimeMs, view };
    return view;
  }

  /** Atomically write the FSM state (temp + rename). Invalidates the cache. */
  async writeState(state: FsmState): Promise<void> {
    await fs.mkdir(dirname(this.statePath), { recursive: true });
    const tmp = `${this.statePath}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(state, null, 2), "utf-8");
    await fs.rename(tmp, this.statePath);
    this.cache = null; // force re-read (next readState re-stats)
  }

  /**
   * Serialized read-modify-write through the single-writer mutex. The updater
   * receives the current state (or a fresh default if ABSENT/CORRUPT) and
   * returns the next state, which is atomically written.
   */
  async mutate(updater: (current: FsmState) => FsmState): Promise<void> {
    const run = this.writeChain.then(async () => {
      const view = await this.readState();
      const current: FsmState =
        view.kind === "OK"
          ? view.state
          : {
              active: false,
              gateCache: {},
              version: 0,
              schemaVersion: 1,
              requiredSkills: [],
              skillReads: [],
              requiredSkillsMessageId: null,
              ownershipTrace: [],
              explicitForeignAgents: [],
              ownedSkillReadTargets: [],
              externalExecConsent: undefined,
              consumedExternalExecConsentMessageId: undefined,
            };
      const next = updater(current);
      await this.writeState(next);
    });
    // keep the chain alive even if this run throws
    this.writeChain = run.catch(() => undefined);
    return run;
  }

  /** Run an arbitrary critical section under the single-writer mutex. */
  async runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.writeChain.then(() => fn());
    this.writeChain = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  async readBranchContract(): Promise<BranchContractView> {
    let stat: { mtimeMs: number };
    try {
      stat = await fs.stat(this.branchContractPath);
    } catch {
      this.branchContractCache = null;
      return { kind: "ABSENT" };
    }

    if (this.branchContractCache && this.branchContractCache.mtimeMs === stat.mtimeMs) {
      return this.branchContractCache.view;
    }

    let raw: string;
    try {
      raw = await fs.readFile(this.branchContractPath, "utf-8");
    } catch {
      return { kind: "CORRUPT" };
    }

    let view: BranchContractView;
    try {
      const parsed = JSON.parse(raw);
      view = isValidBranchContract(parsed)
        ? { kind: "OK", contract: parsed }
        : { kind: "CORRUPT" };
    } catch {
      view = { kind: "CORRUPT" };
    }

    this.branchContractCache = { mtimeMs: stat.mtimeMs, view };
    return view;
  }

  /** Read + validate the file push-consent (TTL). Does not consume. */
  async readFileConsent(): Promise<FileConsent> {
    let raw: string;
    try {
      raw = await fs.readFile(this.consentPath, "utf-8");
    } catch {
      return { valid: false };
    }
    try {
      const parsed = JSON.parse(raw) as PushConsentFile;
      if (typeof parsed.expiresAt !== "number") return { valid: false };
      if (Date.now() >= parsed.expiresAt) return { valid: false };
      return { valid: true, branch: parsed.branch };
    } catch {
      return { valid: false };
    }
  }

  /** Consume the file consent (single-use): delete it. Best-effort. */
  async consumeFileConsent(): Promise<void> {
    try {
      await fs.unlink(this.consentPath);
    } catch {
      // already gone — fine.
    }
  }

  /**
   * Consume one active external execution consent use. Intended to run inside
   * runExclusive() so the read-modify-write stays serialized.
   */
  async consumeExternalExecConsent(
    expectedSourceMessageId: string
  ): Promise<"consumed" | "missing" | "source-message-mismatch"> {
    const view = await this.readState();
    if (view.kind !== "OK" || view.state.externalExecConsent === undefined) return "missing";
    const current = view.state.externalExecConsent;
    if (current.sourceMessageId !== expectedSourceMessageId) return "source-message-mismatch";
    const remainingUses = current.remainingUses - 1;
    await this.writeState({
      ...view.state,
      version: view.state.version + 1,
      externalExecConsent:
        remainingUses > 0
          ? {
              ...current,
              remainingUses,
            }
          : undefined,
      consumedExternalExecConsentMessageId:
        remainingUses > 0 ? view.state.consumedExternalExecConsentMessageId : current.sourceMessageId,
    });
    return "consumed";
  }
}
