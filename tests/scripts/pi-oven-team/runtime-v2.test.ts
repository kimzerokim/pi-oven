import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, readFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { readTeamConfig } from "../../../scripts/pi-oven-team/team-config";
import { startTeamV2 } from "../../../scripts/pi-oven-team/runtime-v2";
import type { TeamTmuxController } from "../../../scripts/pi-oven-team/types";

let cwd = "";

function makeTmuxController(events: string[]): TeamTmuxController {
  const captures: Record<string, string[]> = {
    "%2": ["loading...\n", "❯ \n"],
    "%3": ["loading...\n", "❯ \n"],
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
    async sendPaneKey(paneId: string, key: string) {
      events.push(`send-key:${paneId}:${key}`);
    },
    async killPane(paneId: string) {
      events.push(`kill-pane:${paneId}`);
    },
    async killSession(sessionName: string) {
      events.push(`kill-session:${sessionName}`);
    },
  };
}

beforeEach(() => {
  cwd = join(tmpdir(), `pi-oven-team-runtime-${Date.now()}-${Math.random().toString(36).slice(2)}`);
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

describe("pi-oven-team/runtime-v2", () => {
  it("writes a pi-oven-owned max_workers=100 config and dispatches only after readiness", async () => {
    const events: string[] = [];
    const runtime = await startTeamV2({
      teamName: "native-team",
      workerCount: 1,
      agentType: "claude",
      tasks: [{ subject: "Task A", description: "Do A" }],
      cwd,
      tmux: makeTmuxController(events),
      buildWorkerStart: ({ workerName }) => ({ command: `run-${workerName}` }),
      dispatchStartup: async ({ workerName, paneId }) => {
        events.push(`dispatch:${workerName}:${paneId}`);
        return { ok: true };
      },
    });

    expect(runtime.config.max_workers).toBe(100);
    expect(readTeamConfig("native-team", cwd)?.max_workers).toBe(100);
    expect(events).toContain("dispatch:worker-1:%2");
    expect(events.indexOf("capture:%2")).toBeGreaterThan(-1);
    expect(events.indexOf("capture:%2")).toBeLessThan(events.indexOf("dispatch:worker-1:%2"));
  });

  it("writes startup-failure sidecar and rolls back started panes on startup failure", async () => {
    const events: string[] = [];

    await expect(
      startTeamV2({
        teamName: "native-team",
        workerCount: 2,
        agentType: "claude",
        tasks: [
          { subject: "Task A", description: "Do A" },
          { subject: "Task B", description: "Do B" },
        ],
        cwd,
        tmux: makeTmuxController(events),
        buildWorkerStart: ({ workerName }) => ({ command: `run-${workerName}` }),
        dispatchStartup: async ({ workerName }) =>
          workerName === "worker-2" ? { ok: false, reason: "dispatch_failed" } : { ok: true },
      })
    ).rejects.toThrow("worker_startup_failed:worker-2:dispatch_failed");

    const sidecarPath = join(cwd, ".pi-oven", "state", "team", "native-team", "startup-failure.json");
    expect(existsSync(sidecarPath)).toBe(true);
    const sidecar = JSON.parse(readFileSync(sidecarPath, "utf-8")) as { workers: Array<{ paneId?: string }> };
    expect(sidecar.workers.length).toBe(2);
    expect(events).toContain("kill-pane:%2");
    expect(events).toContain("kill-pane:%3");
  });
});
