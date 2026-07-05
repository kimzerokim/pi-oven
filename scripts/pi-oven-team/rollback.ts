/**
 * Derived from upstream OMC startup and scale-up rollback flows.
 * Sources:
 * - /Users/kimzerokim/.claude/plugins/marketplaces/omc/src/team/runtime-v2.ts
 * - /Users/kimzerokim/.claude/plugins/marketplaces/omc/src/team/scaling.ts
 * Upstream commit: 50f6ff05eb5d9ebed66f05d8c4580c0b119f37af
 */

import { applyOrderedPersistenceMutations } from "./fs-utils";
import { removeTaskStateFile, saveTeamConfig, writeStartupFailureSidecar } from "./team-config";
import { removeWorkerStateDir } from "./team-config";
import type {
  StartedWorkerRecord,
  TeamConfig,
  TeamTmuxController,
  TeamWorktreeManager,
} from "./types";

function nextWorkerIndexFromConfig(config: TeamConfig): number {
  const highestIndex = config.workers.reduce((maxIndex, worker) => Math.max(maxIndex, worker.index), 0);
  return highestIndex + 1;
}

export async function rollbackStartedWorkers(args: {
  teamName: string;
  cwd: string;
  sessionName: string;
  leaderPaneId?: string | null;
  workers: StartedWorkerRecord[];
  tmux: TeamTmuxController;
  worktrees?: TeamWorktreeManager;
  config?: TeamConfig;
  error: unknown;
  writeFailureSidecar?: boolean;
  killSession?: boolean;
  collisionEvidence?: readonly string[];
}): Promise<void> {
  let rollbackError: unknown;
  let rollbackPersistenceOrder: string[] = [];

  try {
    const reversedWorkers = [...args.workers].reverse();
    for (const worker of reversedWorkers) {
      if (worker.paneId) {
        try {
          await args.tmux.killPane(worker.paneId);
        } catch {
          // best-effort pane cleanup
        }
      }
      if (worker.worktreePath && args.worktrees) {
        try {
          await args.worktrees.removeWorkerWorktree(args.teamName, worker.workerName, args.cwd);
        } catch {
          // best-effort worktree cleanup
        }
      }
      removeWorkerStateDir(args.teamName, worker.workerName, args.cwd);
    }

    const persistenceMutations: Array<{
      order: number;
      surface: string;
      key: string;
      action: "save" | "delete";
      apply: () => void;
    }> = reversedWorkers
      .filter((worker) => worker.taskId)
      .map((worker, index) => ({
        order: index,
        surface: "task_file",
        key: worker.taskId!,
        action: "delete" as const,
        apply: () => removeTaskStateFile(args.teamName, args.cwd, worker.taskId!),
      }));

    if (args.config) {
      const removedNames = new Set(args.workers.map((worker) => worker.workerName));
      args.config.workers = args.config.workers.filter((worker) => !removedNames.has(worker.name));
      args.config.worker_count = args.config.workers.length;
      args.config.next_worker_index = nextWorkerIndexFromConfig(args.config);
      persistenceMutations.push({
        order: persistenceMutations.length + 100,
        surface: "team_config",
        key: args.config.name,
        action: "save" as const,
        apply: () => saveTeamConfig(args.config!, args.cwd),
      });
    }

    rollbackPersistenceOrder = applyOrderedPersistenceMutations(persistenceMutations);

    if (args.killSession) {
      try {
        await args.tmux.killSession(
          args.sessionName,
          args.workers.map((worker) => worker.paneId).filter(Boolean) as string[],
          args.leaderPaneId ?? null
        );
      } catch {
        // a missing session after per-pane cleanup is acceptable
      }
    }
  } catch (error) {
    rollbackError = error;
  }

  if (args.writeFailureSidecar !== false) {
    writeStartupFailureSidecar(
      args.teamName,
      args.cwd,
      args.error,
      args.workers,
      rollbackError,
      {
        collisionEvidence: args.collisionEvidence,
        rollbackPersistenceOrder,
      }
    );
  }

  if (rollbackError) {
    throw rollbackError;
  }
}
