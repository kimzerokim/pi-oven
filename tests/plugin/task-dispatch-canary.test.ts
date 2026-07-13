import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

import {
  STATIC_CANARY_PAYLOAD,
  inspectStaticTaskDispatchCanary,
  renderTaskDispatchCanaryArtifact,
} from "../../scripts/canary-runtime-dispatch";
import {
  EXPECTED_ROLE_COUNT,
  ROLE_NAMES,
  canonicalAgentName,
} from "../../.omp/extensions/pi-oven-runtime/runtime-contract";

const root = resolve(import.meta.dir, "../..");

describe("OMP task dispatch static canary", () => {
  test("discovers exactly the 24 canonical pov agents", async () => {
    const result = await inspectStaticTaskDispatchCanary(root);

    expect(result.agentNames).toEqual(ROLE_NAMES.map(canonicalAgentName));
    expect(result.agentNames).toHaveLength(EXPECTED_ROLE_COUNT);
    expect(result.staticStatus).toBe("PASS");
    expect(result.ompSchemaExported).toBe(false);
  });

  test("accepts the canonical RuntimeContract subset in both local and exported OMP schemas", async () => {
    const result = await inspectStaticTaskDispatchCanary(root, { crossCheckOmpSchema: true });

    expect(STATIC_CANARY_PAYLOAD).toEqual({
      agent: "pov:explorer",
      context: "Inspect the repository without mutating it.",
      tasks: [
        {
          id: "inspect",
          description: "Inspect repository identity",
          assignment: "Read package.json and report the package name only.",
        },
      ],
    });
    expect(result.runtimeContractAccepted).toBe(true);
    expect(result.ompSchemaExported).toBe(true);
    expect(result.ompSchemaAccepted).toBe(true);
  });

  test("reports static PASS separately from an opt-in live NOT RUN", async () => {
    const result = await inspectStaticTaskDispatchCanary(root);
    const artifact = renderTaskDispatchCanaryArtifact(result, {
      status: "NOT RUN",
      reason: "PI_OVEN_LIVE_TASK_CANARY is not enabled",
    });

    expect(artifact).toContain('"static": "PASS"');
    expect(artifact).toContain('"live": "NOT RUN"');
    expect(artifact).not.toContain('"live": "PASS"');
  });
});
