import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { readTeamConfig, saveTeamConfig } from "../../../scripts/pi-oven-team/team-config";
import { scaleUp } from "../../../scripts/pi-oven-team/scaling";
import { readTask } from "../../../scripts/pi-oven-team/task-file-ops";
import type { TeamConfig, TeamRuntimeLaneMetadata, TeamTmuxController } from "../../../scripts/pi-oven-team/types";

let cwd = "";

function makeConfig(overrides: Partial<TeamConfig> = {}): TeamConfig {
  return {
    name: "native-team",
    task: "existing",
    agent_type: "claude",
    worker_launch_mode: "interactive",
    worker_count: 1,
    max_workers: 100,
    workers: [{ name: "worker-1", index: 1, role: "worker", assigned_tasks: [], pane_id: "%1", working_dir: cwd }],
    created_at: new Date().toISOString(),
    tmux_session: "native-team:0",
    next_task_id: 2,
    leader_cwd: cwd,
    team_state_root: join(cwd, ".pi-oven", "state", "team", "native-team"),
    leader_pane_id: "%1",
    hud_pane_id: null,
    resize_hook_name: null,
    resize_hook_target: null,
    next_worker_index: 2,
    worktree_mode: "disabled",
    ...overrides,
  };
}

function persistedConfigWithoutMaxWorkers(config: TeamConfig): TeamConfig {
  return { ...config, max_workers: undefined } as unknown as TeamConfig;
}

function makeTmux(): TeamTmuxController & { calls: string[] } {
  const calls: string[] = [];
  let nextPane = 2;
  return {
    calls,
    async createTeamSession() {
      throw new Error("unused");
    },
    async splitWorkerPane(splitTarget: string, direction: "right" | "down") {
      const paneId = `%${nextPane++}`;
      calls.push(`split:${splitTarget}:${direction}:${paneId}`);
      return paneId;
    },
    async spawnWorkerInPane(paneId: string, spec: { workerName: string; command: string }) {
      calls.push(`spawn:${paneId}:${spec.workerName}:${spec.command}`);
    },
    async capturePane() {
      return "❯ \n";
    },
    async sendPaneKey(paneId: string, key: string) {
      calls.push(`send-key:${paneId}:${key}`);
    },
    async killPane(paneId: string) {
      calls.push(`kill-pane:${paneId}`);
    },
    async killSession(sessionName: string, _workerPaneIds?: string[], _leaderPaneId?: string | null) {
      calls.push(`kill-session:${sessionName}`);
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

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}


beforeEach(() => {
  cwd = join(tmpdir(), `pi-oven-team-scaling-${Date.now()}-${Math.random().toString(36).slice(2)}`);
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

describe("pi-oven-team/scaling", () => {
  it("enforces the pi-oven-owned default cap of 100 during scale-up", async () => {
    const config = makeConfig();
    saveTeamConfig(persistedConfigWithoutMaxWorkers(config), cwd);

    const result = await scaleUp({
      teamName: "native-team",
      count: 100,
      agentType: "claude",
      tasks: [],
      cwd,
      tmux: makeTmux(),
      buildWorkerStart: () => ({ command: "run-worker" }),
      dispatchStartup: async () => ({ ok: true }),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("1 + 100 > 100");
    }
  });

  it("rolls back only newly added panes and task state on scale-up failure", async () => {
    saveTeamConfig(makeConfig(), cwd);
    const tmux = makeTmux();

    const result = await scaleUp({
      teamName: "native-team",
      count: 1,
      agentType: "claude",
      tasks: [{ subject: "Task B", description: "Do B" }],
      cwd,
      tmux,
      buildWorkerStart: ({ workerName }) => ({ command: `run-${workerName}` }),
      dispatchStartup: async () => ({ ok: false, reason: "dispatch_failed" }),
    });

    expect(result.ok).toBe(false);
    expect(tmux.calls).toContain("kill-pane:%2");
    expect(tmux.calls.some((call) => call === "kill-session:native-team:0")).toBe(false);
    expect(readTask("native-team", "2", { cwd })).toBeNull();

    const persisted = readTeamConfig("native-team", cwd);
    expect(persisted?.worker_count).toBe(1);
    expect(persisted?.next_task_id).toBe(2);
    expect(existsSync(join(cwd, ".pi-oven", "state", "team", "native-team", "startup-failure.json"))).toBe(true);
  });

  it("persists allocated scale-up tasks and advances next_task_id only for real tasks", async () => {
    saveTeamConfig(makeConfig(), cwd);

    const result = await scaleUp({
      teamName: "native-team",
      count: 2,
      agentType: "claude",
      tasks: [{ subject: "Task B", description: "Do B" }],
      cwd,
      tmux: makeTmux(),
      buildWorkerStart: ({ workerName }) => ({ command: `run-${workerName}` }),
      dispatchStartup: async () => ({ ok: true }),
    });

    expect(result.ok).toBe(true);

    const persisted = readTeamConfig("native-team", cwd);
    expect(persisted?.worker_count).toBe(3);
    expect(persisted?.next_task_id).toBe(3);
    expect(persisted?.workers.find((worker) => worker.name === "worker-2")?.assigned_tasks).toEqual(["2"]);
    expect(persisted?.workers.find((worker) => worker.name === "worker-3")?.assigned_tasks).toEqual([]);

    expect(readTask("native-team", "2", { cwd })).toMatchObject({
      id: "2",
      subject: "Task B",
      owner: "worker-2",
      status: "pending",
    });
    expect(readTask("native-team", "3", { cwd })).toBeNull();
  });

  it("starts independent scale-up worktree preparation before the first worktree resolves and persists batch evidence", async () => {
    saveTeamConfig(makeConfig({ worktree_mode: "named" }), cwd);
    const tmux = makeTmux();
    const verificationLane: TeamRuntimeLaneMetadata = {
      kind: "verification",
      objective: "verify scale-up worktree fanout",
      independence_reason: "read-only verification lanes are independent",
      shared_state_policy: "read_only",
      output_schema: "verification_report",
      reducer: "append_results",
    };
    const firstEnsureStarted = createDeferred<void>();
    const firstEnsure = createDeferred<{ path: string; created: boolean } | null>();
    let secondEnsureStarted = false;

    const resultPromise = scaleUp({
      teamName: "native-team",
      count: 2,
      agentType: "claude",
      tasks: [
        { subject: "Task B", description: "Do B", lane: verificationLane },
        { subject: "Task C", description: "Do C", lane: verificationLane },
      ],
      cwd,
      tmux,
      worktrees: {
        async ensureWorkerWorktree(_teamName: string, workerName: string) {
          if (workerName === "worker-2") {
            firstEnsureStarted.resolve();
            return firstEnsure.promise;
          }
          secondEnsureStarted = true;
          return { path: join(cwd, ".worktrees", workerName), created: true };
        },
        async removeWorkerWorktree() {},
        inspectTeamWorktreeCleanupSafety() {
          return { hasEvidence: false };
        },
        cleanupTeamWorktrees() {
          return { removed: [], preserved: [] };
        },
      },
      buildWorkerStart: ({ workerName }) => ({ command: `run-${workerName}` }),
      dispatchStartup: async ({ workerName, paneId }) => {
        tmux.calls.push(`dispatch:${workerName}:${paneId}`);
        return { ok: true };
      },
    });

    await firstEnsureStarted.promise;
    await Promise.resolve();
    await Promise.resolve();

    let assertionError: unknown;
    try {
      expect(secondEnsureStarted).toBe(true);
    } catch (error) {
      assertionError = error;
    } finally {
      firstEnsure.resolve({ path: join(cwd, ".worktrees", "worker-2"), created: true });
    }

    const result = await resultPromise;
    if (assertionError) {
      throw assertionError;
    }

    expect(result.ok).toBe(true);
    const persisted = readTeamConfig("native-team", cwd);
    const startupEvidence = readStartupEvidence(persisted);
    expect(startupEvidence?.collisionEvidence).toEqual([
      "worker_dir:worker-2",
      "task_file:2",
      "worker_dir:worker-3",
      "task_file:3",
    ]);
    expect(startupEvidence?.reducerOrder).toEqual([
      "append_results",
      "append_results",
    ]);
  });
  it("fans out independent scale-up lanes and persists latency evidence", async () => {
    saveTeamConfig(makeConfig(), cwd);
    const tmux = makeTmux();
    const verificationLane: TeamRuntimeLaneMetadata = {
      kind: "verification",
      objective: "verify scale-up fanout",
      independence_reason: "read-only verification lanes are independent",
      shared_state_policy: "read_only",
      output_schema: "verification_report",
      reducer: "append_results",
    };

    const result = await scaleUp({
      teamName: "native-team",
      count: 2,
      agentType: "claude",
      tasks: [
        { subject: "Task B", description: "Do B", lane: verificationLane },
        { subject: "Task C", description: "Do C", lane: verificationLane },
      ],
      cwd,
      tmux,
      buildWorkerStart: ({ workerName }) => ({ command: `run-${workerName}` }),
      dispatchStartup: async ({ workerName, paneId }) => {
        tmux.calls.push(`dispatch:${workerName}:${paneId}`);
        return { ok: true };
      },
    });

    expect(result.ok).toBe(true);
    expect(tmux.calls.indexOf("split:%2:down:%3")).toBeGreaterThan(-1);
    expect(tmux.calls.indexOf("split:%2:down:%3")).toBeLessThan(tmux.calls.indexOf("dispatch:worker-2:%2"));
    const persisted = readTeamConfig("native-team", cwd);
    const startupEvidence = readStartupEvidence(persisted);
    expect(startupEvidence).toMatchObject({
      fanoutLatencyMs: 2,
      sequentialComparableLatencyMs: 4,
      startupImprovementRatio: 2,
    });
  });

  it("rejects colliding owned-write scale-up lanes before spawning workers", async () => {
    saveTeamConfig(makeConfig(), cwd);
    const tmux = makeTmux();
    const collidingLane: TeamRuntimeLaneMetadata = {
      kind: "owned_write",
      objective: "mutate shared overlay",
      independence_reason: "only one writer may own the overlay surface",
      shared_state_policy: "exclusive_write",
      output_schema: "owned_write_result",
      reducer: "owned_write_commit",
      persistence_claims: [{ surface: "worker_overlay", key: "shared-doc" }],
    };

    const result = await scaleUp({
      teamName: "native-team",
      count: 2,
      agentType: "claude",
      tasks: [
        { subject: "Task B", description: "Do B", lane: collidingLane },
        { subject: "Task C", description: "Do C", lane: collidingLane },
      ],
      cwd,
      tmux,
      buildWorkerStart: ({ workerName }) => ({ command: `run-${workerName}` }),
      dispatchStartup: async () => ({ ok: true }),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("collision");
    }
    expect(tmux.calls.some((call) => call.startsWith("spawn:"))).toBe(false);
  });
});
