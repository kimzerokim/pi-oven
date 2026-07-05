import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { rollbackStartedWorkers } from "../../../scripts/pi-oven-team/rollback";
import { readTeamConfig, saveTeamConfig } from "../../../scripts/pi-oven-team/team-config";
import { readTask } from "../../../scripts/pi-oven-team/task-file-ops";
import type { TeamConfig, TeamTmuxController } from "../../../scripts/pi-oven-team/types";

let cwd = "";

function makeConfig(): TeamConfig {
  return {
    name: "native-team",
    task: "existing",
    agent_type: "claude",
    worker_launch_mode: "interactive",
    worker_count: 3,
    max_workers: 100,
    workers: [
      { name: "worker-1", index: 1, role: "worker", assigned_tasks: [], pane_id: "%1", working_dir: cwd },
      { name: "worker-2", index: 2, role: "worker", assigned_tasks: ["2"], pane_id: "%2", working_dir: cwd },
      { name: "worker-3", index: 3, role: "worker", assigned_tasks: ["3"], pane_id: "%3", working_dir: cwd },
    ],
    created_at: new Date().toISOString(),
    tmux_session: "native-team:0",
    next_task_id: 4,
    leader_cwd: cwd,
    team_state_root: join(cwd, ".pi-oven", "state", "team", "native-team"),
    leader_pane_id: "%1",
    hud_pane_id: null,
    resize_hook_name: null,
    resize_hook_target: null,
    next_worker_index: 4,
    worktree_mode: "disabled",
  };
}

function writeTaskFile(taskId: string, owner: string): void {
  const tasksDir = join(cwd, ".pi-oven", "state", "team", "native-team", "tasks");
  mkdirSync(tasksDir, { recursive: true });
  writeFileSync(
    join(tasksDir, `${taskId}.json`),
    JSON.stringify({
      id: taskId,
      subject: `Task ${taskId}`,
      description: `Persisted task ${taskId}`,
      status: "pending",
      owner,
      blocks: [],
      blockedBy: [],
    }, null, 2),
    "utf-8"
  );
}

function makeTmux(calls: string[]): TeamTmuxController {
  return {
    async createTeamSession() {
      throw new Error("unused");
    },
    async splitWorkerPane() {
      throw new Error("unused");
    },
    async spawnWorkerInPane() {
      throw new Error("unused");
    },
    async capturePane() {
      return "❯ \n";
    },
    async sendPaneKey() {
      return;
    },
    async killPane(paneId: string) {
      calls.push(`kill-pane:${paneId}`);
    },
    async killSession(sessionName: string) {
      calls.push(`kill-session:${sessionName}`);
    },
  };
}

beforeEach(() => {
  cwd = join(tmpdir(), `pi-oven-team-rollback-${Date.now()}-${Math.random().toString(36).slice(2)}`);
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

describe("pi-oven-team/rollback", () => {
  it("removes task state before rewriting config and records deterministic rollback evidence", async () => {
    const config = makeConfig();
    saveTeamConfig(config, cwd);
    writeTaskFile("2", "worker-2");
    writeTaskFile("3", "worker-3");
    mkdirSync(join(cwd, ".pi-oven", "state", "team", "native-team", "workers", "worker-2"), { recursive: true });
    mkdirSync(join(cwd, ".pi-oven", "state", "team", "native-team", "workers", "worker-3"), { recursive: true });
    const calls: string[] = [];

    await rollbackStartedWorkers({
      teamName: "native-team",
      cwd,
      sessionName: "native-team:0",
      leaderPaneId: "%1",
      workers: [
        { workerName: "worker-2", paneId: "%2", taskId: "2" },
        { workerName: "worker-3", paneId: "%3", taskId: "3" },
      ],
      tmux: makeTmux(calls),
      config,
      error: new Error("startup failed"),
      collisionEvidence: ["worker_overlay:shared-doc"],
      writeFailureSidecar: true,
    });

    expect(calls).toEqual(["kill-pane:%3", "kill-pane:%2"]);
    expect(readTask("native-team", "2", { cwd })).toBeNull();
    expect(readTask("native-team", "3", { cwd })).toBeNull();

    const persisted = readTeamConfig("native-team", cwd);
    expect(persisted?.worker_count).toBe(1);
    expect(persisted?.workers.map((worker) => worker.name)).toEqual(["worker-1"]);

    const sidecarPath = join(cwd, ".pi-oven", "state", "team", "native-team", "startup-failure.json");
    expect(existsSync(sidecarPath)).toBe(true);
    const sidecar = JSON.parse(readFileSync(sidecarPath, "utf-8")) as Record<string, unknown>;
    expect(sidecar.collision_evidence).toEqual(["worker_overlay:shared-doc"]);
    expect(sidecar.rollback_persistence_order).toEqual([
      "task_file:3:delete",
      "task_file:2:delete",
      "team_config:native-team:save",
    ]);
  });
});
