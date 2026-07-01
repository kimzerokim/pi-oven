/**
 * Vendored from upstream OMC runtime-v2 startup/spawn flows.
 * Source: /Users/kimzerokim/.claude/plugins/marketplaces/omc/src/team/runtime-v2.ts
 * Upstream commit: 50f6ff05eb5d9ebed66f05d8c4580c0b119f37af
 */

import { buildInitialTeamConfig, buildWorkerInfo, ensureTeamState, saveTeamConfig, seedTeamTasks } from "./team-config";
import { rollbackStartedWorkers } from "./rollback";
import { PI_OVEN_NATIVE_MAX_WORKERS, type SpawnWorkerResult, type StartTeamV2Options, type TeamRuntimeHandle, type WorkerInfo } from "./types";
import { waitForPaneReady } from "./tmux-session";

interface SpawnV2WorkerOptions {
  sessionName: string;
  leaderPaneId: string;
  existingWorkerPaneIds: string[];
  teamName: string;
  workerName: string;
  workerIndex: number;
  agentType: string;
  taskId: string;
  task: StartTeamV2Options["tasks"][number];
  cwd: string;
  workerCwd: string;
  worktreePath?: string;
  tmux: StartTeamV2Options["tmux"];
  buildWorkerStart: StartTeamV2Options["buildWorkerStart"];
  dispatchStartup: StartTeamV2Options["dispatchStartup"];
}

const IDLE_BOOTSTRAP_TASK = {
  subject: "Await next claim",
  description: "Stay ready and claim the next pending owned task once the leader dispatches it.",
};

export async function spawnV2Worker(opts: SpawnV2WorkerOptions): Promise<SpawnWorkerResult> {
  const splitTarget = opts.existingWorkerPaneIds.length === 0
    ? opts.leaderPaneId
    : opts.existingWorkerPaneIds[opts.existingWorkerPaneIds.length - 1]!;
  const splitDirection = opts.existingWorkerPaneIds.length === 0 ? "right" : "down";
  const paneId = await opts.tmux.splitWorkerPane(splitTarget, splitDirection, opts.workerCwd);
  if (!paneId) {
    return { paneId: null, startupAssigned: false, startupFailureReason: "pane_id_missing" };
  }

  const startSpec = await opts.buildWorkerStart({
    teamName: opts.teamName,
    workerName: opts.workerName,
    workerIndex: opts.workerIndex,
    cwd: opts.cwd,
    taskId: opts.taskId,
    task: opts.task,
    worktreePath: opts.worktreePath,
  });

  await opts.tmux.spawnWorkerInPane(paneId, {
    teamName: opts.teamName,
    workerName: opts.workerName,
    command: startSpec.command,
    envVars: startSpec.envVars,
  });

  const paneReady = await waitForPaneReady(opts.tmux, paneId);
  if (!paneReady) {
    return {
      paneId,
      startupAssigned: false,
      startupFailureReason: "worker_pane_not_ready",
    };
  }

  const dispatch = await opts.dispatchStartup({
    teamName: opts.teamName,
    workerName: opts.workerName,
    workerIndex: opts.workerIndex,
    paneId,
    taskId: opts.taskId,
    task: opts.task,
    cwd: opts.cwd,
    sessionName: opts.sessionName,
  });
  if (!dispatch.ok) {
    return {
      paneId,
      startupAssigned: false,
      startupFailureReason: dispatch.reason ?? "startup_dispatch_failed",
      outputFile: dispatch.outputFile,
    };
  }

  return {
    paneId,
    startupAssigned: true,
    outputFile: dispatch.outputFile,
  };
}

export async function startTeamV2(options: StartTeamV2Options): Promise<TeamRuntimeHandle> {
  const maxWorkers = options.maxWorkers ?? PI_OVEN_NATIVE_MAX_WORKERS;
  if (!Number.isInteger(options.workerCount) || options.workerCount < 1) {
    throw new Error(`workerCount must be a positive integer (got ${options.workerCount})`);
  }
  if (options.workerCount > maxWorkers) {
    throw new Error(`workerCount ${options.workerCount} exceeds max_workers ${maxWorkers}`);
  }

  const workerNames = Array.from({ length: options.workerCount }, (_value, index) => `worker-${index + 1}`);
  ensureTeamState(options.teamName, options.cwd, workerNames);
  seedTeamTasks(options.teamName, options.cwd, options.workerCount, options.tasks);

  const session = await options.tmux.createTeamSession(options.teamName, 0, options.cwd, { newWindow: options.newWindow });
  const startedWorkers: Array<{ workerName: string; paneId?: string; worktreePath?: string; worktreeCreated?: boolean }> = [];
  const workersInfo: WorkerInfo[] = [];

  for (let index = 0; index < options.workerCount; index++) {
    const workerIndex = index + 1;
    const workerName = `worker-${workerIndex}`;
    const worktree = options.worktrees && options.worktreeMode !== "disabled"
      ? await options.worktrees.ensureWorkerWorktree(options.teamName, workerName, options.cwd, { mode: options.worktreeMode })
      : null;
    workersInfo.push(buildWorkerInfo(workerIndex, options.cwd, worktree?.path, worktree?.created));
    startedWorkers.push({
      workerName,
      worktreePath: worktree?.path,
      worktreeCreated: worktree?.created,
    });
  }

  const teamConfig = buildInitialTeamConfig({
    teamName: options.teamName,
    workerCount: options.workerCount,
    agentType: options.agentType,
    cwd: options.cwd,
    sessionName: session.sessionName,
    leaderPaneId: session.leaderPaneId,
    workers: workersInfo,
    maxWorkers,
    worktreeMode: options.worktreeMode ?? "disabled",
  });
  teamConfig.task = options.tasks.map((task) => task.subject).join("; ");
  teamConfig.next_task_id = options.tasks.length + 1;
  saveTeamConfig(teamConfig, options.cwd);

  const workerPaneIds: string[] = [...session.workerPaneIds];

  try {
    for (let index = 0; index < options.workerCount; index++) {
      const workerIndex = index + 1;
      const workerName = `worker-${workerIndex}`;
      const taskId = String(index + 1);
      const task = options.tasks[index] ?? IDLE_BOOTSTRAP_TASK;
      const spawnResult = await spawnV2Worker({
        sessionName: session.sessionName,
        leaderPaneId: session.leaderPaneId,
        existingWorkerPaneIds: workerPaneIds,
        teamName: options.teamName,
        workerName,
        workerIndex,
        agentType: options.agentType,
        taskId,
        task,
        cwd: options.cwd,
        workerCwd: workersInfo[index]?.working_dir ?? options.cwd,
        worktreePath: workersInfo[index]?.worktree_path,
        tmux: options.tmux,
        buildWorkerStart: options.buildWorkerStart,
        dispatchStartup: options.dispatchStartup,
      });

      if (spawnResult.paneId) {
        workerPaneIds.push(spawnResult.paneId);
        const workerInfo = workersInfo[index];
        if (workerInfo) {
          workerInfo.pane_id = spawnResult.paneId;
          workerInfo.assigned_tasks = spawnResult.startupAssigned && options.tasks[index] ? [taskId] : [];
          workerInfo.worker_cli = options.agentType;
          if (spawnResult.outputFile) {
            workerInfo.output_file = spawnResult.outputFile;
          }
        }
        const startedWorker = startedWorkers[index];
        if (startedWorker) {
          startedWorker.paneId = spawnResult.paneId;
        }
      }

      if (spawnResult.startupFailureReason) {
        throw new Error(`worker_startup_failed:${workerName}:${spawnResult.startupFailureReason}`);
      }
    }
  } catch (error) {
    await rollbackStartedWorkers({
      teamName: options.teamName,
      cwd: options.cwd,
      sessionName: session.sessionName,
      leaderPaneId: session.leaderPaneId,
      workers: startedWorkers,
      tmux: options.tmux,
      worktrees: options.worktrees,
      error,
      writeFailureSidecar: true,
      killSession: true,
    });
    throw error;
  }

  teamConfig.workers = workersInfo;
  saveTeamConfig(teamConfig, options.cwd);

  return {
    teamName: options.teamName,
    sessionName: session.sessionName,
    leaderPaneId: session.leaderPaneId,
    workerPaneIds,
    config: teamConfig,
  };
}
