import { describe, it, expect } from "bun:test";
import {
  createAutonomousLoopResumeMarker,
  createHaltedByPolicyMarker,
  createLaneResumeMarker,
  createVerifierPendingMarker,
  isRearmableContinuationMarker,
  isValidContinuationMarker,
} from "../../../.omp/extensions/pi-oven-runtime/continuation-marker";

describe("continuation-marker", () => {
  it("models the four structured continuation-marker states", () => {
    const markers = [
      createAutonomousLoopResumeMarker("explicit-continue"),
      createVerifierPendingMarker("fresh-verifier"),
      createLaneResumeMarker("owned_write_lane"),
      createHaltedByPolicyMarker("branch-contract"),
    ];

    expect(markers).toEqual([
      { kind: "autonomous-loop-resume", trigger: "explicit-continue" },
      { kind: "verifier-pending", verifier: "fresh-verifier" },
      { kind: "lane-resume", lane: "owned_write_lane" },
      { kind: "halted-by-policy", policy: "branch-contract" },
    ]);
    expect(markers.every((marker) => isValidContinuationMarker(marker))).toBe(true);
    expect(markers.filter((marker) => isRearmableContinuationMarker(marker)).map((marker) => marker.kind)).toEqual([
      "autonomous-loop-resume",
      "verifier-pending",
    ]);
    expect(isRearmableContinuationMarker(createHaltedByPolicyMarker("branch-contract"))).toBe(false);
  });

  it("rejects prompt-only strings and malformed marker objects", () => {
    expect(isValidContinuationMarker("Continue autonomous execution immediately.")).toBe(false);
    expect(isValidContinuationMarker({ kind: "autonomous-loop-resume" })).toBe(false);
    expect(isValidContinuationMarker({ kind: "verifier-pending", verifier: 1 })).toBe(false);
    expect(isValidContinuationMarker({ kind: "lane-resume", lane: "" })).toBe(false);
    expect(isValidContinuationMarker({ kind: "halted-by-policy", policy: "" })).toBe(false);
  });
});
