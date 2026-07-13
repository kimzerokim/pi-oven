import { describe, it, expect } from "bun:test";
import {
  CAPABILITY_POLICY_VERSION,
  CAPABILITY_RULES,
  CAPABILITY_IDS,
  CAPABILITY_TAGS,
  CAPABILITY_TAGS_BY_ID,
  getCapabilitiesByTag,
  getCapabilityTags,
} from "../../../.omp/extensions/pi-oven-runtime/capability-registry";

describe("capability-registry", () => {
  it("publishes a unique versioned rule key for each registered tool", () => {
    expect(CAPABILITY_POLICY_VERSION).toBe(1);
    expect(new Set(CAPABILITY_RULES.map((rule) => rule.toolName)).size).toBe(
      CAPABILITY_RULES.length
    );
  });

  it("declares the Task 1 minimum capability set", () => {
    expect(CAPABILITY_IDS).toEqual(
      expect.arrayContaining([
        "code_write",
        "owned_write_lane",
        "shared_write_lane",
        "external_read",
        "external_mutation",
        "ask",
        "autonomous_continuation",
        "verification_completion",
        "debug_trace",
        "release_install_sync",
      ])
    );
  });

  it("includes the deep-interview / verification / runtime-routing tags required by the migration plan", () => {
    expect(CAPABILITY_TAGS).toEqual(
      expect.arrayContaining(["deep-interview", "verification", "runtime-routing"])
    );
  });

  it("maps ask / verification / continuation capabilities onto the new tag registry", () => {
    expect(getCapabilityTags("ask")).toContain("deep-interview");
    expect(getCapabilityTags("verification_completion")).toContain("verification");
    expect(getCapabilityTags("autonomous_continuation")).toContain("runtime-routing");
    expect(getCapabilityTags("release_install_sync")).toContain("runtime-routing");
  });

  it("supports reverse lookup by tag for Task 2 runtime routing", () => {
    expect(getCapabilitiesByTag("deep-interview")).toContain("ask");
    expect(getCapabilitiesByTag("verification")).toContain("verification_completion");
    expect(getCapabilitiesByTag("runtime-routing")).toEqual(
      expect.arrayContaining(["autonomous_continuation", "release_install_sync"])
    );
  });

  it("does not leave any capability without a tag assignment", () => {
    for (const capability of CAPABILITY_IDS) {
      expect(CAPABILITY_TAGS_BY_ID[capability]?.length ?? 0).toBeGreaterThan(0);
    }
  });
});
