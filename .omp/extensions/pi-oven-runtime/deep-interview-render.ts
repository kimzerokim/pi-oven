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
  return lines.join("\n");
}
