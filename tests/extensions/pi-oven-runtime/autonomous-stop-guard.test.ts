import { describe, it, expect } from "bun:test";
import {
  classifyDurableExternalToolEffect,
  createStopGuardState,
  decideStopGuardOnTurnEnd,
  updateStopGuardOnTurnStart,
} from "../../../.omp/extensions/pi-oven-runtime/autonomous-stop-guard";

describe("autonomous durable effects", () => {
  it("classifies gated git/external mutations but not local read commands", () => {
    expect(classifyDurableExternalToolEffect("bash", { command: "git push origin main" }))
      .toMatchObject({ kind: "git-push", target: "origin main" });
    expect(classifyDurableExternalToolEffect("bash", { command: "aws s3 cp file s3://bucket/key" }))
      .toMatchObject({ kind: "external-mutation" });
    expect(classifyDurableExternalToolEffect("bash", { command: "git status --short" }))
      .toBeUndefined();
    expect(classifyDurableExternalToolEffect("read", { path: "README.md" }))
      .toBeUndefined();
  });
});

function userEntry(id: string, text: string) {
  return {
    id,
    type: "message",
    message: {
      role: "user",
      content: [{ type: "text", text }],
    },
  };
}

describe("autonomous-stop-guard", () => {
  it("activates autonomous state on Korean autonomous keyword", () => {
    const initial = createStopGuardState();
    const next = updateStopGuardOnTurnStart(initial, [userEntry("u1", "자율 실행으로 끝까지 진행해줘")]);

    expect(next.autonomousActive).toBe(true);
    expect(next.explicitContinueThisTurn).toBe(true);
  });

  it("queues continuation on explicit continue request", () => {
    const started = updateStopGuardOnTurnStart(createStopGuardState(), [userEntry("u1", "계속 진행해줘")]);

    const decision = decideStopGuardOnTurnEnd(started, {
      stopReason: "stop",
      assistantText: "좋습니다. 다음 단계가 필요하면 알려주세요.",
    });

    expect(decision.shouldQueueContinuation).toBe(true);
    expect(decision.reason).toBe("explicit-continue");
    expect(decision.state.continuationMarker).toEqual({
      kind: "autonomous-loop-resume",
      trigger: "explicit-continue",
    });
  });

  it("queues continuation on polite-stop text while autonomous is active", () => {
    const active = {
      ...createStopGuardState(),
      autonomousActive: true,
      explicitContinueThisTurn: false,
    };

    const decision = decideStopGuardOnTurnEnd(active, {
      stopReason: "stop",
      assistantText: "Done, awaiting next instruction.",
    });

    expect(decision.shouldQueueContinuation).toBe(true);
    expect(decision.reason).toBe("polite-stop");
    expect(decision.state.continuationMarker).toEqual({
      kind: "autonomous-loop-resume",
      trigger: "polite-stop",
    });
  });

  it("persists a halted-by-policy marker on branch-contract question", () => {
    const active = {
      ...createStopGuardState(),
      autonomousActive: true,
      explicitContinueThisTurn: true,
    };

    const decision = decideStopGuardOnTurnEnd(active, {
      stopReason: "stop",
      assistantText: "목적지/브랜치명/PR 모드를 어떻게 할까요?",
    });

    expect(decision.shouldQueueContinuation).toBe(false);
    expect(decision.reason).toBeNull();
    expect(decision.blockedReason).toEqual({
      kind: "branch-contract",
      message:
        "pi-oven: autonomy paused — the branch contract is still missing destination/branch/pr_mode for code-write.",
    });
    expect(decision.nextAction).toEqual({
      kind: "write-branch-contract",
      message:
        "Write .pi-oven/state/branch-contract.json with destination, branch, and pr_mode, then continue in the same repo/branch.",
    });
    expect(decision.state.continuationMarker).toEqual({
      kind: "halted-by-policy",
      policy: "branch-contract",
    });
  });

  it("clears continuation marker on terminal completion output", () => {
    const active = {
      ...createStopGuardState(),
      autonomousActive: true,
      explicitContinueThisTurn: true,
      continuationMarker: {
        kind: "autonomous-loop-resume",
        trigger: "explicit-continue",
      } as const,
    };

    const decision = decideStopGuardOnTurnEnd(active, {
      stopReason: "stop",
      assistantText: "모든 요청된 작업이 완료되었습니다. 최종 검증 통과.",
    });

    expect(decision.shouldQueueContinuation).toBe(false);
    expect(decision.reason).toBeNull();
    expect(decision.state.continuationMarker).toBeUndefined();
  });

  it("stops auto-queueing after max consecutive guard injections", () => {
    const active = {
      ...createStopGuardState(),
      autonomousActive: true,
      explicitContinueThisTurn: false,
      consecutiveAutoContinues: 3,
    };

    const decision = decideStopGuardOnTurnEnd(active, {
      stopReason: "stop",
      assistantText: "Should I proceed to the next stage?",
    });

    expect(decision.shouldQueueContinuation).toBe(false);
    expect(decision.state.consecutiveAutoContinues).toBe(0);
    expect(decision.blockedReason).toEqual({
      kind: "max-consecutive-auto-continues",
      message:
        "pi-oven: autonomy paused — the max consecutive auto-continue cap was reached before the run could safely finish.",
    });
    expect(decision.nextAction).toEqual({
      kind: "continue-in-same-repo",
      message:
        "Continue manually in the same repo/branch when more work remains, or ask for an explicit continue after reviewing the last stop.",
    });
    expect(decision.state.continuationMarker).toEqual({
      kind: "halted-by-policy",
      policy: "max-consecutive-auto-continues",
    });
  });
});
