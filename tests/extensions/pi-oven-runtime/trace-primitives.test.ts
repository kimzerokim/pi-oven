import { describe, expect, it } from "bun:test";
import {
  RUNTIME_TRACE_PRIMITIVES,
  createRuntimeTraceSnapshot,
  listChangedRuntimeState,
  recordTouchedPath,
  summarizeFailurePath,
} from "../../../.omp/extensions/pi-oven-runtime/trace-primitives";

describe("trace-primitives", () => {
  it("classifies runtime contract edits as material and records the primitive inventory", () => {
    const trace = recordTouchedPath(createRuntimeTraceSnapshot(), ".omp/extensions/pi-oven-runtime/gate.ts");

    expect(RUNTIME_TRACE_PRIMITIVES).toEqual([
      "trace_function",
      "summarize_failure_path",
      "set_breakpoint_at_symbol",
      "list_changed_runtime_state",
    ]);
    expect(trace.mutationScope).toBe("runtime_contract");
    expect(trace.materialEdit).toBe(true);
  });

  it("lists only changed runtime state keys", () => {
    const changes = listChangedRuntimeState(
      {
        active: false,
        gateCache: { commit: "FAIL" },
        continuationMarker: undefined,
      },
      {
        active: true,
        gateCache: { commit: "PASS" },
        continuationMarker: { kind: "verifier-pending", verifier: "pi-oven:verifier/deep" },
      },
      ["active", "gateCache", "continuationMarker"]
    );

    expect(changes.map((entry) => entry.key)).toEqual([
      "active",
      "gateCache",
      "continuationMarker",
    ]);
  });

  it("summarizes failure paths with function, symbol, and state focus", () => {
    const failure = summarizeFailurePath({
      surface: "completion-gate",
      message: "deep verification required before exit",
      functions: ["decideGate", "decideVerifierDepth"],
      symbols: ["pi-oven:verifier"],
      stateKeys: ["gateCache.commit", "gateCache.regression"],
    });

    expect(failure.summary).toContain("functions=decideGate,decideVerifierDepth");
    expect(failure.summary).toContain("symbols=pi-oven:verifier");
    expect(failure.summary).toContain("state=gateCache.commit,gateCache.regression");
  });

});
