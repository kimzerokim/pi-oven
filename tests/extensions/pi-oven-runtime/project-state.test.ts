import { describe, it, expect } from "bun:test";
import {
  AUTONOMOUS_STATE_FILE,
  BRANCH_CONTRACT_STATE_FILE,
  PUSH_CONSENT_STATE_FILE,
  RUNTIME_STATE_MIGRATION_PLAN,
  createProjectStateEnvelope,
  projectStateMarker,
  projectStatePath,
  stringifyDeterministicJson,
} from "../../../.omp/extensions/pi-oven-runtime/project-state";

describe("project-state", () => {
  it("keeps the live runtime file layout during the migration", () => {
    expect(projectStatePath("/tmp/pi-oven", AUTONOMOUS_STATE_FILE)).toBe(
      "/tmp/pi-oven/state/autonomous.json"
    );
    expect(projectStatePath("/tmp/pi-oven", PUSH_CONSENT_STATE_FILE)).toBe(
      "/tmp/pi-oven/state/push-consent.json"
    );
    expect(projectStatePath("/tmp/pi-oven", BRANCH_CONTRACT_STATE_FILE)).toBe(
      "/tmp/pi-oven/state/branch-contract.json"
    );
    expect(projectStateMarker(BRANCH_CONTRACT_STATE_FILE)).toBe(
      ".pi-oven/state/branch-contract.json"
    );
  });

  it("declares explicit read/write ownership for the Task 1 runtime files", () => {
    expect(AUTONOMOUS_STATE_FILE.ownership.lane).toBe("owned_write_lane");
    expect(AUTONOMOUS_STATE_FILE.ownership.writers).toEqual(["parent-session-runtime"]);

    expect(PUSH_CONSENT_STATE_FILE.ownership.lane).toBe("shared_write_lane");
    expect(PUSH_CONSENT_STATE_FILE.ownership.writers).toEqual(
      expect.arrayContaining(["manual-bootstrap", "gate-consume-on-use"])
    );

    expect(BRANCH_CONTRACT_STATE_FILE.ownership.lane).toBe("owned_write_lane");
    expect(BRANCH_CONTRACT_STATE_FILE.ownership.writers).toEqual(["manual-bootstrap"]);
  });

  it("records the migration decision instead of prematurely splitting live files", () => {
    expect(RUNTIME_STATE_MIGRATION_PLAN.autonomous.mode).toBe("preserve-live-file");
    expect(RUNTIME_STATE_MIGRATION_PLAN.autonomous.keptFacts).toEqual(
      expect.arrayContaining([
        "active",
        "gateCache",
        "requiredSkills",
        "skillReads",
        "ownershipTrace",
        "ownedSkillReadTargets",
        "ownershipStatus",
        "blockedReason",
        "nextAction",
        "resumeTarget",
        "externalExecConsent",
        "consumedExternalExecConsentMessageId",
      ])
    );
    expect(RUNTIME_STATE_MIGRATION_PLAN.pushConsent.mode).toBe("adapter-only");
    expect(RUNTIME_STATE_MIGRATION_PLAN.branchContract.mode).toBe("adapter-only");
  });

  it("builds a stable envelope shape for higher-level runtime adapters", () => {
    const envelope = createProjectStateEnvelope("/tmp/pi-oven", AUTONOMOUS_STATE_FILE, {
      active: true,
      gateCache: { commit: "PASS" },
      version: 3,
      schemaVersion: 1,
    });

    expect(envelope).toEqual({
      fileId: "autonomous",
      fileName: "autonomous.json",
      relativePath: "state/autonomous.json",
      absolutePath: "/tmp/pi-oven/state/autonomous.json",
      ownership: AUTONOMOUS_STATE_FILE.ownership,
      state: {
        active: true,
        gateCache: { commit: "PASS" },
        version: 3,
        schemaVersion: 1,
      },
    });
  });

  it("serializes JSON deterministically for adapter-owned state writes", () => {
    expect(
      stringifyDeterministicJson({
        zeta: 1,
        alpha: { beta: 2, alpha: 1 },
        list: [{ d: 4, c: 3 }],
      })
    ).toBe(
      '{\n  "alpha": {\n    "alpha": 1,\n    "beta": 2\n  },\n  "list": [\n    {\n      "c": 3,\n      "d": 4\n    }\n  ],\n  "zeta": 1\n}'
    );
  });
});
