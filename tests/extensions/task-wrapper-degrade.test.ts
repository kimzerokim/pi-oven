import { describe, expect, it } from "bun:test";
import {
  finalizeSubprocessOutput,
  SUBAGENT_WARNING_NULL_YIELD,
} from "../../node_modules/@oh-my-pi/pi-coding-agent/src/task/executor";

const PASS_TRANSCRIPT = [
  "VERDICT: PASS",
  "Evidence: wrapper degraded to transcript-only output.",
  "Next: inspect transcript before merge/push.",
].join("\n");

function finalizeDegradedWrapper() {
  return finalizeSubprocessOutput({
    rawOutput: PASS_TRANSCRIPT,
    exitCode: 0,
    stderr: "",
    doneAborted: false,
    signalAborted: false,
    yieldItems: [{ data: null }],
    reportFindings: undefined,
    outputSchema: undefined,
  });
}


describe("task/verifier wrapper degraded transcript handling", () => {
  it("keeps the null-yield warning and PASS transcript while failing closed for merge/push", () => {
    const finalized = finalizeDegradedWrapper();

    expect(finalized.hasYield).toBe(true);
    expect(finalized.abortedViaYield).toBe(false);
    expect(finalized.rawOutput).toBe(`${SUBAGENT_WARNING_NULL_YIELD}\n\n${PASS_TRANSCRIPT}`);
    expect(finalized.rawOutput).toContain("VERDICT: PASS");
    expect(finalized.exitCode).not.toBe(0);
    expect(finalized.stderr).toMatch(/structured result parse degraded/i);
    expect(finalized.stderr).toMatch(/inspect transcript before merge\/push/i);
  });

  it("distinguishes degraded wrapper parsing from a normal execution failure", () => {
    const degraded = finalizeDegradedWrapper();
    const executionFailure = finalizeSubprocessOutput({
      rawOutput: "tool crashed before transcript emission",
      exitCode: 1,
      stderr: "verifier process exited 1",
      doneAborted: false,
      signalAborted: false,
      yieldItems: undefined,
      reportFindings: undefined,
      outputSchema: undefined,
    });

    expect(degraded.rawOutput).toContain("VERDICT: PASS");
    expect(degraded.stderr).toMatch(/structured result parse degraded/i);
    expect(degraded.wrapperStatus).toBe("degraded");
    expect(executionFailure.rawOutput).toBe("tool crashed before transcript emission");
    expect(executionFailure.stderr).toBe("verifier process exited 1");
    expect(executionFailure.wrapperStatus).toBe("clean");
    expect(executionFailure.stderr).not.toMatch(/structured result parse degraded/i);
  });

});
