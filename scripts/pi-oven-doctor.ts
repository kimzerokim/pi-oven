#!/usr/bin/env bun
/**
 * pi-oven-doctor.ts — Install-health diagnostic for the pi-oven omp plugin.
 *
 * Runs a 9-check matrix and prints a PASS/WARN/FAIL report. Read-only:
 * the only filesystem mutation is a create+write probe of the state dir,
 * which is removed immediately after (check #8).
 *
 * Architecture (Spec-style separation for testability):
 *   - PURE evaluators (eval*, rollup, exitCodeFor): take gathered facts,
 *     return CheckResult. No I/O. Unit-tested in tests/plugin/pi-oven-doctor.test.ts.
 *   - gather(): isolates ALL real probes (spawn omp/bun/git, fs reads/writes)
 *     behind a single async call so tests inject facts directly.
 *
 * Exit code: 0 if no FAIL (WARN ok), 1 if any FAIL.
 *
 * Environment variables for test isolation:
 *   PI_OVEN_DOCTOR_ROOT   — override repo root used for skills/agents/eval probes.
 */

import { promises as fs } from "node:fs";
import * as path from "node:path";
import { compareSemver } from "./pi-oven-setup/cache-resolver";
import { detectAuth, type AuthStatus } from "./pi-oven-setup/auth-detect";
import { EXPECTED_AGENT_COUNT } from "./pi-oven-setup/profiles";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CheckStatus = "PASS" | "WARN" | "FAIL";

export interface CheckResult {
  name: string;
  status: CheckStatus;
  detail: string;
  fix?: string;
}

export interface BinaryFact {
  present: boolean;
  version?: string;
}

export interface GitFact {
  present: boolean;
  version?: string;
  insideRepo: boolean;
}

export interface McpFact {
  servers: string[];
}

export interface SkillsFact {
  skillMdCount: number;
  pluginSkillsCount: number;
}

export interface AgentsFact {
  agentCount: number;
  expectedCount: number;
  lintClean: boolean;
}

export interface StateDirFact {
  writable: boolean;
  path: string;
  error?: string;
}

export interface EvalRunnerFact {
  runnerPresent: boolean;
  smokeScenarioCount: number;
}

export interface DoctorFacts {
  omp: BinaryFact;
  bun: BinaryFact;
  git: GitFact;
  auth: AuthStatus;
  mcp: McpFact;
  skills: SkillsFact;
  agents: AgentsFact;
  stateDir: StateDirFact;
  evalRunner: EvalRunnerFact;
}

export const MIN_OMP_VERSION = "15.0.0";

// ---------------------------------------------------------------------------
// PURE evaluators — no I/O, unit-testable
// ---------------------------------------------------------------------------

/** (1) omp version: PASS if >= min, FAIL if older, WARN if CLI absent locally. */
export function evalOmpVersion(fact: BinaryFact, min: string): CheckResult {
  const name = "omp version";
  if (!fact.present) {
    return {
      name,
      status: "WARN",
      detail: `omp CLI not found on PATH (min ${min}). Skills/eval cannot be exercised locally.`,
      fix: "Install omp: see https://github.com/kimzerokim/pi-oven, or run pi-oven inside an omp session.",
    };
  }
  const version = fact.version ?? "0.1.0";
  if (compareSemver(version, min) >= 0) {
    return { name, status: "PASS", detail: `omp ${version} (>= ${min})` };
  }
  return {
    name,
    status: "FAIL",
    detail: `omp ${version} is older than required ${min}.`,
    fix: `Upgrade omp to >= ${min}.`,
  };
}

/** (2) generic binary presence (bun): PASS if present, FAIL if absent. */
export function evalBinaryPresent(binary: string, fact: BinaryFact): CheckResult {
  if (fact.present) {
    return {
      name: binary,
      status: "PASS",
      detail: `${binary} ${fact.version ?? "(version unknown)"} present`,
    };
  }
  return {
    name: binary,
    status: "FAIL",
    detail: `${binary} not found on PATH.`,
    fix: `Install ${binary} (https://bun.sh) — pi-oven scripts run on bun.`,
  };
}

/** (3) git present AND inside a repo. */
export function evalGit(fact: GitFact): CheckResult {
  const name = "git";
  if (!fact.present) {
    return {
      name,
      status: "FAIL",
      detail: "git not found on PATH.",
      fix: "Install git.",
    };
  }
  if (!fact.insideRepo) {
    return {
      name,
      status: "FAIL",
      detail: `git ${fact.version ?? ""} present but current dir is not inside a git repo.`.trim(),
      fix: "Run pi-oven from inside a git working tree (git init or cd into the repo).",
    };
  }
  return { name, status: "PASS", detail: `git ${fact.version ?? ""} present, inside repo`.trim() };
}

/** (4) provider auth: PASS if >=1 whitelisted provider authed, else WARN. */
export function evalAuth(fact: AuthStatus): CheckResult {
  const name = "provider auth";
  const authed: string[] = [];
  if (fact.opencode_zen) authed.push("opencode-zen");
  if (fact.openai_codex) authed.push("openai-codex");
  if (fact.anthropic) authed.push("anthropic");
  if (authed.length > 0) {
    return {
      name,
      status: "PASS",
      detail: `Authed providers: ${authed.join(", ")}`,
    };
  }
  return {
    name,
    status: "WARN",
    detail:
      "No whitelisted provider authed (opencode-zen / openai-codex / anthropic). Live eval and subagent dispatch will fail.",
    fix: "Authenticate at least one provider in omp (e.g. opencode-zen), then re-run /pi-oven:doctor.",
  };
}

/** (5) MCP servers: informational. PASS if any configured, WARN if none (never FAIL). */
export function evalMcp(fact: McpFact): CheckResult {
  const name = "mcp servers";
  if (fact.servers.length > 0) {
    return {
      name,
      status: "PASS",
      detail: `MCP servers configured: ${fact.servers.join(", ")}`,
    };
  }
  return {
    name,
    status: "WARN",
    detail: "No MCP servers configured (informational — pi-oven does not require any).",
  };
}

/** (6) skills: SKILL.md count must equal plugin.json skills[] length. */
export function evalSkills(fact: SkillsFact): CheckResult {
  const name = "skills";
  if (fact.skillMdCount === fact.pluginSkillsCount) {
    return {
      name,
      status: "PASS",
      detail: `${fact.skillMdCount} SKILL.md files match plugin.json skills[] (${fact.pluginSkillsCount}).`,
    };
  }
  return {
    name,
    status: "FAIL",
    detail: `skills/*/SKILL.md count (${fact.skillMdCount}) != plugin.json skills[] length (${fact.pluginSkillsCount}).`,
    fix: "Sync .claude-plugin/plugin.json skills[] with skills/*/SKILL.md (add/remove entries to match).",
  };
}

/** (7) agents: count must equal expected AND lint:agents must be clean. */
export function evalAgents(fact: AgentsFact): CheckResult {
  const name = "agents";
  if (fact.agentCount !== fact.expectedCount) {
    return {
      name,
      status: "FAIL",
      detail: `agents/pi-oven-*.md count (${fact.agentCount}) != expected (${fact.expectedCount}).`,
      fix: "Restore the missing agent files or align profiles.ts ROLES with agents/.",
    };
  }
  if (!fact.lintClean) {
    return {
      name,
      status: "FAIL",
      detail: `${fact.agentCount} agents present but lint:agents reported drift (model/thinkingLevel/colon-name).`,
      fix: "Run `bun run lint:agents` to see violations; regenerate frontmatter via maintainer --apply.",
    };
  }
  return {
    name,
    status: "PASS",
    detail: `${fact.agentCount} agents present, lint:agents clean.`,
  };
}

/** (8) state dir: .pi-oven/ must be creatable + writable. */
export function evalStateDir(fact: StateDirFact): CheckResult {
  const name = "state dir";
  if (fact.writable) {
    return { name, status: "PASS", detail: `${fact.path}/ is creatable and writable.` };
  }
  return {
    name,
    status: "FAIL",
    detail: `${fact.path}/ is not writable${fact.error ? ` (${fact.error})` : ""}.`,
    fix: `Ensure the working directory is writable so pi-oven can create ${fact.path}/.`,
  };
}

/** (9) eval runner: scripts/run-eval.ts present AND can enumerate smoke scenarios. */
export function evalEvalRunner(fact: EvalRunnerFact): CheckResult {
  const name = "eval runner";
  if (!fact.runnerPresent) {
    return {
      name,
      status: "FAIL",
      detail: "scripts/run-eval.ts not found.",
      fix: "Restore scripts/run-eval.ts (eval-runner surface).",
    };
  }
  if (fact.smokeScenarioCount > 0) {
    return {
      name,
      status: "PASS",
      detail: `run-eval.ts present; ${fact.smokeScenarioCount} smoke-tagged scenarios enumerable.`,
    };
  }
  return {
    name,
    status: "WARN",
    detail: "run-eval.ts present but no smoke-tagged scenarios found under evals/.",
    fix: "Add at least one evals/<skill>/scenarios/smoke.yaml with `tag: smoke`.",
  };
}

// ---------------------------------------------------------------------------
// Rollup + exit-code logic (pure)
// ---------------------------------------------------------------------------

export interface Rollup {
  overall: CheckStatus;
  pass: number;
  warn: number;
  fail: number;
}

export function rollup(checks: CheckResult[]): Rollup {
  let pass = 0;
  let warn = 0;
  let fail = 0;
  for (const c of checks) {
    if (c.status === "PASS") pass++;
    else if (c.status === "WARN") warn++;
    else fail++;
  }
  const overall: CheckStatus = fail > 0 ? "FAIL" : warn > 0 ? "WARN" : "PASS";
  return { overall, pass, warn, fail };
}

export function exitCodeFor(checks: CheckResult[]): number {
  return checks.some((c) => c.status === "FAIL") ? 1 : 0;
}

// ---------------------------------------------------------------------------
// Real probes — isolated behind gather(); not exercised by unit tests
// ---------------------------------------------------------------------------

function probeBinary(bin: string, versionArg = "--version"): BinaryFact {
  try {
    const proc = Bun.spawnSync([bin, versionArg], { stdio: ["ignore", "pipe", "pipe"], timeout: 4000 });
    if ((proc.exitCode ?? 1) !== 0 && !(proc.stdout && proc.stdout.length)) {
      return { present: false };
    }
    const out = (proc.stdout?.toString() ?? "").trim();
    // Extract first semver-ish token (e.g. "omp/15.5.10", "1.2.0", "git version 2.44.0").
    const m = out.match(/\d+\.\d+(?:\.\d+)?/);
    return { present: true, version: m ? m[0] : out.split("\n")[0] };
  } catch {
    return { present: false };
  }
}

function probeGit(): GitFact {
  const bin = probeBinary("git", "--version");
  if (!bin.present) return { present: false, insideRepo: false };
  let insideRepo = false;
  try {
    const proc = Bun.spawnSync(["git", "rev-parse", "--is-inside-work-tree"], {
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 4000,
    });
    insideRepo = (proc.exitCode ?? 1) === 0 && (proc.stdout?.toString() ?? "").trim() === "true";
  } catch {
    insideRepo = false;
  }
  return { present: true, version: bin.version, insideRepo };
}

async function probeMcp(root: string): Promise<McpFact> {
  // Prefer .pi/mcp.json; fall back to `omp mcp list` if absent.
  const mcpPath = path.join(root, ".pi", "mcp.json");
  try {
    const raw = await fs.readFile(mcpPath, "utf8");
    const json = JSON.parse(raw) as { mcpServers?: Record<string, unknown> };
    return { servers: Object.keys(json.mcpServers ?? {}) };
  } catch {
    // ignore — try omp mcp list
  }
  try {
    const proc = Bun.spawnSync(["omp", "mcp", "list"], { stdio: ["ignore", "pipe", "pipe"], timeout: 4000 });
    if ((proc.exitCode ?? 1) === 0) {
      const lines = (proc.stdout?.toString() ?? "")
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l && !/^(no |name\b|mcp\b)/i.test(l));
      return { servers: lines.map((l) => l.split(/\s+/)[0]).filter(Boolean) };
    }
  } catch {
    // ignore
  }
  return { servers: [] };
}

async function countSkillMd(root: string): Promise<number> {
  const skillsDir = path.join(root, "skills");
  const dirs = await fs.readdir(skillsDir).catch(() => [] as string[]);
  let count = 0;
  for (const d of dirs) {
    const exists = await fs
      .access(path.join(skillsDir, d, "SKILL.md"))
      .then(() => true)
      .catch(() => false);
    if (exists) count++;
  }
  return count;
}

async function readPluginSkillsCount(root: string): Promise<number> {
  try {
    const raw = await fs.readFile(path.join(root, ".claude-plugin", "plugin.json"), "utf8");
    const json = JSON.parse(raw) as { skills?: unknown[] };
    return Array.isArray(json.skills) ? json.skills.length : 0;
  } catch {
    return 0;
  }
}

async function countAgents(root: string): Promise<number> {
  const agentsDir = path.join(root, "agents");
  const files = await fs.readdir(agentsDir).catch(() => [] as string[]);
  return files.filter((f) => f.startsWith("pi-oven-") && f.endsWith(".md")).length;
}

function probeLintAgents(root: string): boolean {
  try {
    const proc = Bun.spawnSync(["bun", "run", "lint:agents"], {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 4000,
    });
    return (proc.exitCode ?? 1) === 0;
  } catch {
    return false;
  }
}

async function probeStateDir(root: string): Promise<StateDirFact> {
  const target = path.join(root, ".pi-oven");
  const probeFile = path.join(target, `.doctor-probe-${process.pid}`);
  try {
    await fs.mkdir(target, { recursive: true });
    await fs.writeFile(probeFile, "ok", "utf8");
    await fs.unlink(probeFile).catch(() => {});
    return { writable: true, path: ".pi-oven" };
  } catch (err) {
    return { writable: false, path: ".pi-oven", error: (err as Error)?.message ?? "unknown" };
  }
}

async function probeEvalRunner(root: string): Promise<EvalRunnerFact> {
  const runnerPresent = await fs
    .access(path.join(root, "scripts", "run-eval.ts"))
    .then(() => true)
    .catch(() => false);
  let smokeScenarioCount = 0;
  const evalsDir = path.join(root, "evals");
  const skillDirs = await fs.readdir(evalsDir).catch(() => [] as string[]);
  for (const d of skillDirs) {
    const scenDir = path.join(evalsDir, d, "scenarios");
    const files = await fs.readdir(scenDir).catch(() => [] as string[]);
    for (const f of files) {
      if (!f.endsWith(".yaml")) continue;
      const text = await fs.readFile(path.join(scenDir, f), "utf8").catch(() => "");
      if (/^tag:\s*smoke/m.test(text)) smokeScenarioCount++;
    }
  }
  return { runnerPresent, smokeScenarioCount };
}

/** Gather all real-world facts. Isolated so unit tests inject facts directly. */
export async function gather(root: string): Promise<DoctorFacts> {
  const [mcp, skillMdCount, pluginSkillsCount, agentCount, stateDir, evalRunner, auth] =
    await Promise.all([
      probeMcp(root),
      countSkillMd(root),
      readPluginSkillsCount(root),
      countAgents(root),
      probeStateDir(root),
      probeEvalRunner(root),
      detectAuth().catch(
        () => ({ opencode_zen: false, openai_codex: false, anthropic: false }) as AuthStatus
      ),
    ]);

  return {
    omp: probeBinary("omp", "--version"),
    bun: probeBinary("bun", "--version"),
    git: probeGit(),
    auth,
    mcp,
    skills: { skillMdCount, pluginSkillsCount },
    agents: {
      agentCount,
      expectedCount: EXPECTED_AGENT_COUNT,
      lintClean: probeLintAgents(root),
    },
    stateDir,
    evalRunner,
  };
}

// ---------------------------------------------------------------------------
// Runner: gather facts → run 9 evaluators → render report
// ---------------------------------------------------------------------------

export function runChecks(facts: DoctorFacts): CheckResult[] {
  return [
    evalOmpVersion(facts.omp, MIN_OMP_VERSION),
    evalBinaryPresent("bun", facts.bun),
    evalGit(facts.git),
    evalAuth(facts.auth),
    evalMcp(facts.mcp),
    evalSkills(facts.skills),
    evalAgents(facts.agents),
    evalStateDir(facts.stateDir),
    evalEvalRunner(facts.evalRunner),
  ];
}

export function renderReport(checks: CheckResult[]): string {
  const icon: Record<CheckStatus, string> = { PASS: "PASS", WARN: "WARN", FAIL: "FAIL" };
  const lines: string[] = [];
  lines.push("pi-oven doctor — install health");
  lines.push("");
  for (const c of checks) {
    lines.push(`[${icon[c.status]}] ${c.name}: ${c.detail}`);
    if (c.fix && c.status !== "PASS") lines.push(`       fix: ${c.fix}`);
  }
  const r = rollup(checks);
  lines.push("");
  lines.push(`Summary: ${r.pass} PASS / ${r.warn} WARN / ${r.fail} FAIL — overall ${r.overall}`);
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// CLI entrypoint (only when run directly, not when imported by tests)
// ---------------------------------------------------------------------------

if (import.meta.main) {
  const root = process.env.PI_OVEN_DOCTOR_ROOT ?? process.cwd();
  const facts = await gather(root);
  const checks = runChecks(facts);
  process.stdout.write(renderReport(checks) + "\n");
  process.exit(exitCodeFor(checks));
}
