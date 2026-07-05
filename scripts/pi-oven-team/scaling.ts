/**
 * Vendored from upstream OMC scale-up guard and rollback semantics.
 * Source: /Users/kimzerokim/.claude/plugins/marketplaces/omc/src/team/scaling.ts
 * Upstream commit: 50f6ff05eb5d9ebed66f05d8c4580c0b119f37af
 */

import {
  buildStartupEvidence,
  buildWorkerInfo,
  persistTaskStateWrites,
  readTeamConfig,
  saveTeamConfigWithStartupEvidence,
  type TaskStateWrite,
} from "./team-config";
import { rollbackStartedWorkers } from "./rollback";
import {
  executeStartupWorkerBatches,
  IDLE_BOOTSTRAP_TASK,
  planStartupWorkerBatches,
  type StartupWorkerPlan,
} from "./runtime-v2";
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
  const taskWrites: TaskStateWrite[] = [];
  const plans: StartupWorkerPlan[] = [];


  let collisionEvidence: string[] = [];
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
      const taskId = allocatedTaskId ?? String(initialNextTaskId + offset);
      const startedWorker: StartedWorkerRecord = {
        workerName,
        worktreePath: worktree?.path,
        worktreeCreated: worktree?.created,
        taskId: allocatedTaskId ?? undefined,
      };

      if (startupTask && allocatedTaskId) {
        taskWrites.push({
          taskId: allocatedTaskId,
          task: startupTask,
          owner: startupTask.owner ?? workerName,
        });
        nextTaskId += 1;
      }

      addedWorkers.push(startedWorker);
      addedNames.push(workerName);
      plans.push({
        workerName,
        workerIndex,
        taskId,
        task: startupTask ?? IDLE_BOOTSTRAP_TASK,
        startupTask,
        workerInfo,
        startedWorker,
        persistenceClaims: [
          { surface: "worker_dir", key: workerName },
          ...(allocatedTaskId ? [{ surface: "task_file", key: allocatedTaskId } as const] : []),
        ],
      });
      nextIndex = workerIndex + 1;
    }
    const batchPlan = planStartupWorkerBatches(plans);
    collisionEvidence = [...batchPlan.collisionEvidence];
    const taskPersistenceOrder = persistTaskStateWrites(options.teamName, options.cwd, taskWrites);
    const execution = await executeStartupWorkerBatches({
      batches: batchPlan.batches,
      workerPaneIds: config.workers
        .map((worker) => worker.pane_id)
        .filter((paneId): paneId is string => typeof paneId === "string"),
      sessionName: config.tmux_session,
      leaderPaneId: config.leader_pane_id,
      teamName: options.teamName,
      agentType: options.agentType,
      cwd: options.cwd,
      tmux: options.tmux,
      buildWorkerStart: options.buildWorkerStart,
      dispatchStartup: options.dispatchStartup,
    });

    for (const plan of plans) {
      config.workers.push(plan.workerInfo);
    }
    config.worker_count = config.workers.length;
    config.next_worker_index = nextIndex;
    config.next_task_id = nextTaskId;

    const finalConfigSaveLabel = `team_config:${config.name}:save`;
    const startupEvidence = buildStartupEvidence({
      fanoutLatencyMs: execution.fanoutLatencyMs,
      sequentialComparableLatencyMs: execution.sequentialComparableLatencyMs,
      collisionEvidence,
      reducerOrder: batchPlan.reducerOrder,
      persistenceOrder: [...taskPersistenceOrder, finalConfigSaveLabel],
    });
    saveTeamConfigWithStartupEvidence(config, options.cwd, startupEvidence);

    return {
      ok: true,
      newWorkerCount: config.workers.length,
      nextWorkerIndex: config.next_worker_index ?? nextIndex,
      addedWorkers: addedNames,
    };
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
      collisionEvidence,
    });
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
