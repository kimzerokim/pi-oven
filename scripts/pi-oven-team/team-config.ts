/**
 * Derived from upstream OMC team runtime config/state writers.
 * Sources:
 * - /Users/kimzerokim/.claude/plugins/marketplaces/omc/src/team/runtime-v2.ts
 * - /Users/kimzerokim/.claude/plugins/marketplaces/omc/src/team/types.ts
 * - /Users/kimzerokim/.claude/plugins/marketplaces/omc/src/team/monitor.ts
 * Upstream commit: 50f6ff05eb5d9ebed66f05d8c4580c0b119f37af
 */

import { existsSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { atomicWriteJson, ensureDirWithMode, readJsonFile, removeFileIfPresent } from "./fs-utils";
import { TeamPaths, absPath, teamStateRoot } from "./state-paths";
import {
  PI_OVEN_NATIVE_MAX_WORKERS,
  type StartedWorkerRecord,
  type TaskFile,
  type TeamConfig,
  type TeamTaskInput,
  type WorkerInfo,
} from "./types";

export function buildWorkerInfo(workerIndex: number, cwd: string, worktreePath?: string, worktreeCreated?: boolean): WorkerInfo {
  const workerName = `worker-${workerIndex}`;
  const worker: WorkerInfo = {
    name: workerName,
    index: workerIndex,
    role: "worker",
    assigned_tasks: [],
    working_dir: worktreePath ?? cwd,
  };
  if (worktreePath) {
    worker.worktree_path = worktreePath;
    worker.worktree_created = worktreeCreated;
  }
  return worker;
}

export function buildInitialTeamConfig(args: {
  teamName: string;
  workerCount: number;
  agentType: string;
  cwd: string;
  sessionName: string;
  leaderPaneId: string | null;
  workers: WorkerInfo[];
  maxWorkers?: number;
  worktreeMode?: TeamConfig["worktree_mode"];
}): TeamConfig {
  return {
    name: args.teamName,
    task: "",
    agent_type: args.agentType,
    worker_launch_mode: "interactive",
    worker_count: args.workerCount,
    max_workers: args.maxWorkers ?? PI_OVEN_NATIVE_MAX_WORKERS,
    workers: args.workers,
    created_at: new Date().toISOString(),
    tmux_session: args.sessionName,
    next_task_id: 1,
    leader_cwd: args.cwd,
    team_state_root: teamStateRoot(args.cwd, args.teamName),
    leader_pane_id: args.leaderPaneId,
    hud_pane_id: null,
    resize_hook_name: null,
    resize_hook_target: null,
    next_worker_index: args.workerCount + 1,
    worktree_mode: args.worktreeMode ?? "disabled",
  };
}

export function ensureTeamState(teamName: string, cwd: string, workers: string[]): void {
  const root = absPath(cwd, TeamPaths.root(teamName));
  ensureDirWithMode(root);
  ensureDirWithMode(absPath(cwd, TeamPaths.tasks(teamName)));
  ensureDirWithMode(absPath(cwd, TeamPaths.workers(teamName)));
  ensureDirWithMode(join(root, "mailbox"));
  for (const workerName of workers) {
    ensureDirWithMode(absPath(cwd, TeamPaths.workerDir(teamName, workerName)));
  }
}

export function writeTaskStateFile(
  teamName: string,
  cwd: string,
  taskId: string,
  task: TeamTaskInput,
  owner: string
): void {
  atomicWriteJson(absPath(cwd, TeamPaths.taskFile(teamName, taskId)), {
    id: taskId,
    subject: task.subject,
    description: task.description,
    status: "pending",
    owner,
    blocks: [],
    blockedBy: task.blocked_by ?? [],
  } satisfies TaskFile);
}

export function removeTaskStateFile(teamName: string, cwd: string, taskId: string): void {
  removeFileIfPresent(absPath(cwd, TeamPaths.taskFile(teamName, taskId)));
}

export function seedTeamTasks(teamName: string, cwd: string, workerCount: number, tasks: TeamTaskInput[]): void {
  for (let index = 0; index < tasks.length; index++) {
    const taskId = String(index + 1);
    const task = tasks[index]!;
    const owner = task.owner ?? `worker-${(index % Math.max(workerCount, 1)) + 1}`;
    writeTaskStateFile(teamName, cwd, taskId, task, owner);
  }
}

export function saveTeamConfig(config: TeamConfig, cwd: string): void {
  atomicWriteJson(absPath(cwd, TeamPaths.config(config.name)), config);
}

export function readTeamConfig(teamName: string, cwd: string): TeamConfig | null {
  return readJsonFile<TeamConfig>(absPath(cwd, TeamPaths.config(teamName)));
}

export function writeStartupFailureSidecar(
  teamName: string,
  cwd: string,
  error: unknown,
  workers: StartedWorkerRecord[],
  rollbackError?: unknown
): void {
  const payload: Record<string, unknown> = {
    reason: "startup_failed",
    error: error instanceof Error ? error.message : String(error),
    workers: workers.map((worker) => ({
      workerName: worker.workerName,
      paneId: worker.paneId,
      worktreePath: worker.worktreePath,
      worktreeCreated: worker.worktreeCreated,
    })),
    recorded_at: new Date().toISOString(),
  };
  if (rollbackError !== undefined) {
    payload.rollback_error = rollbackError instanceof Error ? rollbackError.message : String(rollbackError);
  }
  atomicWriteJson(absPath(cwd, TeamPaths.startupFailure(teamName)), payload);
}

export function removeWorkerStateDir(teamName: string, workerName: string, cwd: string): void {
  const workerDir = absPath(cwd, TeamPaths.workerDir(teamName, workerName));
  if (existsSync(workerDir)) {
    rmSync(workerDir, { recursive: true, force: true });
  }
}

export function writeWorkerInbox(teamName: string, workerName: string, cwd: string, content: string): void {
  const inboxPath = absPath(cwd, TeamPaths.inbox(teamName, workerName));
  ensureDirWithMode(join(cwd, TeamPaths.workerDir(teamName, workerName)));
  writeFileSync(inboxPath, content, { encoding: "utf-8", mode: 0o600 });
}

export function saveWorkerOverlay(teamName: string, workerName: string, cwd: string, content: string): void {
  const overlayPath = absPath(cwd, TeamPaths.overlay(teamName, workerName));
  ensureDirWithMode(join(cwd, TeamPaths.workerDir(teamName, workerName)));
  writeFileSync(overlayPath, content, { encoding: "utf-8", mode: 0o600 });
}
