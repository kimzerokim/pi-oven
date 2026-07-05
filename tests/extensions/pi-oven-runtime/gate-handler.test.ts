import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  createGateHandler,
  isCodeWriteTool,
  getTargetPath,
  getSkillReadName,
  toGateFsmView,
  type GateHandlerDeps,
} from "../../../.omp/extensions/pi-oven-runtime/gate-handler";
import {
  createRuntimeTraceSnapshot,
  recordTouchedPath,
  traceFunction,
} from "../../../.omp/extensions/pi-oven-runtime/trace-primitives";
import {
  GateStateStore,
  fingerprintExternalExecSecret,
  type FsmState,
  type OwnershipTraceEntry,
} from "../../../.omp/extensions/pi-oven-runtime/gate-state";
import {
  AUTONOMOUS_STATE_FILE,
  projectStatePath,
} from "../../../.omp/extensions/pi-oven-runtime/project-state";
function makeTempDir(): string {
  const dir = join(tmpdir(), `pi-oven-gh-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function bashEvent(command: string, toolCallId = "tc1") {
  return { type: "tool_call" as const, toolCallId, toolName: "bash" as const, input: { command } };
}

function taskEvent(agent: string, toolCallId = "tc-task") {
  // a `task` dispatch tool_call (subagent spawn). Carries params.agent.
  return { type: "tool_call" as const, toolCallId, toolName: "task", input: { agent, prompt: "x" } };
}

function readEvent(path: string, toolCallId = "tc-read") {
  return { type: "tool_call" as const, toolCallId, toolName: "read" as const, input: { path } };
}

function writeEvent(path: string, toolCallId = "tc-write") {
  return { type: "tool_call" as const, toolCallId, toolName: "write" as const, input: { path, content: "{}" } };
}


function makeLogger() {
  const lines: { level: string; msg: string }[] = [];
  return {
    lines,
    logger: {
      info: (m: string) => lines.push({ level: "info", msg: m }),
      warn: (m: string) => lines.push({ level: "warn", msg: m }),
      error: (m: string) => lines.push({ level: "error", msg: m }),
      debug: (m: string) => lines.push({ level: "debug", msg: m }),
    },
  };
}

function writeState(dir: string, s: FsmState): void {
  mkdirSync(join(dir, "state"), { recursive: true });
  writeFileSync(join(dir, "state", "autonomous.json"), JSON.stringify(s));
}
type StoredConsent = NonNullable<FsmState["externalExecConsent"]>;

function consent(
  scope: StoredConsent["scope"],
  overrides: Partial<StoredConsent> = {}
): StoredConsent {
  return {
    sourceMessageId: "u1",
    scope,
    remainingUses: 1,
    ...overrides,
  };
}

function tempConsent(
  scope: StoredConsent["scope"],
  overrides: Partial<NonNullable<StoredConsent["tempCredentials"]>> = {}
): StoredConsent {
  return consent(scope, {
    tempCredentials: {
      provider: "aws",
      accessKeyId: "ASIAIOSFODNN7EXAMPLE",
      sessionTokenFingerprint: fingerprintExternalExecSecret("session123"),
      secretAccessKeyFingerprint: fingerprintExternalExecSecret("secret"),
      expiresAt: Date.now() + 60_000,
      ...overrides,
    },
  });
}

function activeState(externalExecConsent?: StoredConsent): FsmState {
  return {
    active: true,
    gateCache: { commit: "PASS", regression: "PASS" },
    version: 1,
    schemaVersion: 1,
    ...(externalExecConsent ? { externalExecConsent } : {}),
  };
}

async function expectStoredConsent(dir: string, expected: StoredConsent | undefined) {
  const after = await new GateStateStore(dir).readState();
  expect(after.kind).toBe("OK");
  if (after.kind !== "OK") return;
  expect(after.state.externalExecConsent).toEqual(expected);
}

async function deps(dir: string, env: Record<string, string | undefined> = {}): Promise<GateHandlerDeps & { _logger: ReturnType<typeof makeLogger> }> {
  const lg = makeLogger();
  return {
    store: new GateStateStore(dir),
    logger: lg.logger,
    getEnv: () => env,
    isParentSession: true,
    _logger: lg,
  };
}

// ---------------------------------------------------------------------------
// AC1 — commit gate via a synthetic ToolCallEvent
// ---------------------------------------------------------------------------

describe("gateHandler — commit gate (AC1)", () => {
  let dir: string;
  beforeEach(() => { dir = makeTempDir(); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it("blocks git commit when active and commit cache != PASS", async () => {
    writeState(dir, { active: true, gateCache: { commit: "FAIL" }, version: 1, schemaVersion: 1 });
    const h = createGateHandler(await deps(dir));
    const r = await h(bashEvent("git commit -m x"));
    expect(r?.block).toBe(true);
    expect(r?.reason).toBeDefined();
  });

  it("allows git commit when active and heavy-verifier cache is absent", async () => {
    writeState(dir, { active: true, gateCache: { commit: "PASS" }, version: 1, schemaVersion: 1 });
    const h = createGateHandler(await deps(dir));
    const r = await h(bashEvent("git commit -m x"));
    expect(r?.block ?? false).toBe(false);
  });
  it("blocks git commit after an autonomous runtime-contract material edit unless the deep verifier cache passes", async () => {
    writeState(dir, {
      active: true,
      gateCache: { commit: "PASS" },
      version: 1,
      schemaVersion: 1,
      requiredSkills: [],
      skillReads: [],
      requiredSkillsMessageId: "u1",
    });
    mkdirSync(join(dir, "state"), { recursive: true });
    writeFileSync(
      join(dir, "state", "branch-contract.json"),
      JSON.stringify({ destination: "worktree", branch: "feature/task7", pr_mode: "direct" })
    );
    const h = createGateHandler(await deps(dir));

    const writeResult = await h(writeEvent(".omp/extensions/pi-oven-runtime/gate.ts", "tc-write-trace"));
    expect(writeResult?.block ?? false).toBe(false);

    const commitResult = await h(bashEvent("git commit -m x", "tc-commit-deep"));
    expect(commitResult?.block).toBe(true);
    expect(commitResult?.reason).toMatch(/verifier depth policy selected deep/i);
  });

  it("reuses a shared runtime trace state so later commits see approval-trace evidence", async () => {
    writeState(dir, {
      active: true,
      gateCache: { commit: "PASS" },
      version: 1,
      schemaVersion: 1,
      requiredSkills: [],
      skillReads: [],
      requiredSkillsMessageId: "u1",
    });
    mkdirSync(join(dir, "state"), { recursive: true });
    writeFileSync(
      join(dir, "state", "branch-contract.json"),
      JSON.stringify({ destination: "worktree", branch: "feature/task7", pr_mode: "direct" })
    );
    const sharedTrace = { trace: createRuntimeTraceSnapshot() };
    const h = createGateHandler({ ...(await deps(dir)), runtimeTraceState: sharedTrace });

    sharedTrace.trace = {
      ...recordTouchedPath(
        traceFunction(
          createRuntimeTraceSnapshot(),
          "recordAnswer",
          ".omp/extensions/pi-oven-runtime/deep-interview-runtime.ts"
        ),
        ".omp/extensions/pi-oven-runtime/deep-interview-runtime.ts"
      ),
      stateChanges: [
        {
          primitive: "list_changed_runtime_state",
          key: "deepInterview.routingApproval.approvals.executor.selectedSelector",
          before: undefined,
          after: "openai-codex/gpt-5.5:high",
        },
      ],
    };

    const commitResult = await h(bashEvent("git commit -m x", "tc-shared-trace"));
    expect(commitResult?.block).toBe(true);
    expect(commitResult?.reason).toMatch(/verifier depth policy selected deep/i);
  });
  it("does not promote a blocked runtime-contract write attempt into deep-verifier commit pressure", async () => {
    writeState(dir, {
      active: true,
      gateCache: { commit: "PASS" },
      version: 1,
      schemaVersion: 1,
      requiredSkills: [],
      skillReads: [],
      requiredSkillsMessageId: "u1",
    });
    const h = createGateHandler(await deps(dir));

    const blockedWrite = await h(writeEvent(".omp/extensions/pi-oven-runtime/gate.ts", "tc-blocked-write"));
    expect(blockedWrite?.block).toBe(true);

    const commitResult = await h(bashEvent("git commit -m x", "tc-commit-after-blocked-write"));
    expect(commitResult?.block ?? false).toBe(false);
  });

  it("allows git commit when active and commit+heavy-verifier cache == PASS", async () => {
    writeState(
      dir,
      { active: true, gateCache: { commit: "PASS", regression: "PASS" }, version: 1, schemaVersion: 1 }
    );
    const h = createGateHandler(await deps(dir));
    const r = await h(bashEvent("git commit -m x"));
    expect(r?.block ?? false).toBe(false);
  });

  it("blocks git commit when active and heavy-verifier cache != PASS", async () => {
    writeState(
      dir,
      { active: true, gateCache: { commit: "PASS", regression: "FAIL" }, version: 1, schemaVersion: 1 }
    );
    const h = createGateHandler(await deps(dir));
    const r = await h(bashEvent("git commit -m x"));
    expect(r?.block).toBe(true);
  });

  it("ALLOWS git commit when the FSM file is ABSENT (normal dev session — B2 refinement)", async () => {
    const h = createGateHandler(await deps(dir));
    const r = await h(bashEvent("git commit -m x"));
    expect(r?.block ?? false).toBe(false);
  });

  it("ignores non-bash tool calls (read/edit) entirely (fail-open)", async () => {
    writeState(dir, { active: true, gateCache: { commit: "FAIL" }, version: 1, schemaVersion: 1 });
    const h = createGateHandler(await deps(dir));
    const r = await h({ type: "tool_call", toolCallId: "x", toolName: "read", input: { path: "/x" } } as never);
    expect(r?.block ?? false).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AC6 — state failure policy at the handler level
// ---------------------------------------------------------------------------

describe("gateHandler — state failure (AC6)", () => {
  let dir: string;
  beforeEach(() => { dir = makeTempDir(); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it("corrupt primary → fail-CLOSED, blocks commit", async () => {
    mkdirSync(join(dir, "state"), { recursive: true });
    writeFileSync(join(dir, "state", "autonomous.json"), "{ corrupt");
    const h = createGateHandler(await deps(dir));
    const r = await h(bashEvent("git commit -m x"));
    expect(r?.block).toBe(true);
  });

  it("corrupt primary + PI_OVEN_GATE_BYPASS=1 → ALLOWS commit and logs a warn", async () => {
    mkdirSync(join(dir, "state"), { recursive: true });
    writeFileSync(join(dir, "state", "autonomous.json"), "{ corrupt");
    const d = await deps(dir, { PI_OVEN_GATE_BYPASS: "1" });
    const h = createGateHandler(d);
    const r = await h(bashEvent("git commit -m x"));
    expect(r?.block ?? false).toBe(false);
    expect(d._logger.lines.some((l) => l.level === "warn")).toBe(true);
  });

  it("forbidden floor blocks rm -rf / even when FSM ABSENT", async () => {
    const h = createGateHandler(await deps(dir));
    const r = await h(bashEvent("rm -rf /"));
    expect(r?.block).toBe(true);
    expect(r?.reason).toMatch(/forbidden/i);
  });

  it("forbidden floor blocks rm -rf / even under PI_OVEN_GATE_BYPASS=1", async () => {
    const h = createGateHandler(await deps(dir, { PI_OVEN_GATE_BYPASS: "1" }));
    const r = await h(bashEvent("rm -rf /"));
    expect(r?.block).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AC5 — push consent env vs file single-use (handler integration)
// ---------------------------------------------------------------------------

describe("gateHandler — push consent (AC5)", () => {
  let dir: string;
  beforeEach(() => { dir = makeTempDir(); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it("blocks git push when active and no consent", async () => {
    writeState(dir, { active: true, gateCache: { commit: "PASS" }, version: 1, schemaVersion: 1 });
    const h = createGateHandler(await deps(dir));
    const r = await h(bashEvent("git push origin main"));
    expect(r?.block).toBe(true);
  });

  it("inline env source: two successive pushes both allowed (NOT consumed)", async () => {
    writeState(dir, { active: true, gateCache: { commit: "PASS" }, version: 1, schemaVersion: 1 });
    const d = await deps(dir);
    const h = createGateHandler(d);
    const r1 = await h(bashEvent("PI_OVEN_PUSH_CONSENT=ref git push origin main"));
    const r2 = await h(bashEvent("PI_OVEN_PUSH_CONSENT=ref git push origin main"));
    expect(r1?.block ?? false).toBe(false);
    expect(r2?.block ?? false).toBe(false);
    expect(d._logger.lines.some((l) => l.msg.includes("source=env") && l.msg.includes("main"))).toBe(true);
  });

  it("blocks git push when only ambient process env consent is present", async () => {
    writeState(dir, { active: true, gateCache: { commit: "PASS" }, version: 1, schemaVersion: 1 });
    const h = createGateHandler(await deps(dir, { PI_OVEN_PUSH_CONSENT: "ref" }));
    const r = await h(bashEvent("git push origin main"));
    expect(r?.block).toBe(true);
  });

  it("file source: first push allowed from <cwd>/.pi-oven/state/push-consent.json; second push blocks after consume", async () => {
    const stateRoot = join(dir, ".pi-oven");
    writeState(stateRoot, { active: true, gateCache: { commit: "PASS" }, version: 1, schemaVersion: 1 });
    const consent = join(stateRoot, "state", "push-consent.json");
    writeFileSync(consent, JSON.stringify({ grantedAt: Date.now(), expiresAt: Date.now() + 60_000, branch: "main" }));
    const h = createGateHandler(await deps(stateRoot));
    const r1 = await h(bashEvent("git push origin main"));
    expect(r1?.block ?? false).toBe(false);
    expect(existsSync(consent)).toBe(false);
    const r2 = await h(bashEvent("git push origin main"));
    expect(r2?.block).toBe(true);
  });

  it("expired file consent → blocks push (treated as absent)", async () => {
    writeState(dir, { active: true, gateCache: { commit: "PASS" }, version: 1, schemaVersion: 1 });
    const consent = join(dir, "state", "push-consent.json");
    writeFileSync(consent, JSON.stringify({ grantedAt: Date.now() - 600_000, expiresAt: Date.now() - 60_000, branch: "main" }));
    const h = createGateHandler(await deps(dir));
    const r = await h(bashEvent("git push origin main"));
    expect(r?.block).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// External execution consent consumption
// ---------------------------------------------------------------------------

describe("gateHandler — external execution consent", () => {
  let dir: string;
  beforeEach(() => { dir = makeTempDir(); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it("allows one consent-gated external session command, consumes it, then blocks the second identical command", async () => {
    writeState(dir, activeState(consent("all")));
    const d = await deps(dir);
    const h = createGateHandler(d);

    const first = await h(bashEvent("aws sts assume-role --role-arn x"));
    expect(first?.block ?? false).toBe(false);
    expect(d._logger.lines.some((l) => l.msg.includes("external execution ALLOWED"))).toBe(true);
    await expectStoredConsent(dir, undefined);

    const second = await h(bashEvent("aws sts assume-role --role-arn x"));
    expect(second?.block).toBe(true);
    expect(second?.reason).toMatch(/latest user message|direct external access command/i);
    expect(second?.reason).not.toMatch(/PI_OVEN_EXTERNAL_EXEC/i);
  });

  it("blocks when stored consent sourceMessageId changes before parent-session consume", async () => {
    writeState(dir, activeState(consent("all")));
    class RaceStore extends GateStateStore {
      private swapped = false;

      override async runExclusive<T>(fn: () => Promise<T>): Promise<T> {
        if (!this.swapped) {
          this.swapped = true;
          await this.writeState(activeState(consent("read", { sourceMessageId: "u2" })));
        }
        return super.runExclusive(fn);
      }
    }
    const d = await deps(dir);
    const h = createGateHandler({ ...d, store: new RaceStore(dir) });

    const result = await h(bashEvent("aws sts assume-role --role-arn x"));
    expect(result?.block).toBe(true);
    expect(result?.reason).toMatch(/sourceMessageId/i);
    expect(d._logger.lines.some((l) => l.msg.includes("external execution ALLOWED"))).toBe(false);
    expect(d._logger.lines.some((l) => l.msg.includes("external execution BLOCKED") && l.msg.includes("sourceMessageId"))).toBe(true);
    await expectStoredConsent(dir, consent("read", { sourceMessageId: "u2" }));
  });

  it("allows matching temporary AWS credential consent in non-parent sessions until expiry", async () => {
    const storedConsent = tempConsent("read");
    writeState(dir, activeState(storedConsent));
    const d = await deps(dir);
    const handler = createGateHandler({ ...d, isParentSession: false });

    const result = await handler(
      bashEvent(
        "AWS_ACCESS_KEY_ID=ASIAIOSFODNN7EXAMPLE AWS_SECRET_ACCESS_KEY=secret AWS_SESSION_TOKEN=session123 aws s3 ls"
      )
    );

    expect(result?.block ?? false).toBe(false);
    await expectStoredConsent(dir, storedConsent);
  });
  it("blocks external-read commands when temporary consent would fall back to ambient credentials", async () => {
    const storedConsent = tempConsent("read");
    writeState(dir, activeState(storedConsent));
    const d = await deps(dir);
    const handler = createGateHandler({ ...d, isParentSession: false });

    const result = await handler(bashEvent("aws s3 ls"));

    expect(result?.block).toBe(true);
    expect(result?.reason).toMatch(/exact same unexpired inline bundle|external-read/i);
    await expectStoredConsent(dir, storedConsent);
  });

  it("blocks external-read commands when access key + session token omit AWS_SECRET_ACCESS_KEY", async () => {
    const storedConsent = tempConsent("read", { secretAccessKeyFingerprint: undefined });
    writeState(dir, activeState(storedConsent));
    const d = await deps(dir);
    const handler = createGateHandler({ ...d, isParentSession: false });

    const result = await handler(
      bashEvent("AWS_ACCESS_KEY_ID=ASIAIOSFODNN7EXAMPLE AWS_SESSION_TOKEN=session123 aws s3 ls")
    );

    expect(result?.block).toBe(true);
    expect(result?.reason).toMatch(/exact same unexpired inline bundle|external-read|AWS_SECRET_ACCESS_KEY/i);
    await expectStoredConsent(dir, storedConsent);
  });


  it("allows external-session commands when the exact temporary bundle prefixes the same shell segment", async () => {
    const storedConsent = tempConsent("access");
    writeState(dir, activeState(storedConsent));
    const d = await deps(dir);
    const handler = createGateHandler({ ...d, isParentSession: false });

    const result = await handler(
      bashEvent(
        "AWS_ACCESS_KEY_ID=ASIAIOSFODNN7EXAMPLE AWS_SECRET_ACCESS_KEY=secret AWS_SESSION_TOKEN=session123 aws sts assume-role --role-arn x"
      )
    );

    expect(result?.block ?? false).toBe(false);
    await expectStoredConsent(dir, storedConsent);
  });

  it("blocks external-session commands when temporary consent would fall back to ambient credentials", async () => {
    const storedConsent = tempConsent("access");
    writeState(dir, activeState(storedConsent));
    const d = await deps(dir);
    const handler = createGateHandler({ ...d, isParentSession: false });

    const result = await handler(bashEvent("aws sts assume-role --role-arn x"));

    expect(result?.block).toBe(true);
    expect(result?.reason).toMatch(/exact same unexpired inline bundle|external-session/i);
    await expectStoredConsent(dir, storedConsent);
  });

  it("blocks external-session commands when access key + session token omit AWS_SECRET_ACCESS_KEY", async () => {
    const storedConsent = tempConsent("access", { secretAccessKeyFingerprint: undefined });
    writeState(dir, activeState(storedConsent));
    const d = await deps(dir);
    const handler = createGateHandler({ ...d, isParentSession: false });

    const result = await handler(
      bashEvent("AWS_ACCESS_KEY_ID=ASIAIOSFODNN7EXAMPLE AWS_SESSION_TOKEN=session123 aws sts assume-role --role-arn x")
    );

    expect(result?.block).toBe(true);
    expect(result?.reason).toMatch(/exact same unexpired inline bundle|external-session|AWS_SECRET_ACCESS_KEY/i);
    await expectStoredConsent(dir, storedConsent);
  });
  it("redacts inline-secret commands from audit logs on allowed temporary-credential commands", async () => {
    const storedConsent = tempConsent("read");
    writeState(dir, activeState(storedConsent));
    const d = await deps(dir);
    const handler = createGateHandler({ ...d, isParentSession: false });

    const result = await handler(
      bashEvent(
        "AWS_ACCESS_KEY_ID=ASIAIOSFODNN7EXAMPLE AWS_SECRET_ACCESS_KEY=secret AWS_SESSION_TOKEN=session123 aws s3 ls"
      )
    );

    expect(result?.block ?? false).toBe(false);
    const rendered = d._logger.lines.map((line) => line.msg).join("\n");
    expect(rendered).toContain("[redacted inline secret command]");
    expect(rendered).not.toContain("AWS_SECRET_ACCESS_KEY=secret");
    expect(rendered).not.toContain("AWS_SESSION_TOKEN=session123");
    expect(rendered).not.toContain("session123");
  });

  it("redacts non-AWS inline secrets from blocked audit logs", async () => {
    writeState(dir, activeState(consent("read")));
    const d = await deps(dir);
    const handler = createGateHandler({ ...d, isParentSession: false });

    const result = await handler(bashEvent("API_TOKEN=abc123 aws s3 ls"));

    expect(result?.block).toBe(true);
    const rendered = d._logger.lines.map((line) => line.msg).join("\n");
    expect(rendered).toContain("[redacted inline secret command]");
    expect(rendered).not.toContain("API_TOKEN=abc123");
    expect(rendered).not.toContain("abc123");
  });

  it("allows mutation commands that actually use the consented temporary bundle", async () => {
    const storedConsent = tempConsent("mutation");
    writeState(dir, activeState(storedConsent));
    const d = await deps(dir);
    const handler = createGateHandler({ ...d, isParentSession: false });

    const result = await handler(
      bashEvent(
        "AWS_ACCESS_KEY_ID=ASIAIOSFODNN7EXAMPLE AWS_SECRET_ACCESS_KEY=secret AWS_SESSION_TOKEN=session123 aws s3 cp ./artifact.tgz s3://example-bucket/artifact.tgz"
      )
    );

    expect(result?.block ?? false).toBe(false);
    await expectStoredConsent(dir, storedConsent);
  });

  it("blocks mutation commands when the temporary bundle appears only in an earlier shell segment", async () => {
    const storedConsent = tempConsent("mutation");
    writeState(dir, activeState(storedConsent));
    const d = await deps(dir);
    const handler = createGateHandler({ ...d, isParentSession: false });

    const result = await handler(
      bashEvent(
        "AWS_ACCESS_KEY_ID=ASIAIOSFODNN7EXAMPLE AWS_SECRET_ACCESS_KEY=secret AWS_SESSION_TOKEN=session123; aws s3 cp ./artifact.tgz s3://example-bucket/artifact.tgz"
      )
    );

    expect(result?.block).toBe(true);
    expect(result?.reason).toMatch(/external-mutation/i);
    await expectStoredConsent(dir, storedConsent);
  });

  it("blocks mutation commands when stored temporary consent omitted the secret access key fingerprint", async () => {
    const storedConsent = tempConsent("mutation", { secretAccessKeyFingerprint: undefined });
    writeState(dir, activeState(storedConsent));
    const d = await deps(dir);
    const handler = createGateHandler({ ...d, isParentSession: false });

    const result = await handler(
      bashEvent(
        "AWS_ACCESS_KEY_ID=ASIAIOSFODNN7EXAMPLE AWS_SECRET_ACCESS_KEY=secret AWS_SESSION_TOKEN=session123 aws s3 cp ./artifact.tgz s3://example-bucket/artifact.tgz"
      )
    );

    expect(result?.block).toBe(true);
    expect(result?.reason).toMatch(/aws_secret_access_key|temporary credential bundle|external-mutation/i);
    await expectStoredConsent(dir, storedConsent);
  });

  it("blocks mutation commands when the inline temporary credential bundle omits AWS_SECRET_ACCESS_KEY", async () => {
    const storedConsent = tempConsent("mutation");
    writeState(dir, activeState(storedConsent));
    const d = await deps(dir);
    const handler = createGateHandler({ ...d, isParentSession: false });

    const result = await handler(
      bashEvent(
        "AWS_ACCESS_KEY_ID=ASIAIOSFODNN7EXAMPLE AWS_SESSION_TOKEN=session123 aws s3 cp ./artifact.tgz s3://example-bucket/artifact.tgz"
      )
    );

    expect(result?.block).toBe(true);
    expect(result?.reason).toMatch(/aws_secret_access_key|temporary credential bundle|external-mutation/i);
    await expectStoredConsent(dir, storedConsent);
  });

  for (const testCase of [
    {
      name: "does not consume mismatched mutation consent for `aws s3 ls`",
      command: "aws s3 ls",
      storedConsent: consent("mutation"),
      reason: /external-read/i,
    },
    {
      name: "blocks deploy script when stored local mutation consent lacks temporary credentials",
      command: "./scripts/deploy.sh --region singapore --warp on",
      storedConsent: consent("mutation"),
      reason: /Local-credential consent cannot authorize mutation|external-mutation/i,
    },
    {
      name: "blocks deploy script when stored local all-scope consent lacks temporary credentials",
      command: "./scripts/deploy.sh --region singapore --warp on",
      storedConsent: consent("all"),
      reason: /Local-credential consent cannot authorize mutation|external-mutation/i,
    },
    {
      name: "blocks deploy script when stored temporary mutation consent does not use the consented temp bundle",
      command: "./scripts/deploy.sh --region singapore --warp on",
      storedConsent: tempConsent("mutation"),
      reason: /exact temporary credential bundle inline|external-mutation/i,
    },
    {
      name: "blocks deploy script when stored temporary all-scope consent does not use the consented temp bundle",
      command: "./scripts/deploy.sh --region singapore --warp on",
      storedConsent: tempConsent("all"),
      reason: /exact temporary credential bundle inline|external-mutation/i,
    },
    {
      name: "blocks chained external subcommands without consuming consent",
      command: "aws s3 ls && aws sts assume-role --role-arn x",
      storedConsent: consent("all"),
      reason: /split/i,
    },
    {
      name: "does not consume consent when an inline secret literal is blocked",
      command: "AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE aws s3 ls",
      storedConsent: consent("all"),
      reason: /inline secret/i,
    },
    {
      name: "blocks consent-gated external execution in non-parent sessions because they cannot consume consent",
      command: "aws sts assume-role --role-arn x",
      storedConsent: consent("all"),
      reason: undefined,
      isParentSession: false,
    },
  ] as const) {
    it(testCase.name, async () => {
      writeState(dir, activeState(testCase.storedConsent));
      const d = await deps(dir);
      const handler = createGateHandler(
        testCase.isParentSession === false ? { ...d, isParentSession: false } : d
      );

      const result = await handler(bashEvent(testCase.command));
      expect(result?.block).toBe(true);
      if (testCase.reason) expect(result?.reason).toMatch(testCase.reason);
      await expectStoredConsent(dir, testCase.storedConsent);
    });
  }
});

// ---------------------------------------------------------------------------
// WS5 — code-write branch-contract gate + skill-read tracking
// ---------------------------------------------------------------------------

describe("gateHandler — WS5 branch-contract and skill-read enforcement", () => {
  let dir: string;
  beforeEach(() => { dir = makeTempDir(); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it("blocks code-write until the branch-contract marker exists", async () => {
    writeState(dir, {
      active: true,
      gateCache: { commit: "PASS", regression: "PASS" },
      version: 1,
      schemaVersion: 1,
      requiredSkills: [],
      skillReads: [],
      requiredSkillsMessageId: "u1",
    });
    const h = createGateHandler(await deps(dir));
    const r = await h(writeEvent("src/example.ts"));
    expect(r?.block).toBe(true);
    expect(r?.reason).toMatch(/branch-contract\.json/i);
  });

  it("allows bootstrap write for the branch-contract marker path itself", async () => {
    writeState(dir, {
      active: true,
      gateCache: { commit: "PASS", regression: "PASS" },
      version: 1,
      schemaVersion: 1,
      requiredSkills: [],
      skillReads: [],
      requiredSkillsMessageId: "u1",
    });
    const h = createGateHandler(await deps(dir));
    const r = await h(writeEvent(".pi-oven/state/branch-contract.json"));
    expect(r?.block ?? false).toBe(false);
  });

  it("credits only exact plugin-owned skill proof targets before unblocking code-write", async () => {
    const ownedTarget = "/plugin/skills/autonomous-loop/SKILL.md";
    writeState(dir, {
      active: true,
      gateCache: { commit: "PASS", regression: "PASS" },
      version: 1,
      schemaVersion: 1,
      requiredSkills: ["autonomous-loop"],
      skillReads: [],
      requiredSkillsMessageId: "u1",
      ownedSkillReadTargets: [ownedTarget],
    });
    mkdirSync(join(dir, "state"), { recursive: true });
    writeFileSync(
      join(dir, "state", "branch-contract.json"),
      JSON.stringify({ destination: "worktree", branch: "feature/ws5", pr_mode: "draft" })
    );
    const h = createGateHandler(await deps(dir));

    const initiallyBlocked = await h(writeEvent("src/example.ts"));
    expect(initiallyBlocked?.block).toBe(true);
    expect(initiallyBlocked?.reason).toMatch(/capability proof/i);
    expect(initiallyBlocked?.reason).toContain(ownedTarget);

    const bareRead = await h(readEvent("skill://autonomous-loop"));
    expect(bareRead?.block ?? false).toBe(false);

    const stillBlockedAfterBare = await h(writeEvent("src/example.ts", "tc-write-bare"));
    expect(stillBlockedAfterBare?.block).toBe(true);
    expect(stillBlockedAfterBare?.reason).toContain(ownedTarget);

    const namespacedRead = await h(readEvent("skill://pi-oven:autonomous-loop"));
    expect(namespacedRead?.block ?? false).toBe(false);

    const stillBlockedAfterAlias = await h(writeEvent("src/example.ts", "tc-write-ns"));
    expect(stillBlockedAfterAlias?.block).toBe(true);
    expect(stillBlockedAfterAlias?.reason).toContain(ownedTarget);

    const readRes = await h(readEvent(ownedTarget));
    expect(readRes?.block ?? false).toBe(false);

    const allowed = await h(writeEvent("src/example.ts", "tc-write-2"));
    expect(allowed?.block ?? false).toBe(false);

    const after = await new GateStateStore(dir).readState();
    expect(after.kind).toBe("OK");
    if (after.kind !== "OK") return;
    expect(after.state.skillReads).toEqual([ownedTarget]);
  });

  it("blocks code-write with an explicit capability-proof diagnostic when a required skill has no owned proof target", async () => {
    writeState(dir, {
      active: true,
      gateCache: { commit: "PASS", regression: "PASS" },
      version: 1,
      schemaVersion: 1,
      requiredSkills: ["autonomous-loop"],
      skillReads: [],
      requiredSkillsMessageId: "u1",
      ownedSkillReadTargets: [],
    });
    mkdirSync(join(dir, "state"), { recursive: true });
    writeFileSync(
      join(dir, "state", "branch-contract.json"),
      JSON.stringify({ destination: "worktree", branch: "feature/ws5", pr_mode: "draft" })
    );
    const h = createGateHandler(await deps(dir));
    const blocked = await h(writeEvent("src/example.ts"));
    expect(blocked?.block).toBe(true);
    expect(blocked?.reason).toMatch(/capability proof/i);
    expect(blocked?.reason).toMatch(/requiredSkills/i);
    expect(blocked?.reason).toMatch(/ownedSkillReadTargets/i);
    expect(blocked?.reason).toMatch(/autonomous-loop/i);
  });

  it("initializes and preserves ownership state fields across exact skill-proof mutations", async () => {
    const store = new GateStateStore(dir);
    await store.mutate((current) => current);
    const initialized = await store.readState();
    expect(initialized.kind).toBe("OK");
    if (initialized.kind !== "OK") return;

    expect(initialized.state.ownershipTrace).toEqual([]);
    expect(initialized.state.explicitForeignAgents).toEqual([]);
    expect(initialized.state.ownedSkillReadTargets).toEqual([]);

    const ownedTarget = "/plugin/skills/autonomous-loop/SKILL.md";
    const ownershipTrace: OwnershipTraceEntry[] = [
      {
        origin: "pi-oven-auto",
        kind: "skill",
        requested: "autonomous-loop",
        canonical: ownedTarget,
        resolved: ownedTarget,
        status: "resolved",
        reason: "matched by pi-oven runtime keyword whitelist",
      },
    ];
    writeState(dir, {
      ...initialized.state,
      active: true,
      gateCache: { commit: "PASS", regression: "PASS" },
      version: 1,
      schemaVersion: 1,
      requiredSkills: ["autonomous-loop"],
      skillReads: [],
      requiredSkillsMessageId: "u1",
      ownershipTrace,
      explicitForeignAgents: ["kzk:explorer"],
      ownedSkillReadTargets: [ownedTarget],
    });
    mkdirSync(join(dir, "state"), { recursive: true });
    writeFileSync(
      join(dir, "state", "branch-contract.json"),
      JSON.stringify({ destination: "worktree", branch: "feature/ws5", pr_mode: "draft" })
    );

    const h = createGateHandler(await deps(dir));
    const readRes = await h(readEvent(ownedTarget));
    expect(readRes?.block ?? false).toBe(false);

    const after = await store.readState();
    expect(after.kind).toBe("OK");
    if (after.kind !== "OK") return;

    expect(after.state.skillReads).toEqual([ownedTarget]);
    expect(after.state.ownershipTrace).toEqual(ownershipTrace);
    expect(after.state.explicitForeignAgents).toEqual(["kzk:explorer"]);
    expect(after.state.ownedSkillReadTargets).toEqual([ownedTarget]);
  });

  it("ignores skill:// reads outside an active autonomous state", async () => {
    const h = createGateHandler(await deps(dir));
    const r = await h(readEvent("skill://autonomous-loop"));
    expect(r?.block ?? false).toBe(false);
    expect(existsSync(projectStatePath(dir, AUTONOMOUS_STATE_FILE))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AC2 — self-deadline + p95 budget (B1, B6)
// ---------------------------------------------------------------------------

describe("gateHandler — self-deadline + p95 (AC2)", () => {
  let dir: string;
  beforeEach(() => { dir = makeTempDir(); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it("(a) p95 of a warm-cache lookup is < 50ms over 1000 synthetic events", async () => {
    writeState(dir, { active: true, gateCache: { commit: "PASS" }, version: 1, schemaVersion: 1 });
    const h = createGateHandler(await deps(dir));
    await h(bashEvent("git status")); // warm the cache
    const samples: number[] = [];
    for (let i = 0; i < 1000; i++) {
      const t0 = performance.now();
      await h(bashEvent("git status", `tc${i}`));
      samples.push(performance.now() - t0);
    }
    samples.sort((a, b) => a - b);
    const p95 = samples[Math.floor(samples.length * 0.95)];
    expect(p95).toBeLessThan(50);
  });

  it("(b) a fault-injected slow path overruns the 1500ms self-deadline → handler THROWS (fail-CLOSED)", async () => {
    writeState(dir, { active: true, gateCache: { commit: "FAIL" }, version: 1, schemaVersion: 1 });
    const d = await deps(dir);
    // inject a store whose readState hangs forever
    const slowStore = {
      readState: () => new Promise(() => {}), // never resolves
      readFileConsent: async () => ({ valid: false }),
      consumeFileConsent: async () => {},
    } as unknown as GateStateStore;
    const h = createGateHandler({ ...d, store: slowStore, deadlineMs: 30 });
    let threw = false;
    try {
      await h(bashEvent("git commit -m x"));
    } catch {
      threw = true;
    }
    expect(threw).toBe(true); // omp converts the throw → {block:true} = fail-CLOSED
  });
});

// ---------------------------------------------------------------------------
// AC8b — nested task-subagent is gated (read-only) but does NOT mutate the FSM
// ---------------------------------------------------------------------------

describe("gateHandler — subagent read-only (AC8b)", () => {
  let dir: string;
  beforeEach(() => { dir = makeTempDir(); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it("a subagent-session handler does not write the FSM file", async () => {
    // subagent path: isParentSession = false
    const d = await deps(dir);
    const subHandler = createGateHandler({ ...d, isParentSession: false });
    // before: no state file
    expect(existsSync(join(dir, "state", "autonomous.json"))).toBe(false);
    await subHandler(bashEvent("git status"));
    await subHandler(taskEvent("pi-oven:executor"));
    // after: still no state file written by the subagent path
    expect(existsSync(join(dir, "state", "autonomous.json"))).toBe(false);
  });

  it("a subagent commit is STILL gated (read-only lookup honored)", async () => {
    writeState(dir, { active: true, gateCache: { commit: "FAIL" }, version: 1, schemaVersion: 1 });
    const d = await deps(dir);
    const subHandler = createGateHandler({ ...d, isParentSession: false });
    const r = await subHandler(bashEvent("git commit -m x"));
    expect(r?.block).toBe(true);
  });
});

// Task dispatch ownership guard:
// - canonicalize bare pi-oven-owned automatic roles to `pi-oven:<role>`
// - preserve exact allowlisted foreign namespaces as explicit user intent
// - block non-allowlisted foreign namespaces
// ---------------------------------------------------------------------------

describe("gateHandler — task dispatch ownership guard", () => {
  let dir: string;
  beforeEach(() => { dir = makeTempDir(); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it("canonicalizes bare built-in agent names to the pi-oven namespace and records the rewrite", async () => {
    const h = createGateHandler(await deps(dir));
    const event = taskEvent("executor");
    const r = await h(event);
    expect(r?.block ?? false).toBe(false);
    expect(event.input.agent).toBe("pi-oven:executor");

    const after = await new GateStateStore(dir).readState();
    expect(after.kind).toBe("OK");
    if (after.kind !== "OK") return;
    expect(after.state.ownershipTrace?.at(-1)).toEqual({
      origin: "pi-oven-auto",
      kind: "agent",
      requested: "executor",
      canonical: "pi-oven:executor",
      resolved: "pi-oven:executor",
      status: "rewritten",
      reason: "canonicalized bare agent dispatch to pi-oven namespace",
    });
  });

  it("allows task dispatch when agent already uses the pi-oven namespace", async () => {
    const h = createGateHandler(await deps(dir));
    const event = taskEvent("pi-oven:executor");
    const r = await h(event);
    expect(r?.block ?? false).toBe(false);
    expect(event.input.agent).toBe("pi-oven:executor");
  });

  it("preserves explicit foreign task dispatches from the allowlist and records explicit intent", async () => {
    writeState(dir, {
      active: false,
      gateCache: {},
      version: 1,
      schemaVersion: 1,
      ownershipTrace: [],
      explicitForeignAgents: ["kzk:explorer"],
      ownedSkillReadTargets: [],
      requiredSkills: [],
      skillReads: [],
      requiredSkillsMessageId: null,
    });
    const h = createGateHandler(await deps(dir));
    const event = taskEvent("kzk:explorer");
    const r = await h(event);
    expect(r?.block ?? false).toBe(false);
    expect(event.input.agent).toBe("kzk:explorer");

    const after = await new GateStateStore(dir).readState();
    expect(after.kind).toBe("OK");
    if (after.kind !== "OK") return;
    expect(after.state.ownershipTrace?.at(-1)).toEqual({
      origin: "user-explicit",
      kind: "agent",
      requested: "kzk:explorer",
      canonical: "kzk:explorer",
      resolved: "kzk:explorer",
      status: "resolved",
      reason: "preserved exact user-explicit foreign agent dispatch",
    });
  });

  it("blocks foreign task dispatch when the exact agent was not explicitly allowlisted", async () => {
    writeState(dir, {
      active: false,
      gateCache: {},
      version: 1,
      schemaVersion: 1,
      ownershipTrace: [],
      explicitForeignAgents: ["kzk:explorer"],
      ownedSkillReadTargets: [],
      requiredSkills: [],
      skillReads: [],
      requiredSkillsMessageId: null,
    });
    const h = createGateHandler(await deps(dir));
    const event = taskEvent("oh-my-claudecode:executor");
    const r = await h(event);
    expect(r?.block).toBe(true);
    expect(r?.reason).toMatch(/user-explicit|pi-oven:<role>|foreign namespace/i);

    const after = await new GateStateStore(dir).readState();
    expect(after.kind).toBe("OK");
    if (after.kind !== "OK") return;
    expect(after.state.ownershipTrace?.at(-1)).toEqual({
      origin: "foreign-auto",
      kind: "agent",
      requested: "oh-my-claudecode:executor",
      canonical: "oh-my-claudecode:executor",
      resolved: "oh-my-claudecode:executor",
      status: "blocked",
      reason: "foreign namespace requires exact user-explicit allowlist",
    });
  });
});

// ---------------------------------------------------------------------------
// AC9 — real-wrapper path (UNIT-SIMULATED: no omp runtime available here).
// We simulate runner.emitToolCall semantics: a thrown handler → {block:true};
// a returned {block:true,reason} surfaces the reason to the caller.
// ---------------------------------------------------------------------------

describe("gateHandler — simulated wrapper round-trip (AC9, unit-simulated)", () => {
  let dir: string;
  beforeEach(() => { dir = makeTempDir(); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  // Mirror of extensibility/extensions/runner.ts emitToolCall: await the
  // handler; on throw, fail-closed to {block:true}; else pass the result.
  async function emitToolCall(handler: (e: never) => Promise<unknown>, event: unknown): Promise<{ block: boolean; reason?: string }> {
    try {
      const res = (await handler(event as never)) as { block?: boolean; reason?: string } | void;
      return { block: res?.block ?? false, reason: res?.reason };
    } catch (err) {
      return { block: true, reason: `handler error (fail-closed): ${String(err)}` };
    }
  }

  it("a blocked commit surfaces the reason to the caller", async () => {
    writeState(dir, { active: true, gateCache: { commit: "FAIL" }, version: 1, schemaVersion: 1 });
    const h = createGateHandler(await deps(dir));
    const out = await emitToolCall(h as never, bashEvent("git commit -m x"));
    expect(out.block).toBe(true);
    expect(out.reason).toBeTruthy();
  });

  it("an allowed status passes through with block=false", async () => {
    writeState(dir, { active: true, gateCache: { commit: "PASS" }, version: 1, schemaVersion: 1 });
    const h = createGateHandler(await deps(dir));
    const out = await emitToolCall(h as never, bashEvent("git status"));
    expect(out.block).toBe(false);
  });

  it("a thrown self-deadline overrun becomes a fail-closed block at the wrapper", async () => {
    const d = await deps(dir);
    const slowStore = { readState: () => new Promise(() => {}), readFileConsent: async () => ({ valid: false }), consumeFileConsent: async () => {} } as unknown as GateStateStore;
    writeState(dir, { active: true, gateCache: { commit: "FAIL" }, version: 1, schemaVersion: 1 });
    const h = createGateHandler({ ...d, store: slowStore, deadlineMs: 25 });
    const out = await emitToolCall(h as never, bashEvent("git commit -m x"));
    expect(out.block).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// WS5 — Pure helper unit tests
// ---------------------------------------------------------------------------

describe("gateHandler — pure helpers", () => {
  it("isCodeWriteTool: 'write','edit','ast_edit' => true; 'read','bash' => false", () => {
    expect(isCodeWriteTool("write")).toBe(true);
    expect(isCodeWriteTool("edit")).toBe(true);
    expect(isCodeWriteTool("ast_edit")).toBe(true);
    expect(isCodeWriteTool("read")).toBe(false);
    expect(isCodeWriteTool("bash")).toBe(false);
    expect(isCodeWriteTool("task")).toBe(false);
  });

  it("getTargetPath: returns input.path when string; null otherwise", () => {
    expect(getTargetPath({ path: "/foo/bar" })).toBe("/foo/bar");
    expect(getTargetPath({ path: 123 } as any)).toBe(null);
    expect(getTargetPath({ notPath: "/foo" } as any)).toBe(null);
    expect(getTargetPath(undefined as any)).toBe(null);
  });

  it("getSkillReadName: identifies only namespaced pi-oven skill:// URIs on read", () => {
    expect(
      getSkillReadName({
        toolName: "read",
        input: { path: "skill://pi-oven:autonomous-loop" },
      } as any)
    ).toBe("autonomous-loop");
    expect(
      getSkillReadName({
        toolName: "read",
        input: { path: "skill://pi-oven:autonomous-loop/references/x.md" },
      } as any)
    ).toBe("autonomous-loop");
    expect(
      getSkillReadName({
        toolName: "read",
        input: { path: "skill://pi-oven:autonomous-loop:1-5" },
      } as any)
    ).toBe("autonomous-loop");
    expect(
      getSkillReadName({ toolName: "read", input: { path: "skill://autonomous-loop" } } as any)
    ).toBe(null);
    expect(
      getSkillReadName({
        toolName: "read",
        input: { path: "skill://superpowers:autonomous-loop" },
      } as any)
    ).toBe(null);
    expect(getSkillReadName({ toolName: "read", input: { path: "/etc/passwd" } } as any)).toBe(null);
    expect(
      getSkillReadName({
        toolName: "write",
        input: { path: "skill://pi-oven:autonomous-loop" },
      } as any)
    ).toBe(null);
    expect(getSkillReadName({ toolName: "read", input: { path: "skill://" } } as any)).toBe(null);
  });

  it("toGateFsmView: maps state views correctly", () => {
    // OK view
    const okRes = toGateFsmView({
      kind: "OK",
      state: { active: true, gateCache: { commit: "PASS" }, version: 1, schemaVersion: 1 } as any,
    });
    expect(okRes).toEqual({
      kind: "OK",
      state: { active: true, gateCache: { commit: "PASS" } },
    });

    // CORRUPT view
    expect(toGateFsmView({ kind: "CORRUPT" } as any)).toEqual({ kind: "CORRUPT" });

    // ABSENT view
    expect(toGateFsmView({ kind: "ABSENT" } as any)).toEqual({ kind: "ABSENT" });
  });
});

