import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import {
  createInstalledTopologyFixture,
  writePluginSkillsManifest,
  writeShippedSkill,
} from "../../helpers/installed-topology";
import { SHIPPED_SKILL_NAMES, SHIPPED_SKILL_PATHS } from "../../../scripts/pi-oven-setup/shipped-skill-registry";
import {
  GateStateStore,
  fingerprintExternalExecSecret,
  type OwnershipTraceEntry,
} from "../../../.omp/extensions/pi-oven-runtime/gate-state";


const { default: piOvenPi } = await import("../../../.omp/extensions/pi-oven");

type ShippedSkillName = (typeof SHIPPED_SKILL_NAMES)[number];
type ShippedSkillPath = (typeof SHIPPED_SKILL_PATHS)[number];
// ---------------------------------------------------------------------------
// AC4 — no regression + correctness: the extension entrypoint still wires the
// baseline behaviors (validateAgentRegistry at load, session_start capture)
// AND registers the new Plan-3 runtime handlers (tool_call, before_agent_start,
// session.compacting, session_before_compact, turn_start, turn_end).
//
// We drive the entrypoint with a fake ExtensionAPI that records registrations.
// ---------------------------------------------------------------------------

interface FakePi {
  events: string[];
  handlers: Record<string, Function>;
  labels: string[];
  logs: { level: string; msg: string }[];
  sentMessages: Array<{ message: unknown; options: unknown }>;
  on(event: string, handler: Function): void;
  sendMessage(message: unknown, options?: unknown): void;
  setLabel(label: string): void;
  logger: { info: Function; warn: Function; error: Function; debug: Function };
}

function makeFakePi(): FakePi {
  const events: string[] = [];
  const handlers: Record<string, Function> = {};
  const labels: string[] = [];
  const logs: { level: string; msg: string }[] = [];
  const sentMessages: Array<{ message: unknown; options: unknown }> = [];
  return {
    events,
    handlers,
    labels,
    logs,
    sentMessages,
    on(event: string, handler: Function) {
      events.push(event);
      handlers[event] = handler;
    },
    sendMessage(message: unknown, options?: unknown) {
      sentMessages.push({ message, options });
    },
    setLabel(label: string) {
      labels.push(label);
    },
    logger: {
      info: (m: string) => logs.push({ level: "info", msg: String(m) }),
      warn: (m: string) => logs.push({ level: "warn", msg: String(m) }),
      error: (m: string) => logs.push({ level: "error", msg: String(m) }),
      debug: (m: string) => logs.push({ level: "debug", msg: String(m) }),
    },
  };
}

function makeTempDir(): string {
  return createInstalledTopologyFixture({ prefix: "pi-oven-wiring-" }).root;
}

function ownedSkillTarget(skillName: ShippedSkillName): string {
  const skillPath = `./skills/${skillName}/SKILL.md` as ShippedSkillPath;
  expect(SHIPPED_SKILL_PATHS).toContain(skillPath);
  return join(__dirname, "../../..", "skills", skillName, "SKILL.md");
}
type PersistedExternalExecConsent = {
  sourceMessageId: string;
  scope: "read" | "access" | "mutation" | "all";
  remainingUses: number;
  tempCredentials?: {
    provider: "aws";
    accessKeyId: string;
    sessionTokenFingerprint: string;
    secretAccessKeyFingerprint?: string;
    expiresAt: number;
  };
};

type PersistedAutonomousState = {
  requiredSkills?: string[];
  skillReads?: string[];
  explicitForeignAgents?: string[];
  ownershipTrace?: OwnershipTraceEntry[];
  externalExecConsent?: PersistedExternalExecConsent;
  gateCache?: { commit?: string; regression?: string };
  continuationMarker?: {
    kind: "autonomous-loop-resume" | "verifier-pending" | "lane-resume" | "halted-by-policy";
    trigger?: "explicit-continue" | "polite-stop";
    verifier?: string;
    lane?: string;
    policy?: string;
  };
  consumedExternalExecConsentMessageId?: string;
};

type UserBranchEntry = {
  id: string;
  type: "message";
  message: {
    role: "user";
    content: Array<{ type: "text"; text: string } | { type: "image"; source: string }>;
  };
};

function readAutonomousState(tempDir: string): PersistedAutonomousState {
  return JSON.parse(
    readFileSync(join(tempDir, ".pi-oven", "state", "autonomous.json"), "utf-8")
  ) as PersistedAutonomousState;
}

function consent(
  scope: PersistedExternalExecConsent["scope"],
  sourceMessageId = "u1"
): PersistedExternalExecConsent {
  return {
    sourceMessageId,
    scope,
    remainingUses: 1,
  };
}

const TEMP_CONSENT_EXPIRES_AT = 4_102_444_800_000;

function tempConsent(
  scope: PersistedExternalExecConsent["scope"],
  sourceMessageId = "u1",
  expiresAt = TEMP_CONSENT_EXPIRES_AT
): PersistedExternalExecConsent {
  return {
    sourceMessageId,
    scope,
    remainingUses: 1,
    tempCredentials: {
      provider: "aws",
      accessKeyId: "ASIAIOSFODNN7EXAMPLE",
      sessionTokenFingerprint: fingerprintExternalExecSecret("session123"),
      secretAccessKeyFingerprint: fingerprintExternalExecSecret("secret"),
      expiresAt,
    },
  };
}

function userMessage(
  id: string,
  content: UserBranchEntry["message"]["content"]
): UserBranchEntry {
  return {
    id,
    type: "message",
    message: {
      role: "user",
      content,
    },
  };
}

function userTextMessage(id: string, text: string): UserBranchEntry {
  return userMessage(id, [{ type: "text", text }]);
}

function createTurnStartRunner(tempDir: string) {
  process.chdir(tempDir);
  const pi = makeFakePi();
  piOvenPi(pi as never);
  const onTurnStart = pi.handlers["turn_start"];
  return async (branchEntries: UserBranchEntry[], turnIndex: number) => {
    const ctx = {
      sessionManager: {
        getBranch: () => branchEntries,
      },
    };
    await onTurnStart({ type: "turn_start", turnIndex, timestamp: Date.now() }, ctx);
    return readAutonomousState(tempDir);
  };
}


const ORIGINAL_CWD = process.cwd();

describe("piOvenPi entrypoint wiring (AC4)", () => {
  let tempDir: string | null = null;

  beforeEach(() => {
    tempDir = null;
    process.chdir(ORIGINAL_CWD);
  });

  afterEach(() => {
    process.chdir(ORIGINAL_CWD);
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  it("registers all Plan-3 runtime handlers plus the preserved session_start", () => {
    const pi = makeFakePi();
    piOvenPi(pi as never);
    expect(pi.events).toContain("tool_call");
    expect(pi.events).toContain("before_agent_start");
    expect(pi.events).toContain("session.compacting");
    expect(pi.events).toContain("session_before_compact");
    expect(pi.events).toContain("session_start"); // baseline preserved
    expect(pi.events).toContain("turn_start");
    expect(pi.events).toContain("turn_end");
  });

  it("still sets the pi-oven label and logs loaded (baseline preserved)", () => {
    const pi = makeFakePi();
    piOvenPi(pi as never);
    expect(pi.labels.some((l) => l.includes("pi-oven"))).toBe(true);
    expect(pi.logs.some((l) => l.msg.includes("pi-oven loaded"))).toBe(true);
  });

  it("before_agent_start handler injects the discipline block into systemPrompt", async () => {
    const pi = makeFakePi();
    piOvenPi(pi as never);
    const handler = pi.handlers["before_agent_start"];
    const res = (await handler({ type: "before_agent_start", prompt: "", systemPrompt: ["base"] })) as {
      systemPrompt: string[];
    };
    expect(res.systemPrompt.some((s) => s.includes("pi-oven:discipline-rules@v1"))).toBe(true);
    expect(res.systemPrompt).toContain("base");
  });

  it("session.compacting handler returns preserveData carrying the discipline key", async () => {
    const pi = makeFakePi();
    piOvenPi(pi as never);
    const handler = pi.handlers["session.compacting"];
    const res = (await handler({ type: "session.compacting", sessionId: "s", messages: [] })) as {
      preserveData: Record<string, unknown>;
    };
    expect(res.preserveData["pi-oven:discipline-rules@v1"]).toBeDefined();
  });

  it("tool_call handler is callable and allows a benign command (fail-open, no state file)", async () => {
    const pi = makeFakePi();
    piOvenPi(pi as never);
    const handler = pi.handlers["tool_call"];
    const res = (await handler({
      type: "tool_call",
      toolCallId: "x",
      toolName: "bash",
      input: { command: "ls -la" },
    })) as { block?: boolean } | void;
    expect(res?.block ?? false).toBe(false);
  });

  it("turn_end queues hidden continuation when autonomous polite-stop is detected", async () => {
    tempDir = makeTempDir();
    process.chdir(tempDir);
    const pi = makeFakePi();
    piOvenPi(pi as never);

    const onTurnStart = pi.handlers["turn_start"];
    const onTurnEnd = pi.handlers["turn_end"];

    const ctx = {
      sessionManager: {
        getBranch: () => [
          {
            id: "u1",
            type: "message",
            message: { role: "user", content: [{ type: "text", text: "자율 실행으로 계속 진행해줘" }] },
          },
        ],
      },
    };

    await onTurnStart({ type: "turn_start", turnIndex: 1, timestamp: Date.now() }, ctx);
    await onTurnEnd({
      type: "turn_end",
      turnIndex: 1,
      message: {
        role: "assistant",
        stopReason: "stop",
        content: [{ type: "text", text: "좋습니다. 다음 단계가 필요하면 알려주세요." }],
      },
      toolResults: [],
    });

    expect(pi.sentMessages.length).toBe(1);
    const queued = pi.sentMessages[0];
    expect((queued.message as { customType?: string }).customType).toBe("pi-oven-autonomous-stop-guard");
    expect((queued.options as { deliverAs?: string; triggerTurn?: boolean }).deliverAs).toBe("nextTurn");
    expect((queued.options as { deliverAs?: string; triggerTurn?: boolean }).triggerTurn).toBe(true);

    const persisted = readAutonomousState(tempDir);
    expect(persisted.continuationMarker).toEqual({
      kind: "autonomous-loop-resume",
      trigger: "explicit-continue",
    });
    expect(persisted.gateCache).toEqual({});
  });

  it("turn_start preserves a persisted continuation marker across a fresh runtime resume", async () => {
    tempDir = makeTempDir();
    process.chdir(tempDir);

    const firstPi = makeFakePi();
    piOvenPi(firstPi as never);

    const branchEntries = [userTextMessage("u1", "자율 실행으로 계속 진행해줘")];
    const ctx = {
      sessionManager: {
        getBranch: () => branchEntries,
      },
    };

    await firstPi.handlers["turn_start"]({ type: "turn_start", turnIndex: 1, timestamp: Date.now() }, ctx);
    await firstPi.handlers["turn_end"]({
      type: "turn_end",
      turnIndex: 1,
      message: {
        role: "assistant",
        stopReason: "stop",
        content: [{ type: "text", text: "좋습니다. 다음 단계가 필요하면 알려주세요." }],
      },
      toolResults: [],
    });

    expect(readAutonomousState(tempDir).continuationMarker).toEqual({
      kind: "autonomous-loop-resume",
      trigger: "explicit-continue",
    });

    const resumedPi = makeFakePi();
    piOvenPi(resumedPi as never);
    await resumedPi.handlers["turn_start"](
      { type: "turn_start", turnIndex: 2, timestamp: Date.now() },
      ctx
    );

    expect(readAutonomousState(tempDir).continuationMarker).toEqual({
      kind: "autonomous-loop-resume",
      trigger: "explicit-continue",
    });
  });

  it("before_agent_start loads shipped skills from pluginRoot even when cwd is a separate project root", async () => {
    tempDir = makeTempDir();
    process.chdir(tempDir);

    const pi = makeFakePi();
    piOvenPi(pi as never);

    const onTurnStart = pi.handlers["turn_start"];
    const onBeforeAgentStart = pi.handlers["before_agent_start"];

    const ctx = {
      sessionManager: {
        getBranch: () => [
          {
            id: "u1",
            type: "message",
            message: {
              role: "user",
              content: [{ type: "text", text: "자율 실행으로 큰 작업 진행해줘. spec 잡자 first." }],
            },
          },
        ],
      },
    };

    await onTurnStart({ type: "turn_start", turnIndex: 1, timestamp: Date.now() }, ctx);
    const res = (await onBeforeAgentStart({
      type: "before_agent_start",
      prompt: "",
      systemPrompt: ["base"],
    })) as { systemPrompt: string[] };

    expect(res.systemPrompt.some((s) => s.includes("pi-oven:keyword-skills@v1"))).toBe(true);
    const joined = res.systemPrompt.join("\n");
    expect(joined).toContain(ownedSkillTarget("autonomous-loop"));
    expect(joined).toContain(ownedSkillTarget("large-task-delegation"));
    expect(joined).toContain(ownedSkillTarget("spec-and-review"));
    expect(joined).toContain("single front door");
    expect(joined).toContain("requiredSkills");
    expect(joined).toContain("ownedSkillReadTargets");
    expect(joined).toContain("skillReads");
    expect(joined).toContain("Bootstrap message injection");
    expect(joined).toContain("tool remap");
  });

  it("session_start surfaces a keyword-integrity warning when plugin assets reference a missing shipped skill file", async () => {
    tempDir = makeTempDir();
    writePluginSkillsManifest(tempDir, ["./skills/missing-skill/SKILL.md"]);

    const pluginRoot = tempDir;
    const projectRoot = join(tempDir, "separate-project");
    process.chdir(projectRoot);
    const expectedProjectRoot = process.cwd();

    const pi = makeFakePi();
    piOvenPi(pi as never, { pluginRoot });

    const onSessionStart = pi.handlers["session_start"];
    const notices: Array<{ message: string; level: string }> = [];
    await onSessionStart(
      { type: "session_start" },
      {
        hasUI: true,
        ui: {
          notify(message: string, level: string) {
            notices.push({ message, level });
          },
        },
      }
    );

    const integrity = notices.find((notice) =>
      notice.message.includes("Standalone truth surface:") &&
      notice.message.includes("[WARN] keyword-skill integrity:")
    );
    expect(integrity).toBeDefined();
    expect(integrity?.message).toContain("missing-skill");
    expect(integrity?.message).toContain(`project state read from ${expectedProjectRoot}`);
    expect(integrity?.message).toContain("Runtime keyword-matched skills are unavailable");
  });

  it("session_start surfaces keyword-skill integrity when plugin manifest yields zero shipped skills", async () => {
    tempDir = makeTempDir();
    writePluginSkillsManifest(tempDir, []);

    const pluginRoot = tempDir;
    const projectRoot = join(tempDir, "separate-project");
    process.chdir(projectRoot);
    const expectedProjectRoot = process.cwd();

    const pi = makeFakePi();
    piOvenPi(pi as never, { pluginRoot });

    const onSessionStart = pi.handlers["session_start"];
    const notices: Array<{ message: string; level: string }> = [];
    await onSessionStart(
      { type: "session_start" },
      {
        hasUI: true,
        ui: {
          notify(message: string, level: string) {
            notices.push({ message, level });
          },
        },
      }
    );

    const integrity = notices.find((notice) =>
      notice.message.includes("[WARN] keyword-skill integrity:")
    );
    expect(integrity).toBeDefined();
    expect(integrity?.message).toContain(`project state read from ${expectedProjectRoot}`);
    expect(integrity?.message).toContain("did not yield any shipped skills");
    expect(integrity?.message).toContain("Runtime keyword-matched skills are unavailable");
  });
  it("before_agent_start injects keyword-skill integrity when plugin manifest yields zero shipped skills", async () => {
    tempDir = makeTempDir();
    writePluginSkillsManifest(tempDir, []);

    const pluginRoot = tempDir;
    const projectRoot = join(tempDir, "separate-project");
    process.chdir(projectRoot);
    const expectedProjectRoot = process.cwd();

    const pi = makeFakePi();
    piOvenPi(pi as never, { pluginRoot });

    const onBeforeAgentStart = pi.handlers["before_agent_start"];
    const res = (await onBeforeAgentStart({
      type: "before_agent_start",
      prompt: "",
      systemPrompt: ["base"],
    })) as { systemPrompt: string[] };
    const joined = res.systemPrompt.join("\n");

    expect(joined).toContain("Standalone truth surface:");
    expect(joined).toContain("[WARN] keyword-skill integrity:");
    expect(joined).toContain(`project state read from ${expectedProjectRoot}`);
    expect(joined).toContain("did not yield any shipped skills");
    expect(joined).toContain("Runtime keyword-matched skills are unavailable");
  });

  it("session_start surfaces a keyword-integrity warning when some shipped skills are skipped", async () => {
    tempDir = makeTempDir();
    writePluginSkillsManifest(tempDir, [
      "./skills/brainstorming/SKILL.md",
      "./skills/keyword-gap/SKILL.md",
    ]);
    writeShippedSkill(tempDir, "brainstorming");
    writeShippedSkill(tempDir, "keyword-gap");

    const projectRoot = join(tempDir, "separate-project");
    process.chdir(projectRoot);
    const expectedProjectRoot = process.cwd();

    const pi = makeFakePi();
    piOvenPi(pi as never, { pluginRoot: tempDir });

    const onSessionStart = pi.handlers["session_start"];
    const notices: Array<{ message: string; level: string }> = [];
    await onSessionStart(
      { type: "session_start" },
      {
        hasUI: true,
        ui: {
          notify(message: string, level: string) {
            notices.push({ message, level });
          },
        },
      }
    );

    const integrity = notices.find((notice) =>
      notice.message.includes("[WARN] keyword-skill integrity:")
    );
    expect(integrity).toBeDefined();
    expect(integrity?.message).toContain("keyword-gap");
    expect(integrity?.message).toContain(`project state read from ${expectedProjectRoot}`);
    expect(integrity?.message).toContain("loaded 1/2 shipped skills");
    expect(integrity?.message).toContain("partially available");
    expect(pi.logs.some((entry) => entry.level === "warn" && entry.msg.includes("keyword-skill integrity"))).toBe(true);
  });

  it("before_agent_start injects the same keyword-integrity warning into systemPrompt when plugin assets are broken", async () => {
    tempDir = makeTempDir();
    writePluginSkillsManifest(tempDir, ["./skills/autonomous-loop/SKILL.md"]);
    const pluginRoot = tempDir;
    const projectRoot = join(tempDir, "separate-project");
    process.chdir(projectRoot);
    const expectedProjectRoot = process.cwd();

    const pi = makeFakePi();
    piOvenPi(pi as never, { pluginRoot });

    const onBeforeAgentStart = pi.handlers["before_agent_start"];
    const res = (await onBeforeAgentStart({
      type: "before_agent_start",
      prompt: "",
      systemPrompt: ["base"],
    })) as { systemPrompt: string[] };
    const joined = res.systemPrompt.join("\n");

    expect(joined).toContain("Standalone truth surface:");
    expect(joined).toContain("[WARN] keyword-skill integrity:");
    expect(joined).toContain(`project state read from ${expectedProjectRoot}`);
    expect(joined).toContain("machine-global config remains ~/.omp/agent/config.yml");
    expect(joined).toContain("Runtime keyword-matched skills are unavailable");
    expect(joined).toContain("autonomous-loop");
  });


  it("before_agent_start can inject first-turn autonomous reminders before turn_start persists state", async () => {
    tempDir = makeTempDir();
    process.chdir(tempDir);

    const pi = makeFakePi();
    piOvenPi(pi as never);

    const onBeforeAgentStart = pi.handlers["before_agent_start"];
    const res = (await onBeforeAgentStart({
      type: "before_agent_start",
      prompt: "자율 실행으로 큰 작업 진행해줘. spec 잡자 first.",
      systemPrompt: ["base"],
    })) as { systemPrompt: string[] };
    const joined = res.systemPrompt.join("\n");
    expect(joined).toContain("Current autonomous reminder:");
    expect(joined).toContain(".pi-oven/state/branch-contract.json");
    expect(joined).toContain(ownedSkillTarget("autonomous-loop"));
  });

  it("turn_start syncs autonomous ownership state into the gate store", async () => {
    tempDir = makeTempDir();
    process.chdir(tempDir);

    const pi = makeFakePi();
    piOvenPi(pi as never);

    const onTurnStart = pi.handlers["turn_start"];
    const ctx = {
      sessionManager: {
        getBranch: () => [
          {
            id: "u1",
            type: "message",
            message: {
              role: "user",
              content: [
                {
                  type: "text",
                  text: "자율 실행으로 큰 작업 진행해줘. kzk:explorer는 유지하고 spec 잡자 first.",
                },
              ],
            },
          },
        ],
      },
    };

    await onTurnStart({ type: "turn_start", turnIndex: 1, timestamp: Date.now() }, ctx);
    const persisted = JSON.parse(
      readFileSync(join(tempDir, ".pi-oven", "state", "autonomous.json"), "utf-8")
    ) as {
      active: boolean;
      requiredSkills?: string[];
      skillReads?: string[];
      explicitForeignAgents?: string[];
      ownedSkillReadTargets?: string[];
      ownershipTrace?: OwnershipTraceEntry[];
    };
    expect(persisted.active).toBe(true);
    expect(persisted.requiredSkills).toHaveLength(3);
    expect(persisted.requiredSkills).toEqual(
      expect.arrayContaining([
        "autonomous-loop",
        "large-task-delegation",
        "spec-and-review",
      ])
    );
    expect(persisted.skillReads).toEqual([]);
    expect(persisted.explicitForeignAgents).toEqual(["kzk:explorer"]);
    expect(persisted.ownedSkillReadTargets).toEqual(
      expect.arrayContaining([
        ownedSkillTarget("autonomous-loop"),
        ownedSkillTarget("large-task-delegation"),
        ownedSkillTarget("spec-and-review"),
      ])
    );
    expect(persisted.ownershipTrace).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          origin: "pi-oven-auto",
          kind: "skill",
          requested: "autonomous-loop",
          canonical: ownedSkillTarget("autonomous-loop"),
          resolved: ownedSkillTarget("autonomous-loop"),
          status: "resolved",
        }),
      ])
    );
    const onBeforeAgentStart = pi.handlers["before_agent_start"];
    const res = (await onBeforeAgentStart({
      type: "before_agent_start",
      prompt: "",
      systemPrompt: ["base"],
    })) as { systemPrompt: string[] };
    const joined = res.systemPrompt.join("\n");
    expect(joined).toContain("Current autonomous reminder:");
    expect(joined).toContain(".pi-oven/state/branch-contract.json");
    expect(joined).toContain(ownedSkillTarget("autonomous-loop"));
  });

  it("before_agent_start injects native deep-interview resume guidance from persisted state", async () => {
    tempDir = makeTempDir();
    process.chdir(tempDir);

    const pi = makeFakePi();
    piOvenPi(pi as never);

    const store = new GateStateStore(join(tempDir, ".pi-oven"));
    const seededState = Object.assign(
      {
        active: false,
        gateCache: {},
        version: 1,
        schemaVersion: 1,
        requiredSkills: ["spec-and-review"],
        skillReads: [],
        requiredSkillsMessageId: "u1",
      },
      {
        deepInterview: {
          version: 1,
          active: true,
          interviewId: "di-1",
          phase: "approval_pending",
          rounds: [],
          approvalHandoff: {
            decisionKey: "approve-option-c",
            summary: "Implement Option C after approval",
            status: "pending",
            requestedAt: "2026-07-05T00:00:00.000Z",
          },
          lastUpdatedAt: "2026-07-05T00:00:00.000Z",
        },
      }
    );
    await store.writeState(seededState);

    const onBeforeAgentStart = pi.handlers["before_agent_start"];
    const res = (await onBeforeAgentStart({
      type: "before_agent_start",
      prompt: "let's write a design doc",
      systemPrompt: ["base"],
    })) as { systemPrompt: string[] };
    const joined = res.systemPrompt.join("\n");

    expect(joined).toContain("pi-oven:deep-interview-contract@v1");
    expect(joined).toContain("pi-oven_ask");
    expect(joined).toContain("approve-option-c");
    expect(joined).toContain("Implement Option C after approval");
  });
  for (const testCase of [
    {
      name: "turn_start persists natural-language local external execution consent with scope access",
      entry: userTextMessage(
        "u1",
        "You may use my local credentials for one direct external access command."
      ),
      expected: consent("access"),
    },
    {
      name: "turn_start persists natural-language temporary AWS external execution consent from a full inline bundle",
      entry: userTextMessage(
        "u2",
        `You may run direct external mutation commands using this temporary AWS credential bundle until it expires: AWS_ACCESS_KEY_ID=ASIAIOSFODNN7EXAMPLE AWS_SECRET_ACCESS_KEY=secret AWS_SESSION_TOKEN=session123 expiresAt=${TEMP_CONSENT_EXPIRES_AT}`
      ),
      expected: tempConsent("mutation", "u2"),
    },
  ] as const) {
    it(testCase.name, async () => {
      tempDir = makeTempDir();
      const runTurnStart = createTurnStartRunner(tempDir);
      const persisted = await runTurnStart([testCase.entry], 1);
      expect(persisted.externalExecConsent).toEqual(testCase.expected);
    });
  }

  it("turn_start rejects vague approval phrases, unsupported local scopes, scope-free local direct-exec phrasing, and negated consent wording", async () => {
    tempDir = makeTempDir();
    const runTurnStart = createTurnStartRunner(tempDir);

    for (const entry of [
      userTextMessage("u3", "You may use my local credentials for all direct external commands."),
      userTextMessage("u4", "You may use my local credentials for one direct external mutation command."),
      userTextMessage("u5", "use my local credentials and execute the external command directly"),
      userTextMessage("u6", "go ahead\ncontinue\njust do it"),
      userTextMessage("u7", "Please don't use my local credentials for one direct external access command."),
      userTextMessage("u8", "Please do not use my local credentials for one direct external access command."),
      userTextMessage(
        "u9",
        `You can never run direct external mutation commands using this temporary AWS credential bundle until it expires: AWS_ACCESS_KEY_ID=ASIAIOSFODNN7EXAMPLE AWS_SECRET_ACCESS_KEY=secret AWS_SESSION_TOKEN=session123 expiresAt=${TEMP_CONSENT_EXPIRES_AT}`
      ),
      userTextMessage("u10", "Please issue no direct external access commands using my local credentials."),
      userTextMessage("u11", "직접 실행해도 돼, 그런데 외부 접근 명령에 로컬 자격증명은 사용하지 마."),
    ]) {
      const persisted = await runTurnStart([entry], 1);
      expect(persisted.externalExecConsent).toBeUndefined();
    }
  });

  it("turn_start clears prior external execution consent on a later user message without consent while preserving ownership state behavior", async () => {
    tempDir = makeTempDir();
    const runTurnStart = createTurnStartRunner(tempDir);
    let branchEntries = [
      userTextMessage(
        "u1",
        [
          "자율 실행으로 큰 작업 진행해줘. kzk:explorer는 유지하고 spec 잡자 first.",
          "You may use my local credentials for one direct external access command.",
        ].join("\n")
      ),
    ];

    await runTurnStart(branchEntries, 1);
    branchEntries = [
      userTextMessage(
        "u2",
        "자율 실행으로 큰 작업 계속 진행해줘. kzk:explorer는 유지하고 spec 잡자 first."
      ),
    ];

    const persisted = await runTurnStart(branchEntries, 2);
    expect(persisted.externalExecConsent).toBeUndefined();
    expect(persisted.requiredSkills).toEqual(
      expect.arrayContaining([
        "autonomous-loop",
        "large-task-delegation",
        "spec-and-review",
      ])
    );
    expect(persisted.skillReads).toEqual([]);
    expect(persisted.explicitForeignAgents).toEqual(["kzk:explorer"]);
    expect(persisted.ownershipTrace).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          origin: "pi-oven-auto",
          kind: "skill",
          requested: "autonomous-loop",
          status: "resolved",
        }),
      ])
    );
  });
  it("turn_start does not resurrect consumed consent while the same latest user message remains current", async () => {
    tempDir = makeTempDir();
    const runTurnStart = createTurnStartRunner(tempDir);

    await runTurnStart(
      [userTextMessage("u1", "You may use my local credentials for one direct external access command.")],
      1
    );
    const store = new GateStateStore(join(tempDir, ".pi-oven"));
    expect(await store.consumeExternalExecConsent("u1")).toBe("consumed");

    const persisted = await runTurnStart(
      [userTextMessage("u1", "You may use my local credentials for one direct external access command.")],
      2
    );

    expect(persisted.externalExecConsent).toBeUndefined();
    expect(persisted.consumedExternalExecConsentMessageId).toBe("u1");
  });
  it("turn_start grants a fresh consent use when a new latest user message carries consent", async () => {
    tempDir = makeTempDir();
    const runTurnStart = createTurnStartRunner(tempDir);
    let branchEntries = [
      userTextMessage("u1", "You may use my local credentials for one direct external access command."),
    ];

    await runTurnStart(branchEntries, 1);
    const store = new GateStateStore(join(tempDir, ".pi-oven"));
    expect(await store.consumeExternalExecConsent("u1")).toBe("consumed");
    branchEntries = [
      userTextMessage("u2", "You may use my local credentials for one direct external read command."),
    ];

    const persisted = await runTurnStart(branchEntries, 2);

    expect(persisted.externalExecConsent).toEqual(consent("read", "u2"));
    expect(persisted.consumedExternalExecConsentMessageId).toBeUndefined();
  });
  it("turn_start clears prior external execution consent when the latest user message is attachment-only", async () => {
    tempDir = makeTempDir();
    const runTurnStart = createTurnStartRunner(tempDir);
    let branchEntries = [
      userTextMessage(
        "u1",
        "You may use my local credentials for one direct external access command.\nkzk:explorer"
      ),
    ];

    await runTurnStart(branchEntries, 1);
    branchEntries = [
      ...branchEntries,
      userMessage("u2", [{ type: "image", source: "attachment://1" }]),
    ];

    const persisted = await runTurnStart(branchEntries, 2);
    expect(persisted.externalExecConsent).toBeUndefined();
    expect(persisted.explicitForeignAgents).toEqual(["kzk:explorer"]);
  });
  it("turn_end queues a verifier-pending continuation after an autonomous runtime-contract edit", async () => {
    tempDir = makeTempDir();
    process.chdir(tempDir);
    const pi = makeFakePi();
    piOvenPi(pi as never);

    const onTurnStart = pi.handlers["turn_start"];
    const onToolCall = pi.handlers["tool_call"];
    const onTurnEnd = pi.handlers["turn_end"];
    const ctx = {
      sessionManager: {
        getBranch: () => [userTextMessage("u1", "autopilot")],
      },
    };

    await onTurnStart({ type: "turn_start", turnIndex: 1, timestamp: Date.now() }, ctx);
    mkdirSync(join(tempDir, ".pi-oven", "state"), { recursive: true });
    writeFileSync(
      join(tempDir, ".pi-oven", "state", "branch-contract.json"),
      JSON.stringify({ destination: "worktree", branch: "feature/task7", pr_mode: "direct" })
    );

    const skillReadResult = (await onToolCall({
      type: "tool_call",
      toolCallId: "tc-skill-proof",
      toolName: "read",
      input: { path: ownedSkillTarget("autonomous-loop") },
    })) as { block?: boolean } | void;
    expect(skillReadResult?.block ?? false).toBe(false);

    const writeResult = (await onToolCall({
      type: "tool_call",
      toolCallId: "tc-runtime-write",
      toolName: "write",
      input: { path: ".omp/extensions/pi-oven-runtime/gate.ts", content: "// trace" },
    })) as { block?: boolean; reason?: string } | void;
    expect(writeResult?.block ?? false).toBe(false);

    await onTurnEnd({
      type: "turn_end",
      message: {
        stopReason: "stop",
        content: [{ type: "text", text: "All requested deliverables are complete." }],
      },
    });

    expect(pi.sentMessages).toHaveLength(1);
    const queued = pi.sentMessages[0];
    expect(queued).toBeDefined();
    if (!queued) throw new Error("expected queued stop-guard continuation");
    const queuedMessage = queued.message;
    if (!queuedMessage || typeof queuedMessage !== "object") {
      throw new Error("expected structured stop-guard message");
    }
    expect("details" in queuedMessage && queuedMessage.details).toEqual(
      expect.objectContaining({ reason: "verifier-pending" })
    );
    if (!("content" in queuedMessage) || !Array.isArray(queuedMessage.content)) {
      throw new Error("expected stop-guard content array");
    }
    expect(queuedMessage.content[0]).toEqual(
      expect.objectContaining({
        text: expect.stringContaining("Run the deep verifier lane before exit."),
      })
    );

    const persisted = readAutonomousState(tempDir);
    expect(persisted.continuationMarker).toEqual({
      kind: "verifier-pending",
      verifier: "pi-oven:verifier/deep",
    });
  });
  it("keeps mixed registries observable across turn resyncs while automatic task dispatch stays pi-oven-owned", async () => {
    tempDir = makeTempDir();
    process.chdir(tempDir);

    const pi = makeFakePi();
    piOvenPi(pi as never);

    const onTurnStart = pi.handlers["turn_start"];
    const onToolCall = pi.handlers["tool_call"];
    const ctx = {
      sessionManager: {
        getBranch: () => [
          {
            id: "u1",
            type: "message",
            message: {
              role: "user",
              content: [
                {
                  type: "text",
                  text: "자율 실행으로 큰 작업 진행해줘. kzk:explorer는 유지하고 spec 잡자 first.",
                },
              ],
            },
          },
        ],
      },
    };

    await onTurnStart({ type: "turn_start", turnIndex: 1, timestamp: Date.now() }, ctx);

    const bareTaskEvent = {
      type: "tool_call",
      toolCallId: "t1",
      toolName: "task",
      input: { agent: "explorer" },
    };
    const bareResult = (await onToolCall(bareTaskEvent)) as { block?: boolean } | void;
    expect(bareResult?.block ?? false).toBe(false);
    expect(bareTaskEvent.input.agent).toBe("pi-oven:explorer");

    const foreignTaskEvent = {
      type: "tool_call",
      toolCallId: "t2",
      toolName: "task",
      input: { agent: "kzk:explorer" },
    };
    const foreignResult = (await onToolCall(foreignTaskEvent)) as { block?: boolean } | void;
    expect(foreignResult?.block ?? false).toBe(false);
    expect(foreignTaskEvent.input.agent).toBe("kzk:explorer");

    await onTurnStart({ type: "turn_start", turnIndex: 2, timestamp: Date.now() }, ctx);

    const persisted = JSON.parse(
      readFileSync(join(tempDir, ".pi-oven", "state", "autonomous.json"), "utf-8")
    ) as {
      explicitForeignAgents?: string[];
      ownershipTrace?: OwnershipTraceEntry[];
    };

    expect(persisted.explicitForeignAgents).toEqual(["kzk:explorer"]);
    expect(persisted.ownershipTrace).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          origin: "pi-oven-auto",
          kind: "skill",
          requested: "autonomous-loop",
          canonical: ownedSkillTarget("autonomous-loop"),
          resolved: ownedSkillTarget("autonomous-loop"),
          status: "resolved",
          reason: expect.any(String),
        }),
        {
          origin: "pi-oven-auto",
          kind: "agent",
          requested: "explorer",
          canonical: "pi-oven:explorer",
          resolved: "pi-oven:explorer",
          status: "rewritten",
          reason: "canonicalized bare agent dispatch to pi-oven namespace",
        },
        {
          origin: "user-explicit",
          kind: "agent",
          requested: "kzk:explorer",
          canonical: "kzk:explorer",
          resolved: "kzk:explorer",
          status: "resolved",
          reason: "preserved exact user-explicit foreign agent dispatch",
        },
      ])
    );
  });
});
