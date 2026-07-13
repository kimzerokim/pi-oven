import { describe, expect, it } from "bun:test";
import path from "node:path";
import { OmpEvalEventAdapter } from "../../scripts/lib/omp-eval-event-adapter";

describe("OmpEvalEventAdapter", () => {
  it("accepts skill-read evidence only for configured plugin-owned manifest targets", () => {
    const ownedReadTarget = "/plugin/skills/autonomous-loop/SKILL.md";
    const adapter = new OmpEvalEventAdapter({
      now: () => 321,
      skillReadTargets: [
        { skill: "pov:autonomous-loop", ownedReadTarget },
      ],
    });

    adapter.adapt({
      type: "tool_execution_start",
      toolCallId: "decoy-read",
      toolName: "read",
      args: { path: "/tmp/decoy/skills/autonomous-loop/SKILL.md" },
    });
    expect(
      adapter.adapt({
        type: "tool_execution_end",
        toolCallId: "decoy-read",
        toolName: "read",
        result: {},
        isError: false,
      }),
    ).not.toContainEqual(expect.objectContaining({ type: "skill_activation" }));

    adapter.adapt({
      type: "tool_execution_start",
      toolCallId: "owned-read",
      toolName: "read",
      args: { path: ownedReadTarget },
    });
    expect(
      adapter.adapt({
        type: "tool_execution_end",
        toolCallId: "owned-read",
        toolName: "read",
        result: {},
        isError: false,
      }),
    ).toContainEqual({
      type: "skill_activation",
      skill: "pov:autonomous-loop",
      receipt: "read",
      at: 321,
    });
  });

  it("preserves direct tool args and correlates a successful completion by call id", () => {
    const adapter = new OmpEvalEventAdapter(() => 123);

    expect(
      adapter.adapt({
        type: "tool_execution_start",
        toolCallId: "call-1",
        toolName: "task",
        args: { agent: "pov:executor", tasks: [{ id: "a" }] },
      }),
    ).toEqual([
      {
        type: "tool_start",
        callId: "call-1",
        name: "task",
        args: { agent: "pov:executor", tasks: [{ id: "a" }] },
        at: 123,
      },
    ]);

    expect(
      adapter.adapt({
        type: "tool_execution_end",
        toolCallId: "call-1",
        toolName: "task",
        result: { content: [{ type: "text", text: "done" }] },
        isError: false,
      }),
    ).toEqual([
      {
        type: "tool_end",
        callId: "call-1",
        name: "task",
        outcome: "success",
        result: { content: [{ type: "text", text: "done" }] },
        at: 123,
      },
    ]);
  });

  it("captures assistant text, exact model receipt, and message usage delta", () => {
    const adapter = new OmpEvalEventAdapter(() => 456);
    expect(
      adapter.adapt({
        type: "message_end",
        message: {
          role: "assistant",
          provider: "openai-codex",
          model: "gpt-5.4",
          content: [
            { type: "thinking", thinking: "private" },
            { type: "text", text: "first" },
            { type: "text", text: " second" },
          ],
          usage: {
            input: 10,
            output: 4,
            cacheRead: 20,
            cacheWrite: 2,
            cost: { total: 0.25 },
          },
        },
      }),
    ).toEqual([
      {
        type: "assistant_end",
        text: "first second",
        usage: { input: 10, output: 4, cacheRead: 20, cacheWrite: 2, cost: 0.25 },
        model: { provider: "openai-codex", model: "gpt-5.4" },
        at: 456,
      },
    ]);
  });

  it("adds task subagent usage and emits exact read activation only after success", () => {
    const adapter = new OmpEvalEventAdapter({
      now: () => 789,
      skillReadTargets: [
        {
          skill: "pov:autonomous-loop",
          ownedReadTarget: "/repo/skills/autonomous-loop/SKILL.md",
        },
        {
          skill: "pov:tdd-strict",
          ownedReadTarget: path.resolve("skills/tdd-strict/SKILL.md"),
        },
      ],
    });
    adapter.adapt({
      type: "tool_execution_start",
      toolCallId: "read-1",
      toolName: "read",
      args: { path: "/repo/skills/autonomous-loop/SKILL.md" },
    });
    expect(
      adapter.adapt({
        type: "tool_execution_end",
        toolCallId: "read-1",
        toolName: "read",
        result: {},
        isError: false,
      }),
    ).toContainEqual({
      type: "skill_activation",
      skill: "pov:autonomous-loop",
      receipt: "read",
      at: 789,
    });

    adapter.adapt({
      type: "tool_execution_start",
      toolCallId: "read-relative",
      toolName: "read",
      args: { path: "skills/tdd-strict/SKILL.md" },
    });
    expect(
      adapter.adapt({
        type: "tool_execution_end",
        toolCallId: "read-relative",
        toolName: "read",
        result: {},
        isError: false,
      }),
    ).toContainEqual({
      type: "skill_activation",
      skill: "pov:tdd-strict",
      receipt: "read",
      at: 789,
    });

    expect(
      adapter.adapt({
        type: "tool_execution_end",
        toolCallId: "task-1",
        toolName: "task",
        result: {
          details: {
            usage: {
              input: 30,
              output: 9,
              cacheRead: 12,
              cacheWrite: 1,
              cost: { total: 0.75 },
            },
          },
        },
        isError: false,
      }),
    ).toContainEqual({
      type: "tool_end",
      name: "task",
      callId: "task-1",
      outcome: "success",
      result: {
        details: {
          usage: {
            input: 30,
            output: 9,
            cacheRead: 12,
            cacheWrite: 1,
            cost: { total: 0.75 },
          },
        },
      },
      usage: { input: 30, output: 9, cacheRead: 12, cacheWrite: 1, cost: 0.75 },
      at: 789,
    });
  });

  it("classifies structured and textual blocked/aborted tool outcomes", () => {
    const adapter = new OmpEvalEventAdapter(() => 99);
    expect(
      adapter.adapt({
        type: "tool_execution_end",
        toolCallId: "blocked-1",
        toolName: "bash",
        isError: true,
        result: { content: [{ type: "text", text: "Blocked by runtime policy" }] },
      })[0],
    ).toMatchObject({ outcome: "blocked" });
    expect(
      adapter.adapt({
        type: "tool_execution_end",
        toolCallId: "aborted-1",
        toolName: "bash",
        isError: true,
        result: { content: [{ type: "text", text: "Tool execution was aborted" }] },
      })[0],
    ).toMatchObject({ outcome: "aborted" });
  });

  it("preserves the final assistant stop reason on the agent terminal event", () => {
    const adapter = new OmpEvalEventAdapter(() => 100);
    expect(
      adapter.adapt({
        type: "agent_end",
        messages: [
          { role: "assistant", stopReason: "toolUse" },
          { role: "toolResult" },
          { role: "assistant", stopReason: "stop" },
        ],
      }),
    ).toEqual([{ type: "turn_end", stopReason: "stop", at: 100 }]);
  });
});
