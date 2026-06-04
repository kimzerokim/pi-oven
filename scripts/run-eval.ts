#!/usr/bin/env bun
import { parseScenario, runScenario, type SessionLike, type RunnerEvent } from "./lib/eval-runner";
import { createAgentSession, ModelRegistry, SessionManager, discoverAuthStorage, discoverSkills } from "@oh-my-pi/pi-coding-agent";
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
 *
 *  Headless fixes (ported from v0.1.1 main branch):
 *  - autoApprove:true  — no UI approver; avoid blocking on tool approval prompts
 *  - hasUI:false       — disables interactive tools (ask/pi-oven_ask) mid-scenario
 *  - skills loaded from worktree .claude-plugin/plugin.json so this worktree's
 *    skill changes are visible (not just the installed plugin cache)
 *  - agent_end used as turn-end signal (not message_end on user/tool messages)
 *  - message_end.message content captured with role==='assistant' guard
 */
async function makeSession(modelPattern?: string): Promise<SessionLike> {
  const cwd = process.cwd();
  const auth = await discoverAuthStorage();
  const models = new ModelRegistry(auth);
  await models.refresh();

  // Load skills from this worktree so eval sees the current skill changes,
  // not just the installed plugin cache. discoverSkills(cwd) walks .claude-plugin/
  // and local skill directories starting from cwd.
  const { skills } = await discoverSkills(cwd);

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
    // Load this worktree's skills so eval exercises the current code, not the
    // installed plugin snapshot.
    skills,
    // Wire --model so evals can pin a fast model (e.g. a flash/haiku tier);
    // the session default can be a slow reasoning model that times out scenarios.
    ...(modelPattern ? { modelPattern } : {}),
  });
  return {
    subscribe(listener: (event: RunnerEvent) => void): () => void {
      return session.subscribe((sdkEvent) => {
        // Capture from the COMPLETED assistant message (message_end.message)
        // rather than streamed text_delta events. The role guard is essential —
        // message_end also fires for user echo and tool-result messages.
        if (sdkEvent.type === "message_end") {
          const msg = (sdkEvent as { message?: { role?: string; content?: unknown } }).message;
          if (msg?.role === "assistant" && Array.isArray(msg.content)) {
            for (const b of msg.content as Array<Record<string, unknown>>) {
              if (b && b.type === "text" && typeof b.text === "string") {
                listener({ type: "message_update", delta: b.text });
              } else if (b && typeof b.name === "string" && b.type !== "text") {
                // ToolCall / tool_use content block — record the requested tool name.
                listener({ type: "tool_execution_start", toolName: b.name as string, toolCallId: "" });
              }
            }
          }
        } else if (sdkEvent.type === "agent_end") {
          // Signal turn completion only when the whole agent run ends, so multi-step
          // turns (assistant → tool → assistant) are fully captured before unsubscribe.
          listener({ type: "message_end" });
        } else {
          // Forward SDK-level terminal error events (error, abort, session_error,
          // stream_error) so the runner ends the turn instead of hitting the cap.
          // Cast via { type: string } because the SDK union may not declare these
          // event types even though the runtime can emit them.
          const raw = sdkEvent as { type: string };
          if (
            raw.type === "error" ||
            raw.type === "abort" ||
            raw.type === "session_error" ||
            raw.type === "stream_error"
          ) {
            listener({ type: raw.type });
          }
        }
      });
    },
    async prompt(message: string, options?: { signal?: AbortSignal }): Promise<void> {
      // Real SDK PromptOptions does not have a signal field — wire abort via
      // session.abort() instead: listen on the AbortSignal and call session.abort()
      // so the in-flight turn is actually cancelled when the per-turn timer fires.
      if (options?.signal) {
        const handler = () => { void session.abort(); };
        options.signal.addEventListener("abort", handler, { once: true });
      }
      await session.prompt(message);
    },
  };
}

/** Exported for unit testing — same as makeSession() but exposed so tests can
 *  mock @oh-my-pi/pi-coding-agent and assert the options passed to createAgentSession. */
export const makeSessionForTest = makeSession;

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
    const session = await makeSession(args.model);
    const verdict = await runScenario(scenario, session);
    verdicts.push(verdict);
    const mark = verdict.inconclusive ? "⊘" : (verdict.passed ? "✓" : "✗");
    console.log(`${mark} ${verdict.skill}/${verdict.scenario} (${verdict.latency_ms}ms)`);
    for (const f of verdict.failures) console.log(`  fail: ${f}`);
    // Print telemetry observations for transparency
    for (const obs of verdict.observations) {
      if (
        obs.startsWith("response_contains[telemetry]") ||
        obs.startsWith("tool_required[telemetry]") ||
        obs.startsWith("skill_read") ||
        obs.startsWith("timeout:")
      ) {
        console.log(`  · ${obs}`);
      }
    }
  }
  if (args.outFile) {
    await fs.writeFile(args.outFile, verdicts.map((v) => JSON.stringify(v)).join("\n") + "\n");
  }
  const passCount = verdicts.filter((v) => v.passed).length;
  const failCount = verdicts.filter((v) => !v.passed && !v.inconclusive).length;
  const inconclusiveCount = verdicts.filter((v) => v.inconclusive).length;
  console.log(`\n${passCount} pass, ${failCount} fail, ${inconclusiveCount} inconclusive`);
  // Inconclusive is NOT a hard failure — only !passed && !inconclusive counts
  const hardFail = verdicts.some((v) => !v.passed && !v.inconclusive);
  process.exit(hardFail ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
