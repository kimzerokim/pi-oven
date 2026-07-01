/**
 * Vendored from upstream OMC scale-up guard and rollback semantics.
 * Source: /Users/kimzerokim/.claude/plugins/marketplaces/omc/src/team/scaling.ts
 * Upstream commit: 50f6ff05eb5d9ebed66f05d8c4580c0b119f37af
 */

import { buildWorkerInfo, readTeamConfig, saveTeamConfig, writeTaskStateFile } from "./team-config";
import { rollbackStartedWorkers } from "./rollback";
import { spawnV2Worker } from "./runtime-v2";
import { PI_OVEN_NATIVE_MAX_WORKERS, type ScaleError, type ScaleUpOptions, type ScaleUpResult, type StartedWorkerRecord } from "./types";

export async function scaleUp(options: ScaleUpOptions): Promise<ScaleUpResult | ScaleError> {
  if (!Number.isInteger(options.count) || options.count < 1) {
    return { ok: false, error: `count must be a positive integer (got ${options.count})` };
  }

  const config = readTeamConfig(options.teamName, options.cwd);
  if (!config) {
    return { ok: false, error: `Team ${options.teamName} not found` };
  }
  if (!config.tmux_session || !config.leader_pane_id) {
    return { ok: false, error: `Team ${options.teamName} is missing configured tmux session metadata` };
  }

  const maxWorkers = options.maxWorkers ?? config.max_workers ?? PI_OVEN_NATIVE_MAX_WORKERS;
  const currentCount = config.workers.length;
  if (currentCount + options.count > maxWorkers) {
    return {
      ok: false,
      error: `Cannot add ${options.count} workers: would exceed max_workers (${currentCount} + ${options.count} > ${maxWorkers})`,
    };
  }

  let nextIndex = config.next_worker_index ?? currentCount + 1;
  const initialNextTaskId = config.next_task_id;
  let nextTaskId = initialNextTaskId;
  const addedWorkers: StartedWorkerRecord[] = [];
  const addedNames: string[] = [];
  const workerPaneIds = config.workers.map((worker) => worker.pane_id).filter((paneId): paneId is string => typeof paneId === "string");

  try {
    for (let offset = 0; offset < options.count; offset++) {
      while (config.workers.some((worker) => worker.name === `worker-${nextIndex}`)) {
        nextIndex += 1;
      }

      const workerIndex = nextIndex;
      const workerName = `worker-${workerIndex}`;
      const worktree = options.worktrees && config.worktree_mode !== "disabled"
        ? await options.worktrees.ensureWorkerWorktree(options.teamName, workerName, options.cwd, { mode: config.worktree_mode })
        : null;
      const workerInfo = buildWorkerInfo(workerIndex, options.cwd, worktree?.path, worktree?.created);
      const startupTask = options.tasks[offset];
      const allocatedTaskId = startupTask ? String(nextTaskId) : null;
      const task = startupTask ?? {
        subject: "Await next claim",
        description: "Stay ready and claim the next pending owned task once the leader dispatches it.",
      };
      const taskId = allocatedTaskId ?? String(initialNextTaskId + offset);
      const startedWorker: StartedWorkerRecord = {
        workerName,
        worktreePath: worktree?.path,
        worktreeCreated: worktree?.created,
        taskId: allocatedTaskId ?? undefined,
      };
      addedWorkers.push(startedWorker);
      if (startupTask && allocatedTaskId) {
        writeTaskStateFile(options.teamName, options.cwd, allocatedTaskId, startupTask, startupTask.owner ?? workerName);
        nextTaskId += 1;
      }
      const spawnResult = await spawnV2Worker({
        sessionName: config.tmux_session,
        leaderPaneId: config.leader_pane_id,
        existingWorkerPaneIds: workerPaneIds,
        teamName: options.teamName,
        workerName,
        workerIndex,
        agentType: options.agentType,
        taskId,
        task,
        cwd: options.cwd,
        workerCwd: workerInfo.working_dir ?? options.cwd,
        worktreePath: workerInfo.worktree_path,
        tmux: options.tmux,
        buildWorkerStart: options.buildWorkerStart,
        dispatchStartup: options.dispatchStartup,
      });

      if (spawnResult.paneId) {
        startedWorker.paneId = spawnResult.paneId;
      }

      if (!spawnResult.paneId || spawnResult.startupFailureReason) {
        throw new Error(
          spawnResult.startupFailureReason
            ? `worker_startup_failed:${workerName}:${spawnResult.startupFailureReason}`
            : `worker_startup_failed:${workerName}:pane_id_missing`
        );
      }

      workerInfo.pane_id = spawnResult.paneId;
      workerInfo.worker_cli = options.agentType;
      workerInfo.assigned_tasks = startupTask && allocatedTaskId ? [allocatedTaskId] : [];
      if (spawnResult.outputFile) {
        workerInfo.output_file = spawnResult.outputFile;
      }

      config.workers.push(workerInfo);
      config.worker_count = config.workers.length;
      config.next_worker_index = workerIndex + 1;
      saveTeamConfig(config, options.cwd);

      workerPaneIds.push(spawnResult.paneId);
      addedNames.push(workerName);
      nextIndex = workerIndex + 1;
    }
  } catch (error) {
    await rollbackStartedWorkers({
      teamName: options.teamName,
      cwd: options.cwd,
      sessionName: config.tmux_session,
      leaderPaneId: config.leader_pane_id,
      workers: addedWorkers,
      tmux: options.tmux,
      worktrees: options.worktrees,
      config,
      error,
      writeFailureSidecar: true,
    });
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
  if (nextTaskId !== config.next_task_id) {
    config.next_task_id = nextTaskId;
    saveTeamConfig(config, options.cwd);
  }

  return {
    ok: true,
    newWorkerCount: config.workers.length,
    nextWorkerIndex: config.next_worker_index ?? nextIndex,
    addedWorkers: addedNames,
  };
}
