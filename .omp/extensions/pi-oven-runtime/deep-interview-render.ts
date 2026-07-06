import type { ApprovalFlowState, DeepInterviewState } from "./deep-interview-state";

export const DEEP_INTERVIEW_CONTRACT_DEDUP_KEY = "pi-oven:deep-interview-contract@v1";
export const RECOMMENDED_SUFFIX = " (Recommended)";

export function formatRecommendedLabel(label: string, isRecommended: boolean): string {
  if (!isRecommended || label.endsWith(RECOMMENDED_SUFFIX)) return label;
  return `${label}${RECOMMENDED_SUFFIX}`;
}

export function buildDeepInterviewContractPrompt(
  state: DeepInterviewState | undefined,
  approvalFlow?: ApprovalFlowState
): string {
  const lines = [
    `<!-- ${DEEP_INTERVIEW_CONTRACT_DEDUP_KEY} -->`,
    "## pi-oven native deep-interview contract",
    "",
    "- When ambiguity or a user-owned decision remains, route the question through `pi-oven_ask`.",
    "- Supply `contextHeaders`, `contextSections`, `recommended`, and structured `deepInterview` / `approval` metadata so round identity, topology confirmation, milestone bands, weakest unresolved target selection, threshold tracking, spec persistence progress, and approval handoff state persist in the native runtime.",
    "- Use `affordances.askAboutChoices` for approval/routing clarification branches; only enable `affordances.other` when free-text is actually a valid next action.",
    "- Reuse the persisted interview/round identifiers; do not create a parallel prompt-only clarification flow.",
  ];

  if (!state && !approvalFlow) {
    return lines.join("\n");
  }

  lines.push("", "### Current deep-interview resume state");
  if (state) {
    lines.push(`- interviewId: ${state.interviewId}`);
    lines.push(`- phase: ${state.phase}`);
    if (state.threshold !== undefined) {
      lines.push(`- threshold: ${state.threshold} (source: ${state.thresholdSource ?? "default"})`);
    }
    if (state.pendingQuestion) {
      lines.push(`- pending question: ${state.pendingQuestion.question}`);
      lines.push(`- pending round key: ${state.pendingQuestion.roundKey}`);
      lines.push(`- pending stage: ${state.pendingQuestion.meta.stage}`);
    }
    if (state.state.milestone) {
      lines.push(`- milestone band: ${state.state.milestone}`);
    }
    if (state.state.nextTarget) {
      lines.push(
        `- weakest unresolved target: ${state.state.nextTarget.componentId} / ${state.state.nextTarget.dimension}`
      );
      lines.push(`- weakest target why: ${state.state.nextTarget.rationale}`);
    }
    if (state.spec) {
      lines.push(`- spec: ${state.spec.path} (${state.spec.stage})`);
      lines.push(`- spec persisted at: ${state.spec.persistedAt}`);
      lines.push(`- spec persistence: ${state.spec.stage} persisted to ${state.spec.path}`);
    } else if (approvalFlow?.resumedFrom?.specPath) {
      lines.push(`- spec persistence: approval handoff is waiting on ${approvalFlow.resumedFrom.specPath}`);
    }
    if (state.state.currentAmbiguity !== undefined) {
      lines.push(`- ambiguity: ${state.state.currentAmbiguity}`);
    }
    if (state.state.topology?.summary) {
      lines.push(`- topology: ${state.state.topology.summary}`);
      if (state.state.topology.confirmed !== undefined) {
        lines.push(`- topology confirmed: ${state.state.topology.confirmed ? "yes" : "no"}`);
      }
      lines.push(`- topology nodes: ${state.state.topology.nodes.length}`);
    }
    const latestOntology = state.state.ontologySnapshots.at(-1);
    if (latestOntology?.summary) {
      lines.push(`- ontology: ${latestOntology.summary}`);
    }
  }

  if (approvalFlow) {
    lines.push(`- approval flow: ${approvalFlow.kind}`);
    lines.push(`- approval decision: ${approvalFlow.decisionKey}`);
    lines.push(`- approval summary: ${approvalFlow.summary}`);
    lines.push(`- approval status: ${approvalFlow.status}`);
    lines.push(`- approval handoff state: ${approvalFlow.status} (${approvalFlow.source} / ${approvalFlow.kind})`);
    if (approvalFlow.resumedFrom?.specPath) {
      lines.push(`- approval spec: ${approvalFlow.resumedFrom.specPath}`);
    }
    if (approvalFlow.routingApproval) {
      for (const bucket of approvalFlow.routingApproval.buckets) {
        lines.push(`- routing bucket ${bucket.bucketKey}: ${bucket.roles.join(", ")}`);
      }
      for (const approval of Object.values(approvalFlow.routingApproval.approvals)) {
        if (!approval) continue;
        lines.push(
          `- routing approval ${approval.role}: ${approval.selectedSelector} (${approval.status})`
        );
      }
    }
  }

  if (state) {
    const topologyRound = state.state.rounds.find((round) => round.stage === "topology");
    if (topologyRound) {
      lines.push("", "### Topology", `- ${topologyRound.question}`);
      if (topologyRound.selected) {
        lines.push(`- Answer: ${topologyRound.selected}`);
      } else if (topologyRound.customInput) {
        lines.push(`- Answer: ${topologyRound.customInput}`);
      }
      if (topologyRound.topologySummary) {
        lines.push(`- Summary: ${topologyRound.topologySummary}`);
      }
    }

    const closureRound = state.state.rounds.find((round) => round.stage === "closure");
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
  }

  const approvalQuestion = approvalFlow?.pendingQuestion?.question;
  if (approvalQuestion || approvalFlow) {
    lines.push("", "### Approval");
    if (approvalQuestion) {
      lines.push(`- ${approvalQuestion}`);
    }
    if (approvalFlow) {
      lines.push(`- Kind: ${approvalFlow.kind}`);
      lines.push(`- Handoff: ${approvalFlow.decisionKey}`);
      lines.push(`- Summary: ${approvalFlow.summary}`);
      lines.push(`- Status: ${approvalFlow.status}`);
      lines.push(
        "- Canonical ask affordances: askAboutChoices=yes, other=no (unless a free-text override is explicitly required)"
      );
      if (approvalFlow.routingApproval) {
        const totalRoles = approvalFlow.routingApproval.buckets.reduce(
          (sum, bucket) => sum + bucket.roles.length,
          0
        );
        const approvedRoles = Object.values(approvalFlow.routingApproval.approvals).filter(
          (approval) => approval?.status === "approved"
        ).length;
        lines.push(`- Approval progress: ${approvedRoles}/${totalRoles} roles approved`);
      }
    }
  }

  return lines.join("\n");
}
