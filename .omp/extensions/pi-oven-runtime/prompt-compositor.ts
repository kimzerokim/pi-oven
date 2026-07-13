import { createHash } from "crypto";

export type PromptAudience = "parent" | "worker" | "both";
export type PromptPhase = "always" | "explore" | "plan" | "mutate" | "verify";

export interface PromptFragment {
  id: string;
  audience: PromptAudience;
  phase: PromptPhase;
  priority: number;
  required: boolean;
  dedupKey: string;
  maxBytes?: number;
  render(): string;
}

export type PromptFragmentReason =
  | "included"
  | "required"
  | "audience-mismatch"
  | "phase-mismatch"
  | "already-present"
  | "fragment-max-bytes"
  | "budget-exceeded";

export interface PromptFragmentReceipt {
  id: string;
  dedupKey: string;
  audience: PromptAudience;
  phase: PromptPhase;
  priority: number;
  required: boolean;
  included: boolean;
  reason: PromptFragmentReason;
  hash: string;
  bytes: number;
}

export interface PromptCompositionReceipt {
  contractVersion: 1;
  audience: Exclude<PromptAudience, "both">;
  phase: PromptPhase;
  maxBytes: number;
  includedBytes: number;
  droppedBytes: number;
  fragments: PromptFragmentReceipt[];
}

export interface PromptCompositionResult {
  systemPrompt: string[];
  receipt: PromptCompositionReceipt;
}

export class PromptCompositionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PromptCompositionError";
  }
}

function byteLength(content: string): number {
  return Buffer.byteLength(content, "utf8");
}

function hash(content: string): string {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

function matchesAudience(
  fragment: PromptAudience,
  requested: Exclude<PromptAudience, "both">
): boolean {
  return fragment === "both" || fragment === requested;
}

function matchesPhase(fragment: PromptPhase, requested: PromptPhase): boolean {
  return fragment === "always" || fragment === requested;
}

function assertFragments(fragments: readonly PromptFragment[]): void {
  const ids = new Set<string>();
  const dedupKeys = new Set<string>();
  for (const fragment of fragments) {
    if (!fragment.id || !fragment.dedupKey) {
      throw new PromptCompositionError("prompt fragments require non-empty id and dedupKey");
    }
    if (!Number.isFinite(fragment.priority)) {
      throw new PromptCompositionError(`fragment ${fragment.id} priority must be finite`);
    }
    if (ids.has(fragment.id)) {
      throw new PromptCompositionError(`duplicate prompt fragment id: ${fragment.id}`);
    }
    if (dedupKeys.has(fragment.dedupKey)) {
      throw new PromptCompositionError(`duplicate prompt fragment dedupKey: ${fragment.dedupKey}`);
    }
    if (
      fragment.maxBytes !== undefined &&
      (!Number.isSafeInteger(fragment.maxBytes) || fragment.maxBytes < 0)
    ) {
      throw new PromptCompositionError(`fragment ${fragment.id} maxBytes must be a non-negative safe integer`);
    }
    ids.add(fragment.id);
    dedupKeys.add(fragment.dedupKey);
  }
}

export function composeRuntimePrompt(input: {
  audience: "parent" | "worker";
  phase: PromptPhase;
  maxBytes: number;
  existing: string[];
  fragments: readonly PromptFragment[];
}): PromptCompositionResult {
  if (!Number.isSafeInteger(input.maxBytes) || input.maxBytes < 0) {
    throw new PromptCompositionError("composition maxBytes must be a non-negative safe integer");
  }
  assertFragments(input.fragments);
  const rendered = input.fragments
    .map((fragment) => {
      const content = fragment.render();
      if (typeof content !== "string") {
        throw new PromptCompositionError(`fragment ${fragment.id} render() must return a string`);
      }
      return { fragment, content, bytes: byteLength(content), hash: hash(content) };
    })
    .sort((left, right) =>
      right.fragment.priority - left.fragment.priority ||
      left.fragment.id.localeCompare(right.fragment.id)
    );

  let includedBytes = 0;
  let droppedBytes = 0;
  const included: string[] = [];
  const receipts: PromptFragmentReceipt[] = [];

  for (const entry of rendered) {
    const { fragment, content, bytes } = entry;
    let include = false;
    let reason: PromptFragmentReason;
    if (!matchesAudience(fragment.audience, input.audience)) {
      reason = "audience-mismatch";
    } else if (!matchesPhase(fragment.phase, input.phase)) {
      reason = "phase-mismatch";
    } else if (input.existing.some((existing) => existing.includes(fragment.dedupKey))) {
      reason = "already-present";
    } else if (fragment.required) {
      include = true;
      reason = "required";
    } else if (fragment.maxBytes !== undefined && bytes > fragment.maxBytes) {
      reason = "fragment-max-bytes";
    } else if (includedBytes + bytes > input.maxBytes) {
      reason = "budget-exceeded";
    } else {
      include = true;
      reason = "included";
    }

    if (include) {
      included.push(content);
      includedBytes += bytes;
    } else {
      droppedBytes += bytes;
    }
    receipts.push({
      id: fragment.id,
      dedupKey: fragment.dedupKey,
      audience: fragment.audience,
      phase: fragment.phase,
      priority: fragment.priority,
      required: fragment.required,
      included: include,
      reason,
      hash: entry.hash,
      bytes,
    });
  }

  return {
    systemPrompt: [...input.existing, ...included],
    receipt: {
      contractVersion: 1,
      audience: input.audience,
      phase: input.phase,
      maxBytes: input.maxBytes,
      includedBytes,
      droppedBytes,
      fragments: receipts,
    },
  };
}
