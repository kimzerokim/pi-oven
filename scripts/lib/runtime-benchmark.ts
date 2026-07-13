import { performance } from "node:perf_hooks";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readlinkSync } from "node:fs";
import path from "node:path";
import {
  createGateHandler,
  type GateLogger,
} from "../../.omp/extensions/pi-oven-runtime/gate-handler";
import { buildDeepInterviewContractPrompt } from "../../.omp/extensions/pi-oven-runtime/deep-interview-render";
import {
  GateStateStore,
  type FsmState,
  type FsmStateView,
} from "../../.omp/extensions/pi-oven-runtime/gate-state";
import {
  buildKeywordMatchedSkillsPrompt,
  matchSkillsForText,
} from "../../.omp/extensions/pi-oven-runtime/skill-keyword-loader";
import { RulesInjector } from "../../.omp/extensions/pi-oven-runtime/rules-injector";
import {
  DEFAULT_MAX_IMPLICIT_ROOTS,
  hasExplicitSkillAlias,
  selectSkillsForTurn,
  type SkillSelectionIndexEntry,
} from "../../.omp/extensions/pi-oven-runtime/skill-selection";
import { TaskDispatchSchema } from "../../.omp/extensions/pi-oven-runtime/runtime-contract";
import { createWorkerContextFragments } from "../../.omp/extensions/pi-oven-runtime/context-capsule";
import type {
  PromptCompositionReceipt,
  PromptFragment,
} from "../../.omp/extensions/pi-oven-runtime/prompt-compositor";

export interface RuntimeBenchmarkFixture {
  name: string;
  text: string;
  requiredSkills: string[];
  forbiddenSkills: string[];
}

export const DEFAULT_RUNTIME_BENCHMARK_FIXTURES: RuntimeBenchmarkFixture[] = [
  {
    name: "worst-multi-skill-autonomous",
    text:
      "자율 실행으로 큰 작업 진행해줘. spec 잡자, 구현 계획, tdd, 코드 수정, 리팩토링, large task, " +
      "fresh verify, pre commit, git commit, execute plan, survey the codebase, codex review 결과 반영.",
    requiredSkills: [
      "pov:autonomous-loop",
      "pov:receiving-code-review",
      "pov:spec-and-review",
      "pov:writing-plans",
      "pov:pre-commit-gate",
      "pov:fresh-verifier",
      "pov:tdd-strict",
      "pov:code-quality-discipline",
      "pov:subagent-driven-development",
      "pov:large-task-delegation",
      "pov:codebase-survey",
    ],
    forbiddenSkills: ["pov:aws", "pov:cloudflare", "pov:bitbucket-pipeline"],
  },
  {
    name: "debug-mutate-verify",
    text: "debug this regression, fix the bug, test first, verify before done, commit this",
    requiredSkills: [
      "pov:systematic-debugging",
      "pov:pre-commit-gate",
      "pov:fresh-verifier",
      "pov:tdd-strict",
    ],
    forbiddenSkills: ["pov:aws", "pov:cloudflare"],
  },
  {
    name: "research-plan",
    text: "deep dive and write a spec with html report and architecture refactor options",
    requiredSkills: [
      "pov:deep-dive",
      "pov:spec-and-review",
      "pov:improve-codebase-architecture",
      "pov:html-research-orchestrator",
      "pov:code-quality-discipline",
    ],
    forbiddenSkills: ["pov:autonomous-loop", "pov:aws"],
  },
];

export interface BenchmarkCorrectness {
  contractValid: boolean;
  explicitRecall: number;
  requiredRecall: number;
  forbiddenPrecision: number;
  deterministic: boolean;
  failures: string[];
}

export interface LatencyPercentiles {
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
}

export interface GatePathMeasurement {
  path:
    | "read-only-fast-path"
    | "canonical-task-validation"
    | "blocked-legacy-task"
    | "blocked-unknown-task";
  warmupIterations: number;
  measurementIterations: number;
  outcome: { block: boolean; reason?: string; agent?: string };
  latency: LatencyPercentiles;
}

export type PromptAudience = "parent" | "worker";

export interface PromptFragmentMeasurement {
  id: string;
  audiences: PromptAudience[];
  bytes: number;
  estimatedTokens: number;
}

export interface PromptMeasurement {
  fixture: string;
  fragments: PromptFragmentMeasurement[];
  totals: Record<PromptAudience, { bytes: number; estimatedTokens: number }>;
}

export const RUNTIME_BENCHMARK_VERSION = 1;
export { RUNTIME_CONTRACT_VERSION } from "../../.omp/extensions/pi-oven-runtime/runtime-contract";
import { RUNTIME_CONTRACT_VERSION } from "../../.omp/extensions/pi-oven-runtime/runtime-contract";

export type RuntimeBenchmarkSource =
  | { kind: "commit"; commitSha: string }
  | { kind: "worktree"; headCommitSha: string; contentHash: string };

export interface RuntimeBenchmarkEnvironment {
  source: RuntimeBenchmarkSource;
  bunVersion: string;
  ompVersion: string;
}

export interface RuntimeBenchmarkSourceOptions {
  /** Generated artifacts omitted from the source snapshot to avoid self-reference. */
  excludedRelativePaths?: readonly string[];
}

function runGit(repoRoot: string, args: string[]): Uint8Array {
  const result = Bun.spawnSync(["git", ...args], {
    cwd: repoRoot,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    const detail = result.stderr.toString().trim();
    throw new Error(
      `runtime benchmark provenance git ${args[0] ?? "command"} failed${detail ? `: ${detail}` : ""}`,
    );
  }
  return result.stdout;
}

function normalizedRelativePath(value: string): string {
  return value.replaceAll("\\", "/").replace(/^\.\//u, "");
}

/** Resolve truthful source provenance for a benchmark captured from this checkout. */
export function resolveRuntimeBenchmarkSource(
  repoRoot: string,
  options: RuntimeBenchmarkSourceOptions = {},
): RuntimeBenchmarkSource {
  const resolvedRoot = path.resolve(repoRoot);
  const headCommitSha = Buffer.from(
    runGit(resolvedRoot, ["rev-parse", "HEAD"]),
  ).toString("utf8").trim();
  if (!/^[0-9a-f]{40}$/u.test(headCommitSha)) {
    throw new Error("runtime benchmark provenance requires a full HEAD commit SHA");
  }

  const excluded = new Set(
    (options.excludedRelativePaths ?? []).map(normalizedRelativePath),
  );
  const pathspec = [
    ".",
    ...[...excluded].sort().map((relative) => `:(exclude)${relative}`),
  ];
  const trackedDiff = runGit(resolvedRoot, [
    "diff",
    "--binary",
    "--no-ext-diff",
    "HEAD",
    "--",
    ...pathspec,
  ]);
  const untracked = Buffer.from(
    runGit(resolvedRoot, ["ls-files", "--others", "--exclude-standard", "-z", "--", "."]),
  )
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .map(normalizedRelativePath)
    .filter((relative) => !excluded.has(relative))
    .sort();

  if (trackedDiff.byteLength === 0 && untracked.length === 0) {
    return { kind: "commit", commitSha: headCommitSha };
  }

  const hash = createHash("sha256");
  hash.update("pi-oven-runtime-benchmark-worktree@1\0");
  hash.update(headCommitSha);
  hash.update("\0tracked-diff\0");
  hash.update(trackedDiff);
  for (const relative of untracked) {
    const absolute = path.resolve(resolvedRoot, relative);
    const stat = lstatSync(absolute);
    hash.update("\0untracked\0");
    hash.update(relative);
    hash.update(`\0mode:${stat.mode.toString(8)}\0`);
    if (stat.isSymbolicLink()) {
      hash.update(`symlink\0${readlinkSync(absolute)}`);
    } else {
      hash.update("file\0");
      hash.update(readFileSync(absolute));
    }
  }
  return {
    kind: "worktree",
    headCommitSha,
    contentHash: `sha256:${hash.digest("hex")}`,
  };
}

export interface RuntimeBenchmarkBaseline extends RuntimeBenchmarkEnvironment {
  benchmarkVersion: number;
  contractVersion: string;
  generatedAt: string;
  fixtureHash: string;
  selectionReceipt: Record<string, ReturnType<typeof semanticReceipt>>;
  performance: {
    workerPrompt: { fixture: string; bytes: number };
    gateReadOnly: { path: "read-only-fast-path"; p95Ms: number };
  };
}

export interface RuntimeBenchmarkReport {
  benchmarkVersion: number;
  generatedAt: string;
  correctness: BenchmarkCorrectness;
  performance: {
    accepted: boolean;
    workerPrompt: {
      fixture: string;
      baselineBytes: number;
      currentBytes: number;
      reduction: number;
      requiredReduction: number;
      accepted: boolean;
    };
    gateReadOnly: {
      path: "read-only-fast-path";
      baselineP95Ms: number;
      currentP95Ms: number;
      allowedRegressionMs: number;
      maximumP95Ms: number;
      accepted: boolean;
    };
    prompts: PromptMeasurement[];
    gates: GatePathMeasurement[];
  };
  metadata: {
    contractVersion: string;
    source: RuntimeBenchmarkSource;
    bunVersion: string;
    ompVersion: string;
    fixtureHash: string;
    selectionReceipt: RuntimeBenchmarkBaseline["selectionReceipt"];
    baseline: Omit<RuntimeBenchmarkBaseline, "performance" | "selectionReceipt">;
  };
  accepted: boolean;
}

interface RuntimeBenchmarkOptions {
  index: SkillSelectionIndexEntry[];
  fixtures: RuntimeBenchmarkFixture[];
  projectInstructions: string | null;
  language: string | null;
  environment: RuntimeBenchmarkEnvironment;
  warmupIterations?: number;
  measurementIterations?: number;
  generatedAt?: string;
  expectedSkillCount?: number;
}

interface RuntimeBenchmarkEvidence {
  correctness: BenchmarkCorrectness;
  fixtureHash: string;
  selectionReceipt: RuntimeBenchmarkBaseline["selectionReceipt"];
  prompts: PromptMeasurement[];
  gates: GatePathMeasurement[];
}

const INITIAL_BENCHMARK_STATE: FsmState = {
  active: false,
  gateCache: {},
  version: 1,
  schemaVersion: 1,
  ownershipTrace: [],
  explicitForeignAgents: [],
};

class InMemoryGateStateStore extends GateStateStore {
  private current = structuredClone(INITIAL_BENCHMARK_STATE);

  constructor() {
    super("/__pi-oven-runtime-benchmark-in-memory__");
  }

  reset(): void {
    this.current = structuredClone(INITIAL_BENCHMARK_STATE);
  }

  override async readState(): Promise<FsmStateView> {
    return { kind: "OK", state: structuredClone(this.current) };
  }

  override async readStateMtimeMs(): Promise<number> {
    return this.current.version;
  }

  override async writeState(state: FsmState): Promise<void> {
    this.current = structuredClone(state);
  }

  override async mutate(updater: (current: FsmState) => FsmState): Promise<void> {
    this.current = structuredClone(updater(structuredClone(this.current)));
  }

  override async runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    return fn();
  }
}

const QUIET_LOGGER: GateLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
};

function percentile(values: number[], percentileRank: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((percentileRank / 100) * sorted.length) - 1)
  );
  return Number(sorted[index]!.toFixed(6));
}

async function measureAsync(
  operation: () => Promise<unknown>,
  warmupIterations: number,
  measurementIterations: number,
  beforeEach?: () => void
): Promise<LatencyPercentiles> {
  for (let iteration = 0; iteration < warmupIterations; iteration += 1) {
    beforeEach?.();
    await operation();
  }
  const samples: number[] = [];
  for (let iteration = 0; iteration < measurementIterations; iteration += 1) {
    beforeEach?.();
    const startedAt = performance.now();
    await operation();
    samples.push(performance.now() - startedAt);
  }
  return {
    p50Ms: percentile(samples, 50),
    p95Ms: percentile(samples, 95),
    p99Ms: percentile(samples, 99),
  };
}

function taskEvent(agent: string, id: string) {
  return {
    type: "tool_call" as const,
    toolCallId: id,
    toolName: "task",
    input: {
      agent,
      tasks: [
        {
          id: `${id}-item`,
          description: "Exercise the runtime benchmark gate path.",
          assignment: "Return the gate decision only.",
        },
      ],
    },
  };
}

export async function benchmarkGatePaths(options: {
  warmupIterations?: number;
  measurementIterations?: number;
} = {}): Promise<GatePathMeasurement[]> {
  const warmupIterations = options.warmupIterations ?? 50;
  const measurementIterations = options.measurementIterations ?? 250;
  if (!Number.isSafeInteger(warmupIterations) || warmupIterations < 0) {
    throw new RangeError("warmupIterations must be a non-negative safe integer");
  }
  if (!Number.isSafeInteger(measurementIterations) || measurementIterations < 1) {
    throw new RangeError("measurementIterations must be a positive safe integer");
  }

  const store = new InMemoryGateStateStore();
  const handler = createGateHandler({
    store,
    logger: QUIET_LOGGER,
    getEnv: () => ({}),
    isParentSession: true,
  });
  const definitions: Array<{
    path: GatePathMeasurement["path"];
    makeEvent: () => ReturnType<typeof taskEvent> | {
      type: "tool_call";
      toolCallId: string;
      toolName: "bash";
      input: { command: string };
    };
  }> = [
    {
      path: "read-only-fast-path",
      makeEvent: () => ({
        type: "tool_call",
        toolCallId: "bench-read-only",
        toolName: "bash",
        input: { command: "git status --short" },
      }),
    },
    {
      path: "canonical-task-validation",
      makeEvent: () => taskEvent("pov:executor", "bench-canonical"),
    },
    {
      path: "blocked-legacy-task",
      makeEvent: () => taskEvent("pi-oven:executor", "bench-legacy"),
    },
    {
      path: "blocked-unknown-task",
      makeEvent: () => taskEvent("foreign:phantom", "bench-unknown"),
    },
  ];

  const measurements: GatePathMeasurement[] = [];
  for (const definition of definitions) {
    store.reset();
    const probeEvent = definition.makeEvent();
    const probeResult = await handler(probeEvent);
    const outcome = {
      block: probeResult?.block ?? false,
      ...(probeResult?.reason ? { reason: probeResult.reason } : {}),
      ...("agent" in probeEvent.input && typeof probeEvent.input.agent === "string"
        ? { agent: probeEvent.input.agent }
        : {}),
    };
    const latency = await measureAsync(
      async () => handler(definition.makeEvent()),
      warmupIterations,
      measurementIterations,
      () => store.reset()
    );
    measurements.push({
      path: definition.path,
      warmupIterations,
      measurementIterations,
      outcome,
      latency,
    });
  }
  return measurements;
}

export function measurePromptFragments(input: {
  index: SkillSelectionIndexEntry[];
  fixture: RuntimeBenchmarkFixture;
  projectInstructions: string | null;
  language: string | null;
}): PromptMeasurement {
  const receipt = selectSkillsForTurn({
    latestUserText: input.fixture.text,
    index: input.index,
    maxImplicitRoots: DEFAULT_MAX_IMPLICIT_ROOTS,
  });
  const injector = new RulesInjector();
  injector.setLanguage(input.language);
  injector.setProjectInstructions(input.projectInstructions);
  const selectedRoots = [...receipt.explicit, ...receipt.implicitRoot];
  const parentAdditional: PromptFragment[] = [];
  const keywordPrompt = buildKeywordMatchedSkillsPrompt(selectedRoots, receipt.deferred);
  if (keywordPrompt !== null) {
    parentAdditional.push({
      id: "keyword-skills",
      audience: "parent",
      phase: "always",
      priority: 75,
      required: true,
      dedupKey: "pi-oven:benchmark-keyword-skills",
      render: () => keywordPrompt,
    });
  }
  if (
    receipt.explicit.length > 0 ||
    receipt.implicitRoot.length > 0 ||
    receipt.deferred.length > 0
  ) {
    parentAdditional.push({
      id: "deep-interview-contract",
      audience: "parent",
      phase: "always",
      priority: 70,
      required: true,
      dedupKey: "pi-oven:benchmark-deep-interview",
      render: () => buildDeepInterviewContractPrompt(undefined),
    });
  }

  const autonomousActive = selectedRoots.some(
    (candidate) => candidate.name === "pov:autonomous-loop"
  );
  const parent = injector.composeSystemPrompt({
    systemPrompt: [],
    audience: "parent",
    autonomousActive,
    additionalFragments: parentAdditional,
  });
  const selectedSkillTargets = [...selectedRoots, ...receipt.deferred]
    .map((candidate) => candidate.ownedReadTarget);
  const worker = injector.composeSystemPrompt({
    systemPrompt: [],
    audience: "worker",
    includeDiscipline: false,
    includeLanguage: false,
    includeProjectInstructions: false,
    additionalFragments: createWorkerContextFragments({
      role: "pov:executor",
      assignment: input.fixture.text,
      selectedSkillTargets,
      phase: "mutate",
    }),
  });

  const fragments: PromptFragmentMeasurement[] = [];
  const collect = (
    composition: PromptCompositionReceipt,
    audience: PromptAudience
  ): void => {
    for (const entry of composition.fragments) {
      if (!entry.included) continue;
      const existing = fragments.find(
        (fragment) => fragment.id === entry.id && fragment.bytes === entry.bytes
      );
      if (existing) {
        if (!existing.audiences.includes(audience)) existing.audiences.push(audience);
      } else {
        fragments.push({
          id: entry.id,
          audiences: [audience],
          bytes: entry.bytes,
          estimatedTokens: Math.ceil(entry.bytes / 4),
        });
      }
    }
  };
  collect(parent.receipt, "parent");
  collect(worker.receipt, "worker");
  fragments.sort((left, right) => left.id.localeCompare(right.id));

  const totals = Object.fromEntries(
    (["parent", "worker"] as const).map((audience) => {
      const bytes = audience === "parent"
        ? parent.receipt.includedBytes
        : worker.receipt.includedBytes;
      return [audience, { bytes, estimatedTokens: Math.ceil(bytes / 4) }];
    })
  ) as PromptMeasurement["totals"];

  return { fixture: input.fixture.name, fragments, totals };
}

export function hashRuntimeBenchmarkFixtures(
  fixtures: RuntimeBenchmarkFixture[]
): string {
  return createHash("sha256")
    .update(JSON.stringify(fixtures))
    .digest("hex");
}

export function summarizeSelectionReceipts(input: {
  index: SkillSelectionIndexEntry[];
  fixtures: RuntimeBenchmarkFixture[];
}): RuntimeBenchmarkBaseline["selectionReceipt"] {
  return Object.fromEntries(
    input.fixtures.map((fixture) => [
      fixture.name,
      semanticReceipt(
        selectSkillsForTurn({
          latestUserText: fixture.text,
          index: input.index,
          maxImplicitRoots: DEFAULT_MAX_IMPLICIT_ROOTS,
        })
      ),
    ])
  );
}

function gateOutcomeFailures(gates: GatePathMeasurement[]): string[] {
  const expected = new Map<GatePathMeasurement["path"], boolean>([
    ["read-only-fast-path", false],
    ["canonical-task-validation", false],
    ["blocked-legacy-task", true],
    ["blocked-unknown-task", true],
  ]);
  const failures: string[] = [];
  for (const [path, expectedBlock] of expected) {
    const measurement = gates.find((candidate) => candidate.path === path);
    if (!measurement) {
      failures.push(`contract: gate benchmark path missing ${path}`);
    } else if (measurement.outcome.block !== expectedBlock) {
      failures.push(
        `contract: gate benchmark path ${path} returned block=${measurement.outcome.block}`
      );
    }
  }
  return failures;
}

function correctnessAccepted(correctness: BenchmarkCorrectness): boolean {
  return (
    correctness.contractValid &&
    correctness.explicitRecall === 1 &&
    correctness.requiredRecall === 1 &&
    correctness.forbiddenPrecision === 1 &&
    correctness.deterministic &&
    correctness.failures.length === 0
  );
}

async function collectRuntimeBenchmarkEvidence(
  options: RuntimeBenchmarkOptions
): Promise<RuntimeBenchmarkEvidence> {
  const initialCorrectness = evaluateBenchmarkCorrectness({
    index: options.index,
    fixtures: options.fixtures,
    expectedSkillCount: options.expectedSkillCount,
  });
  const prompts = options.fixtures.map((fixture) =>
    measurePromptFragments({
      index: options.index,
      fixture,
      projectInstructions: options.projectInstructions,
      language: options.language,
    })
  );
  const gates = await benchmarkGatePaths({
    warmupIterations: options.warmupIterations,
    measurementIterations: options.measurementIterations,
  });
  const gateFailures = gateOutcomeFailures(gates);
  const correctness = gateFailures.length === 0
    ? initialCorrectness
    : {
        ...initialCorrectness,
        contractValid: false,
        failures: [...initialCorrectness.failures, ...gateFailures],
      };
  return {
    correctness,
    fixtureHash: hashRuntimeBenchmarkFixtures(options.fixtures),
    selectionReceipt: summarizeSelectionReceipts({
      index: options.index,
      fixtures: options.fixtures,
    }),
    prompts,
    gates,
  };
}

function findWorkerPrompt(
  prompts: PromptMeasurement[],
  preferredFixture?: string
): PromptMeasurement {
  const prompt =
    prompts.find((candidate) => candidate.fixture === preferredFixture) ?? prompts[0];
  if (!prompt) throw new Error("runtime benchmark requires at least one fixture");
  return prompt;
}

function findReadOnlyGate(gates: GatePathMeasurement[]): GatePathMeasurement {
  const gate = gates.find((candidate) => candidate.path === "read-only-fast-path");
  if (!gate) throw new Error("runtime benchmark did not measure read-only-fast-path");
  return gate;
}

export async function captureRuntimeBenchmarkBaseline(
  options: RuntimeBenchmarkOptions
): Promise<RuntimeBenchmarkBaseline> {
  const evidence = await collectRuntimeBenchmarkEvidence(options);
  if (!correctnessAccepted(evidence.correctness)) {
    throw new Error(
      `refusing to capture an incorrect runtime benchmark baseline: ${evidence.correctness.failures.join("; ")}`
    );
  }
  const workerPrompt = findWorkerPrompt(
    evidence.prompts,
    "worst-multi-skill-autonomous"
  );
  const readOnlyGate = findReadOnlyGate(evidence.gates);
  return {
    benchmarkVersion: RUNTIME_BENCHMARK_VERSION,
    contractVersion: RUNTIME_CONTRACT_VERSION,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    ...options.environment,
    fixtureHash: evidence.fixtureHash,
    selectionReceipt: evidence.selectionReceipt,
    performance: {
      workerPrompt: {
        fixture: workerPrompt.fixture,
        bytes: workerPrompt.totals.worker.bytes,
      },
      gateReadOnly: {
        path: "read-only-fast-path",
        p95Ms: readOnlyGate.latency.p95Ms,
      },
    },
  };
}

function baselineContractFailures(
  baseline: RuntimeBenchmarkBaseline,
  evidence: RuntimeBenchmarkEvidence
): string[] {
  const failures: string[] = [];
  if (
    baseline.source?.kind === "commit"
      ? !/^[0-9a-f]{40}$/u.test(baseline.source.commitSha)
      : baseline.source?.kind === "worktree"
        ? !/^[0-9a-f]{40}$/u.test(baseline.source.headCommitSha) ||
          !/^sha256:[0-9a-f]{64}$/u.test(baseline.source.contentHash)
        : true
  ) {
    failures.push("contract: baseline source provenance is missing or invalid");
  }
  if (baseline.benchmarkVersion !== RUNTIME_BENCHMARK_VERSION) {
    failures.push(
      `contract: baseline benchmark version ${baseline.benchmarkVersion} != ${RUNTIME_BENCHMARK_VERSION}`
    );
  }
  if (baseline.contractVersion !== RUNTIME_CONTRACT_VERSION) {
    failures.push(
      `contract: baseline contract version ${baseline.contractVersion} != ${RUNTIME_CONTRACT_VERSION}`
    );
  }
  if (baseline.fixtureHash !== evidence.fixtureHash) {
    failures.push("contract: baseline fixture hash does not match current fixtures");
  }
  if (
    JSON.stringify(baseline.selectionReceipt) !==
    JSON.stringify(evidence.selectionReceipt)
  ) {
    failures.push("contract: baseline selection receipt does not match current selection");
  }
  if (
    !Number.isFinite(baseline.performance.workerPrompt.bytes) ||
    baseline.performance.workerPrompt.bytes <= 0
  ) {
    failures.push("contract: baseline worker prompt bytes must be positive");
  }
  if (
    !Number.isFinite(baseline.performance.gateReadOnly.p95Ms) ||
    baseline.performance.gateReadOnly.p95Ms < 0
  ) {
    failures.push("contract: baseline gate read-only p95 must be non-negative");
  }
  return failures;
}

export async function runRuntimeBenchmark(
  options: RuntimeBenchmarkOptions & { baseline: RuntimeBenchmarkBaseline }
): Promise<RuntimeBenchmarkReport> {
  const evidence = await collectRuntimeBenchmarkEvidence(options);
  const baselineFailures = baselineContractFailures(options.baseline, evidence);
  const correctness: BenchmarkCorrectness = baselineFailures.length === 0
    ? evidence.correctness
    : {
        ...evidence.correctness,
        contractValid: false,
        failures: [...evidence.correctness.failures, ...baselineFailures],
      };
  const correctnessPass = correctnessAccepted(correctness);
  const workerPrompt = findWorkerPrompt(
    evidence.prompts,
    options.baseline.performance.workerPrompt.fixture
  );
  const baselineBytes = options.baseline.performance.workerPrompt.bytes;
  const currentBytes = workerPrompt.totals.worker.bytes;
  const reduction = Number((1 - currentBytes / baselineBytes).toFixed(6));
  const workerAccepted = correctnessPass && reduction >= 0.5;

  const readOnlyGate = findReadOnlyGate(evidence.gates);
  const baselineP95Ms = options.baseline.performance.gateReadOnly.p95Ms;
  const allowedRegressionMs = Number(Math.max(baselineP95Ms * 0.1, 0.05).toFixed(6));
  const maximumP95Ms = Number((baselineP95Ms + allowedRegressionMs).toFixed(6));
  const gateAccepted = correctnessPass && readOnlyGate.latency.p95Ms <= maximumP95Ms;
  const performanceAccepted = workerAccepted && gateAccepted;

  return {
    benchmarkVersion: RUNTIME_BENCHMARK_VERSION,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    correctness,
    performance: {
      accepted: performanceAccepted,
      workerPrompt: {
        fixture: workerPrompt.fixture,
        baselineBytes,
        currentBytes,
        reduction,
        requiredReduction: 0.5,
        accepted: workerAccepted,
      },
      gateReadOnly: {
        path: "read-only-fast-path",
        baselineP95Ms,
        currentP95Ms: readOnlyGate.latency.p95Ms,
        allowedRegressionMs,
        maximumP95Ms,
        accepted: gateAccepted,
      },
      prompts: evidence.prompts,
      gates: evidence.gates,
    },
    metadata: {
      contractVersion: RUNTIME_CONTRACT_VERSION,
      ...options.environment,
      fixtureHash: evidence.fixtureHash,
      selectionReceipt: evidence.selectionReceipt,
      baseline: {
        benchmarkVersion: options.baseline.benchmarkVersion,
        contractVersion: options.baseline.contractVersion,
        generatedAt: options.baseline.generatedAt,
        source: options.baseline.source,
        bunVersion: options.baseline.bunVersion,
        ompVersion: options.baseline.ompVersion,
        fixtureHash: options.baseline.fixtureHash,
      },
    },
    accepted: performanceAccepted,
  };
}

export function exitCodeForBenchmarkReport(report: RuntimeBenchmarkReport): 0 | 1 {
  return report.accepted ? 0 : 1;
}

function semanticReceipt(
  receipt: ReturnType<typeof selectSkillsForTurn>
): Record<string, unknown> {
  return {
    explicit: receipt.explicit.map((candidate) => candidate.name),
    implicitRoot: receipt.implicitRoot.map((candidate) => candidate.name),
    deferred: receipt.deferred.map((candidate) => candidate.name),
    dropped: receipt.dropped.map((candidate) => [candidate.name, candidate.reason]),
    maxImplicitRoots: receipt.maxImplicitRoots,
  };
}

export function evaluateBenchmarkCorrectness(input: {
  index: SkillSelectionIndexEntry[];
  fixtures: RuntimeBenchmarkFixture[];
  expectedSkillCount?: number;
}): BenchmarkCorrectness {
  const failures: string[] = [];
  const seenSkills = new Set<string>();
  for (const entry of input.index) {
    if (seenSkills.has(entry.name)) {
      failures.push(`contract: duplicate skill index entry ${entry.name}`);
    }
    seenSkills.add(entry.name);
    if (!entry.name.startsWith("pov:")) {
      failures.push(`contract: non-canonical skill name ${entry.name}`);
    }
    if (!entry.ownedReadTarget.endsWith("/SKILL.md")) {
      failures.push(`contract: invalid owned read target for ${entry.name}`);
    }
  }
  if (
    input.expectedSkillCount !== undefined &&
    input.index.length !== input.expectedSkillCount
  ) {
    failures.push(
      `contract: expected ${input.expectedSkillCount} skill index entries, found ${input.index.length}`
    );
  }
  const taskContractValid = TaskDispatchSchema.safeParse({
    agent: "pov:executor",
    tasks: [{ id: "benchmark", description: "benchmark", assignment: "benchmark" }],
  }).success;
  if (!taskContractValid) failures.push("contract: canonical benchmark task is invalid");
  let explicitExpected = 0;
  let explicitSelected = 0;
  for (const entry of input.index) {
    const localName = entry.name.startsWith("pov:")
      ? entry.name.slice("pov:".length)
      : entry.name;
    for (const alias of [`pov:${localName}`, `$${localName}`, `/${localName}`]) {
      explicitExpected += 1;
      const receipt = selectSkillsForTurn({
        latestUserText: `benchmark explicit ${alias}`,
        index: input.index,
        maxImplicitRoots: 0,
      });
      if (
        receipt.explicit.length === 1 &&
        receipt.explicit[0]?.name === entry.name
      ) {
        explicitSelected += 1;
      } else {
        failures.push(`explicit: ${alias} did not select exactly ${entry.name}`);
      }
    }
  }
  let requiredExpected = 0;
  let requiredSelected = 0;
  let forbiddenExpected = 0;
  let forbiddenExcluded = 0;
  let deterministic = true;

  for (const fixture of input.fixtures) {
    const receipt = selectSkillsForTurn({
      latestUserText: fixture.text,
      index: input.index,
      maxImplicitRoots: DEFAULT_MAX_IMPLICIT_ROOTS,
    });
    const reversedReceipt = selectSkillsForTurn({
      latestUserText: fixture.text,
      index: [...input.index].reverse(),
      maxImplicitRoots: DEFAULT_MAX_IMPLICIT_ROOTS,
    });
    if (
      JSON.stringify(semanticReceipt(receipt)) !==
      JSON.stringify(semanticReceipt(reversedReceipt))
    ) {
      deterministic = false;
      failures.push(`${fixture.name}: selection receipt changed after index reversal`);
    }
    const candidateNames = new Set([
      ...matchSkillsForText(fixture.text, input.index).map((candidate) => candidate.name),
      ...input.index
        .filter((candidate) => hasExplicitSkillAlias(fixture.text, candidate.name))
        .map((candidate) => candidate.name),
    ]);
    const bucketCounts = new Map<string, number>();
    for (const candidate of [
      ...receipt.explicit,
      ...receipt.implicitRoot,
      ...receipt.deferred,
      ...receipt.dropped,
    ]) {
      bucketCounts.set(candidate.name, (bucketCounts.get(candidate.name) ?? 0) + 1);
      if (!candidateNames.has(candidate.name)) {
        failures.push(
          `contract: ${fixture.name} receipt contains non-candidate ${candidate.name}`
        );
      }
    }
    for (const candidateName of candidateNames) {
      const count = bucketCounts.get(candidateName) ?? 0;
      if (count !== 1) {
        failures.push(
          `contract: ${fixture.name} candidate ${candidateName} appears in ${count} receipt buckets`
        );
      }
    }
    const selected = new Set(
      [...receipt.explicit, ...receipt.implicitRoot, ...receipt.deferred].map(
        (candidate) => candidate.name
      )
    );
    for (const required of fixture.requiredSkills) {
      requiredExpected += 1;
      if (selected.has(required)) {
        requiredSelected += 1;
      } else {
        failures.push(`${fixture.name}: missing required skill ${required}`);
      }
    }
    for (const forbidden of fixture.forbiddenSkills) {
      forbiddenExpected += 1;
      if (!selected.has(forbidden)) {
        forbiddenExcluded += 1;
      } else {
        failures.push(`${fixture.name}: selected forbidden skill ${forbidden}`);
      }
    }
  }

  return {
    contractValid: !failures.some((failure) => failure.startsWith("contract:")),
    explicitRecall: explicitExpected === 0 ? 1 : explicitSelected / explicitExpected,
    requiredRecall: requiredExpected === 0 ? 1 : requiredSelected / requiredExpected,
    forbiddenPrecision:
      forbiddenExpected === 0 ? 1 : forbiddenExcluded / forbiddenExpected,
    deterministic,
    failures,
  };
}
