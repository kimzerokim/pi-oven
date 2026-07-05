export type AutonomousLoopResumeTrigger = "explicit-continue" | "polite-stop";

export interface AutonomousLoopResumeMarker {
  kind: "autonomous-loop-resume";
  trigger: AutonomousLoopResumeTrigger;
}

export interface VerifierPendingMarker {
  kind: "verifier-pending";
  verifier: string;
}

export interface LaneResumeMarker {
  kind: "lane-resume";
  lane: string;
}

export interface HaltedByPolicyMarker {
  kind: "halted-by-policy";
  policy: string;
}

export type ContinuationMarker =
  | AutonomousLoopResumeMarker
  | VerifierPendingMarker
  | LaneResumeMarker
  | HaltedByPolicyMarker;

export function createAutonomousLoopResumeMarker(
  trigger: AutonomousLoopResumeTrigger
): AutonomousLoopResumeMarker {
  return { kind: "autonomous-loop-resume", trigger };
}

export function createVerifierPendingMarker(verifier: string): VerifierPendingMarker {
  return { kind: "verifier-pending", verifier };
}

export function createLaneResumeMarker(lane: string): LaneResumeMarker {
  return { kind: "lane-resume", lane };
}

export function createHaltedByPolicyMarker(policy: string): HaltedByPolicyMarker {
  return { kind: "halted-by-policy", policy };
}

export function isValidContinuationMarker(value: unknown): value is ContinuationMarker {
  if (typeof value !== "object" || value === null) return false;
  if (!("kind" in value) || typeof value.kind !== "string") return false;

  switch (value.kind) {
    case "autonomous-loop-resume":
      return (
        "trigger" in value &&
        (value.trigger === "explicit-continue" || value.trigger === "polite-stop")
      );
    case "verifier-pending":
      return "verifier" in value && typeof value.verifier === "string" && value.verifier.length > 0;
    case "lane-resume":
      return "lane" in value && typeof value.lane === "string" && value.lane.length > 0;
    case "halted-by-policy":
      return "policy" in value && typeof value.policy === "string" && value.policy.length > 0;
    default:
      return false;
  }
}
