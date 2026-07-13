#!/usr/bin/env bun

import { createHash } from "node:crypto";
import {
  copyFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";

import { inspectAgentRegistry } from "../.omp/extensions/pi-oven";
import { reconcileEffect } from "../.omp/extensions/pi-oven-runtime/effect-reconciler";
import { GateStateLedgerAdapter } from "../.omp/extensions/pi-oven-runtime/gate-state-ledger-adapter";
import { GateStateStore, type FsmState } from "../.omp/extensions/pi-oven-runtime/gate-state";
import { RulesInjector, resolveRuntimePromptMode } from "../.omp/extensions/pi-oven-runtime/rules-injector";
import { ROLE_NAMES, TaskDispatchSchema } from "../.omp/extensions/pi-oven-runtime/runtime-contract";
import { selectSkillsForTurn, type SkillSelectionIndexEntry } from "../.omp/extensions/pi-oven-runtime/skill-selection";
import { SqliteRunLedger } from "../.omp/extensions/pi-oven-runtime/sqlite-run-ledger";
import { runCanary } from "./canary-runtime-dispatch";
import { atomicReplaceFile } from "./lib/atomic-file";
import { resolveHomePaths } from "./lib/home-paths";
import type { Verdict } from "./lib/scenario-schema";
import { inspectAuthoredSurfaces } from "./pi-oven-contract/check";
import { verifyInstalledManifest } from "./pi-oven-release/fresh-install-smoke";
import { buildReleaseArtifacts, validateReleaseTagContract } from "./pi-oven-release/release-contract";
import { runStatus } from "./pi-oven-setup/status";
import { buildSetupReceiptConfig } from "./pi-oven-setup/project-config";
import { buildProjectSetupSettings, serializeProjectSettings } from "./pi-oven-setup/project-settings";
import {
  ABSENT,
  applySetupTransaction,
  inspectSetupTransaction,
  isAbsentSnapshot,
  recoverSetupTransactions,
  setupTransactionPaths,
  type SetupTransactionResourceAdapter,
  type SetupTransactionSnapshot,
} from "./pi-oven-setup/setup-transaction";

export const REHEARSAL_CASE_IDS = [
  "fresh-isolated-home",
  "legacy-routing",
  "project-over-global",
  "setup-validation-rollback",
  "setup-journal-recovery",
  "explicit-autonomous-after-nine-implicit",
  "task-dispatch-contract",
  "effect-receipt-crash",
  "provider-canary",
  "candidate-artifact-doctor",
] as const;

export type RehearsalCaseId = (typeof REHEARSAL_CASE_IDS)[number];
export type RehearsalCaseStatus = "PASS" | "FAIL";

export interface RehearsalCaseResult {
  id: RehearsalCaseId;
  status: RehearsalCaseStatus;
  durationMs: number;
  evidence: Record<string, unknown>;
  error?: string;
}

export interface RollbackProof {
  name: "compatibility-reader" | "setup-journal" | "ledger-json-fallback" | "prompt-legacy-flag" | "immutable-release-version";
  status: RehearsalCaseStatus;
  evidence: string;
}

export interface ReleaseRehearsalReceipt {
  schemaVersion: 1;
  status: RehearsalCaseStatus;
  generatedAt: string;
  root: string;
  cases: RehearsalCaseResult[];
  rollbackProof: RollbackProof[];
  contractCounts: {
    staleLegacyAgentReferences: number;
    staleSlashCommands: number;
    invalidTaskExamples: number;
    providerTierAliases: number;
  };
  bundle: { bytes: number; historicalNominalBytes: number; deltaBytes: number };
  checksums: { archive: string; bundle: string };
}

export interface ReleaseRehearsalOptions {
  root?: string;
  scratchRoot?: string;
  candidateInstaller?: (input: {
    packageRoot: string;
    env: Record<string, string | undefined>;
  }) => { exitCode: number; stdout: string; stderr: string; evidence: string };
}

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function runCase(
  id: RehearsalCaseId,
  work: () => Promise<Record<string, unknown>> | Record<string, unknown>,
): Promise<RehearsalCaseResult> {
  const started = performance.now();
  try {
    const evidence = await work();
    return {
      id,
      status: "PASS",
      durationMs: Math.round((performance.now() - started) * 100) / 100,
      evidence,
    };
  } catch (error) {
    return {
      id,
      status: "FAIL",
      durationMs: Math.round((performance.now() - started) * 100) / 100,
      evidence: {},
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function memoryAdapter(values: Map<string, SetupTransactionSnapshot>): SetupTransactionResourceAdapter {
  return {
    read: async (resource) => structuredClone(values.get(resource) ?? ABSENT),
    write: async (resource, value) => {
      if (isAbsentSnapshot(value)) values.delete(resource);
      else values.set(resource, structuredClone(value));
    },
  };
}

function configSpawn(overrides: Record<string, string>) {
  return (command: string, args: string[]) => {
    if (command === "omp" && args[0] === "config" && args[1] === "get") {
      const key = args[2] ?? "";
      const value = key === "task.agentModelOverrides"
        ? overrides
        : key === "skills.includeSkills"
          ? ["pov:*"]
          : key === "skills.ignoredSkills" || key === "disabledProviders"
            ? []
            : key === "task.enableLsp" || key === "inspect_image.enabled" || key === "web_search.enabled" || key === "async.enabled"
              ? true
              : key === "task.maxConcurrency"
                ? 12
                : undefined;
      if (value !== undefined) {
        return {
          exitCode: 0,
          stdout: Buffer.from(JSON.stringify({
            key,
            value,
            type: Array.isArray(value) ? "array" : typeof value === "object" ? "record" : typeof value,
          })),
          stderr: Buffer.from(""),
        };
      }
    }
    if (command === "omp" && args.includes("list-models")) {
      return { exitCode: 0, stdout: Buffer.from("[]"), stderr: Buffer.from("") };
    }
    return { exitCode: 1, stdout: Buffer.from(""), stderr: Buffer.from("not configured") };
  };
}

function makeSkillIndex(): SkillSelectionIndexEntry[] {
  const roots = [
    "deep-dive",
    "systematic-debugging",
    "spec-and-review",
    "writing-plans",
    "brainstorming",
    "improve-codebase-architecture",
    "receiving-code-review",
    "html-research-orchestrator",
    "memory-discipline",
    "autonomous-loop",
  ];
  return roots.map((name, index) => ({
    name: `pov:${name}`,
    description: name,
    phrases: [`phrase-${index}`],
    ownedReadTarget: `/skills/${name}/SKILL.md`,
    pluginRoot: "/plugin",
    manifestOrder: index,
  }));
}

async function proveLedgerJsonFallback(stateRoot: string): Promise<void> {
  const initial: FsmState = {
    active: true,
    gateCache: {},
    version: 1,
    schemaVersion: 1,
    requiredSkills: [],
    skillReads: [],
  };
  await new GateStateStore(stateRoot).writeState(initial);
  const ledger = new SqliteRunLedger(join(stateRoot, "state", "fallback.sqlite"));
  const adapter = new GateStateLedgerAdapter(stateRoot, ledger, {
    runId: "rehearsal-fallback",
    ownerId: "rehearsal",
    repoRoot: stateRoot,
    branch: "rehearsal",
    readSource: "ledger",
    writeTarget: "json",
    jsonFallbackRead: true,
  });
  invariant((await adapter.readState()).kind === "OK", "ledger-primary JSON fallback was not readable");
  await adapter.mutate((state) => ({ ...state, version: 2 }));
  invariant(ledger.readGateState("rehearsal-fallback") === undefined, "JSON rollback wrote ledger state");
  invariant((await new GateStateStore(stateRoot).readState()).kind === "OK", "JSON rollback state vanished");
  await adapter.close();
}

function provePromptRollback(): void {
  invariant(resolveRuntimePromptMode("compositor") === "compositor", "compositor flag rejected");
  invariant(resolveRuntimePromptMode("legacy") === "legacy", "legacy flag rejected");
  const injector = new RulesInjector();
  injector.setProjectInstructions("rehearsal legacy project contract");
  const fragment = {
    id: "rehearsal-safety",
    audience: "both" as const,
    phase: "always" as const,
    priority: 999,
    required: true,
    dedupKey: "pi-oven:rehearsal-safety",
    render: () => "pi-oven:rehearsal-safety required",
  };
  const compositor = injector.composeSystemPrompt({
    systemPrompt: [],
    audience: "worker",
    includeDiscipline: false,
    additionalFragments: [fragment],
    mode: "compositor",
  });
  invariant(
    compositor.systemPrompt.some((line) => line.includes(fragment.dedupKey)),
    "compositor dropped required worker safety"
  );
  invariant(
    !compositor.systemPrompt.some((line) => line.includes("rehearsal legacy project contract")),
    "compositor leaked project instructions to worker"
  );

  const legacy = injector.composeSystemPrompt({
    systemPrompt: [],
    audience: "worker",
    includeDiscipline: false,
    additionalFragments: [fragment],
    mode: "legacy",
  });
  invariant(
    legacy.systemPrompt.some((line) => line.includes("pi-oven:discipline-rules@v1")),
    "legacy worker omitted full runtime discipline"
  );
  invariant(
    legacy.systemPrompt.some((line) => line.includes("rehearsal legacy project contract")),
    "legacy worker omitted full project instructions"
  );
  invariant(
    !legacy.systemPrompt.some((line) => line.includes(fragment.dedupKey)),
    "legacy worker unexpectedly used the compositor capsule"
  );
}

function prepareCandidateDoctorEnvironment(packageRoot: string, home: string): {
  binDir: string;
  canaryReceipt: string;
} {
  const overrides = Object.fromEntries(
    ROLE_NAMES.map((role) => [`pov:${role}`, "openai-codex/gpt-5.5"]),
  );
  const settings = buildProjectSetupSettings({}, {
    overrides,
    modelRoles: { default: "openai-codex/gpt-5.5", title: "openai-codex/gpt-5.4" },
    fallbackChains: { default: ["openai-codex/gpt-5.4"] },
  });
  mkdirSync(join(packageRoot, ".omp"), { recursive: true });
  writeFileSync(join(packageRoot, ".omp", "settings.json"), serializeProjectSettings(settings));
  mkdirSync(join(packageRoot, ".pi-oven"), { recursive: true });
  writeFileSync(
    join(packageRoot, ".pi-oven", "config.json"),
    `${JSON.stringify(buildSetupReceiptConfig({ language: "en" }, "2026-07-13T00:00:00.000Z"), null, 2)}\n`,
  );
  mkdirSync(join(packageRoot, ".pi"), { recursive: true });
  writeFileSync(
    join(packageRoot, ".pi", "mcp.json"),
    `${JSON.stringify({ mcpServers: { rehearsal: { command: "true" } } }, null, 2)}\n`,
  );
  writeFileSync(packageRoot + "/.external-credentials", "[aws]\nrehearsal=true\n[bitbucket]\nrehearsal=true\n[cloudflare]\nrehearsal=true\n");

  const ledger = new SqliteRunLedger(join(packageRoot, ".pi-oven", "state", "run-ledger.sqlite"));
  ledger.close();

  const canaryReceipt = join(packageRoot, "artifacts", "trusted-canary-receipt.json");
  mkdirSync(dirname(canaryReceipt), { recursive: true });
  writeFileSync(canaryReceipt, `${JSON.stringify({ status: "NOT_RUN", reason: "credentials-unavailable" }, null, 2)}\n`);

  const binDir = join(home, "bin");
  mkdirSync(binDir, { recursive: true });
  const globalValues: Record<string, unknown> = {
    "task.agentModelOverrides": overrides,
    "skills.includeSkills": ["pov:*"],
    "skills.ignoredSkills": [],
    disabledProviders: [],
    "memory.backend": "mnemopi",
    "mnemopi.noEmbeddings": true,
    "mnemopi.llmMode": "none",
    "async.enabled": true,
    "task.enableLsp": true,
    "inspect_image.enabled": true,
    "web_search.enabled": true,
    "lsp.enabled": true,
    "astGrep.enabled": true,
    "browser.enabled": true,
    "debug.enabled": true,
    "task.maxConcurrency": 12,
  };
  const ompPath = join(binDir, "omp");
  writeFileSync(ompPath, `#!/usr/bin/env bun
const args = Bun.argv.slice(2);
const values = ${JSON.stringify(globalValues)};
if (args[0] === "--version") {
  console.log("omp 15.5.3");
} else if (args[0] === "models") {
  console.log("provider model context output\\nopenai-codex gpt-5.5 200K 32K no no");
} else if (args[0] === "mcp" && args[1] === "list") {
  console.log("rehearsal connected");
} else if (args[0] === "config" && args[1] === "get" && Object.hasOwn(values, args[2])) {
  const key = args[2];
  const value = values[key];
  console.log(JSON.stringify({ key, value, type: Array.isArray(value) ? "array" : typeof value === "object" ? "record" : typeof value }));
} else {
  process.exit(1);
}
`);
  chmodSync(ompPath, 0o755);
  return { binDir, canaryReceipt };
}

export async function runReleaseRehearsal(
  options: ReleaseRehearsalOptions = {},
): Promise<ReleaseRehearsalReceipt> {
  const root = resolve(options.root ?? join(import.meta.dir, ".."));
  const ownScratch = options.scratchRoot === undefined;
  const scratch = resolve(options.scratchRoot ?? mkdtempSync(join(tmpdir(), "pi-oven-release-rehearsal-")));
  mkdirSync(scratch, { recursive: true });
  const cases: RehearsalCaseResult[] = [];
  let compatibilityReaderPassed = false;
  let setupRollbackPassed = false;
  let archiveChecksum = "";
  let candidateWorkspace: string | undefined;

  try {
    cases.push(await runCase("fresh-isolated-home", async () => {
      const home = join(scratch, "fresh-home");
      const project = join(scratch, "fresh-project");
      mkdirSync(home, { recursive: true });
      mkdirSync(project, { recursive: true });
      const paths = resolveHomePaths({ homeDir: home, env: { HOME: home } });
      invariant(paths.homeDir === resolve(home), "fresh HOME escaped isolation");
      invariant(!existsSync(paths.ompConfigRoot), "fresh HOME unexpectedly contains OMP state");
      const status = await runStatus({ cwd: project, homeDir: home, agentsDir: join(root, "agents"), spawnFn: configSpawn({}) });
      invariant(status.output.includes("no pi-oven project routing detected"), "fresh status invented project routing");
      return { home: paths.homeDir, priorPluginState: "absent", statusExitCode: status.exitCode };
    }));

    cases.push(await runCase("legacy-routing", async () => {
      const project = join(scratch, "legacy-project");
      const home = join(scratch, "legacy-home");
      mkdirSync(project, { recursive: true });
      mkdirSync(home, { recursive: true });
      const status = await runStatus({
        cwd: project,
        homeDir: home,
        agentsDir: join(root, "agents"),
        spawnFn: configSpawn({ "pi-oven:executor": "openai-codex/gpt-5.3-codex" }),
      });
      invariant(status.output.includes("override(config.yml old config keys)"), "legacy compatibility reader did not surface routing");
      invariant(status.output.includes("next successful global write rewrites it to pov:executor"), "legacy migration receipt missing");
      compatibilityReaderPassed = true;
      return { model: "openai-codex/gpt-5.3-codex", surface: "old config keys", migration: "pov:executor" };
    }));

    cases.push(await runCase("project-over-global", async () => {
      const project = join(scratch, "precedence-project");
      const home = join(scratch, "precedence-home");
      mkdirSync(join(project, ".omp"), { recursive: true });
      mkdirSync(home, { recursive: true });
      writeFileSync(join(project, ".omp", "settings.json"), JSON.stringify({
        task: { agentModelOverrides: { "pov:critic": "openai-codex/project-model" } },
        skills: { includeSkills: ["pov:*"] },
        modelRoles: { default: "openai-codex/gpt-5.5", title: "openai/gpt-5" },
        retry: { fallbackChains: { default: ["openai/gpt-5"] } },
      }));
      const status = await runStatus({
        cwd: project,
        homeDir: home,
        agentsDir: join(root, "agents"),
        spawnFn: configSpawn({ "pov:critic": "openai-codex/global-model" }),
      });
      const critic = status.output.split("\n").find((line) => /^\s*critic\s/.test(line)) ?? "";
      invariant(critic.includes("openai-codex/project-model"), "project override did not win");
      invariant(!critic.includes("global-model"), "global override incorrectly won");
      return { winner: "project", model: "openai-codex/project-model" };
    }));

    cases.push(await runCase("setup-validation-rollback", async () => {
      const stateDir = join(scratch, "setup-validation");
      const values = new Map<string, SetupTransactionSnapshot>([["routing", { original: true }]]);
      const adapter = memoryAdapter(values);
      let rejected = false;
      try {
        await applySetupTransaction({
          scope: "project",
          operation: "apply",
          stateDir,
          adapter,
          desired: { routing: { desired: true } },
          validate: async () => ({ ok: false as const, error: "rehearsal validation rejection" }),
        });
      } catch {
        rejected = true;
      }
      invariant(rejected, "setup validation unexpectedly committed");
      invariant(JSON.stringify(values.get("routing")) === JSON.stringify({ original: true }), "setup rollback changed original state");
      invariant((await inspectSetupTransaction(stateDir)).state === "healthy", "rollback left nonterminal state");

      const manualDir = join(scratch, "setup-manual-diff");
      const manualValues = new Map<string, SetupTransactionSnapshot>([["routing", "original"]]);
      const manualAdapter = memoryAdapter(manualValues);
      try {
        await applySetupTransaction({
          scope: "global",
          operation: "apply",
          stateDir: manualDir,
          adapter: manualAdapter,
          desired: { routing: "desired" },
          fault: (point) => {
            if (point === "forward:routing") {
              manualValues.set("routing", "concurrent-user-edit");
              throw new Error("simulated concurrent edit");
            }
          },
        });
      } catch {
        // Expected: CAS compensation preserves the user edit and writes a manual diff.
      }
      invariant(manualValues.get("routing") === "concurrent-user-edit", "CAS rollback overwrote concurrent edit");
      invariant(existsSync(setupTransactionPaths(manualDir).manualRecovery), "manual recovery diff missing");
      setupRollbackPassed = true;
      return { restored: true, concurrentEditPreserved: true, manualDiff: true };
    }));

    cases.push(await runCase("setup-journal-recovery", async () => {
      const stateDir = join(scratch, "setup-recovery");
      const values = new Map<string, SetupTransactionSnapshot>([["first", "original"]]);
      const adapter = memoryAdapter(values);
      let rollbackInterrupted = false;
      try {
        await applySetupTransaction({
          scope: "project",
          operation: "apply",
          stateDir,
          adapter,
          desired: { first: "desired", second: "created" },
          fault: (point) => {
            if (point === "forward:second") throw new Error("simulated process loss");
            if (point === "compensation:second" && !rollbackInterrupted) {
              rollbackInterrupted = true;
              throw new Error("simulated recovery loss");
            }
          },
        });
      } catch {
        // Expected nonterminal journal.
      }
      invariant((await inspectSetupTransaction(stateDir)).state === "recovery_needed", "nonterminal journal not detected");
      invariant((await recoverSetupTransactions({ stateDir, adapter })).state === "recovered", "journal recovery failed");
      invariant(values.get("first") === "original" && !values.has("second"), "journal recovery did not restore originals");

      const corruptDir = join(scratch, "setup-corrupt");
      const corruptPath = setupTransactionPaths(corruptDir).journal;
      mkdirSync(dirname(corruptPath), { recursive: true });
      writeFileSync(corruptPath, "{not-json\n");
      invariant((await inspectSetupTransaction(corruptDir)).state === "corrupt", "corrupt journal was not reported");
      return { nonterminal: "recovered", corrupt: "reported", restored: true };
    }));

    cases.push(await runCase("explicit-autonomous-after-nine-implicit", () => {
      const text = `${Array.from({ length: 9 }, (_, index) => `phrase-${index}`).join(" ")} /autonomous-loop`;
      const selected = selectSkillsForTurn({ latestUserText: text, index: makeSkillIndex(), maxImplicitRoots: 1 });
      invariant(selected.explicit.some((entry) => entry.name === "pov:autonomous-loop"), "explicit autonomous skill was lost");
      invariant(selected.implicitRoot.length === 1, "implicit root cap not enforced");
      invariant(selected.deferred.length === 8, "nine implicit matches were not deterministically deferred");
      return { explicitRecall: "100%", implicitMatches: 9, implicitRoots: 1, deferred: 8 };
    }));

    cases.push(await runCase("task-dispatch-contract", () => {
      const canonical = TaskDispatchSchema.safeParse({
        agent: "pov:executor",
        tasks: [{ id: "implement", description: "Implement", assignment: "Apply the approved change" }],
      });
      const unknown = TaskDispatchSchema.safeParse({
        agent: "pov:unknown-role",
        tasks: [{ id: "bad", description: "Bad", assignment: "Must reject" }],
      });
      const copiedAgents = join(scratch, "missing-agent-registry");
      mkdirSync(copiedAgents, { recursive: true });
      for (const file of readdirSync(join(root, "agents")).filter((file) => file.endsWith(".md"))) {
        copyFileSync(join(root, "agents", file), join(copiedAgents, file));
      }
      rmSync(join(copiedAgents, "pov-executor.md"));
      const missing = inspectAgentRegistry(copiedAgents);
      invariant(canonical.success, "canonical task rejected");
      invariant(!unknown.success, "unknown task agent accepted");
      invariant(missing.issues.some((issue) => issue.code === "missing-role" && issue.role === "executor"), "missing task agent not detected");
      return { canonical: "accepted", unknown: "rejected", missing: "rejected", matrixAccuracy: "100%" };
    }));

    cases.push(await runCase("effect-receipt-crash", async () => {
      const ledger = new SqliteRunLedger(join(scratch, "effect-ledger.sqlite"), { now: () => 1_000 });
      ledger.beginRun({ runId: "rehearsal-effects", repoRoot: root, branch: "rehearsal" });
      const lease = ledger.acquireLease("rehearsal-effects", "rehearsal", 10_000);
      ledger.beginEffect({
        runId: "rehearsal-effects",
        idempotencyKey: "before-receipt",
        kind: "git-push",
        target: "origin/main",
      }, lease);
      invariant(ledger.loadResume("rehearsal-effects").action === "manual-review", "open intent was blindly resumed");

      let executions = 0;
      const intent = {
        runId: "rehearsal-effects",
        idempotencyKey: "after-receipt",
        kind: "git-commit",
        target: "HEAD",
      };
      const first = await reconcileEffect({ ledger, lease, intent, execute: () => ({ oid: "abc" }) });
      executions += first.executed ? 1 : 0;
      const second = await reconcileEffect({ ledger, lease, intent, execute: () => { executions += 1; return { oid: "duplicate" }; } });
      invariant(first.status === "completed" && second.status === "completed", "completed effect receipt was not reusable");
      invariant(second.executed === false && executions === 1, "completed effect was executed twice");
      ledger.close();
      return { beforeReceipt: "manual-review", afterReceipt: "completed-no-replay", executions };
    }));

    cases.push(await runCase("provider-canary", async () => {
      const unavailable = await runCanary({
        outFile: join(scratch, "canary-unavailable.json"),
        strict: true,
        requireScenarios: true,
        notRunReason: "credentials-unavailable",
      });
      invariant(unavailable.receipt.status === "NOT_RUN" && unavailable.exitCode === 0, "credential absence was not NOT RUN");
      const available = await runCanary({
        outFile: join(scratch, "canary-available.json"),
        model: "openai-codex/gpt-5.5",
        strict: true,
        requireScenarios: true,
      }, {
        runEval: async (argv) => {
          const out = argv[argv.indexOf("--out") + 1]!;
          const scenario = argv[argv.indexOf("--scenario") + 1]!;
          const verdict: Verdict = {
            scenario,
            skill: "harness/runtime-canary",
            passed: true,
            inconclusive: false,
            failures: [],
            observations: ["deterministic provider seam accepted canonical dispatch"],
            latency_ms: 1,
            token_in: 1,
            token_out: 1,
            cache_read: 0,
            cache_write: 0,
            cost: 0,
            timed_out: false,
            infrastructure_error: false,
            model_receipts: [{ provider: "openai-codex", model: "gpt-5.5" }],
          };
          writeFileSync(out, `${JSON.stringify(verdict)}\n`);
          return 0;
        },
      });
      invariant(available.receipt.status === "PASS" && available.receipt.completedScenarios === 6, "available canary did not pass all scenarios");
      return { available: "PASS", unavailable: "NOT RUN", unavailableReason: "credentials-unavailable", scenarios: 6 };
    }));

    cases.push(await runCase("candidate-artifact-doctor", () => {
      const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { version: string };
      mkdirSync(join(root, ".pi-oven"), { recursive: true });
      candidateWorkspace = mkdtempSync(join(root, ".pi-oven", "release-rehearsal-"));
      const outDir = join(candidateWorkspace, "candidate");
      const artifacts = buildReleaseArtifacts({ root, outDir, version: pkg.version });
      archiveChecksum = artifacts.archiveSha256;
      const install = join(candidateWorkspace, "candidate-install");
      mkdirSync(install, { recursive: true });
      const extracted = Bun.spawnSync(["tar", "-xzf", artifacts.archivePath, "-C", install], { stdout: "pipe", stderr: "pipe" });
      invariant(extracted.exitCode === 0, `candidate extraction failed: ${extracted.stderr.toString()}`);
      const packageRoot = join(install, `pi-oven-v${pkg.version}`);
      verifyInstalledManifest(packageRoot, artifacts.manifest);
      invariant(artifacts.manifest.files.some((file) => file.path === "scripts/pi-oven-doctor.ts"), "candidate omitted doctor entrypoint");
      invariant(artifacts.manifest.files.some((file) => file.path.startsWith("evals/")), "candidate omitted doctor eval fixtures");
      const candidateHome = join(candidateWorkspace, "candidate-home");
      const candidateTmp = join(packageRoot, ".tmp");
      mkdirSync(candidateHome, { recursive: true });
      mkdirSync(candidateTmp, { recursive: true });
      const ambientHome = process.env.PI_OVEN_TEST_ORIGINAL_HOME || resolveHomePaths().homeDir;
      const installEnv = {
        ...process.env,
        HOME: candidateHome,
        TMPDIR: candidateTmp,
        BUN_INSTALL_CACHE_DIR:
          process.env.BUN_INSTALL_CACHE_DIR ?? join(ambientHome, ".bun", "install", "cache"),
      };
      const installResult = options.candidateInstaller
        ? options.candidateInstaller({ packageRoot, env: installEnv })
        : (() => {
            const offline = Bun.spawnSync(
              ["bun", "install", "--frozen-lockfile", "--offline", "--backend=copyfile"],
              { cwd: packageRoot, env: installEnv, stdout: "pipe", stderr: "pipe", timeout: 120_000 },
            );
            if (offline.exitCode === 0) {
              return {
                exitCode: offline.exitCode,
                stdout: offline.stdout.toString(),
                stderr: offline.stderr.toString(),
                evidence: "bun install --frozen-lockfile --offline --backend=copyfile",
              };
            }
            // A partial/corrupt shared cache must not be treated as candidate failure.
            // Retry into a clean candidate-local cache; CI/release runners have registry access.
            const healedCache = join(candidateWorkspace!, "bun-install-cache");
            mkdirSync(healedCache, { recursive: true });
            const healed = Bun.spawnSync(
              ["bun", "install", "--frozen-lockfile", "--backend=copyfile"],
              {
                cwd: packageRoot,
                env: { ...installEnv, BUN_INSTALL_CACHE_DIR: healedCache },
                stdout: "pipe",
                stderr: "pipe",
                timeout: 120_000,
              },
            );
            return {
              exitCode: healed.exitCode,
              stdout: `${offline.stdout.toString()}\n${healed.stdout.toString()}`,
              stderr: `${offline.stderr.toString()}\n${healed.stderr.toString()}`,
              evidence: "offline read-through attempted; clean candidate-local cache self-heal via bun install --frozen-lockfile --backend=copyfile",
            };
          })();
      invariant(installResult.exitCode === 0, `candidate frozen install failed: ${installResult.stderr}`);
      const doctorEnv = prepareCandidateDoctorEnvironment(packageRoot, candidateHome);
      const gitInit = Bun.spawnSync(["git", "init", "--quiet"], { cwd: packageRoot, stdout: "pipe", stderr: "pipe" });
      invariant(gitInit.exitCode === 0, `candidate git fixture failed: ${gitInit.stderr.toString()}`);
      const doctorProcess = Bun.spawnSync(["bun", "scripts/pi-oven-doctor.ts"], {
        cwd: packageRoot,
        env: {
          ...process.env,
          HOME: candidateHome,
          XDG_CONFIG_HOME: join(candidateHome, ".config"),
          XDG_CACHE_HOME: join(candidateHome, ".cache"),
          XDG_STATE_HOME: join(candidateHome, ".local", "state"),
          PATH: `${doctorEnv.binDir}:${process.env.PATH ?? ""}`,
          PI_OVEN_DOCTOR_ROOT: packageRoot,
          PI_OVEN_DOCTOR_PROJECT_ROOT: packageRoot,
          PI_OVEN_RUN_LEDGER_MODE: "shadow",
          PI_OVEN_CANARY_RECEIPT: doctorEnv.canaryReceipt,
        },
        stdout: "pipe",
        stderr: "pipe",
        timeout: 30_000,
      });
      const doctorOutput = doctorProcess.stdout.toString();
      invariant(doctorOutput.includes("pi-oven doctor — install health"), "candidate doctor entrypoint did not execute");
      invariant(doctorOutput.includes("Summary:"), "candidate doctor omitted its health summary");
      invariant(doctorProcess.exitCode === 0, `candidate doctor failed:\n${doctorOutput}\n${doctorProcess.stderr.toString()}`);
      invariant(!doctorOutput.includes("[FAIL]"), `candidate doctor reported FAIL:\n${doctorOutput}`);
      invariant(
        /Summary: \d+ PASS \/ 0 WARN \/ 0 FAIL \/ 1 NOT RUN — overall WARN/.test(doctorOutput),
        `candidate doctor had unexpected non-pass findings:\n${doctorOutput}`,
      );
      invariant(doctorOutput.includes("[PASS] run ledger:"), "candidate doctor did not validate the ledger");
      invariant(doctorOutput.includes("[NOT RUN] live dispatch canary:"), "candidate doctor did not preserve live canary NOT RUN");
      validateReleaseTagContract(`v${pkg.version}`, pkg.version, `v${pkg.version}`);
      let immutableRejected = false;
      try {
        validateReleaseTagContract(`v${pkg.version}`, `${pkg.version}-mutated`, `v${pkg.version}`);
      } catch {
        immutableRejected = true;
      }
      invariant(immutableRejected, "tagged version mutation was accepted");
      return {
        installedRoot: packageRoot,
        shippedFiles: artifacts.manifest.files.length,
        candidateInstall: `${installResult.evidence} PASS`,
        dependencyCache: "prewarmed read-through; candidate node_modules newly materialized",
        manifestVerified: true,
        doctor: "PASS",
        doctorExitCode: doctorProcess.exitCode,
        liveCanary: "NOT RUN (credentials-unavailable)",
        archiveSha256: artifacts.archiveSha256,
      };
    }));

    const authored = await inspectAuthoredSurfaces({ root, checkGenerated: true });
    const count = (code: string) => authored.issues.filter((issue) => issue.code === code).length;
    const contractCounts = {
      staleLegacyAgentReferences: count("legacy-agent-reference"),
      staleSlashCommands: count("unregistered-slash-command"),
      invalidTaskExamples: count("invalid-task-example") + count("unclassified-task-example"),
      providerTierAliases: count("provider-tier-alias"),
    };
    if (Object.values(contractCounts).some((value) => value !== 0)) {
      cases.push({
        id: "task-dispatch-contract",
        status: "FAIL",
        durationMs: 0,
        evidence: contractCounts,
        error: "authored runtime contract counts are not zero",
      });
    }

    await proveLedgerJsonFallback(join(scratch, "ledger-json-fallback"));
    provePromptRollback();
    const rollbackProof: RollbackProof[] = [
      { name: "compatibility-reader", status: compatibilityReaderPassed ? "PASS" : "FAIL", evidence: "legacy pi-oven:* routing remained readable and advertised canonical rewrite" },
      { name: "setup-journal", status: setupRollbackPassed ? "PASS" : "FAIL", evidence: "validation compensation restored originals; CAS preserved concurrent edits with a manual diff" },
      { name: "ledger-json-fallback", status: "PASS", evidence: "ledger-primary read fell back to JSON and JSON-only writes did not touch the ledger" },
      { name: "prompt-legacy-flag", status: "PASS", evidence: "compositor retained the compact worker capsule; one-release legacy restored full pre-capsule runtime and project injection" },
      { name: "immutable-release-version", status: "PASS", evidence: "exact tag/version/ref passed and post-tag version mutation was rejected" },
    ];

    const bundlePath = existsSync(join(root, "dist", "pi-oven.js"))
      ? join(root, "dist", "pi-oven.js")
      : join(root, ".omp", "extensions", "pi-oven.ts");
    const bundleBytes = readFileSync(bundlePath).byteLength;
    const historicalNominalBytes = 340_000;
    const status = cases.length === 10 && cases.every((entry) => entry.status === "PASS") &&
      rollbackProof.every((entry) => entry.status === "PASS") ? "PASS" : "FAIL";
    return {
      schemaVersion: 1,
      status,
      generatedAt: new Date().toISOString(),
      root,
      cases,
      rollbackProof,
      contractCounts,
      bundle: {
        bytes: bundleBytes,
        historicalNominalBytes,
        deltaBytes: bundleBytes - historicalNominalBytes,
      },
      checksums: { archive: archiveChecksum, bundle: sha256(bundlePath) },
    };
  } finally {
    if (candidateWorkspace) rmSync(candidateWorkspace, { recursive: true, force: true });
    if (ownScratch) {
      // CLI receipts are written outside this scratch; discard candidate artifacts before publish.
      rmSync(scratch, { recursive: true, force: true });
    }
  }
}

export async function writeReleaseRehearsalReceipt(
  outputPath: string,
  receipt: ReleaseRehearsalReceipt,
): Promise<void> {
  await atomicReplaceFile(resolve(outputPath), `${JSON.stringify(receipt, null, 2)}\n`);
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: { out: { type: "string", default: "artifacts/runtime-contract-rehearsal.json" } },
    strict: true,
  });
  const receipt = await runReleaseRehearsal();
  await writeReleaseRehearsalReceipt(values.out!, receipt);
  for (const entry of receipt.cases) {
    process.stdout.write(`${entry.status.padEnd(4)} ${entry.id}${entry.error ? ` — ${entry.error}` : ""}\n`);
  }
  process.stdout.write(
    `Runtime contract rehearsal: ${receipt.status} (${receipt.cases.filter((entry) => entry.status === "PASS").length}/10 cases; receipt=${values.out})\n`,
  );
  process.exit(receipt.status === "PASS" ? 0 : 1);
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exit(1);
  });
}
