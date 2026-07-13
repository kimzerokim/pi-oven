/**
 * Canonical public contract shared by authored surfaces and runtime adapters.
 */

import { z } from "zod/mini";
import packageManifest from "../../../package.json";

export const RUNTIME_CONTRACT_VERSION = "runtime-contract@1" as const;

/** Exact OMP runtime package supported by this release, derived from package.json. */
export const SUPPORTED_OMP_VERSION =
  packageManifest.dependencies["@oh-my-pi/pi-coding-agent"];

export const ROLE_NAMES = [
  "executor",
  "explorer",
  "verifier",
  "critic",
  "planner",
  "code-reviewer",
  "debugger",
  "test-engineer",
  "security-reviewer",
  "writer",
  "designer",
  "code-simplifier",
  "qa-tester",
  "git-master",
  "document-specialist",
  "tracer",
  "analyst",
  "architect",
  "librarian",
  "multimodal-looker",
  "oracle",
  "metis",
  "deep-researcher",
  "data-runner",
] as const;

export type RoleName = (typeof ROLE_NAMES)[number];

export const EXPECTED_ROLE_COUNT = ROLE_NAMES.length;

export const NAMESPACES = {
  agent: "pov",
  skill: "pov",
  command: "/pi-oven",
  install: "pi-oven@kzk",
} as const;

export type RuntimeAgentName = `${typeof NAMESPACES.agent}:${RoleName}`;

export function canonicalAgentName(role: RoleName): RuntimeAgentName {
  return `${NAMESPACES.agent}:${role}`;
}

const runtimeAgentNames = ROLE_NAMES.map(canonicalAgentName) as [
  RuntimeAgentName,
  ...RuntimeAgentName[],
];

export const RuntimeAgentNameSchema = z.enum(runtimeAgentNames);

export function isRuntimeAgentName(value: unknown): value is RuntimeAgentName {
  return RuntimeAgentNameSchema.safeParse(value).success;
}

export const REGISTERED_COMMANDS = [
  "/pi-oven:setup",
  "/pi-oven:doctor",
  "/pi-oven:release",
] as const;

export type RegisteredCommand = (typeof REGISTERED_COMMANDS)[number];

export const RegisteredCommandSchema = z.enum(REGISTERED_COMMANDS);

export function isRegisteredCommand(value: unknown): value is RegisteredCommand {
  return RegisteredCommandSchema.safeParse(value).success;
}

const NonEmptyStringSchema = z.string().check(z.minLength(1));

export const TaskItemSchema = z.strictObject({
  id: NonEmptyStringSchema,
  description: NonEmptyStringSchema,
  assignment: NonEmptyStringSchema,
  blockedBy: z.optional(z.array(NonEmptyStringSchema)),
});

export type TaskItem = z.infer<typeof TaskItemSchema>;

export function validateTaskDag(
  dispatch: { tasks: TaskItem[] },
  context: z.core.$RefinementCtx<{ tasks: TaskItem[] }>,
): void {
  const taskIds = new Set(dispatch.tasks.map((task) => task.id));
  const tasksById = new Map(dispatch.tasks.map((task) => [task.id, task]));
  const taskIndexById = new Map(dispatch.tasks.map((task, index) => [task.id, index]));
  const seenTaskIds = new Set<string>();

  dispatch.tasks.forEach((task, index) => {
    if (seenTaskIds.has(task.id)) {
      context.addIssue({
        code: "custom",
        message: `Task id "${task.id}" is duplicated.`,
        path: ["tasks", index, "id"],
      });
    }
    seenTaskIds.add(task.id);

    for (const dependency of task.blockedBy ?? []) {
      if (dependency === task.id) {
        context.addIssue({
          code: "custom",
          message: `Task "${task.id}" cannot block itself.`,
          path: ["tasks", index, "blockedBy"],
        });
      } else if (!taskIds.has(dependency)) {
        context.addIssue({
          code: "custom",
          message: `Task "${task.id}" depends on unknown task "${dependency}".`,
          path: ["tasks", index, "blockedBy"],
        });
      }
    }
  });

  const visitState = new Map<string, "visiting" | "visited">();

  const visit = (taskId: string): void => {
    visitState.set(taskId, "visiting");
    const task = tasksById.get(taskId);

    for (const dependency of task?.blockedBy ?? []) {
      if (!taskIds.has(dependency) || dependency === taskId) continue;

      if (visitState.get(dependency) === "visiting") {
        context.addIssue({
          code: "custom",
          message: `Task dependency cycle includes "${taskId}" and "${dependency}".`,
          path: ["tasks", taskIndexById.get(taskId) ?? 0, "blockedBy"],
        });
        continue;
      }

      if (visitState.get(dependency) !== "visited") visit(dependency);
    }

    visitState.set(taskId, "visited");
  };

  for (const task of dispatch.tasks) {
    if (visitState.get(task.id) !== "visited") visit(task.id);
  }
}

export const TaskDispatchSchema = z.strictObject({
  agent: RuntimeAgentNameSchema,
  context: z.optional(NonEmptyStringSchema),
  schema: z.optional(NonEmptyStringSchema),
  tasks: z.array(TaskItemSchema).check(z.minLength(1)),
  isolated: z.optional(z.boolean()),
}).check(z.superRefine(validateTaskDag));

export type TaskDispatch = z.infer<typeof TaskDispatchSchema>;
