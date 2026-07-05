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
import { buildDependencyAwareBatches } from "./task-file-ops";
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
  reducerOrder: string[];
  collisionEvidence: string[];
}

export interface StartupBatchExecutionResult {
  fanoutLatencyMs: number;
  sequentialComparableLatencyMs: number;
  workerPaneIds: string[];
}

export const IDLE_BOOTSTRAP_TASK: TeamTaskInput = {
  subject: "Await next claim",
  description: "Stay ready and claim the next pending owned task once the leader dispatches it.",
};

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
}): Promise<StartupBatchExecutionResult> {
  const fanoutStart = Date.now();
  const workerPaneIds = [...args.workerPaneIds];
  let sequentialComparableLatencyMs = 0;

  for (const batch of args.batches) {
    const reservations: Array<{ plan: StartupWorkerPlan; paneId: string; splitLatencyMs: number }> = [];
    for (const plan of batch) {
      const splitTarget = workerPaneIds.length === 0
        ? args.leaderPaneId
        : workerPaneIds[workerPaneIds.length - 1]!;
      const splitDirection = workerPaneIds.length === 0 ? "right" : "down";
      const splitStartedAt = Date.now();
      const paneId = await args.tmux.splitWorkerPane(
        splitTarget,
        splitDirection,
        plan.workerInfo.working_dir ?? args.cwd
      );
      if (!paneId) {
        throw new Error(`worker_startup_failed:${plan.workerName}:pane_id_missing`);
      }
      const splitLatencyMs = Math.max(1, Date.now() - splitStartedAt);
      plan.startedWorker.paneId = paneId;
      workerPaneIds.push(paneId);
      reservations.push({ plan, paneId, splitLatencyMs });
    }

    const batchResults = await Promise.all(
      reservations.map(async (reservation) => {
        const startupStartedAt = Date.now();
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
        return {
          reservation,
          spawnResult,
          startupLatencyMs: Math.max(1, Date.now() - startupStartedAt),
        };
      })
    );

    sequentialComparableLatencyMs += batchResults.reduce(
      (total, result) => total + result.reservation.splitLatencyMs + result.startupLatencyMs,
      0
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

  return {
    fanoutLatencyMs: Math.max(1, Date.now() - fanoutStart),
    sequentialComparableLatencyMs,
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

  for (let index = 0; index < options.workerCount; index++) {
    const workerIndex = index + 1;
    const workerName = `worker-${workerIndex}`;
    const worktree = options.worktrees && options.worktreeMode !== "disabled"
      ? await options.worktrees.ensureWorkerWorktree(options.teamName, workerName, options.cwd, { mode: options.worktreeMode })
      : null;
    const workerInfo = buildWorkerInfo(workerIndex, options.cwd, worktree?.path, worktree?.created);
    const startedWorker = {
      workerName,
      worktreePath: worktree?.path,
      worktreeCreated: worktree?.created,
      taskId: options.tasks[index] ? String(index + 1) : undefined,
    };
    const startupTask = options.tasks[index];
    const task = startupTask ?? IDLE_BOOTSTRAP_TASK;
    if (startupTask) {
      taskWrites.push({
        taskId: String(index + 1),
        task: startupTask,
        owner: startupTask.owner ?? workerName,
      });
    }
    workersInfo.push(workerInfo);
    startedWorkers.push(startedWorker);
    plans.push({
      workerName,
      workerIndex,
      taskId: String(index + 1),
      task,
      startupTask,
      workerInfo,
      startedWorker,
      persistenceClaims: [
        { surface: "worker_dir", key: workerName },
        ...(startupTask ? [{ surface: "task_file", key: String(index + 1) } as const] : []),
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

  const batchPlan = planStartupWorkerBatches(plans);
  const taskPersistenceOrder = persistTaskStateWrites(options.teamName, options.cwd, taskWrites);
  const initialConfigSaveLabel = saveTeamConfigWithStartupEvidence(teamConfig, options.cwd);

  let execution: StartupBatchExecutionResult;
  try {
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
      collisionEvidence: batchPlan.collisionEvidence,
    });
    throw error;
  }

  teamConfig.workers = workersInfo;
  const finalConfigSaveLabel = `team_config:${teamConfig.name}:save`;
  const startupEvidence = buildStartupEvidence({
    fanoutLatencyMs: execution.fanoutLatencyMs,
    sequentialComparableLatencyMs: execution.sequentialComparableLatencyMs,
    collisionEvidence: batchPlan.collisionEvidence,
    reducerOrder: batchPlan.reducerOrder,
    persistenceOrder: [...taskPersistenceOrder, initialConfigSaveLabel, finalConfigSaveLabel],
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
