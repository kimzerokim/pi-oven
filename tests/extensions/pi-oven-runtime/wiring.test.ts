import { describe, it, expect } from "bun:test";
import piOvenPi from "../../../.omp/extensions/pi-oven";

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

describe("piOvenPi entrypoint wiring (AC4)", () => {
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

  it("before_agent_start injects a must-read skill block when user keywords match shipped skills", async () => {
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
    expect(joined).toContain("skill://autonomous-loop");
    expect(joined).toContain("skill://large-task-delegation");
    expect(joined).toContain("skill://spec-and-review");
  });
});
