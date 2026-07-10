import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const ROOT = join(import.meta.dir, "../..");
const LINT = join(ROOT, "scripts/lint-doc-evidence.ts");
const DETAILED_SURVEY = join(
  ROOT,
  "docs/harness/surveys/2026-07-05-pi-oven-remediation-detailed-survey.md"
);
const ROUTING_RESEARCH = join(
  ROOT,
  "docs/research/2026-07-05-pi-oven-codex-only-routing-research.md"
);

type CommandResult = {
  code: number;
  stdout: string;
  stderr: string;
};

function runDirect(paths: string[]): CommandResult {
  const proc = Bun.spawnSync([process.execPath, LINT, ...paths], {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"],
  });

  return {
    code: proc.exitCode ?? 1,
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
  };
}

function runPackageCommand(paths: string[]): CommandResult {
  const proc = Bun.spawnSync([process.execPath, "--silent", "run", "lint:doc-evidence", ...paths], {
    cwd: ROOT,
    env: { ...process.env, LC_ALL: "C", LANG: "C" },
    stdio: ["ignore", "pipe", "pipe"],
  });

  return {
    code: proc.exitCode ?? 1,
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
  };
}

describe("lint-doc-evidence", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "lint-doc-evidence-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function writeDoc(name: string, content: string): string {
    const file = join(dir, name);
    writeFileSync(file, content, "utf-8");
    return file;
  }

  it("rejects a metadata-only survey that never cites exact repo code evidence", () => {
    const doc = writeDoc(
      "thin-survey.md",
      `# Thin survey

## Scope
- Topic: remediation wave survey
- Evidence inputs:
  - agent://DetailedSurvey
  - live repo state
- Deliverable intent: survey only

## Executive summary
This area needs follow-up work.
`
    );

    const { code, stderr } = runDirect([doc]);
    expect(code).toBe(1);
    expect(stderr).toContain(doc);
    expect(stderr).toMatch(/code-grounded|repo code|exact local evidence/i);
  });

  it("rejects a research memo that lacks official-source links and exact local change surfaces", () => {
    const doc = writeDoc(
      "thin-research.md",
      `# Thin research

## Scope
- Topic: codex-only routing
- Inputs:
  - current repo notes
  - prior agent output

## Executive summary
Adopt codex-only routing as the baseline.
`
    );

    const { code, stderr } = runDirect([doc]);
    expect(code).toBe(1);
    expect(stderr).toContain(doc);
    expect(stderr).toMatch(/official-source|local change surface|code-grounded/i);
  });

  it("rejects docs-like URLs that are not on the curated official-doc host policy", () => {
    const doc = writeDoc(
      "thin-research-unofficial-docs.md",
      `# Thin research with unofficial docs-like URLs

## Scope
- Topic: codex-only routing
- Inputs:
  - https://example.com/docs/codex/models
  - https://example.com/reference/reasoning
  - current repo state

## Executive summary
Adopt codex-only routing as the baseline.

## Local evidence
- The codex-only matrix already exists in scripts/pi-oven-setup/profiles.ts:345-532.
- The apply path already persists the selector shape in scripts/pi-oven-setup/apply.ts:80-82,184-191.
- Load-time provider validation still treats mixed providers as live in .omp/extensions/pi-oven.ts:246-364.

## Explicit unknowns
- I did not verify the provenance of these docs-like hosts.
`
    );

    const { code, stderr } = runDirect([doc]);
    expect(code).toBe(1);
    expect(stderr).toContain(doc);
    expect(stderr).toMatch(/official-source/i);
  });

  it("classifies research docs before survey-like filenames", () => {
    const doc = writeDoc(
      "routing-survey-research.md",
      `# Routing survey research

## Scope
- Topic: codex-only routing
- Inputs:
  - current repo state

## Executive summary
Research docs should still trigger research checks even when the filename also says survey.

## Local evidence
- The codex-only matrix already exists in scripts/pi-oven-setup/profiles.ts:345-532.
- The apply path already persists the selector shape in scripts/pi-oven-setup/apply.ts:80-82,184-191.
- Load-time provider validation still treats mixed providers as live in .omp/extensions/pi-oven.ts:246-364.

## Explicit unknowns
- I did not add official-source links in this sample on purpose.
`
    );

    const { code, stderr } = runDirect([doc]);
    expect(code).toBe(1);
    expect(stderr).toContain(doc);
    expect(stderr).toMatch(/official-source|Executive summary/i);
    expect(stderr).not.toMatch(/implementation and test surfaces/i);
  });

  it("rejects a survey that cites implementation files but no tests", () => {
    const doc = writeDoc(
      "survey-without-tests.md",
      `# Survey without tests

## Scope
- Topic: remediation wave survey
- Evidence inputs:
  - live repo state

## Findings
- Proof gating already blocks code-write without exact owned skill reads (.omp/extensions/pi-oven-runtime/gate.ts:435-480; scripts/pi-oven-team/task-file-ops.ts:99-145).

## Explicit unknowns
- I did not inspect the matching regression tests in this sample.
`
    );

    const { code, stderr } = runDirect([doc]);
    expect(code).toBe(1);
    expect(stderr).toContain(doc);
    expect(stderr).toMatch(/implementation and test surfaces/i);
  });

  it("accepts a research memo that uses non-openai official documentation hosts", () => {
    const doc = writeDoc(
      "grounded-research-generic-official.md",
      `# Grounded research with generic official docs

## Scope
- Topic: generic official-doc host recognition
- Inputs:
  - https://developer.mozilla.org/en-US/docs/Web/JavaScript
  - https://docs.python.org/3/library/pathlib.html
  - current repo state

## Executive summary
Official-link recognition should not be hard-pinned to OpenAI hosts.

## Local evidence
- The codex-only matrix already exists in scripts/pi-oven-setup/profiles.ts:345-532.
- The apply path already persists the selector shape in scripts/pi-oven-setup/apply.ts:80-82,184-191.
- Load-time provider validation still treats mixed providers as live in .omp/extensions/pi-oven.ts:246-364.

## Explicit unknowns
- I did not verify every possible official-doc hostname pattern in this sample.
`
    );

    const { code, stderr } = runDirect([doc]);
    expect(code).toBe(0);
    expect(stderr).toBe("");
  });

  it("accepts a survey that cites exact implementation and test surfaces", () => {
    const doc = writeDoc(
      "grounded-survey.md",
      `# Grounded survey

## Scope
- Topic: remediation wave survey
- Evidence inputs:
  - live repo state

## Findings
- Proof gating already blocks code-write without exact owned skill reads (.omp/extensions/pi-oven-runtime/gate.ts:435-480; tests/extensions/pi-oven-runtime/gate.test.ts:559-653).
- Dependency-aware batching rejects colliding write lanes before startup fan-out (scripts/pi-oven-team/task-file-ops.ts:99-145; scripts/pi-oven-team/runtime-v2.ts:141-230).

## Explicit unknowns
- I did not validate whether any additional runtime gate should lint these docs automatically outside this command yet.
`
    );

    const { code, stderr } = runDirect([doc]);
    expect(code).toBe(0);
    expect(stderr).toBe("");
  });

  it("accepts a research memo that ties official guidance to exact local change surfaces", () => {
    const doc = writeDoc(
      "grounded-research.md",
      `# Grounded research

## Scope
- Topic: codex-only routing
- Inputs:
  - https://developers.openai.com/codex/models
  - https://developers.openai.com/api/docs/guides/reasoning
  - current repo state

## Executive summary
Use PROFILE_B as the codex-only baseline.

## Local evidence
- The codex-only matrix already exists in scripts/pi-oven-setup/profiles.ts:345-532.
- The apply path already persists the selector shape in scripts/pi-oven-setup/apply.ts:80-82,184-191.
- Load-time provider validation still treats mixed providers as live in .omp/extensions/pi-oven.ts:246-364.

## Explicit unknowns
- I did not verify in this sample whether setup UX should ask by role or by shared bucket first.
`
    );

    const { code, stderr } = runDirect([doc]);
    expect(code).toBe(0);
    expect(stderr).toBe("");
  });
});

describe("lint:doc-evidence package integration", () => {
  it("accepts the checked-in detailed survey and routing research docs", () => {
    const { code, stderr } = runPackageCommand([DETAILED_SURVEY, ROUTING_RESEARCH]);
    expect(code).toBe(0);
    expect(stderr).toBe("");
  });
});
