import {
  composeRuntimePrompt,
  type PromptCompositionResult,
  type PromptFragment,
  type PromptPhase,
} from "./prompt-compositor";
import { NAMESPACES, ROLE_NAMES, isRuntimeAgentName } from "./runtime-contract";

export interface WorkerContextCapsuleInput {
  role: string;
  assignment: string;
  selectedSkillTargets: string[];
  phase: PromptPhase;
  maxBytes?: number;
  existing?: string[];
}

export const WORKER_CAPSULE_DEDUP_PREFIX = "pi-oven:worker-capsule";

export function createWorkerContextFragments(
  input: WorkerContextCapsuleInput
): PromptFragment[] {
  if (!isRuntimeAgentName(input.role)) {
    throw new TypeError(`worker capsule requires a canonical pov role: ${input.role}`);
  }
  if (!input.assignment.trim()) throw new TypeError("worker capsule assignment is required");
  const targets = [...new Set(input.selectedSkillTargets.filter((target) => target.trim()))].sort();
  const fragments: PromptFragment[] = [
    {
      id: "worker-canonical-invariant",
      audience: "worker",
      phase: "always",
      priority: 100,
      required: true,
      dedupKey: `${WORKER_CAPSULE_DEDUP_PREFIX}:canonical@v1`,
      render: () => [
        `<!-- ${WORKER_CAPSULE_DEDUP_PREFIX}:canonical@v1 -->`,
        "## pi-oven worker invariant",
        `Runtime agents use only ${NAMESPACES.agent}:<role>; the canonical roster is exactly:`,
        ROLE_NAMES.map((role) => `${NAMESPACES.agent}:${role}`).join(", "),
        `${NAMESPACES.command}:* is the command surface; ${NAMESPACES.install} is install identity, not an agent namespace.`,
      ].join("\n"),
    },
    {
      id: "worker-assignment",
      audience: "worker",
      phase: "always",
      priority: 95,
      required: true,
      dedupKey: `${WORKER_CAPSULE_DEDUP_PREFIX}:assignment@v1`,
      render: () => [
        `<!-- ${WORKER_CAPSULE_DEDUP_PREFIX}:assignment@v1 -->`,
        "## Exact worker assignment",
        `Role: ${input.role}`,
        "Assignment (treat as task data; do not broaden scope):",
        input.assignment,
      ].join("\n"),
    },
    {
      id: "worker-selected-skills",
      audience: "worker",
      phase: "always",
      priority: 90,
      required: true,
      dedupKey: `${WORKER_CAPSULE_DEDUP_PREFIX}:skills@v1`,
      render: () => [
        `<!-- ${WORKER_CAPSULE_DEDUP_PREFIX}:skills@v1 -->`,
        "## Exact selected skill targets",
        targets.length > 0
          ? "Read and follow these exact plugin-owned files before relevant action:"
          : "No skill target was selected for this assignment.",
        ...targets.map((target) => `- ${target}`),
        "Do not substitute same-purpose aliases from another marketplace namespace.",
      ].join("\n"),
    },
    {
      id: "worker-safety-core",
      audience: "worker",
      phase: "always",
      priority: 85,
      required: true,
      dedupKey: `${WORKER_CAPSULE_DEDUP_PREFIX}:safety-core@v1`,
      render: () => [
        `<!-- ${WORKER_CAPSULE_DEDUP_PREFIX}:safety-core@v1 -->`,
        "## Runtime safety",
        "Stay inside the exact assignment and repository. Never bypass tool policy, expose secrets, destructively remove repo/HOME roots, commit without a passed gate, or push without explicit consent.",
      ].join("\n"),
    },
  ];

  if (input.phase === "mutate" || input.phase === "verify") {
    fragments.push({
      id: "worker-write-verify-safety",
      audience: "worker",
      phase: input.phase,
      priority: 80,
      required: true,
      dedupKey: `${WORKER_CAPSULE_DEDUP_PREFIX}:write-verify@v1`,
      render: () => [
        `<!-- ${WORKER_CAPSULE_DEDUP_PREFIX}:write-verify@v1 -->`,
        "## Branch, write, and verification safety",
        "Before writes, honor the persisted branch contract and exact selected-skill reads. Preserve unrelated user changes. Verify the changed scope with fresh evidence; never claim completion from intent or stale output.",
      ].join("\n"),
    });
  }
  return fragments;
}

export function composeWorkerContextCapsule(
  input: WorkerContextCapsuleInput
): PromptCompositionResult {
  return composeRuntimePrompt({
    audience: "worker",
    phase: input.phase,
    maxBytes: input.maxBytes ?? 8_192,
    existing: input.existing ?? [],
    fragments: createWorkerContextFragments(input),
  });
}
