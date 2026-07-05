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

  it("tracks nested routing approval state as first-class runtime evidence", () => {
    const changes = listChangedRuntimeState(
      {
        deepInterview: {
          approvalHandoff: { status: "pending" },
          routingApproval: {
            approvals: {
              executor: {
                selectedSelector: undefined,
              },
            },
          },
        },
      },
      {
        deepInterview: {
          approvalHandoff: { status: "approved" },
          routingApproval: {
            approvals: {
              executor: {
                selectedSelector: "openai-codex/gpt-5.5:high",
              },
            },
          },
        },
      },
      [
        "deepInterview.approvalHandoff.status",
        "deepInterview.routingApproval.approvals.executor.selectedSelector",
      ]
    );

    expect(changes).toEqual([
      expect.objectContaining({
        key: "deepInterview.approvalHandoff.status",
        before: "pending",
        after: "approved",
      }),
      expect.objectContaining({
        key: "deepInterview.routingApproval.approvals.executor.selectedSelector",
        before: undefined,
        after: "openai-codex/gpt-5.5:high",
      }),
    ]);
  });

  it("treats remediation survey and research artifacts as verifier-relevant material evidence", () => {
    const trace = recordTouchedPath(
      recordTouchedPath(
        createRuntimeTraceSnapshot(),
        "docs/harness/surveys/2026-07-05-pi-oven-remediation-detailed-survey.md"
      ),
      "docs/research/2026-07-05-pi-oven-codex-only-routing-research.md"
    );

    expect(trace.touchedPaths).toEqual([
      "docs/harness/surveys/2026-07-05-pi-oven-remediation-detailed-survey.md",
      "docs/research/2026-07-05-pi-oven-codex-only-routing-research.md",
    ]);
    expect(trace.mutationScope).not.toBe("docs_only");
    expect(trace.materialEdit).toBe(true);
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
