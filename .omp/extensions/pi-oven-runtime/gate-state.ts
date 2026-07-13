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

import { createHash } from "crypto";
import { promises as fs } from "fs";
import {
  AUTONOMOUS_STATE_FILE,
  BRANCH_CONTRACT_STATE_FILE,
  PUSH_CONSENT_STATE_FILE,
  atomicWriteProjectState,
  projectStatePath,
  readProjectState,
} from "./project-state";
import {
  isValidContinuationMarker,
  type ContinuationMarker,
} from "./continuation-marker";

export interface OwnershipTraceEntry {
  origin: "pi-oven-auto" | "user-explicit" | "foreign-auto";
  kind: "agent" | "skill";
  requested: string;
  canonical: string;
  resolved: string;
  status: "resolved" | "rewritten" | "blocked";
  reason: string;
}

export type RuntimeSkillPhase = "explore" | "plan" | "mutate" | "verify";

export interface DeferredSkillObligation {
  skill: string;
  ownedReadTarget: string;
  phases: RuntimeSkillPhase[];
  reason: string;
}

export interface PhaseReceipt {
  phase: RuntimeSkillPhase;
  skill: string;
  satisfiedAt: string;
  ownedReadTarget?: string;
}

export interface TemporaryAwsCredentials {
  provider: "aws";
  accessKeyId: string;
  sessionTokenFingerprint: string;
  secretAccessKeyFingerprint?: string;
  expiresAt: number;
}

export function fingerprintExternalExecSecret(secret: string): string {
  return createHash("sha256")
    .update(`pi-oven-temp-credential:v1:${secret}`)
    .digest("hex");
}

export function isTemporaryCredentialWindowActive(
  tempCredentials: TemporaryAwsCredentials | undefined,
  now: number = Date.now()
): boolean {
  return tempCredentials !== undefined && now < tempCredentials.expiresAt;
}

export interface ExternalExecConsent {
  sourceMessageId: string;
  scope: "read" | "access" | "mutation" | "all";
  remainingUses: number;
  tempCredentials?: TemporaryAwsCredentials;
}

export type AutonomyOwnershipStatus =
  | "owned-surface active"
  | "compatibility aids only"
  | "ownership not established";

export interface AutonomyBlockedReason {
  kind:
    | "approval-pending"
    | "branch-contract"
    | "max-consecutive-auto-continues"
    | "ambiguous-effect"
    | "skill-proof-incomplete"
    | "verifier-depth-hard-cap"
    | "verifier-pending";
  message: string;
}

export interface AutonomyNextAction {
  kind:
    | "complete-skill-proof"
    | "continue-in-same-repo"
    | "reconcile-external-effect"
    | "resolve-approval"
    | "run-deep-verifier"
    | "write-branch-contract";
  message: string;
}

export interface AutonomyResumeTarget {
  repoRoot: string;
  branch: string;
  capturedAt: string;
}

export function deriveAutonomyOwnershipStatus(
  requiredSkills: string[] | undefined,
  ownedSkillReadTargets: string[] | undefined
): AutonomyOwnershipStatus {
  const requiredCount = requiredSkills?.filter((skill) => typeof skill === "string" && skill.length > 0).length ?? 0;
  const ownedCount =
    ownedSkillReadTargets?.filter((target) => typeof target === "string" && target.length > 0).length ?? 0;
  if (requiredCount > 0 && ownedCount >= requiredCount) {
    return "owned-surface active";
  }
  if (requiredCount > 0 || ownedCount > 0) {
    return "compatibility aids only";
  }
  return "ownership not established";
}

export function matchesAutonomyResumeTarget(
  target: AutonomyResumeTarget | undefined,
  repoRoot: string,
  branch: string
): boolean {
  return target?.repoRoot === repoRoot && target.branch === branch;
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
  deferredSkillObligations?: DeferredSkillObligation[];
  phaseReceipts?: PhaseReceipt[];
  ownershipStatus?: AutonomyOwnershipStatus;
  blockedReason?: AutonomyBlockedReason;
  nextAction?: AutonomyNextAction;
  resumeTarget?: AutonomyResumeTarget;
  continuationMarker?: ContinuationMarker;
  externalExecConsent?: ExternalExecConsent;
  consumedExternalExecConsentMessageId?: string;
  deepInterview?: unknown;
  approvalFlow?: unknown;
}

export function createDefaultFsmState(): FsmState {
  return {
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
    deferredSkillObligations: [],
    phaseReceipts: [],
    ownershipStatus: undefined,
    blockedReason: undefined,
    nextAction: undefined,
    resumeTarget: undefined,
    externalExecConsent: undefined,
    continuationMarker: undefined,
    consumedExternalExecConsentMessageId: undefined,
    deepInterview: undefined,
    approvalFlow: undefined,
  };
}
function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isValidAutonomyOwnershipStatus(value: unknown): value is AutonomyOwnershipStatus {
  return (
    value === "owned-surface active" ||
    value === "compatibility aids only" ||
    value === "ownership not established"
  );
}

function isValidAutonomyBlockedReason(value: unknown): value is AutonomyBlockedReason {
  if (typeof value !== "object" || value === null) return false;
  const reason = value as Record<string, unknown>;
  return (
    (reason.kind === "approval-pending" ||
      reason.kind === "branch-contract" ||
      reason.kind === "max-consecutive-auto-continues" ||
      reason.kind === "ambiguous-effect" ||
      reason.kind === "skill-proof-incomplete" ||
      reason.kind === "verifier-depth-hard-cap" ||
      reason.kind === "verifier-pending") &&
    typeof reason.message === "string" &&
    reason.message.length > 0
  );
}

function isValidAutonomyNextAction(value: unknown): value is AutonomyNextAction {
  if (typeof value !== "object" || value === null) return false;
  const action = value as Record<string, unknown>;
  return (
    (action.kind === "complete-skill-proof" ||
      action.kind === "continue-in-same-repo" ||
      action.kind === "reconcile-external-effect" ||
      action.kind === "resolve-approval" ||
      action.kind === "run-deep-verifier" ||
      action.kind === "write-branch-contract") &&
    typeof action.message === "string" &&
    action.message.length > 0
  );
}

function isValidAutonomyResumeTarget(value: unknown): value is AutonomyResumeTarget {
  if (typeof value !== "object" || value === null) return false;
  const target = value as Record<string, unknown>;
  return (
    typeof target.repoRoot === "string" &&
    target.repoRoot.length > 0 &&
    typeof target.branch === "string" &&
    target.branch.length > 0 &&
    typeof target.capturedAt === "string" &&
    target.capturedAt.length > 0
  );
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

function isValidRuntimeSkillPhase(value: unknown): value is RuntimeSkillPhase {
  return value === "explore" || value === "plan" || value === "mutate" || value === "verify";
}

function isValidDeferredSkillObligation(value: unknown): value is DeferredSkillObligation {
  if (typeof value !== "object" || value === null) return false;
  const obligation = value as Record<string, unknown>;
  return (
    typeof obligation.skill === "string" &&
    obligation.skill.length > 0 &&
    typeof obligation.ownedReadTarget === "string" &&
    obligation.ownedReadTarget.length > 0 &&
    Array.isArray(obligation.phases) &&
    obligation.phases.every(isValidRuntimeSkillPhase) &&
    typeof obligation.reason === "string" &&
    obligation.reason.length > 0
  );
}

function isValidPhaseReceipt(value: unknown): value is PhaseReceipt {
  if (typeof value !== "object" || value === null) return false;
  const receipt = value as Record<string, unknown>;
  return (
    isValidRuntimeSkillPhase(receipt.phase) &&
    typeof receipt.skill === "string" &&
    receipt.skill.length > 0 &&
    typeof receipt.satisfiedAt === "string" &&
    receipt.satisfiedAt.length > 0 &&
    (receipt.ownedReadTarget === undefined || typeof receipt.ownedReadTarget === "string")
  );
}

function isValidFingerprint(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/i.test(value);
}

function isValidTemporaryAwsCredentials(value: unknown): value is TemporaryAwsCredentials {
  if (typeof value !== "object" || value === null) return false;
  const credentials = value as Record<string, unknown>;
  return (
    credentials.provider === "aws" &&
    typeof credentials.accessKeyId === "string" &&
    /^ASIA[0-9A-Z]{12,}$/i.test(credentials.accessKeyId) &&
    isValidFingerprint(credentials.sessionTokenFingerprint) &&
    (credentials.secretAccessKeyFingerprint === undefined ||
      isValidFingerprint(credentials.secretAccessKeyFingerprint)) &&
    typeof credentials.expiresAt === "number" &&
    Number.isFinite(credentials.expiresAt)
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
    consent.remainingUses > 0 &&
    (consent.tempCredentials === undefined ||
      isValidTemporaryAwsCredentials(consent.tempCredentials))
  );
}

function normalizeExternalExecConsent(
  consent: ExternalExecConsent | undefined,
  now: number = Date.now()
): ExternalExecConsent | undefined {
  if (!consent?.tempCredentials) return consent;
  return isTemporaryCredentialWindowActive(consent.tempCredentials, now)
    ? consent
    : undefined;
}

function sanitizeState(state: FsmState): { state: FsmState; changed: boolean } {
  const externalExecConsent = normalizeExternalExecConsent(state.externalExecConsent);
  if (externalExecConsent === state.externalExecConsent) {
    return { state, changed: false };
  }
  return {
    state: {
      ...state,
      externalExecConsent,
    },
    changed: true,
  };
}

export type FsmStateView =
  | { kind: "ABSENT" }
  | { kind: "CORRUPT" }
  | { kind: "OK"; state: FsmState };

async function readPrimaryStateFile(statePath: string): Promise<FsmStateView> {
  let raw: string;
  try {
    raw = await fs.readFile(statePath, "utf-8");
  } catch {
    return { kind: "CORRUPT" };
  }

  try {
    const parsed = JSON.parse(raw);
    return isValidFsmState(parsed)
      ? { kind: "OK", state: parsed }
      : { kind: "CORRUPT" };
  } catch {
    return { kind: "CORRUPT" };
  }
}

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


export function isValidFsmState(v: unknown): v is FsmState {
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
    o.deferredSkillObligations !== undefined &&
    (!Array.isArray(o.deferredSkillObligations) ||
      o.deferredSkillObligations.some((entry) => !isValidDeferredSkillObligation(entry)))
  ) {
    return false;
  }
  if (
    o.phaseReceipts !== undefined &&
    (!Array.isArray(o.phaseReceipts) ||
      o.phaseReceipts.some((entry) => !isValidPhaseReceipt(entry)))
  ) {
    return false;
  }

  if (
    o.ownershipStatus !== undefined &&
    !isValidAutonomyOwnershipStatus(o.ownershipStatus)
  ) {
    return false;
  }
  if (
    o.blockedReason !== undefined &&
    !isValidAutonomyBlockedReason(o.blockedReason)
  ) {
    return false;
  }
  if (
    o.nextAction !== undefined &&
    !isValidAutonomyNextAction(o.nextAction)
  ) {
    return false;
  }
  if (
    o.resumeTarget !== undefined &&
    !isValidAutonomyResumeTarget(o.resumeTarget)
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
  if (
    o.continuationMarker !== undefined &&
    !isValidContinuationMarker(o.continuationMarker)
  ) {
    return false;
  }
  return true;
}

interface ReadStateOptions {
  alreadyExclusive?: boolean;
  persistSanitizedRead?: boolean;
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
    this.statePath = projectStatePath(root, AUTONOMOUS_STATE_FILE);
    this.consentPath = projectStatePath(root, PUSH_CONSENT_STATE_FILE);
    this.branchContractPath = projectStatePath(root, BRANCH_CONTRACT_STATE_FILE);
  }

  private async persistSanitizedRead(
    observedMtimeMs: number,
    sanitizedState: FsmState,
    alreadyExclusive: boolean = false
  ): Promise<FsmStateView> {
    const persist = async (): Promise<FsmStateView> => {
      let latestStat: { mtimeMs: number };
      try {
        latestStat = await fs.stat(this.statePath);
      } catch {
        this.cache = null;
        return { kind: "ABSENT" };
      }

      if (latestStat.mtimeMs !== observedMtimeMs) {
        const latestView = await readPrimaryStateFile(this.statePath);
        if (latestView.kind !== "OK") {
          this.cache = { mtimeMs: latestStat.mtimeMs, view: latestView };
          return latestView;
        }

        const latestSanitized = sanitizeState(latestView.state);
        if (!latestSanitized.changed) {
          this.cache = { mtimeMs: latestStat.mtimeMs, view: latestView };
          return latestView;
        }

        await this.writeState(latestSanitized.state);
        return { kind: "OK", state: latestSanitized.state };
      }

      await this.writeState(sanitizedState);
      return { kind: "OK", state: sanitizedState };
    };

    return alreadyExclusive ? persist() : this.runExclusive(persist);
  }

  private async readStateInternal(options: ReadStateOptions = {}): Promise<FsmStateView> {
    const { alreadyExclusive = false, persistSanitizedRead = true } = options;
    let stat: { mtimeMs: number };
    try {
      stat = await fs.stat(this.statePath);
    } catch {
      // primary absent (orphan .tmp, if any, is ignored)
      this.cache = null;
      return { kind: "ABSENT" };
    }

    if (this.cache && this.cache.mtimeMs === stat.mtimeMs) {
      if (this.cache.view.kind !== "OK") {
        return this.cache.view;
      }
      const sanitized = sanitizeState(this.cache.view.state);
      if (!sanitized.changed) {
        return this.cache.view;
      }
      if (!persistSanitizedRead) {
        return { kind: "OK", state: sanitized.state };
      }
      return this.persistSanitizedRead(stat.mtimeMs, sanitized.state, alreadyExclusive);
    }

    const view = await readPrimaryStateFile(this.statePath);
    if (view.kind === "OK") {
      const sanitized = sanitizeState(view.state);
      if (sanitized.changed) {
        if (!persistSanitizedRead) {
          return { kind: "OK", state: sanitized.state };
        }
        return this.persistSanitizedRead(stat.mtimeMs, sanitized.state, alreadyExclusive);
      }
    }

    // Cache OK and CORRUPT both keyed by mtime; ABSENT is never cached (handled above).
    this.cache = { mtimeMs: stat.mtimeMs, view };
    return view;
  }

  /** Read the FSM state, discriminating ABSENT / CORRUPT / OK, with mtime cache. */
  async readState(): Promise<FsmStateView> {
    return this.readStateInternal();
  }

  async readStateMtimeMs(): Promise<number | null> {
    try {
      const stat = await fs.stat(this.statePath);
      return stat.mtimeMs;
    } catch {
      return null;
    }
  }

  /** Atomically write the FSM state (temp + rename). Refreshes the cache from the written file. */
  async writeState(state: FsmState): Promise<void> {
    await atomicWriteProjectState(this.root, AUTONOMOUS_STATE_FILE, state);
    try {
      const stat = await fs.stat(this.statePath);
      this.cache = { mtimeMs: stat.mtimeMs, view: { kind: "OK", state: structuredClone(state) } };
    } catch {
      this.cache = null;
    }
  }

  /**
   * Serialized read-modify-write through the single-writer mutex. The updater
   * receives the current state (or a fresh default if ABSENT/CORRUPT) and
   * returns the next state, which is atomically written.
   */
  async mutate(updater: (current: FsmState) => FsmState): Promise<void> {
    const run = this.writeChain.then(async () => {
      const view = await this.readStateInternal({ alreadyExclusive: true, persistSanitizedRead: false });
      const current: FsmState =
        view.kind === "OK"
          ? view.state
          : createDefaultFsmState();
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

  async setContinuationMarker(marker: ContinuationMarker | undefined): Promise<void> {
    await this.mutate((current) => ({
      ...current,
      version: current.version + 1,
      continuationMarker: marker,
    }));
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

    const projectStateView = await readProjectState(
      this.root,
      BRANCH_CONTRACT_STATE_FILE,
      isValidBranchContract
    );

    const view: BranchContractView =
      projectStateView.kind === "OK"
        ? { kind: "OK", contract: projectStateView.envelope.state }
        : { kind: "CORRUPT" };

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
   * runExclusive() so the read-modify-write stays serialized. Temporary AWS
   * credential consent keeps the allow-window open until expiresAt instead of
   * burning a single use.
   */
  async consumeExternalExecConsent(
    expectedSourceMessageId: string
  ): Promise<"consumed" | "missing" | "source-message-mismatch"> {
    const view = await this.readStateInternal({ alreadyExclusive: true });
    if (view.kind !== "OK" || view.state.externalExecConsent === undefined) return "missing";
    const current = view.state.externalExecConsent;
    if (current.sourceMessageId !== expectedSourceMessageId) return "source-message-mismatch";
    if (current.tempCredentials) return "consumed";
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
