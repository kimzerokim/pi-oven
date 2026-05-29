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

export interface FsmState {
  active: boolean;
  gateCache: { commit?: string };
  version: number;
  schemaVersion: number;
  phase?: string;
  dispatchLog?: unknown[];
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

const STATE_FILE = "autonomous.json";
const CONSENT_FILE = "push-consent.json";

function isValidState(v: unknown): v is FsmState {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  if (typeof o.active !== "boolean") return false;
  if (typeof o.gateCache !== "object" || o.gateCache === null) return false;
  return true;
}

export class GateStateStore {
  /** `.pi-oven/` root directory. State lives under `<root>/state/`. */
  private readonly root: string;
  private readonly statePath: string;
  private readonly consentPath: string;

  // mtime-keyed cache
  private cache: { mtimeMs: number; view: FsmStateView } | null = null;

  // single-writer async mutex (promise chain)
  private writeChain: Promise<unknown> = Promise.resolve();

  constructor(root: string) {
    this.root = root;
    this.statePath = join(root, "state", STATE_FILE);
    this.consentPath = join(root, "state", CONSENT_FILE);
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
          : { active: false, gateCache: {}, version: 0, schemaVersion: 1 };
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
}
