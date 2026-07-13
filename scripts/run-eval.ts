#!/usr/bin/env bun
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { parseScenario, runScenario, type SessionLike } from "./lib/eval-runner";
import {
  OmpEvalEventAdapter,
  type EvidenceEvent,
  type ModelReceipt,
} from "./lib/omp-eval-event-adapter";
import type { Verdict } from "./lib/scenario-schema";
import { loadSkillKeywordIndex } from "../.omp/extensions/pi-oven-runtime/skill-keyword-loader";

export interface Args {
  skill?: string;
  scenario?: string;
  tag?: string;
  outFile?: string;
  model?: string;
  strict: boolean;
  requireScenarios: boolean;
}

export function parseArgs(argv: string[]): Args {
  const args: Args = { strict: false, requireScenarios: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--skill") args.skill = argv[++index];
    else if (argument === "--scenario") args.scenario = argv[++index];
    else if (argument === "--tag") args.tag = argv[++index];
    else if (argument === "--out") args.outFile = argv[++index];
    else if (argument === "--model") args.model = argv[++index];
    else if (argument === "--strict") args.strict = true;
    else if (argument === "--require-scenarios") args.requireScenarios = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  return args;
}

async function collectScenarioFiles(directory: string, output: string[]): Promise<void> {
  let entries: Array<{ name: string; isDirectory(): boolean }>;
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return;
    throw error;
  }
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await collectScenarioFiles(absolute, output);
    } else if (
      path.basename(path.dirname(absolute)) === "scenarios" &&
      (entry.name.endsWith(".yaml") || entry.name.endsWith(".yml"))
    ) {
      output.push(absolute);
    }
  }
}

export async function listScenarios(rootDir: string, args: Args): Promise<string[]> {
  const evalsDir = path.join(rootDir, "evals");
  const searchRoot = args.skill ? path.join(evalsDir, args.skill) : evalsDir;
  const files: string[] = [];
  await collectScenarioFiles(searchRoot, files);
  const filtered: string[] = [];
  for (const file of files.sort()) {
    if (args.scenario && !path.basename(file).includes(args.scenario)) continue;
    if (args.tag) {
      const parsed = parseScenario(await fs.readFile(file, "utf8"));
      if (parsed.tag !== args.tag) continue;
    }
    filtered.push(file);
  }
  return filtered;
}

const FAST_EVAL_MODEL_PRIORITY = [
  "haiku-4-5",
  "gemini-3-flash",
  "gemini-3.5-flash",
  "gpt-5.4-mini",
  "haiku-4",
  "flash",
  "mini",
  "nano",
  "small",
  "lite",
] as const;

/** Non-release convenience selection. Strict trusted runs must supply an exact pin. */
export function pickEvalModelPattern(
  explicit: string | undefined,
  envValue: string | undefined,
  available: ReadonlyArray<{ provider: string; id: string }> | undefined,
): string | undefined {
  if (explicit) return explicit;
  if (envValue) return envValue;
  if (!available?.length) return undefined;
  for (const needle of FAST_EVAL_MODEL_PRIORITY) {
    const hit = available.find((model) => model.id.toLocaleLowerCase("en-US").includes(needle));
    if (hit) return `${hit.provider}/${hit.id}`;
  }
  return `${available[0].provider}/${available[0].id}`;
}

export function parseExactModelPattern(pattern: string | undefined): ModelReceipt | undefined {
  if (!pattern) return undefined;
  const separator = pattern.indexOf("/");
  if (separator <= 0 || separator === pattern.length - 1) return undefined;
  const provider = pattern.slice(0, separator);
  const model = pattern.slice(separator + 1);
  if (/[*?]/.test(pattern)) return undefined;
  return { provider, model };
}

function hasExactModelReceipt(verdict: Verdict, expected: ModelReceipt): boolean {
  return verdict.model_receipts.some(
    (receipt) => receipt.provider === expected.provider && receipt.model === expected.model,
  );
}

export function computeEvalExitCode(
  verdicts: Verdict[],
  options: Pick<Args, "strict" | "requireScenarios">,
): number {
  if (verdicts.length === 0) return options.requireScenarios ? 1 : 0;
  const nonAssertionFailure = /^(?:turn_timeout|scenario_timeout|infrastructure_error):/;
  const hardAssertionFailed = verdicts.some((verdict) =>
    verdict.failures.some((failure) => !nonAssertionFailure.test(failure)),
  );
  if (hardAssertionFailed) return 1;
  if (
    options.strict &&
    verdicts.some(
      (verdict) => verdict.inconclusive || verdict.timed_out || verdict.infrastructure_error,
    )
  ) {
    return 1;
  }
  return 0;
}

/**
 * Create a real SDK session. The SDK is deliberately dynamically imported so
 * importing this module performs no auth discovery, logger setup, or DB I/O.
 */
async function makeSession(modelPattern?: string): Promise<SessionLike> {
  const {
    createAgentSession,
    ModelRegistry,
    SessionManager,
    discoverAuthStorage,
    discoverSkills,
  } = await import("@oh-my-pi/pi-coding-agent");
  const cwd = process.cwd();
  const auth = await discoverAuthStorage();
  const models = new ModelRegistry(auth);
  await models.refresh();
  const { skills } = await discoverSkills(cwd);
  const available = typeof models.getAvailable === "function" ? models.getAvailable() : undefined;
  const resolvedPattern = pickEvalModelPattern(
    modelPattern,
    process.env.PI_OVEN_EVAL_MODEL,
    available,
  );
  if (!modelPattern && resolvedPattern) {
    console.error(`eval: auto-selected model pattern ${resolvedPattern}`);
  }

  const extensionPath = path.resolve(cwd, ".omp/extensions/pi-oven.ts");
  const extensionExists = await fs.access(extensionPath).then(() => true).catch(() => false);
  const { session } = await createAgentSession({
    sessionManager: SessionManager.inMemory(),
    authStorage: auth,
    modelRegistry: models,
    autoApprove: true,
    hasUI: false,
    skills,
    ...(extensionExists ? { additionalExtensionPaths: [extensionPath] } : {}),
    ...(resolvedPattern ? { modelPattern: resolvedPattern } : {}),
  });
  const adapter = new OmpEvalEventAdapter({
    skillReadTargets: loadSkillKeywordIndex(cwd).map((entry) => ({
      skill: entry.name,
      ownedReadTarget: entry.ownedReadTarget,
    })),
  });

  return {
    subscribe(listener: (event: EvidenceEvent) => void): () => void {
      return session.subscribe((sdkEvent) => {
        for (const event of adapter.adapt(sdkEvent)) {
          listener(event);
        }
      });
    },
    async prompt(message: string, options?: { signal?: AbortSignal }): Promise<void> {
      const signal = options?.signal;
      const abort = () => {
        void session.abort();
      };
      signal?.addEventListener("abort", abort, { once: true });
      try {
        await session.prompt(message);
      } finally {
        signal?.removeEventListener("abort", abort);
      }
    },
  };
}

export const makeSessionForTest = makeSession;

export interface MainDependencies {
  rootDir?: string;
  makeSession?: (model?: string) => Promise<SessionLike>;
  log?: (message: string) => void;
}

export async function main(
  argv = Bun.argv.slice(2),
  dependencies: MainDependencies = {},
): Promise<number> {
  const args = parseArgs(argv);
  const rootDir = dependencies.rootDir ?? process.cwd();
  const log = dependencies.log ?? console.log;
  const files = await listScenarios(rootDir, args);
  if (files.length === 0) return args.requireScenarios ? 1 : 0;

  const pinnedPattern = args.model ?? process.env.PI_OVEN_EVAL_MODEL;
  const exactModel = parseExactModelPattern(pinnedPattern);
  if (args.strict && !exactModel) {
    throw new Error("--strict requires an exact provider/model via --model or PI_OVEN_EVAL_MODEL");
  }

  const createSession = dependencies.makeSession ?? makeSession;
  const verdicts: Verdict[] = [];
  for (const file of files) {
    const scenario = parseScenario(await fs.readFile(file, "utf8"));
    const session = await createSession(args.model);
    const verdict = await runScenario(scenario, session);
    if (exactModel && !hasExactModelReceipt(verdict, exactModel)) {
      verdict.failures.push(
        `model_receipt: expected exact ${exactModel.provider}/${exactModel.model}, observed ${JSON.stringify(verdict.model_receipts)}`,
      );
      verdict.passed = false;
    }
    verdicts.push(verdict);
    const mark = verdict.inconclusive ? "⊘" : verdict.passed ? "✓" : "✗";
    log(`${mark} ${verdict.skill}/${verdict.scenario} (${verdict.latency_ms}ms)`);
    for (const failure of verdict.failures) log(`  fail: ${failure}`);
    for (const observation of verdict.observations) log(`  · ${observation}`);
  }

  if (args.outFile) {
    await fs.writeFile(
      args.outFile,
      `${verdicts.map((verdict) => JSON.stringify(verdict)).join("\n")}\n`,
    );
  }
  const passCount = verdicts.filter((verdict) => verdict.passed).length;
  const inconclusiveCount = verdicts.filter((verdict) => verdict.inconclusive).length;
  const failCount = verdicts.length - passCount - inconclusiveCount;
  log(`\n${passCount} pass, ${failCount} fail, ${inconclusiveCount} inconclusive`);
  return computeEvalExitCode(verdicts, args);
}

if (import.meta.main) {
  try {
    process.exitCode = await main();
  } catch (error) {
    console.error(error);
    process.exitCode = 2;
  }
}
