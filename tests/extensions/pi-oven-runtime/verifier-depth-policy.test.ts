import { describe, expect, it } from "bun:test";
import {
  decideVerifierDepth,
  deriveVerifierRisk,
} from "../../../.omp/extensions/pi-oven-runtime/verifier-depth-policy";

describe("verifier-depth-policy", () => {
  it("keeps interactive non-material docs-only flows on the light path", () => {
    const decision = decideVerifierDepth({
      mode: "interactive",
      risk: deriveVerifierRisk({ mutationScope: "docs_only", materialEdit: false }),
      mutationScope: "docs_only",
      materialEdit: false,
    });

    expect(decision.depth).toBe("light");
    expect(decision.requiresRegressionGate).toBe(false);
    expect(decision.hardCap.maxConsecutiveAutoContinues).toBe(0);
  });

  it("requires the deep path for autonomous runtime-contract material edits", () => {
    const decision = decideVerifierDepth({
      mode: "autonomous",
      risk: deriveVerifierRisk({ mutationScope: "runtime_contract", materialEdit: true }),
      mutationScope: "runtime_contract",
      materialEdit: true,
    });

    expect(decision.depth).toBe("deep");
    expect(decision.requiresRegressionGate).toBe(true);
    expect(decision.requiresMaterialRevalidation).toBe(true);
    expect(decision.hardCap.maxConsecutiveAutoContinues).toBe(1);
  });

  it("elevates high-risk flows to deep verification outside autonomous mode", () => {
    const decision = decideVerifierDepth({
      mode: "interactive",
      risk: "high",
      mutationScope: "team_runtime",
      materialEdit: true,
    });

    expect(decision.depth).toBe("deep");
    expect(decision.requiresFreshEvidence).toBe(true);
  });
});
