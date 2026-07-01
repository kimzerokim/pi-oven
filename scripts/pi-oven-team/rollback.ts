/**
 * Derived from upstream OMC startup and scale-up rollback flows.
 * Sources:
 * - /Users/kimzerokim/.claude/plugins/marketplaces/omc/src/team/runtime-v2.ts
 * - /Users/kimzerokim/.claude/plugins/marketplaces/omc/src/team/scaling.ts
 * Upstream commit: 50f6ff05eb5d9ebed66f05d8c4580c0b119f37af
 */

import { removeTaskStateFile, removeWorkerStateDir, saveTeamConfig, writeStartupFailureSidecar } from "./team-config";
import type {
  StartedWorkerRecord,
  TeamConfig,
  TeamTmuxController,
  TeamWorktreeManager,
} from "./types";

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
}): Promise<void> {
  let rollbackError: unknown;

  try {
    for (const worker of args.workers.slice().reverse()) {
      if (worker.paneId) {
        try {
          await args.tmux.killPane(worker.paneId);
        } catch {
          // best-effort pane cleanup
        }
      }
      if (worker.taskId) {
        removeTaskStateFile(args.teamName, args.cwd, worker.taskId);
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

    if (args.config) {
      const removedNames = new Set(args.workers.map((worker) => worker.workerName));
      args.config.workers = args.config.workers.filter((worker) => !removedNames.has(worker.name));
      args.config.worker_count = args.config.workers.length;
      args.config.next_worker_index = Math.max(
        args.config.next_worker_index ?? args.config.workers.length + 1,
        args.config.workers.length + 1
      );
      saveTeamConfig(args.config, args.cwd);
    }

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
    writeStartupFailureSidecar(args.teamName, args.cwd, args.error, args.workers, rollbackError);
  }

  if (rollbackError) {
    throw rollbackError;
  }
}
