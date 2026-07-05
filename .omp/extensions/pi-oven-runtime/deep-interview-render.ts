import type { DeepInterviewState } from "./deep-interview-state";

export const DEEP_INTERVIEW_CONTRACT_DEDUP_KEY = "pi-oven:deep-interview-contract@v1";
export const RECOMMENDED_SUFFIX = " (Recommended)";

export function formatRecommendedLabel(label: string, isRecommended: boolean): string {
  if (!isRecommended || label.endsWith(RECOMMENDED_SUFFIX)) return label;
  return `${label}${RECOMMENDED_SUFFIX}`;
}

export function buildDeepInterviewContractPrompt(state: DeepInterviewState | undefined): string {
  const lines = [
    `<!-- ${DEEP_INTERVIEW_CONTRACT_DEDUP_KEY} -->`,
    "## pi-oven native deep-interview contract",
    "",
    "- When ambiguity or a user-owned decision remains, route the question through `pi-oven_ask`.",
    "- Supply `recommended` and structured `deepInterview` metadata so round identity, approval handoff, and resume state persist in the native runtime.",
    "- Reuse the persisted interview/round identifiers; do not create a parallel prompt-only clarification flow.",
  ];

  if (!state) {
    return lines.join("\n");
  }

  lines.push("", "### Current deep-interview resume state");
  lines.push(`- interviewId: ${state.interviewId}`);
  lines.push(`- phase: ${state.phase}`);
  if (state.pendingQuestion) {
    lines.push(`- pending question: ${state.pendingQuestion.question}`);
    lines.push(`- pending round key: ${state.pendingQuestion.roundKey}`);
  }
  if (state.approvalHandoff) {
    lines.push(`- approval handoff: ${state.approvalHandoff.decisionKey}`);
    lines.push(`- approval summary: ${state.approvalHandoff.summary}`);
    lines.push(`- approval status: ${state.approvalHandoff.status}`);
  }
  if (state.routingApproval) {
    for (const bucket of state.routingApproval.buckets) {
      lines.push(`- routing bucket ${bucket.bucketKey}: ${bucket.roles.join(", ")}`);
    }
    for (const approval of Object.values(state.routingApproval.approvals)) {
      if (!approval) continue;
      lines.push(
        `- routing approval ${approval.role}: ${approval.selectedSelector} (${approval.status})`
      );
    }
  }

  const topologyRound = state.rounds.find((round) => round.stage === "topology");
  if (topologyRound) {
    lines.push("", "### Topology", `- ${topologyRound.question}`);
    if (topologyRound.selected) {
      lines.push(`- Answer: ${topologyRound.selected}`);
    } else if (topologyRound.customInput) {
      lines.push(`- Answer: ${topologyRound.customInput}`);
    }
  }

  const closureRound = state.rounds.find((round) => round.stage === "closure");
  const closureQuestion =
    state.pendingQuestion?.meta.stage === "closure"
      ? state.pendingQuestion.question
      : closureRound?.question;
  if (closureQuestion || closureRound) {
    lines.push("", "### Closure / restate gate");
    if (closureQuestion) {
      lines.push(`- ${closureQuestion}`);
    }
    if (closureRound) {
      lines.push(`- Status: ${closureRound.lifecycle}`);
      if (closureRound.selected) {
        lines.push(`- Answer: ${closureRound.selected}`);
      } else if (closureRound.customInput) {
        lines.push(`- Answer: ${closureRound.customInput}`);
      }
    }
  }

  const approvalRound = state.rounds.find((round) => round.stage === "approval");
  const approvalQuestion =
    state.pendingQuestion?.meta.stage === "approval"
      ? state.pendingQuestion.question
      : approvalRound?.question;
  if (approvalQuestion || state.approvalHandoff || state.routingApproval) {
    lines.push("", "### Approval");
    if (approvalQuestion) {
      lines.push(`- ${approvalQuestion}`);
    }
    if (state.approvalHandoff) {
      lines.push(`- Handoff: ${state.approvalHandoff.decisionKey}`);
      lines.push(`- Summary: ${state.approvalHandoff.summary}`);
      lines.push(`- Status: ${state.approvalHandoff.status}`);
    }
    if (state.routingApproval) {
      const totalRoles = state.routingApproval.buckets.reduce((sum, bucket) => sum + bucket.roles.length, 0);
      const approvedRoles = Object.values(state.routingApproval.approvals).filter(Boolean).length;
      lines.push(`- Approval progress: ${approvedRoles}/${totalRoles} roles approved`);
    }
  }

  return lines.join("\n");
}
