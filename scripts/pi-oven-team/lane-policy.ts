import { TeamPaths } from "./state-paths";
import type {
  TeamPersistenceSurfaceId,
  TeamRuntimeLaneId,
  TeamRuntimeLaneMetadata,
  TeamTaskInput,
} from "./types";

export interface TeamRuntimePersistenceSurfaceContract {
  path_template: string;
  scope: "team" | "task" | "worker";
  mutable: boolean;
}

export interface TeamRuntimeLanePolicy extends TeamRuntimeLaneMetadata {
  allowed_persistence_surfaces: readonly TeamPersistenceSurfaceId[];
  role_hints: readonly string[];
}

const TEAM_NAME_TOKEN = "<teamName>";
const TASK_ID_TOKEN = "<taskId>";
const WORKER_NAME_TOKEN = "<workerName>";

export const TEAM_RUNTIME_PERSISTENCE_CONTRACT = {
  team_config: {
    path_template: TeamPaths.config(TEAM_NAME_TOKEN),
    scope: "team",
    mutable: true,
  },
  startup_failure_sidecar: {
    path_template: TeamPaths.startupFailure(TEAM_NAME_TOKEN),
    scope: "team",
    mutable: true,
  },
  task_file: {
    path_template: TeamPaths.taskFile(TEAM_NAME_TOKEN, TASK_ID_TOKEN),
    scope: "task",
    mutable: true,
  },
  task_failure_sidecar: {
    path_template: `${TeamPaths.tasks(TEAM_NAME_TOKEN)}/${TASK_ID_TOKEN}.failure.json`,
    scope: "task",
    mutable: true,
  },
  worker_dir: {
    path_template: TeamPaths.workerDir(TEAM_NAME_TOKEN, WORKER_NAME_TOKEN),
    scope: "worker",
    mutable: true,
  },
  worker_inbox: {
    path_template: TeamPaths.inbox(TEAM_NAME_TOKEN, WORKER_NAME_TOKEN),
    scope: "worker",
    mutable: true,
  },
  worker_ready_marker: {
    path_template: TeamPaths.ready(TEAM_NAME_TOKEN, WORKER_NAME_TOKEN),
    scope: "worker",
    mutable: true,
  },
  worker_overlay: {
    path_template: TeamPaths.overlay(TEAM_NAME_TOKEN, WORKER_NAME_TOKEN),
    scope: "worker",
    mutable: true,
  },
  worker_mailbox: {
    path_template: TeamPaths.mailbox(TEAM_NAME_TOKEN, WORKER_NAME_TOKEN),
    scope: "worker",
    mutable: true,
  },
  team_manifest: {
    path_template: TeamPaths.manifest(TEAM_NAME_TOKEN),
    scope: "team",
    mutable: true,
  },
} as const satisfies Record<TeamPersistenceSurfaceId, TeamRuntimePersistenceSurfaceContract>;

const OWNED_WRITE_SURFACES = Object.keys(TEAM_RUNTIME_PERSISTENCE_CONTRACT) as TeamPersistenceSurfaceId[];

export const TEAM_RUNTIME_LANE_POLICIES = {
  survey: {
    kind: "survey",
    objective: "Map the current codebase or runtime state without mutating project-owned persistence.",
    independence_reason: "Survey work is independent when it only reads state and reports findings.",
    shared_state_policy: "read_only",
    output_schema: "survey_report",
    reducer: "append_results",
    allowed_persistence_surfaces: [],
    role_hints: ["explorer", "analyst", "tracer", "planner", "metis"],
  },
  research: {
    kind: "research",
    objective: "Collect external or internal reference material without mutating team runtime state.",
    independence_reason: "Research lanes stay independent when they emit notes only and do not share mutable state.",
    shared_state_policy: "read_only",
    output_schema: "research_brief",
    reducer: "append_results",
    allowed_persistence_surfaces: [],
    role_hints: ["document-specialist", "librarian", "deep-researcher"],
  },
  comparison: {
    kind: "comparison",
    objective: "Compare options or implementations and return a structured decision matrix.",
    independence_reason: "Comparison work is independent when each lane reads evidence and contributes structured judgments only.",
    shared_state_policy: "read_only",
    output_schema: "comparison_matrix",
    reducer: "merge_comparison",
    allowed_persistence_surfaces: [],
    role_hints: ["critic", "architect", "oracle", "code-reviewer"],
  },
  verification: {
    kind: "verification",
    objective: "Verify behavior and invariants without mutating shared persistence surfaces.",
    independence_reason: "Verification lanes remain independent when they read state, execute checks, and emit proofs only.",
    shared_state_policy: "read_only",
    output_schema: "verification_report",
    reducer: "append_results",
    allowed_persistence_surfaces: [],
    role_hints: ["verifier", "qa-tester", "test-engineer", "security-reviewer"],
  },
  documentation: {
    kind: "documentation",
    objective: "Produce documentation-oriented outputs that are reduced after the lane completes.",
    independence_reason: "Documentation lanes stay independent when they return patches or drafts instead of mutating shared files directly.",
    shared_state_policy: "read_only",
    output_schema: "documentation_patch",
    reducer: "apply_document_patch",
    allowed_persistence_surfaces: [],
    role_hints: ["writer", "designer"],
  },
  owned_write: {
    kind: "owned_write",
    objective: "Mutate only explicitly claimed persistence surfaces under a single-owner contract.",
    independence_reason: "Owned-write lanes are independent only when every mutable surface has one owner and a reducer-defined merge path.",
    shared_state_policy: "exclusive_write",
    output_schema: "owned_write_result",
    reducer: "owned_write_commit",
    allowed_persistence_surfaces: OWNED_WRITE_SURFACES,
    role_hints: ["executor", "debugger", "code-simplifier", "git-master"],
  },
} as const satisfies Record<TeamRuntimeLaneId, TeamRuntimeLanePolicy>;

const ROLE_TO_LANE: Partial<Record<string, TeamRuntimeLaneId>> = {
  explorer: "survey",
  analyst: "survey",
  tracer: "survey",
  planner: "survey",
  metis: "survey",
  "document-specialist": "research",
  librarian: "research",
  "deep-researcher": "research",
  critic: "comparison",
  architect: "comparison",
  oracle: "comparison",
  "code-reviewer": "comparison",
  verifier: "verification",
  "qa-tester": "verification",
  "test-engineer": "verification",
  "security-reviewer": "verification",
  writer: "documentation",
  designer: "documentation",
  executor: "owned_write",
  debugger: "owned_write",
  "code-simplifier": "owned_write",
  "git-master": "owned_write",
};

export function classifyLaneForTask(task: Pick<TeamTaskInput, "role" | "lane">): TeamRuntimeLanePolicy {
  if (task.lane?.kind) {
    return {
      ...TEAM_RUNTIME_LANE_POLICIES[task.lane.kind],
      ...task.lane,
    };
  }

  const kind = task.role ? ROLE_TO_LANE[task.role] ?? "owned_write" : "owned_write";
  return TEAM_RUNTIME_LANE_POLICIES[kind];
}

export function assertLaneBatchIsIndependent(lanes: readonly TeamRuntimeLaneMetadata[]): void {
  const claimedTargets = new Map<string, TeamRuntimeLaneMetadata>();

  for (const lane of lanes) {
    if (lane.kind !== "owned_write") {
      if ((lane.persistence_claims?.length ?? 0) > 0) {
        throw new Error(`Lane collision: ${lane.kind} lanes must not claim mutable persistence surfaces`);
      }
      continue;
    }

    if (!lane.persistence_claims || lane.persistence_claims.length === 0) {
      throw new Error("Lane collision: owned_write lanes require at least one persistence claim");
    }

    for (const claim of lane.persistence_claims) {
      const contract = TEAM_RUNTIME_PERSISTENCE_CONTRACT[claim.surface];
      if (!contract) {
        throw new Error(`Lane collision: unknown persistence surface ${claim.surface}`);
      }
      if (!TEAM_RUNTIME_LANE_POLICIES.owned_write.allowed_persistence_surfaces.includes(claim.surface)) {
        throw new Error(`Lane collision: owned_write lane cannot claim ${claim.surface}`);
      }
      const collisionKey = buildPersistenceCollisionKey(claim.surface, contract.scope, claim.key);
      if (claimedTargets.has(collisionKey)) {
        throw new Error(`Lane collision on ${collisionKey}`);
      }
      claimedTargets.set(collisionKey, lane);
    }
  }
}

function buildPersistenceCollisionKey(
  surface: TeamPersistenceSurfaceId,
  scope: TeamRuntimePersistenceSurfaceContract["scope"],
  key?: string
): string {
  if (scope === "team") {
    return surface;
  }
  const normalizedKey = key?.trim();
  if (!normalizedKey) {
    throw new Error(`Lane collision: ${surface} claims require a concrete owner key`);
  }
  return `${surface}:${normalizedKey}`;
}
