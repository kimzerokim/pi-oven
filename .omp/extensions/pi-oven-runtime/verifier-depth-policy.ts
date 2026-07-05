import type { RuntimeMutationScope } from "./trace-primitives";

export type VerifierMode = "interactive" | "autonomous";
export type VerifierRiskLevel = "low" | "medium" | "high";
export type VerifierDepth = "light" | "deep";

export interface VerifierDepthContext {
  mode: VerifierMode;
  risk: VerifierRiskLevel;
  mutationScope: RuntimeMutationScope;
  materialEdit: boolean;
}

export interface VerifierHardCapPolicy {
  maxConsecutiveAutoContinues: number;
}

export interface VerifierDepthDecision {
  depth: VerifierDepth;
  requiresRegressionGate: boolean;
  requiresFreshEvidence: boolean;
  requiresMaterialRevalidation: boolean;
  hardCap: VerifierHardCapPolicy;
  reason: string;
}

export function deriveVerifierRisk(input: {
  mutationScope: RuntimeMutationScope;
  materialEdit: boolean;
}): VerifierRiskLevel {
  const { mutationScope, materialEdit } = input;
  if (!materialEdit) return "low";
  if (mutationScope === "runtime_contract" || mutationScope === "team_runtime") return "high";
  if (
    mutationScope === "setup_surface" ||
    mutationScope === "agent_surface" ||
    mutationScope === "eval_surface"
  ) {
    return "medium";
  }
  return "medium";
}

export function decideVerifierDepth(
  context: VerifierDepthContext
): VerifierDepthDecision {
  const deepBecauseRisk = context.risk === "high";
  const deepBecauseAutonomousMaterial =
    context.mode === "autonomous" &&
    context.materialEdit &&
    context.mutationScope !== "docs_only" &&
    context.mutationScope !== "none";
  const deepBecauseRuntimeContract =
    context.materialEdit &&
    (context.mutationScope === "runtime_contract" || context.mutationScope === "team_runtime");
  const depth: VerifierDepth =
    deepBecauseRisk || deepBecauseAutonomousMaterial || deepBecauseRuntimeContract
      ? "deep"
      : "light";

  const reason =
    depth === "deep"
      ? [
          deepBecauseRisk ? `risk=${context.risk}` : null,
          deepBecauseAutonomousMaterial ? `mode=${context.mode}+material_edit` : null,
          deepBecauseRuntimeContract ? `scope=${context.mutationScope}` : null,
        ]
          .filter((segment): segment is string => segment !== null)
          .join(", ") || "deep verification required"
      : `mode=${context.mode}, risk=${context.risk}, material_edit=${context.materialEdit}`;

  return {
    depth,
    requiresRegressionGate: depth === "deep",
    requiresFreshEvidence: true,
    requiresMaterialRevalidation: context.materialEdit,
    hardCap: {
      maxConsecutiveAutoContinues:
        context.mode === "autonomous" ? (depth === "deep" ? 1 : 3) : 0,
    },
    reason,
  };
}
