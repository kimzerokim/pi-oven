#!/usr/bin/env bun
import { parseScenario, runScenario, type SessionLike, type RunnerEvent } from "./lib/eval-runner";
import { createAgentSession, ModelRegistry, SessionManager, discoverAuthStorage } from "@oh-my-pi/pi-coding-agent";
import * as fs from "node:fs/promises";
import * as path from "node:path";

interface Args {
  skill?: string;
  scenario?: string;
  tag?: string;
  outFile?: string;
  model?: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--skill") args.skill = argv[++i];
    else if (a === "--scenario") args.scenario = argv[++i];
    else if (a === "--tag") args.tag = argv[++i];
    else if (a === "--out") args.outFile = argv[++i];
    else if (a === "--model") args.model = argv[++i];
  }
  return args;
}

async function listScenarios(rootDir: string, args: Args): Promise<string[]> {
  const evalsDir = path.join(rootDir, "evals");
  const skillDirs = args.skill
    ? [path.join(evalsDir, args.skill)]
    : (await fs.readdir(evalsDir)).map((d) => path.join(evalsDir, d));
  const out: string[] = [];
  for (const dir of skillDirs) {
    const scenDir = path.join(dir, "scenarios");
    try {
      const files = await fs.readdir(scenDir);
      for (const f of files) {
        if (!f.endsWith(".yaml")) continue;
        if (args.scenario && !f.includes(args.scenario)) continue;
        if (args.tag) {
          const text = await fs.readFile(path.join(scenDir, f), "utf8");
          if (!new RegExp(`^tag:\\s*${args.tag}`, "m").test(text)) continue;
        }
        out.push(path.join(scenDir, f));
      }
    } catch {}
  }
  return out;
}

/** Wrap a real AgentSession into the SessionLike interface.
 *  subscribe() forwards to session.subscribe() with event shape adaptation.
 *  prompt() returns Promise<void> — matching the real SDK signature exactly.
 */
async function makeSession(modelPattern?: string): Promise<SessionLike> {
  const auth = await discoverAuthStorage();
  const models = new ModelRegistry(auth);
  await models.refresh();
  const { session } = await createAgentSession({
    sessionManager: SessionManager.inMemory(),
    authStorage: auth,
    modelRegistry: models,
    // Headless eval: no UI to approve tool calls, so auto-approve every tier —
    // otherwise the agent blocks forever on the first task/Bash approval prompt
    // (the eval runner has no interactive approver). hasUI:false also keeps the
    // agent from invoking interactive ask/pi-oven_ask tools mid-scenario.
    autoApprove: true,
    hasUI: false,
    // Wire --model so evals can pin a fast model (e.g. a flash/haiku tier);
    // the session default can be a slow reasoning model that times out scenarios.
    ...(modelPattern ? { modelPattern } : {}),
  });
  return {
    subscribe(listener: (event: RunnerEvent) => void): () => void {
      return session.subscribe((sdkEvent) => {
        // Adapt SDK AgentSessionEvent → RunnerEvent.
        //
        // We read the authoritative output from the COMPLETED assistant message
        // (`message_end.message.content`) rather than streamed `text_delta` events.
        // Two reasons: (1) streamed text deltas proved unreliable across models
        // (reasoning models stream via non-text channels), and (2) `tool_execution_start`
        // fires AFTER the assistant message_end — but the runner unsubscribes on the
        // first message_end, so executed-tool events are missed. The assistant message's
        // own content already carries the requested tool-call blocks, which is exactly
        // the "did this skill cause a task dispatch" signal the matchers check.
        if (sdkEvent.type === "message_end") {
          const msg = (sdkEvent as { message?: { content?: unknown } }).message;
          const blocks = Array.isArray(msg?.content)
            ? (msg!.content as Array<Record<string, unknown>>)
            : [];
          for (const b of blocks) {
            if (b && b.type === "text" && typeof b.text === "string") {
              listener({ type: "message_update", delta: b.text });
            } else if (b && typeof b.name === "string" && b.type !== "text") {
              // ToolCall / tool_use content block — record the requested tool name.
              listener({ type: "tool_execution_start", toolName: b.name as string, toolCallId: "" });
            }
          }
          listener({ type: "message_end" });
        }
      });
    },
    async prompt(message: string): Promise<void> {
      await session.prompt(message);
    },
  };
}

async function main() {
  const args = parseArgs(Bun.argv.slice(2));
  const rootDir = process.cwd();
  const files = await listScenarios(rootDir, args);
  if (files.length === 0) {
    process.exit(0);
  }
  const session = await makeSession(args.model);
  const verdicts = [];
  for (const file of files) {
    const text = await fs.readFile(file, "utf8");
    const scenario = parseScenario(text);
    const verdict = await runScenario(scenario, session);
    verdicts.push(verdict);
    console.log(`${verdict.passed ? "✓" : "✗"} ${verdict.skill}/${verdict.scenario} (${verdict.latency_ms}ms)`);
    for (const f of verdict.failures) console.log(`  fail: ${f}`);
  }
  if (args.outFile) {
    await fs.writeFile(args.outFile, verdicts.map((v) => JSON.stringify(v)).join("\n") + "\n");
  }
  const allPassed = verdicts.every((v) => v.passed);
  process.exit(allPassed ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
