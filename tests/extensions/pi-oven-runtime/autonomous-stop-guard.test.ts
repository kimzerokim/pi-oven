import { describe, it, expect } from "bun:test";
import {
  createStopGuardState,
  decideStopGuardOnTurnEnd,
  updateStopGuardOnTurnStart,
} from "../../../.omp/extensions/pi-oven-runtime/autonomous-stop-guard";

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
    expect(decision.state.continuationMarker).toEqual({
      kind: "halted-by-policy",
      policy: "max-consecutive-auto-continues",
    });
  });
});
