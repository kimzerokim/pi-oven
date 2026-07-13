import { describe, expect, test } from "bun:test";
import { z } from "zod";

import {
  RUNTIME_CONTRACT_VERSION,
  SUPPORTED_OMP_VERSION,
  NAMESPACES,
  REGISTERED_COMMANDS,
  RegisteredCommandSchema,
  EXPECTED_ROLE_COUNT,
  ROLE_NAMES,
  RuntimeAgentNameSchema,
  TaskDispatchSchema,
  canonicalAgentName,
  isRuntimeAgentName,
  isRegisteredCommand,
} from "../../../.omp/extensions/pi-oven-runtime/runtime-contract";
import { ROLES } from "../../../scripts/pi-oven-setup/profiles";
import packageManifest from "../../../package.json";
import { renderGeneratedArtifacts } from "../../../scripts/pi-oven-contract/generate";

describe("RuntimeContract role roster", () => {
  test("owns the contract version and derives the exact supported OMP package version", () => {
    expect(RUNTIME_CONTRACT_VERSION).toBe("runtime-contract@1");
    expect(SUPPORTED_OMP_VERSION).toBe(
      packageManifest.dependencies["@oh-my-pi/pi-coding-agent"],
    );
    expect(renderGeneratedArtifacts()["docs/generated/runtime-contract.md"]).toContain(
      `Contract version: \`${RUNTIME_CONTRACT_VERSION}\``,
    );
    expect(renderGeneratedArtifacts()["docs/generated/runtime-contract.md"]).toContain(
      `Supported OMP package: \`@oh-my-pi/pi-coding-agent@${SUPPORTED_OMP_VERSION}\``,
    );
  });

  test("publishes exactly 24 unique canonical roles", () => {
    expect(ROLE_NAMES).toHaveLength(24);
    expect(new Set(ROLE_NAMES).size).toBe(24);
    expect(EXPECTED_ROLE_COUNT).toBe(24);
  });

  test("is the source of the setup compatibility roster", () => {
    expect(ROLES).toBe(ROLE_NAMES);
  });
});

describe("RuntimeContract task dispatch", () => {
  test("accepts the canonical OMP task payload and its conditional fields", () => {
    const payload = {
      agent: "pov:executor" as const,
      context: "The public interface is already approved.",
      schema: "Return the changed paths and verification evidence.",
      isolated: true,
      tasks: [
        {
          id: "implement",
          description: "Implement the contract",
          assignment: "Add the approved public behavior.",
        },
      ],
    };

    expect(TaskDispatchSchema.parse(payload)).toEqual(payload);
  });

  test("accepts an acyclic same-call dependency graph", () => {
    const result = TaskDispatchSchema.safeParse({
      agent: "pov:test-engineer",
      tasks: [
        { id: "root", description: "Root", assignment: "Create the fixture" },
        {
          id: "left",
          description: "Left",
          assignment: "Use the fixture on the left path",
          blockedBy: ["root"],
        },
        {
          id: "right",
          description: "Right",
          assignment: "Use the fixture on the right path",
          blockedBy: ["root"],
        },
        {
          id: "join",
          description: "Join",
          assignment: "Verify both dependent paths",
          blockedBy: ["left", "right"],
        },
      ],
    });

    expect(result.success).toBe(true);
  });

  test("rejects a task that blocks itself", () => {
    const result = TaskDispatchSchema.safeParse({
      agent: "pov:executor",
      tasks: [
        {
          id: "self",
          description: "Impossible self dependency",
          assignment: "This task cannot become ready.",
          blockedBy: ["self"],
        },
      ],
    });

    expect(result.success).toBe(false);
  });

  test("rejects dependencies that do not name a task in the same call", () => {
    const result = TaskDispatchSchema.safeParse({
      agent: "pov:executor",
      tasks: [
        {
          id: "consumer",
          description: "Consume missing output",
          assignment: "This dependency does not exist.",
          blockedBy: ["missing"],
        },
      ],
    });

    expect(result.success).toBe(false);
  });

  test("rejects dependency cycles", () => {
    const result = TaskDispatchSchema.safeParse({
      agent: "pov:executor",
      tasks: [
        {
          id: "a",
          description: "Wait for B",
          assignment: "This task creates one edge of a cycle.",
          blockedBy: ["b"],
        },
        {
          id: "b",
          description: "Wait for C",
          assignment: "This task creates one edge of a cycle.",
          blockedBy: ["c"],
        },
        {
          id: "c",
          description: "Wait for A",
          assignment: "This task closes the cycle.",
          blockedBy: ["a"],
        },
      ],
    });

    expect(result.success).toBe(false);
  });

  test("rejects duplicate task ids", () => {
    const result = TaskDispatchSchema.safeParse({
      agent: "pov:executor",
      tasks: [
        { id: "same", description: "First", assignment: "First assignment" },
        { id: "same", description: "Second", assignment: "Second assignment" },
      ],
    });

    expect(result.success).toBe(false);
  });

  test("rejects legacy or unknown top-level task fields", () => {
    const canonical = {
      agent: "pov:executor",
      tasks: [{ id: "one", description: "One", assignment: "Do one thing" }],
    };

    for (const [field, value] of [
      ["prompt", "legacy"],
      ["model", "sonnet"],
      ["subagent_type", "executor"],
      ["run_in_background", true],
      ["unknown", "not part of OMP task"],
    ] as const) {
      expect(TaskDispatchSchema.safeParse({ ...canonical, [field]: value }).success).toBe(
        false,
      );
    }
  });

  test("rejects unknown task item fields", () => {
    const result = TaskDispatchSchema.safeParse({
      agent: "pov:executor",
      tasks: [
        {
          id: "one",
          description: "One",
          assignment: "Do one thing",
          prompt: "legacy item field",
        },
      ],
    });

    expect(result.success).toBe(false);
  });

  test("exports as Draft 2020-12 JSON Schema", () => {
    const schema = z.toJSONSchema(TaskDispatchSchema, { target: "draft-2020-12" });

    expect(schema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
    expect(schema.additionalProperties).toBe(false);
  });
});

describe("RuntimeContract namespaces", () => {
  test("canonicalizes registered bare roles into the pov runtime namespace", () => {
    expect(canonicalAgentName("executor")).toBe("pov:executor");
    expect(NAMESPACES).toEqual({
      agent: "pov",
      skill: "pov",
      command: "/pi-oven",
      install: "pi-oven@kzk",
    });
  });

  test("recognizes only exact canonical registry members", () => {
    expect(isRuntimeAgentName("pov:executor")).toBe(true);
    expect(RuntimeAgentNameSchema.safeParse("pov:data-runner").success).toBe(true);
    expect(isRuntimeAgentName("pov:phantom")).toBe(false);
    expect(isRuntimeAgentName("pi-oven:executor")).toBe(false);
    expect(isRuntimeAgentName("executor")).toBe(false);
    expect(isRuntimeAgentName("")).toBe(false);
  });

  test("registers only the three manifest-backed slash commands", () => {
    expect(REGISTERED_COMMANDS).toEqual([
      "/pi-oven:setup",
      "/pi-oven:doctor",
      "/pi-oven:release",
    ]);
    expect(RegisteredCommandSchema.safeParse("/pi-oven:setup").success).toBe(true);
    expect(isRegisteredCommand("/pi-oven:doctor")).toBe(true);
    expect(isRegisteredCommand("/pi-oven:release")).toBe(true);
    expect(isRegisteredCommand("/pi-oven:autonomous")).toBe(false);
    expect(isRegisteredCommand("pi-oven:setup")).toBe(false);
  });
});
