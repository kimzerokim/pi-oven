import { describe, expect, it } from "bun:test";
import {
  TEAM_RUNTIME_LANE_POLICIES,
  TEAM_RUNTIME_PERSISTENCE_CONTRACT,
  assertLaneBatchIsIndependent,
  classifyLaneForTask,
} from "../../../scripts/pi-oven-team/lane-policy";
import type { TeamRuntimeLaneMetadata } from "../../../scripts/pi-oven-team/types";

function ownedWriteClaim(key: string): TeamRuntimeLaneMetadata {
  return {
    kind: "owned_write",
    objective: `mutate ${key}`,
    independence_reason: "single explicit owner for the claimed persistence target",
    shared_state_policy: "exclusive_write",
    output_schema: "owned_write_result",
    reducer: "owned_write_commit",
    persistence_claims: [{ surface: "task_file", key }],
  };
}

describe("pi-oven-team/lane-policy", () => {
  it("classifies read-only lanes from known task roles", () => {
    expect(classifyLaneForTask({ role: "explorer" }).kind).toBe("survey");
    expect(classifyLaneForTask({ role: "writer" }).kind).toBe("documentation");
    expect(classifyLaneForTask({ role: "verifier" }).kind).toBe("verification");
  });

  it("defines a reducer for every frozen lane policy", () => {
    for (const policy of Object.values(TEAM_RUNTIME_LANE_POLICIES)) {
      expect(policy.objective.length).toBeGreaterThan(0);
      expect(policy.independence_reason.length).toBeGreaterThan(0);
      expect(policy.shared_state_policy.length).toBeGreaterThan(0);
      expect(policy.output_schema.length).toBeGreaterThan(0);
      expect(policy.reducer.length).toBeGreaterThan(0);
    }
  });

  it("rejects owned-write collisions on the same persistence target", () => {
    expect(() =>
      assertLaneBatchIsIndependent([
        ownedWriteClaim("task-7"),
        ownedWriteClaim("task-7"),
      ])
    ).toThrow(/collision/i);
  });

  it("freezes the current persistence surfaces before scheduler refactors", () => {
    expect(TEAM_RUNTIME_PERSISTENCE_CONTRACT.team_config).toMatchObject({
      path_template: ".pi-oven/state/team/<teamName>/config.json",
      scope: "team",
      mutable: true,
    });
    expect(TEAM_RUNTIME_PERSISTENCE_CONTRACT.task_file).toMatchObject({
      path_template: ".pi-oven/state/team/<teamName>/tasks/<taskId>.json",
      scope: "task",
      mutable: true,
    });
    expect(TEAM_RUNTIME_PERSISTENCE_CONTRACT.task_failure_sidecar).toMatchObject({
      path_template: ".pi-oven/state/team/<teamName>/tasks/<taskId>.failure.json",
      scope: "task",
      mutable: true,
    });
    expect(TEAM_RUNTIME_PERSISTENCE_CONTRACT.worker_inbox.path_template).toBe(
      ".pi-oven/state/team/<teamName>/workers/<workerName>/inbox.md"
    );
  });
});
