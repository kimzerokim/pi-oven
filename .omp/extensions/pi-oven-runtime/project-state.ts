import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import { dirname, join } from "path";

import type { CapabilityId } from "./capability-registry";

export type ProjectStateFileId = "autonomous" | "push-consent" | "branch-contract";
export type ProjectStateActor =
  | "parent-session-runtime"
  | "subagent-read-only"
  | "manual-bootstrap"
  | "gate-consume-on-use";
export type ProjectStateLane = Extract<CapabilityId, "owned_write_lane" | "shared_write_lane">;

export interface ProjectStateOwnership {
  lane: ProjectStateLane;
  readers: readonly ProjectStateActor[];
  writers: readonly ProjectStateActor[];
  capabilities: readonly CapabilityId[];
}

export interface ProjectStateFileDescriptor {
  id: ProjectStateFileId;
  fileName: string;
  relativePath: string;
  ownership: ProjectStateOwnership;
}

export interface ProjectStateEnvelope<T> {
  fileId: ProjectStateFileId;
  fileName: string;
  relativePath: string;
  absolutePath: string;
  ownership: ProjectStateOwnership;
  state: T;
}

export type ProjectStateReadResult<T> =
  | { kind: "ABSENT" }
  | { kind: "CORRUPT" }
  | { kind: "OK"; envelope: ProjectStateEnvelope<T> };

export const AUTONOMOUS_STATE_FILE = {
  id: "autonomous",
  fileName: "autonomous.json",
  relativePath: "state/autonomous.json",
  ownership: {
    lane: "owned_write_lane",
    readers: ["parent-session-runtime", "subagent-read-only"],
    writers: ["parent-session-runtime"],
    capabilities: ["autonomous_continuation", "verification_completion", "debug_trace"],
  },
} as const satisfies ProjectStateFileDescriptor;

export const PUSH_CONSENT_STATE_FILE = {
  id: "push-consent",
  fileName: "push-consent.json",
  relativePath: "state/push-consent.json",
  ownership: {
    lane: "shared_write_lane",
    readers: ["parent-session-runtime", "subagent-read-only"],
    writers: ["manual-bootstrap", "gate-consume-on-use"],
    capabilities: ["external_mutation"],
  },
} as const satisfies ProjectStateFileDescriptor;

export const BRANCH_CONTRACT_STATE_FILE = {
  id: "branch-contract",
  fileName: "branch-contract.json",
  relativePath: "state/branch-contract.json",
  ownership: {
    lane: "owned_write_lane",
    readers: ["parent-session-runtime", "subagent-read-only"],
    writers: ["manual-bootstrap"],
    capabilities: ["code_write"],
  },
} as const satisfies ProjectStateFileDescriptor;

export const RUNTIME_STATE_MIGRATION_PLAN = {
  autonomous: {
    mode: "preserve-live-file",
    keptFacts: [
      "active",
      "gateCache",
      "version",
      "schemaVersion",
      "phase",
      "dispatchLog",
      "requiredSkills",
      "skillReads",
      "requiredSkillsMessageId",
      "ownershipTrace",
      "explicitForeignAgents",
      "ownedSkillReadTargets",
      "ownershipStatus",
      "blockedReason",
      "nextAction",
      "resumeTarget",
      "continuationMarker",
      "externalExecConsent",
      "consumedExternalExecConsentMessageId",
    ],
  },
  pushConsent: {
    mode: "adapter-only",
    keptFacts: ["grantedAt", "expiresAt", "branch"],
  },
  branchContract: {
    mode: "adapter-only",
    keptFacts: ["destination", "branch", "pr_mode"],
  },
} as const;

export function projectStatePath(root: string, file: ProjectStateFileDescriptor): string {
  return join(root, file.relativePath);
}

export function projectStateMarker(file: ProjectStateFileDescriptor): string {
  return `.pi-oven/${file.relativePath.replace(/\\/g, "/")}`;
}

export function createProjectStateEnvelope<T>(
  root: string,
  file: ProjectStateFileDescriptor,
  state: T
): ProjectStateEnvelope<T> {
  return {
    fileId: file.id,
    fileName: file.fileName,
    relativePath: file.relativePath,
    absolutePath: projectStatePath(root, file),
    ownership: file.ownership,
    state,
  };
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sortJsonValue(item));
  }
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = sortJsonValue((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

export function stringifyDeterministicJson(value: unknown): string {
  return JSON.stringify(sortJsonValue(value), null, 2);
}

export async function readProjectState<T>(
  root: string,
  file: ProjectStateFileDescriptor,
  validate: (value: unknown) => value is T
): Promise<ProjectStateReadResult<T>> {
  const absolutePath = projectStatePath(root, file);
  let raw: string;
  try {
    raw = await fs.readFile(absolutePath, "utf-8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    return code === "ENOENT" ? { kind: "ABSENT" } : { kind: "CORRUPT" };
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!validate(parsed)) {
      return { kind: "CORRUPT" };
    }
    return { kind: "OK", envelope: createProjectStateEnvelope(root, file, parsed) };
  } catch {
    return { kind: "CORRUPT" };
  }
}

export async function atomicWriteProjectState<T>(
  root: string,
  file: ProjectStateFileDescriptor,
  state: T
): Promise<void> {
  const absolutePath = projectStatePath(root, file);
  await fs.mkdir(dirname(absolutePath), { recursive: true });
  const tmp = join(dirname(absolutePath), `${file.fileName}.${randomUUID()}.tmp`);
  try {
    await fs.writeFile(tmp, stringifyDeterministicJson(state), "utf-8");
    await fs.rename(tmp, absolutePath);
  } catch (error) {
    await fs.rm(tmp, { force: true }).catch(() => {});
    throw error;
  }
}
