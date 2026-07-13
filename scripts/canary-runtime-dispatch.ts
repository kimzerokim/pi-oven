import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import {
  EXPECTED_ROLE_COUNT,
  ROLE_NAMES,
  TaskDispatchSchema,
  canonicalAgentName,
  type TaskDispatch,
} from "../.omp/extensions/pi-oven-runtime/runtime-contract";
import { main as runEvalMain, parseExactModelPattern } from "./run-eval";
import type { Verdict } from "./lib/scenario-schema";

export const CANONICAL_CANARY_SCENARIOS = [
  { skill: "harness/runtime-canary", scenario: "executor", agent: "pov:executor" },
  { skill: "harness/runtime-canary", scenario: "explorer", agent: "pov:explorer" },
  { skill: "harness/runtime-canary", scenario: "verifier", agent: "pov:verifier" },
  { skill: "harness/runtime-canary", scenario: "critic", agent: "pov:critic" },
  { skill: "harness/runtime-canary", scenario: "planner", agent: "pov:planner" },
  { skill: "harness/runtime-canary", scenario: "code-reviewer", agent: "pov:code-reviewer" },
] as const;

export interface CanaryArgs {
  outFile: string;
  model?: string;
  strict: boolean;
  requireScenarios: boolean;
  notRunReason?: string;
}

export interface CanaryReceipt {
  schemaVersion: 1;
  tier: "trusted-provider-canary";
  status: "PASS" | "FAIL" | "NOT_RUN";
  reason?: string;
  exactModel: string | null;
  strict: boolean;
  requireScenarios: boolean;
  requiredScenarios: number;
  completedScenarios: number;
  tokenIn: number;
  tokenOut: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
  scenarios: Array<{
    skill: string;
    scenario: string;
    agent: string;
    status: "PASS" | "FAIL" | "NOT_RUN";
    exitCode?: number;
    verdict?: Verdict;
    error?: string;
  }>;
}

export function parseCanaryArgs(argv: string[]): CanaryArgs {
  const args: CanaryArgs = {
    outFile: "artifacts/trusted-canary-receipt.json",
    strict: false,
    requireScenarios: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--out") args.outFile = argv[++index] ?? "";
    else if (argument === "--model") args.model = argv[++index];
    else if (argument === "--strict") args.strict = true;
    else if (argument === "--require-scenarios") args.requireScenarios = true;
    else if (argument === "--not-run-reason") args.notRunReason = argv[++index];
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!args.outFile) throw new Error("--out requires a path");
  return args;
}

export interface CanaryDependencies {
  runEval?: (argv: string[]) => Promise<number>;
}

function sum(receipts: Verdict[], field: "token_in" | "token_out" | "cache_read" | "cache_write" | "cost"): number {
  return Number(receipts.reduce((total, verdict) => total + verdict[field], 0).toFixed(12));
}

export async function runCanary(
  args: CanaryArgs,
  dependencies: CanaryDependencies = {},
): Promise<{ exitCode: number; receipt: CanaryReceipt }> {
  await mkdir(dirname(resolve(args.outFile)), { recursive: true });
  if (args.notRunReason) {
    const receipt: CanaryReceipt = {
      schemaVersion: 1,
      tier: "trusted-provider-canary",
      status: "NOT_RUN",
      reason: args.notRunReason,
      exactModel: null,
      strict: args.strict,
      requireScenarios: args.requireScenarios,
      requiredScenarios: CANONICAL_CANARY_SCENARIOS.length,
      completedScenarios: 0,
      tokenIn: 0,
      tokenOut: 0,
      cacheRead: 0,
      cacheWrite: 0,
      cost: 0,
      scenarios: CANONICAL_CANARY_SCENARIOS.map((entry) => ({ ...entry, status: "NOT_RUN" })),
    };
    await writeFile(args.outFile, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
    return { exitCode: 0, receipt };
  }

  if (!args.strict || !args.requireScenarios) {
    throw new Error("live canary requires --strict --require-scenarios");
  }
  if (!parseExactModelPattern(args.model)) {
    throw new Error("live canary requires an exact provider/model via --model");
  }

  const runEval = dependencies.runEval ?? ((argv: string[]) => runEvalMain(argv));
  const partsDir = await mkdtemp(join(tmpdir(), "pi-oven-canary-parts-"));
  const scenarios: CanaryReceipt["scenarios"] = [];
  const verdicts: Verdict[] = [];
  try {
    for (const [index, entry] of CANONICAL_CANARY_SCENARIOS.entries()) {
      const part = join(partsDir, `${index}.jsonl`);
      try {
        const exitCode = await runEval([
          "--skill", entry.skill,
          "--scenario", entry.scenario,
          "--model", args.model!,
          "--strict",
          "--require-scenarios",
          "--out", part,
        ]);
        const parsed = (await readFile(part, "utf8"))
          .split("\n")
          .filter(Boolean)
          .map((line) => JSON.parse(line) as Verdict);
        const verdict = parsed.length === 1 ? parsed[0] : undefined;
        if (verdict) verdicts.push(verdict);
        const passed = exitCode === 0 && verdict?.passed === true;
        scenarios.push({ ...entry, status: passed ? "PASS" : "FAIL", exitCode, verdict });
      } catch (error) {
        scenarios.push({
          ...entry,
          status: "FAIL",
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  } finally {
    await rm(partsDir, { recursive: true, force: true });
  }

  const completedScenarios = scenarios.filter((scenario) => scenario.status === "PASS").length;
  const status = completedScenarios === CANONICAL_CANARY_SCENARIOS.length ? "PASS" : "FAIL";
  const receipt: CanaryReceipt = {
    schemaVersion: 1,
    tier: "trusted-provider-canary",
    status,
    exactModel: args.model!,
    strict: true,
    requireScenarios: true,
    requiredScenarios: CANONICAL_CANARY_SCENARIOS.length,
    completedScenarios,
    tokenIn: sum(verdicts, "token_in"),
    tokenOut: sum(verdicts, "token_out"),
    cacheRead: sum(verdicts, "cache_read"),
    cacheWrite: sum(verdicts, "cache_write"),
    cost: sum(verdicts, "cost"),
    scenarios,
  };
  await writeFile(args.outFile, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  return { exitCode: status === "PASS" ? 0 : 1, receipt };
}

export const STATIC_CANARY_PAYLOAD = {
  agent: "pov:explorer",
  context: "Inspect the repository without mutating it.",
  tasks: [
    {
      id: "inspect",
      description: "Inspect repository identity",
      assignment: "Read package.json and report the package name only.",
    },
  ],
} as const satisfies TaskDispatch;

export interface StaticTaskDispatchCanaryResult {
  staticStatus: "PASS";
  agentNames: string[];
  runtimeContractAccepted: true;
  ompSchemaExported: boolean;
  ompSchemaAccepted: boolean;
}

export type LiveTaskDispatchCanaryResult =
  | {
      status: "NOT RUN";
      reason: string;
    }
  | {
      status: "PASS";
      agent: string;
      taskId: string;
      lifecycle: ["started", "completed"];
    };

function parseAgentName(source: string, file: string): string {
  const match = /^---\s*\n([\s\S]*?)\n---(?:\s*\n|$)/.exec(source);
  if (!match) throw new Error(`${file} has no YAML frontmatter`);
  const name = /^name:\s*(\S+)\s*$/m.exec(match[1] ?? "")?.[1];
  if (!name) throw new Error(`${file} has no frontmatter name`);
  return name;
}

export async function inspectStaticTaskDispatchCanary(
  root = resolve(import.meta.dir, ".."),
  options: { crossCheckOmpSchema?: boolean } = {},
): Promise<StaticTaskDispatchCanaryResult> {
  const agentsDir = join(root, "agents");
  const files = (await readdir(agentsDir)).filter((file) => file.endsWith(".md")).sort();
  const discovered = new Map<string, string>();

  for (const file of files) {
    const name = parseAgentName(await readFile(join(agentsDir, file), "utf8"), file);
    if (discovered.has(name)) throw new Error(`duplicate agent name ${name}`);
    discovered.set(name, file);
  }

  const expectedNames = ROLE_NAMES.map(canonicalAgentName);
  const expectedFiles = new Set(ROLE_NAMES.map((role) => `pov-${role}.md`));
  const unknownFiles = files.filter((file) => !expectedFiles.has(file));
  const missingNames = expectedNames.filter((name) => !discovered.has(name));
  const unknownNames = [...discovered.keys()].filter((name) => !expectedNames.includes(name as never));

  if (
    files.length !== EXPECTED_ROLE_COUNT ||
    discovered.size !== EXPECTED_ROLE_COUNT ||
    unknownFiles.length > 0 ||
    missingNames.length > 0 ||
    unknownNames.length > 0
  ) {
    throw new Error(
      `agent roster mismatch: files=${files.length}; unknownFiles=${unknownFiles.join(",") || "none"}; ` +
        `missingNames=${missingNames.join(",") || "none"}; unknownNames=${unknownNames.join(",") || "none"}`,
    );
  }

  const runtimeResult = TaskDispatchSchema.safeParse(STATIC_CANARY_PAYLOAD);
  if (!runtimeResult.success) throw new Error(`RuntimeContract rejected task canary: ${runtimeResult.error.message}`);

  let ompSchemaExported = false;
  let ompSchemaAccepted = false;
  if (options.crossCheckOmpSchema) {
    try {
      const ompTask = await import("@oh-my-pi/pi-coding-agent/task/types");
      if (ompTask.taskSchema && typeof ompTask.taskSchema.safeParse === "function") {
        ompSchemaExported = true;
        ompSchemaAccepted = ompTask.taskSchema.safeParse(STATIC_CANARY_PAYLOAD).success;
      }
    } catch {
      // Older OMP builds may not export the schema. RuntimeContract remains the local gate.
    }
  }

  if (ompSchemaExported && !ompSchemaAccepted) {
    throw new Error("Exported OMP task schema rejected the RuntimeContract canary subset");
  }

  return {
    staticStatus: "PASS",
    agentNames: expectedNames,
    runtimeContractAccepted: true,
    ompSchemaExported,
    ompSchemaAccepted,
  };
}

interface LifecycleEvent {
  id: string;
  agent: string;
  status: "started" | "completed" | "failed" | "aborted";
}

function isLifecycleEvent(value: unknown): value is LifecycleEvent {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const event = value as Partial<LifecycleEvent>;
  return (
    typeof event.id === "string" &&
    typeof event.agent === "string" &&
    ["started", "completed", "failed", "aborted"].includes(event.status ?? "")
  );
}

export async function runLiveTaskDispatchCanary(
  root = resolve(import.meta.dir, ".."),
): Promise<Extract<LiveTaskDispatchCanaryResult, { status: "PASS" }>> {
  const {
    createAgentSession,
    SessionManager,
    TASK_SUBAGENT_LIFECYCLE_CHANNEL,
  } = await import("@oh-my-pi/pi-coding-agent");
  const { session, eventBus } = await createAgentSession({
    cwd: root,
    sessionManager: SessionManager.inMemory(),
    toolNames: ["task"],
    enableMCP: false,
    enableLsp: false,
    autoApprove: true,
  });
  const lifecycle: LifecycleEvent[] = [];
  const unsubscribe = eventBus.on(TASK_SUBAGENT_LIFECYCLE_CHANNEL, (event) => {
    if (isLifecycleEvent(event) && event.agent === STATIC_CANARY_PAYLOAD.agent) lifecycle.push(event);
  });
  const timeoutMs = Number.parseInt(Bun.env.PI_OVEN_LIVE_TASK_CANARY_TIMEOUT_MS ?? "120000", 10);
  const timer = setTimeout(() => void session.abort(), Number.isFinite(timeoutMs) ? timeoutMs : 120000);

  try {
    await session.prompt(
      [
        "This is an opt-in runtime dispatch canary.",
        "Call the task tool exactly once using this exact payload and wait for completion:",
        JSON.stringify(STATIC_CANARY_PAYLOAD),
        "Do not use any other tool. After the task completes, answer CANARY COMPLETE.",
      ].join("\n"),
    );
  } finally {
    clearTimeout(timer);
    unsubscribe();
    await session.dispose();
  }

  const started = lifecycle.find((event) => event.status === "started");
  const completed = lifecycle.find(
    (event) => event.status === "completed" && started !== undefined && event.id === started.id,
  );
  if (!started || !completed) {
    throw new Error(`live task lifecycle incomplete: ${JSON.stringify(lifecycle)}`);
  }

  return {
    status: "PASS",
    agent: completed.agent,
    taskId: completed.id,
    lifecycle: ["started", "completed"],
  };
}

export function renderTaskDispatchCanaryArtifact(
  staticResult: StaticTaskDispatchCanaryResult,
  liveResult: LiveTaskDispatchCanaryResult,
): string {
  return `${JSON.stringify(
    {
      taskDispatchCanary: {
        static: staticResult.staticStatus,
        live: liveResult.status,
        exactAgentCount: staticResult.agentNames.length,
        runtimeContractAccepted: staticResult.runtimeContractAccepted,
        ompSchema: staticResult.ompSchemaExported
          ? staticResult.ompSchemaAccepted
            ? "PASS"
            : "FAIL"
          : "NOT EXPORTED",
        liveEvidence: liveResult,
      },
    },
    null,
    2,
  )}\n`;
}

if (import.meta.main) {
  const argv = Bun.argv.slice(2);
  if (argv.length > 0) {
    try {
      const result = await runCanary(parseCanaryArgs(argv));
      process.stdout.write(`${result.receipt.status}\n`);
      process.exitCode = result.exitCode;
    } catch (error) {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 2;
    }
  } else {
    const liveEnabled = Bun.env.PI_OVEN_LIVE_TASK_CANARY === "1";
    const staticResult = await inspectStaticTaskDispatchCanary(undefined, {
      crossCheckOmpSchema: liveEnabled,
    });
    const liveResult: LiveTaskDispatchCanaryResult = liveEnabled
      ? await runLiveTaskDispatchCanary()
      : { status: "NOT RUN", reason: "PI_OVEN_LIVE_TASK_CANARY is not enabled" };
    process.stdout.write(renderTaskDispatchCanaryArtifact(staticResult, liveResult));
  }
}
