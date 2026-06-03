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
async function makeSession(): Promise<SessionLike> {
  const auth = await discoverAuthStorage();
  const models = new ModelRegistry(auth);
  await models.refresh();
  const { session } = await createAgentSession({
    sessionManager: SessionManager.inMemory(),
    authStorage: auth,
    modelRegistry: models,
  });
  return {
    subscribe(listener: (event: RunnerEvent) => void): () => void {
      return session.subscribe((sdkEvent) => {
        // Adapt SDK AgentSessionEvent → RunnerEvent using proper type narrowing
        if (sdkEvent.type === "tool_execution_start") {
          listener({ type: "tool_execution_start", toolName: sdkEvent.toolName, toolCallId: sdkEvent.toolCallId });
        } else if (sdkEvent.type === "message_update") {
          const ame = sdkEvent.assistantMessageEvent;
          if (ame.type === "text_delta") {
            listener({ type: "message_update", delta: ame.delta });
          }
        } else if (sdkEvent.type === "message_end") {
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
  // Fix 2: create a fresh session per scenario so a stuck/aborted scenario
  // cannot poison the next one (per-scenario isolation).
  const verdicts = [];
  for (const file of files) {
    const text = await fs.readFile(file, "utf8");
    const scenario = parseScenario(text);
    const session = await makeSession();
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
