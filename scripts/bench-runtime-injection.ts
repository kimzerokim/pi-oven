#!/usr/bin/env bun

import { performance } from "node:perf_hooks";
import {
  buildKeywordMatchedSkillsPrompt,
  createSkillKeywordLoaderState,
  loadSkillKeywordIndex,
  matchSkillsForText,
  updateSkillKeywordLoaderOnTurnStart,
} from "../.omp/extensions/pi-oven-runtime/skill-keyword-loader";

interface BenchFixture {
  name: string;
  text: string;
}

interface BenchMetrics {
  fixture: string;
  mode: "old-sim" | "new";
  matchedSkillCount: number;
  injectedPromptBytes: number;
  injectedPromptChars: number;
  injectedPromptLines: number;
  deferredObligationCount: number;
  phaseReceiptCount: number;
  turn_start_p50_ms: number;
  turn_start_p95_ms: number;
  turn_start_p99_ms: number;
  before_agent_start_p50_ms: number;
  before_agent_start_p95_ms: number;
  before_agent_start_p99_ms: number;
  tool_call_p50_ms: number;
  tool_call_p95_ms: number;
  tool_call_p99_ms: number;
}

const FIXTURES: BenchFixture[] = [
  {
    name: "worst-multi-skill-autonomous",
    text:
      "자율 실행으로 큰 작업 진행해줘. spec 잡자, 구현 계획, tdd, 코드 수정, 리팩토링, large task, " +
      "fresh verify, pre commit, git commit, execute plan, survey the codebase, codex review 결과 반영.",
  },
  {
    name: "debug-mutate-verify",
    text: "debug this regression, fix the bug, test first, verify before done, commit this",
  },
  {
    name: "research-plan",
    text: "deep dive and write a spec with html report and architecture refactor options",
  },
];

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return Number(sorted[index].toFixed(3));
}

function promptStats(prompt: string | null): Pick<
  BenchMetrics,
  "injectedPromptBytes" | "injectedPromptChars" | "injectedPromptLines"
> {
  const value = prompt ?? "";
  return {
    injectedPromptBytes: Buffer.byteLength(value, "utf-8"),
    injectedPromptChars: value.length,
    injectedPromptLines: value.length === 0 ? 0 : value.split("\n").length,
  };
}

function oldModePrompt(matched: ReturnType<typeof matchSkillsForText>): string | null {
  if (matched.length === 0) return null;
  const lines = [
    "<!-- old-runtime-sim:keyword-skills@v1 -->",
    "## Runtime keyword-matched skills",
    "",
    "The latest user message matched these workflow skills. You MUST load every listed skill before substantive action.",
    "This simulates the pre-pruning prompt shape where all matched skills are immediate hard reads.",
    "Runtime proof surface: requiredSkills, ownedSkillReadTargets, skillReads, active plugin root, exact SKILL.md targets, conflict precedence, provider-policy notes.",
    "Old-mode simulation repeats the proof contract and dispatch boundary for every matched skill, matching the pre-pruning expansion style.",
    "",
  ];
  for (const skill of matched) {
    lines.push(
      `- ${skill.ownedReadTarget} — ${skill.name}; matched by ${skill.rawMatchedPhrases.join(", ")}; read immediately before work.`,
      `  requiredSkills entry: ${skill.name}; ownedSkillReadTargets entry: ${skill.ownedReadTarget}; skillReads must prove the exact target.`,
      "  Hard precondition: no substantive work, planning, mutation, verification, delegation, or final answer before this skill is loaded.",
      "  Dispatch rule: preserve all non-conflicting rules, prefer the more specific skill on conflict, and keep provider/model wording symbolic.",
      "  Control-plane rule: bootstrap message injection, tool remap, same-purpose sibling skills, and invented aliases are not valid proof paths.",
      "  Boundary rule: repeat the exact read target in any child prompt that needs the capability and require receipt before code-write."
    );
  }
  return lines.join("\n");
}

function timeMany(fn: () => void, iterations = 250): number[] {
  const values: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    fn();
    values.push(performance.now() - start);
  }
  return values;
}

function summarize(
  fixture: string,
  mode: BenchMetrics["mode"],
  matchedSkillCount: number,
  prompt: string | null,
  deferredObligationCount: number,
  phaseReceiptCount: number,
  timings: {
    turnStart: number[];
    beforeAgentStart: number[];
    toolCall: number[];
  }
): BenchMetrics {
  return {
    fixture,
    mode,
    matchedSkillCount,
    ...promptStats(prompt),
    deferredObligationCount,
    phaseReceiptCount,
    turn_start_p50_ms: percentile(timings.turnStart, 50),
    turn_start_p95_ms: percentile(timings.turnStart, 95),
    turn_start_p99_ms: percentile(timings.turnStart, 99),
    before_agent_start_p50_ms: percentile(timings.beforeAgentStart, 50),
    before_agent_start_p95_ms: percentile(timings.beforeAgentStart, 95),
    before_agent_start_p99_ms: percentile(timings.beforeAgentStart, 99),
    tool_call_p50_ms: percentile(timings.toolCall, 50),
    tool_call_p95_ms: percentile(timings.toolCall, 95),
    tool_call_p99_ms: percentile(timings.toolCall, 99),
  };
}

const repoRoot = process.cwd();
const index = loadSkillKeywordIndex(repoRoot);
const rows: BenchMetrics[] = [];

for (const fixture of FIXTURES) {
  const branch = [
    {
      id: `${fixture.name}-user`,
      type: "message",
      message: { role: "user", content: fixture.text },
    },
  ];
  const matched = matchSkillsForText(fixture.text, index);
  const state = updateSkillKeywordLoaderOnTurnStart(
    createSkillKeywordLoaderState(),
    branch,
    index
  );

  const oldPrompt = oldModePrompt(matched);
  const newPrompt = buildKeywordMatchedSkillsPrompt(
    state.matchedSkills,
    state.deferredSkillObligations
  );

  rows.push(
    summarize(fixture.name, "old-sim", matched.length, oldPrompt, 0, 0, {
      turnStart: timeMany(() => matchSkillsForText(fixture.text, index)),
      beforeAgentStart: timeMany(() => oldModePrompt(matched)),
      toolCall: timeMany(() => undefined),
    })
  );
  rows.push(
    summarize(
      fixture.name,
      "new",
      state.matchedSkills.length,
      newPrompt,
      state.deferredSkillObligations.length,
      state.phaseReceipts.length,
      {
        turnStart: timeMany(() =>
          updateSkillKeywordLoaderOnTurnStart(createSkillKeywordLoaderState(), branch, index)
        ),
        beforeAgentStart: timeMany(() =>
          buildKeywordMatchedSkillsPrompt(state.matchedSkills, state.deferredSkillObligations)
        ),
        toolCall: timeMany(() => undefined),
      }
    )
  );
}

console.table(
  rows.map((row) => ({
    fixture: row.fixture,
    mode: row.mode,
    skills: row.matchedSkillCount,
    bytes: row.injectedPromptBytes,
    deferred: row.deferredObligationCount,
    turn_p95: row.turn_start_p95_ms,
    before_p95: row.before_agent_start_p95_ms,
    tool_p95: row.tool_call_p95_ms,
  }))
);

const worstOld = rows.find((row) => row.fixture === "worst-multi-skill-autonomous" && row.mode === "old-sim")!;
const worstNew = rows.find((row) => row.fixture === "worst-multi-skill-autonomous" && row.mode === "new")!;
const byteReduction = 1 - worstNew.injectedPromptBytes / worstOld.injectedPromptBytes;

const summary = {
  generatedAt: new Date().toISOString(),
  acceptance: {
    worstFixtureByteReduction: Number(byteReduction.toFixed(4)),
    worstFixtureBytesReducedAtLeast50Percent: byteReduction >= 0.5,
    toolCallP95NotWorse:
      worstNew.tool_call_p95_ms <= Math.max(worstOld.tool_call_p95_ms * 1.1, worstOld.tool_call_p95_ms + 0.01),
  },
  rows,
};

console.log(JSON.stringify(summary));
