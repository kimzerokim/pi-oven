/**
 * Vendored from upstream OMC runtime-v2 startup/spawn flows.
 * Source: /Users/kimzerokim/.claude/plugins/marketplaces/omc/src/team/runtime-v2.ts
 * Upstream commit: 50f6ff05eb5d9ebed66f05d8c4580c0b119f37af
 */

import { classifyLaneForTask } from "./lane-policy";
import {
  buildInitialTeamConfig,
  buildStartupEvidence,
  buildWorkerInfo,
  ensureTeamState,
  persistTaskStateWrites,
  saveTeamConfigWithStartupEvidence,
  type TaskStateWrite,
} from "./team-config";
import {
  buildDependencyAwareBatches,
  type DependencyAwareBarrierBenchmark,
} from "./task-file-ops";
import { rollbackStartedWorkers } from "./rollback";
import {
  PI_OVEN_NATIVE_MAX_WORKERS,
  type SpawnWorkerResult,
  type StartTeamV2Options,
  type TeamRuntimeHandle,
  type TeamRuntimePersistenceClaim,
  type TeamTaskInput,
  type WorkerInfo,
} from "./types";
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
  task: TeamTaskInput;
  cwd: string;
  workerCwd: string;
  worktreePath?: string;
  paneId?: string;
  tmux: StartTeamV2Options["tmux"];
  buildWorkerStart: StartTeamV2Options["buildWorkerStart"];
  dispatchStartup: StartTeamV2Options["dispatchStartup"];
}

export interface StartupWorkerPlan {
  workerName: string;
  workerIndex: number;
  taskId: string;
  task: TeamTaskInput;
  startupTask?: TeamTaskInput;
  workerInfo: WorkerInfo;
  startedWorker: { workerName: string; paneId?: string; worktreePath?: string; worktreeCreated?: boolean; taskId?: string };
  persistenceClaims: TeamRuntimePersistenceClaim[];
}

export interface StartupWorkerBatchPlan {
  batches: StartupWorkerPlan[][];
  barrierBenchmark: DependencyAwareBarrierBenchmark;
  reducerOrder: string[];
  collisionEvidence: string[];
}

export interface StartupBatchExecutionResult {
  fanoutLatencyMs: number;
  sequentialComparableLatencyMs: number;
  reservationBenchmark: DependencyAwareBarrierBenchmark;
  spawnBenchmark: DependencyAwareBarrierBenchmark;
  workerPaneIds: string[];
}

export const IDLE_BOOTSTRAP_TASK: TeamTaskInput = {
  subject: "Await next claim",
  description: "Stay ready and claim the next pending owned task once the leader dispatches it.",
};
function predictNextPaneId(lastPaneId: string): string | null {
  const match = /^%(\d+)$/.exec(lastPaneId.trim());
  if (!match) {
    return null;
  }
  return `%${Number(match[1]) + 1}`;
}

export async function spawnV2Worker(opts: SpawnV2WorkerOptions): Promise<SpawnWorkerResult> {
  const paneId = opts.paneId ?? await opts.tmux.splitWorkerPane(
    opts.existingWorkerPaneIds.length === 0
      ? opts.leaderPaneId
      : opts.existingWorkerPaneIds[opts.existingWorkerPaneIds.length - 1]!,
    opts.existingWorkerPaneIds.length === 0 ? "right" : "down",
    opts.workerCwd
  );
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

export function planStartupWorkerBatches(plans: readonly StartupWorkerPlan[]): StartupWorkerBatchPlan {
  const batchPlan = buildDependencyAwareBatches(
    plans.map((plan) => {
      const lane = classifyLaneForTask(plan.startupTask ?? {});
      return {
        id: plan.taskId,
        blockedBy: plan.startupTask?.blocked_by ?? [],
        lane,
        persistenceClaims: [
          ...plan.persistenceClaims,
          ...(lane.persistence_claims ?? []),
        ],
        value: plan,
      };
    })
  );

  return {
    batches: batchPlan.batches.map((batch) => batch.map((item) => item.value ?? plans[0]!)),
    barrierBenchmark: batchPlan.barrierBenchmark,
    reducerOrder: batchPlan.reducerOrder,
    collisionEvidence: batchPlan.collisionEvidence,
  };
}

export async function executeStartupWorkerBatches(args: {
  batches: readonly StartupWorkerPlan[][];
  workerPaneIds: string[];
  sessionName: string;
  leaderPaneId: string;
  teamName: string;
  agentType: string;
  cwd: string;
  tmux: StartTeamV2Options["tmux"];
  buildWorkerStart: StartTeamV2Options["buildWorkerStart"];
  dispatchStartup: StartTeamV2Options["dispatchStartup"];
  beforeBatchSpawn?: (context: {
    batchIndex: number;
    batch: readonly StartupWorkerPlan[];
  }) => void | Promise<void>;
}): Promise<StartupBatchExecutionResult> {
  const workerPaneIds = [...args.workerPaneIds];
  const reservationBenchmark: DependencyAwareBarrierBenchmark = {
    sequentialUnits: 0,
    criticalPathUnits: 0,
    overlapUnits: 0,
  };
  const spawnBenchmark: DependencyAwareBarrierBenchmark = {
    sequentialUnits: 0,
    criticalPathUnits: 0,
    overlapUnits: 0,
  };

  for (const [batchIndex, batch] of args.batches.entries()) {
    if (batch.length === 0) {
      continue;
    }
    reservationBenchmark.sequentialUnits += batch.length;
    reservationBenchmark.criticalPathUnits += 1;
    const reservationPromises: Array<Promise<{ plan: StartupWorkerPlan; paneId: string }>> = [];
    const tmux = args.tmux as StartTeamV2Options["tmux"] & {
      splitWorkerPaneOptimistic?: (
        splitTarget: string | Promise<string>,
        optimisticTarget: string,
        direction: "right" | "down",
        cwd: string
      ) => Promise<string | null>;
    };
    let actualSplitTarget: string | Promise<string> = workerPaneIds.length === 0
      ? args.leaderPaneId
      : workerPaneIds[workerPaneIds.length - 1]!;
    let predictedSplitTarget =
      typeof actualSplitTarget === "string"
        ? actualSplitTarget
        : args.leaderPaneId;
    let predictedPaneId = predictNextPaneId(predictedSplitTarget);
    const firstSplitDirection = workerPaneIds.length === 0 ? "right" : "down";

    for (const [index, plan] of batch.entries()) {
      const splitDirection = index === 0 ? firstSplitDirection : "down";
      const optimisticTarget = predictedSplitTarget;
      const paneIdPromise: Promise<string | null> =
        typeof tmux.splitWorkerPaneOptimistic === "function"
          ? tmux.splitWorkerPaneOptimistic(
            actualSplitTarget,
            optimisticTarget,
            splitDirection,
            plan.workerInfo.working_dir ?? args.cwd
          )
          : Promise.resolve(actualSplitTarget).then((actualTarget) =>
            tmux.splitWorkerPane(
              actualTarget,
              splitDirection,
              plan.workerInfo.working_dir ?? args.cwd
            )
          );
      reservationPromises.push(
        Promise.resolve(paneIdPromise).then((paneId) => {
          if (!paneId) {
            throw new Error(`worker_startup_failed:${plan.workerName}:pane_id_missing`);
          }
          return { plan, paneId };
        })
      );
      const nextTargetLabel = predictedPaneId ?? optimisticTarget;
      predictedSplitTarget = nextTargetLabel;
      predictedPaneId = predictNextPaneId(nextTargetLabel);
      actualSplitTarget = paneIdPromise.then((paneId: string | null) => {
        if (!paneId) {
          throw new Error(`worker_startup_failed:${plan.workerName}:pane_id_missing`);
        }
        return paneId;
      });
    }

    const reservationResults = await Promise.allSettled(reservationPromises);
    const reservations: Array<{ plan: StartupWorkerPlan; paneId: string }> = [];
    let reservationFailure: unknown = null;
    for (const reservationResult of reservationResults) {
      if (reservationResult.status === "rejected") {
        reservationFailure ??= reservationResult.reason;
        continue;
      }
      reservations.push(reservationResult.value);
      reservationResult.value.plan.startedWorker.paneId = reservationResult.value.paneId;
      workerPaneIds.push(reservationResult.value.paneId);
    }
    if (reservationFailure) {
      throw reservationFailure;
    }

    await args.beforeBatchSpawn?.({ batchIndex, batch });
    spawnBenchmark.sequentialUnits += reservations.length;
    spawnBenchmark.criticalPathUnits += 1;
    const batchResults = await Promise.all(
      reservations.map(async (reservation) => {
        const spawnResult = await spawnV2Worker({
          sessionName: args.sessionName,
          leaderPaneId: args.leaderPaneId,
          existingWorkerPaneIds: workerPaneIds,
          teamName: args.teamName,
          workerName: reservation.plan.workerName,
          workerIndex: reservation.plan.workerIndex,
          agentType: args.agentType,
          taskId: reservation.plan.taskId,
          task: reservation.plan.task,
          cwd: args.cwd,
          workerCwd: reservation.plan.workerInfo.working_dir ?? args.cwd,
          worktreePath: reservation.plan.workerInfo.worktree_path,
          paneId: reservation.paneId,
          tmux: args.tmux,
          buildWorkerStart: args.buildWorkerStart,
          dispatchStartup: args.dispatchStartup,
        });
        return { reservation, spawnResult };
      })
    );

    let batchFailure: Error | null = null;
    for (const result of batchResults) {
      const { plan } = result.reservation;
      if (result.spawnResult.paneId) {
        plan.startedWorker.paneId = result.spawnResult.paneId;
        plan.workerInfo.pane_id = result.spawnResult.paneId;
        plan.workerInfo.assigned_tasks = plan.startupTask ? [plan.taskId] : [];
        plan.workerInfo.worker_cli = args.agentType;
        if (result.spawnResult.outputFile) {
          plan.workerInfo.output_file = result.spawnResult.outputFile;
        }
      }
      if (!batchFailure && result.spawnResult.startupFailureReason) {
        batchFailure = new Error(
          `worker_startup_failed:${plan.workerName}:${result.spawnResult.startupFailureReason}`
        );
      }
    }

    if (batchFailure) {
      throw batchFailure;
    }
  }

  reservationBenchmark.overlapUnits = Math.max(
    0,
    reservationBenchmark.sequentialUnits - reservationBenchmark.criticalPathUnits
  );
  spawnBenchmark.overlapUnits = Math.max(
    0,
    spawnBenchmark.sequentialUnits - spawnBenchmark.criticalPathUnits
  );

  return {
    fanoutLatencyMs:
      reservationBenchmark.criticalPathUnits + spawnBenchmark.criticalPathUnits,
    sequentialComparableLatencyMs:
      reservationBenchmark.sequentialUnits + spawnBenchmark.sequentialUnits,
    reservationBenchmark,
    spawnBenchmark,
    workerPaneIds,
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

  const session = await options.tmux.createTeamSession(options.teamName, 0, options.cwd, { newWindow: options.newWindow });
  const startedWorkers: Array<{ workerName: string; paneId?: string; worktreePath?: string; worktreeCreated?: boolean; taskId?: string }> = [];
  const workersInfo: WorkerInfo[] = [];
  const taskWrites: TaskStateWrite[] = [];
  const plans: StartupWorkerPlan[] = [];

  const plannedWorkers: Array<{
    workerIndex: number;
    workerName: string;
    taskId: string;
    startupTask: StartTeamV2Options["tasks"][number] | undefined;
  }> = [];

  for (let index = 0; index < options.workerCount; index++) {
    const workerIndex = index + 1;
    plannedWorkers.push({
      workerIndex,
      workerName: `worker-${workerIndex}`,
      taskId: String(index + 1),
      startupTask: options.tasks[index],
    });
  }

  const worktreeResults = await Promise.allSettled(
    plannedWorkers.map(({ workerName }) =>
      options.worktrees && options.worktreeMode !== "disabled"
        ? options.worktrees.ensureWorkerWorktree(options.teamName, workerName, options.cwd, { mode: options.worktreeMode })
        : Promise.resolve(null)
    )
  );

  const rollbackPreparedWorkers: typeof startedWorkers = [];
  let worktreeFailure: unknown = null;
  for (const [index, plannedWorker] of plannedWorkers.entries()) {
    const worktreeResult = worktreeResults[index]!;
    if (worktreeResult.status === "rejected") {
      worktreeFailure ??= worktreeResult.reason;
      continue;
    }
    const worktree = worktreeResult.value;
    if (worktree) {
      rollbackPreparedWorkers.push({
        workerName: plannedWorker.workerName,
        worktreePath: worktree.path,
        worktreeCreated: worktree.created,
        taskId: plannedWorker.startupTask ? plannedWorker.taskId : undefined,
      });
    }
  }
  if (worktreeFailure) {
    await rollbackStartedWorkers({
      teamName: options.teamName,
      cwd: options.cwd,
      sessionName: session.sessionName,
      leaderPaneId: session.leaderPaneId,
      workers: rollbackPreparedWorkers,
      tmux: options.tmux,
      worktrees: options.worktrees,
      error: worktreeFailure,
      writeFailureSidecar: true,
      killSession: true,
    });
    throw worktreeFailure;
  }

  for (const [index, plannedWorker] of plannedWorkers.entries()) {
    const worktreeResult = worktreeResults[index]!;
    if (worktreeResult.status !== "fulfilled") {
      continue;
    }
    const worktree = worktreeResult.value;
    const workerInfo = buildWorkerInfo(
      plannedWorker.workerIndex,
      options.cwd,
      worktree?.path,
      worktree?.created
    );
    const startedWorker = {
      workerName: plannedWorker.workerName,
      worktreePath: worktree?.path,
      worktreeCreated: worktree?.created,
      taskId: plannedWorker.startupTask ? plannedWorker.taskId : undefined,
    };
    const task = plannedWorker.startupTask ?? IDLE_BOOTSTRAP_TASK;
    if (plannedWorker.startupTask) {
      taskWrites.push({
        taskId: plannedWorker.taskId,
        task: plannedWorker.startupTask,
        owner: plannedWorker.startupTask.owner ?? plannedWorker.workerName,
      });
    }
    workersInfo.push(workerInfo);
    startedWorkers.push(startedWorker);
    plans.push({
      workerName: plannedWorker.workerName,
      workerIndex: plannedWorker.workerIndex,
      taskId: plannedWorker.taskId,
      task,
      startupTask: plannedWorker.startupTask,
      workerInfo,
      startedWorker,
      persistenceClaims: [
        { surface: "worker_dir", key: plannedWorker.workerName },
        ...(plannedWorker.startupTask ? [{ surface: "task_file", key: plannedWorker.taskId } as const] : []),
      ],
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

  let batchPlan: StartupWorkerBatchPlan | null = null;
  let startupPersistenceOrderPromise: Promise<string[]> | null = null;
  let execution: StartupBatchExecutionResult;
  try {
    batchPlan = planStartupWorkerBatches(plans);
    startupPersistenceOrderPromise = Promise.resolve().then(() => {
      const taskPersistenceOrder = persistTaskStateWrites(options.teamName, options.cwd, taskWrites);
      const initialConfigSaveLabel = saveTeamConfigWithStartupEvidence(teamConfig, options.cwd);
      return [...taskPersistenceOrder, initialConfigSaveLabel];
    });
    execution = await executeStartupWorkerBatches({
      batches: batchPlan.batches,
      workerPaneIds: [...session.workerPaneIds],
      sessionName: session.sessionName,
      leaderPaneId: session.leaderPaneId,
      teamName: options.teamName,
      agentType: options.agentType,
      cwd: options.cwd,
      tmux: options.tmux,
      buildWorkerStart: options.buildWorkerStart,
      dispatchStartup: options.dispatchStartup,
      beforeBatchSpawn: ({ batchIndex }) =>
        batchIndex === 0
          ? startupPersistenceOrderPromise?.then(() => undefined)
          : undefined,
    });
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
      collisionEvidence: batchPlan?.collisionEvidence ?? [],
    });
    throw error;
  }

  const resolvedBatchPlan = batchPlan;
  if (!resolvedBatchPlan) {
    throw new Error("worker_startup_failed:startup_batch_plan_missing");
  }
  const startupPersistenceOrder = startupPersistenceOrderPromise
    ? await startupPersistenceOrderPromise
    : [];

  teamConfig.workers = workersInfo;
  const finalConfigSaveLabel = `team_config:${teamConfig.name}:save`;
  const persistenceSequentialUnits = taskWrites.length + 1;
  const persistenceOverlapUnits = Math.min(
    persistenceSequentialUnits,
    resolvedBatchPlan.batches.length > 0 ? 1 : 0
  );
  const startupEvidence = buildStartupEvidence({
    fanoutLatencyMs: execution.fanoutLatencyMs,
    sequentialComparableLatencyMs: execution.sequentialComparableLatencyMs,
    collisionEvidence: resolvedBatchPlan.collisionEvidence,
    reducerOrder: resolvedBatchPlan.reducerOrder,
    persistenceOrder: [...startupPersistenceOrder, finalConfigSaveLabel],
    benchmark: {
      model: "synthetic-barrier-units-v1",
      reservation: execution.reservationBenchmark,
      persistence: {
        sequentialUnits: persistenceSequentialUnits,
        criticalPathUnits: Math.max(
          0,
          persistenceSequentialUnits - persistenceOverlapUnits
        ),
        overlapUnits: persistenceOverlapUnits,
      },
      spawn: execution.spawnBenchmark,
    },
  });
  saveTeamConfigWithStartupEvidence(teamConfig, options.cwd, startupEvidence);

  return {
    teamName: options.teamName,
    sessionName: session.sessionName,
    leaderPaneId: session.leaderPaneId,
    workerPaneIds: execution.workerPaneIds,
    config: teamConfig as TeamRuntimeHandle["config"],
  };
}
