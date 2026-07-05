import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { readTeamConfig } from "../../../scripts/pi-oven-team/team-config";
import {
  resolveNativeWorkerRuntimeStatus,
  scaleNativeTeamRuntime,
  startNativeTeamRuntime,
} from "../../../scripts/pi-oven-team";
import type { TeamTmuxController } from "../../../scripts/pi-oven-team/types";

let cwd = "";
let homeDir = "";
const pluginRoot = join(import.meta.dir, "..", "..", "..");

function writeProjectConfig(data: Record<string, unknown>): void {
  mkdirSync(join(cwd, ".pi-oven"), { recursive: true });
  writeFileSync(join(cwd, ".pi-oven", "config.json"), JSON.stringify(data, null, 2) + "\n", "utf-8");
}

function makeTmux(events: string[]): TeamTmuxController {
  const captures: Record<string, string[]> = {
    "%2": ["loading...\n", "❯ \n"],
  };
  let nextPane = 2;
  return {
    async createTeamSession(teamName: string) {
      events.push(`create:${teamName}`);
      return { sessionName: `${teamName}:0`, leaderPaneId: "%1", workerPaneIds: [] };
    },
    async splitWorkerPane(splitTarget: string, direction: "right" | "down") {
      const paneId = `%${nextPane++}`;
      events.push(`split:${splitTarget}:${direction}:${paneId}`);
      return paneId;
    },
    async spawnWorkerInPane(paneId: string, spec: { workerName: string; command: string }) {
      events.push(`spawn:${paneId}:${spec.workerName}:${spec.command}`);
    },
    async capturePane(paneId: string) {
      events.push(`capture:${paneId}`);
      return captures[paneId]?.shift() ?? "❯ \n";
    },
    async sendPaneKey() {
      return;
    },
    async killPane(paneId: string) {
      events.push(`kill-pane:${paneId}`);
    },
    async killSession(sessionName: string) {
      events.push(`kill-session:${sessionName}`);
    },
  };
}

function readStartupEvidence(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || !("startup_evidence" in value)) {
    return null;
  }
  const startupEvidence = value.startup_evidence;
  return startupEvidence && typeof startupEvidence === "object"
    ? startupEvidence as Record<string, unknown>
    : null;
}

beforeEach(() => {
  cwd = join(tmpdir(), `pi-oven-team-index-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  homeDir = join(tmpdir(), `pi-oven-team-home-${Date.now()}-${Math.random().toString(36).slice(2)}`);
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
  rmSync(homeDir, { recursive: true, force: true });
});

describe("pi-oven-team/index", () => {
  it("reports the vendored control path and prefers the project-local nativeWorkers.maxWorkers", async () => {
    writeProjectConfig({ nativeWorkers: { maxWorkers: 7 } });

    const status = await resolveNativeWorkerRuntimeStatus({
      pluginRoot,
      projectRoot: cwd,
      homeDir,
    });

    expect(status.active).toBe(true);
    expect(status.controlPath).toBe("scripts/pi-oven-team/index.ts");
    expect(status.implementationPath).toBe("scripts/pi-oven-team/runtime-v2.ts");
    expect(status.maxWorkers).toBe(7);
    expect(status.maxWorkersConfigPath).toBe(join(cwd, ".pi-oven", "config.json"));
    expect(status.maxWorkersSource).toBe("project-local override");
    expect(status.tracePrimitives).toEqual(
      expect.arrayContaining([
        "trace_function",
        "summarize_failure_path",
        "set_breakpoint_at_symbol",
        "list_changed_runtime_state",
      ])
    );
    expect(status.verifierDepth.deepAutoContinueHardCap).toBe(1);
    expect(status.verifierDepth.deepWhen).toContain("autonomous material edits");
  });

  it("starts the vendored runtime through the index control path with the configured worker ceiling", async () => {
    writeProjectConfig({ nativeWorkers: { maxWorkers: 7 } });
    const events: string[] = [];

    const runtime = await startNativeTeamRuntime({
      pluginRoot,
      homeDir,
      teamName: "native-team",
      workerCount: 1,
      agentType: "claude",
      tasks: [{ subject: "Task A", description: "Do A" }],
      cwd,
      tmux: makeTmux(events),
      buildWorkerStart: ({ workerName }) => ({ command: `run-${workerName}` }),
      dispatchStartup: async ({ workerName, paneId }) => {
        events.push(`dispatch:${workerName}:${paneId}`);
        return { ok: true };
      },
    });

    expect(runtime.config.max_workers).toBe(7);
    const persisted = readTeamConfig("native-team", cwd);
    const startupEvidence = readStartupEvidence(persisted);
    expect(persisted?.max_workers).toBe(7);
    expect(startupEvidence?.fanoutLatencyMs).toEqual(expect.any(Number));
    expect(startupEvidence?.sequentialComparableLatencyMs).toEqual(expect.any(Number));
    expect(startupEvidence?.startupImprovementRatio).toEqual(expect.any(Number));
    expect(events).toContain("dispatch:worker-1:%2");
  });

  it("returns an explicit degraded error when the vendored runtime files are missing", async () => {
    const result = await scaleNativeTeamRuntime({
      pluginRoot: join(cwd, "missing-plugin-root"),
      homeDir,
      teamName: "native-team",
      count: 1,
      agentType: "claude",
      tasks: [],
      cwd,
      tmux: makeTmux([]),
      buildWorkerStart: () => ({ command: "run-worker" }),
      dispatchStartup: async () => ({ ok: true }),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("inactive");
      expect(result.error).toContain("scripts/pi-oven-team/index.ts");
    }
  });
});
