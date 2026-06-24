import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { readFileSync, rmSync } from "fs";
import { join } from "path";
import {
  createInstalledTopologyFixture,
  writePluginSkillsManifest,
  writeShippedSkill,
} from "../../helpers/installed-topology";

mock.module("@oh-my-pi/pi-tui", () => ({
  Container: class {},
  Markdown: class {},
  Text: class {},
  SelectList: class {},
  wrapTextWithAnsi: (value: string) => value,
}));

const { default: piOvenPi } = await import("../../../.omp/extensions/pi-oven");
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
    expect(joined).toContain("skill://pi-oven:autonomous-loop");
    expect(joined).toContain("skill://pi-oven:large-task-delegation");
    expect(joined).toContain("skill://pi-oven:spec-and-review");
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
    expect(joined).toContain("skill://pi-oven:autonomous-loop");
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
      ownershipTrace?: Array<{
        origin: string;
        kind: string;
        requested: string;
        canonical: string;
        resolved: string;
        status: string;
        reason: string;
      }>;
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
        "skill://pi-oven:autonomous-loop",
        "skill://pi-oven:large-task-delegation",
        "skill://pi-oven:spec-and-review",
      ])
    );
    expect(persisted.ownershipTrace).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          origin: "pi-oven-auto",
          kind: "skill",
          requested: "autonomous-loop",
          canonical: "skill://pi-oven:autonomous-loop",
          resolved: "skill://pi-oven:autonomous-loop",
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
    expect(joined).toContain("skill://pi-oven:autonomous-loop");
  });
});
