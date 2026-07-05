/**
 * Vendored from upstream OMC task claiming/runtime semantics.
 * Source: /Users/kimzerokim/.claude/plugins/marketplaces/omc/src/team/task-file-ops.ts
 * Upstream commit: 50f6ff05eb5d9ebed66f05d8c4580c0b119f37af
 */

import {
  closeSync,
  constants as fsConstants,
  existsSync,
  openSync,
  readFileSync,
  readdirSync,
  statSync,
  unlinkSync,
  writeSync,
} from "fs";
import { join } from "path";
import { assertLaneBatchIsIndependent } from "./lane-policy";
import { atomicWriteJson, ensureDirWithMode, readJsonFile } from "./fs-utils";
import { getTaskStoragePath } from "./state-paths";
import type {
  TaskFailureSidecar,
  TaskFile,
  TaskFileUpdate,
  TeamRuntimeLaneMetadata,
  TeamRuntimePersistenceClaim,
} from "./types";

export interface LockHandle {
  fd: number;
  path: string;
}

export interface DependencyAwareBatchItem<T = undefined> {
  id: string;
  blockedBy: string[];
  lane: TeamRuntimeLaneMetadata;
  persistenceClaims: TeamRuntimePersistenceClaim[];
  value?: T;
}

export interface DependencyAwareBatchPlan<T = undefined> {
  batches: Array<Array<DependencyAwareBatchItem<T>>>;
  reducerOrder: string[];
  collisionEvidence: string[];
}

const DEFAULT_STALE_LOCK_MS = 30_000;
export const DEFAULT_MAX_TASK_RETRIES = 5;

function sanitizeTaskId(taskId: string): string {
  const sanitized = String(taskId).trim().replace(/\.json$/i, "");
  if (sanitized.length === 0 || sanitized.includes("/") || sanitized.includes("\\")) {
    throw new Error(`Invalid task id: ${taskId}`);
  }
  return sanitized;
}

function canonicalTasksDir(teamName: string, cwd?: string): string {
  const root = cwd ?? process.cwd();
  return getTaskStoragePath(root, teamName);
}

function resolveTaskPath(teamName: string, taskId: string, cwd?: string): string {
  return join(canonicalTasksDir(teamName, cwd), `${sanitizeTaskId(taskId)}.json`);
}

function failureSidecarPath(teamName: string, taskId: string, cwd?: string): string {
  return join(canonicalTasksDir(teamName, cwd), `${sanitizeTaskId(taskId)}.failure.json`);
}

function pidLooksAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function isLockStale(lockPath: string, staleLockMs: number): boolean {
  try {
    const stats = statSync(lockPath);
    if (Date.now() - stats.mtimeMs < staleLockMs) {
      return false;
    }
    const payload = JSON.parse(readFileSync(lockPath, "utf-8")) as { pid?: number };
    return !pidLooksAlive(payload.pid ?? -1);
  } catch {
    return true;
  }
}


export function buildDependencyAwareBatches<T>(
  items: readonly DependencyAwareBatchItem<T>[]
): DependencyAwareBatchPlan<T> {
  const pending = new Map(items.map((item) => [item.id, item]));
  const batches: Array<Array<DependencyAwareBatchItem<T>>> = [];
  const reducerOrder: string[] = [];
  const collisionEvidence: string[] = [];

  for (const item of items) {
    if (item.lane.shared_state_policy !== "read_only" && item.lane.kind !== "owned_write") {
      throw new Error("Fan-out rejected: only read_only and owned_write lanes may batch");
    }
  }

  while (pending.size > 0) {
    const ready = [...pending.values()]
      .filter((item) => item.blockedBy.every((blockerId) => !pending.has(blockerId)))
      .sort((left, right) => left.id.localeCompare(right.id, undefined, { numeric: true }));
    if (ready.length === 0) {
      throw new Error("Task dependency cycle prevents fan-out batching");
    }

    assertLaneBatchIsIndependent(
      ready.map((item) => ({
        kind: "owned_write",
        objective: item.lane.objective,
        independence_reason: item.lane.independence_reason,
        shared_state_policy: "exclusive_write",
        output_schema: "owned_write_result",
        reducer: "owned_write_commit",
        persistence_claims: item.persistenceClaims,
      }))
    );

    batches.push(ready);
    for (const item of ready) {
      reducerOrder.push(item.lane.reducer);
      for (const claim of item.persistenceClaims) {
        collisionEvidence.push(
          claim.key ? `${claim.surface}:${claim.key}` : claim.surface
        );
      }
      pending.delete(item.id);
    }
  }

  return { batches, reducerOrder, collisionEvidence };
}

export function acquireTaskLock(
  teamName: string,
  taskId: string,
  opts?: { staleLockMs?: number; workerName?: string; cwd?: string }
): LockHandle | null {
  const staleLockMs = opts?.staleLockMs ?? DEFAULT_STALE_LOCK_MS;
  const dir = canonicalTasksDir(teamName, opts?.cwd);
  ensureDirWithMode(dir);
  const lockPath = join(dir, `${sanitizeTaskId(taskId)}.lock`);

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(lockPath, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY, 0o600);
      const payload = JSON.stringify({
        pid: process.pid,
        workerName: opts?.workerName ?? "",
        timestamp: Date.now(),
      });
      writeSync(fd, payload, null, "utf-8");
      return { fd, path: lockPath };
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        (error as NodeJS.ErrnoException).code === "EEXIST"
      ) {
        if (attempt === 0 && isLockStale(lockPath, staleLockMs)) {
          try {
            unlinkSync(lockPath);
          } catch {
            // another worker may have reaped it first
          }
          continue;
        }
        return null;
      }
      throw error;
    }
  }

  return null;
}

export function releaseTaskLock(handle: LockHandle): void {
  try {
    closeSync(handle.fd);
  } catch {
    // already closed
  }
  try {
    unlinkSync(handle.path);
  } catch {
    // already removed
  }
}

export async function withTaskLock<T>(
  teamName: string,
  taskId: string,
  fn: () => T | Promise<T>,
  opts?: { staleLockMs?: number; workerName?: string; cwd?: string }
): Promise<T | null> {
  const handle = acquireTaskLock(teamName, taskId, opts);
  if (!handle) {
    return null;
  }
  try {
    return await fn();
  } finally {
    releaseTaskLock(handle);
  }
}

export function readTask(teamName: string, taskId: string, opts?: { cwd?: string }): TaskFile | null {
  return readJsonFile<TaskFile>(resolveTaskPath(teamName, taskId, opts?.cwd));
}

export function updateTask(
  teamName: string,
  taskId: string,
  updates: TaskFileUpdate,
  opts?: { useLock?: boolean; cwd?: string }
): void {
  const filePath = resolveTaskPath(teamName, taskId, opts?.cwd);
  const current = readTask(teamName, taskId, opts);
  if (!current) {
    throw new Error(`Task not found: ${taskId}`);
  }

  if (opts?.useLock !== false) {
    const handle = acquireTaskLock(teamName, taskId, { cwd: opts?.cwd });
    if (!handle) {
      throw new Error(`Cannot acquire lock for task ${taskId}`);
    }
    try {
      atomicWriteJson(filePath, { ...current, ...updates });
    } finally {
      releaseTaskLock(handle);
    }
    return;
  }

  atomicWriteJson(filePath, { ...current, ...updates });
}

export function listTaskIds(teamName: string, opts?: { cwd?: string }): string[] {
  const dir = canonicalTasksDir(teamName, opts?.cwd);
  if (!existsSync(dir)) {
    return [];
  }
  return readdirSync(dir)
    .filter((name) => name.endsWith(".json") && !name.endsWith(".failure.json"))
    .map((name) => name.replace(/\.json$/i, ""))
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
}

export function areBlockersResolved(teamName: string, blockedBy: string[], opts?: { cwd?: string }): boolean {
  if (blockedBy.length === 0) {
    return true;
  }
  for (const blockerId of blockedBy) {
    const blocker = readTask(teamName, blockerId, opts);
    if (!blocker || blocker.status !== "completed") {
      return false;
    }
  }
  return true;
}

export async function findNextTask(teamName: string, workerName: string, opts?: { cwd?: string }): Promise<TaskFile | null> {
  const dir = canonicalTasksDir(teamName, opts?.cwd);
  if (!existsSync(dir)) {
    return null;
  }

  for (const taskId of listTaskIds(teamName, opts)) {
    const task = readTask(teamName, taskId, opts);
    if (!task || task.status !== "pending" || task.owner !== workerName) {
      continue;
    }
    if (!areBlockersResolved(teamName, task.blockedBy, opts)) {
      continue;
    }

    const handle = acquireTaskLock(teamName, taskId, { workerName, cwd: opts?.cwd });
    if (!handle) {
      continue;
    }

    try {
      const freshTask = readTask(teamName, taskId, opts);
      if (
        !freshTask ||
        freshTask.status !== "pending" ||
        freshTask.owner !== workerName ||
        !areBlockersResolved(teamName, freshTask.blockedBy, opts)
      ) {
        continue;
      }

      const claimedAt = Date.now();
      const nextTask = {
        ...freshTask,
        claimedBy: workerName,
        claimedAt,
        claimPid: process.pid,
        status: "in_progress" as const,
      };
      atomicWriteJson(resolveTaskPath(teamName, taskId, opts?.cwd), nextTask);
      return nextTask;
    } finally {
      releaseTaskLock(handle);
    }
  }

  return null;
}

export function writeTaskFailure(teamName: string, taskId: string, error: string, opts?: { cwd?: string }): TaskFailureSidecar {
  const prior = readTaskFailure(teamName, taskId, opts);
  const next: TaskFailureSidecar = {
    taskId,
    lastError: error,
    retryCount: (prior?.retryCount ?? 0) + 1,
    lastFailedAt: new Date().toISOString(),
  };
  atomicWriteJson(failureSidecarPath(teamName, taskId, opts?.cwd), next);
  return next;
}

export function readTaskFailure(teamName: string, taskId: string, opts?: { cwd?: string }): TaskFailureSidecar | null {
  return readJsonFile<TaskFailureSidecar>(failureSidecarPath(teamName, taskId, opts?.cwd));
}

export function isTaskRetryExhausted(
  teamName: string,
  taskId: string,
  maxRetries: number = DEFAULT_MAX_TASK_RETRIES,
  opts?: { cwd?: string }
): boolean {
  const sidecar = readTaskFailure(teamName, taskId, opts);
  return (sidecar?.retryCount ?? 0) >= maxRetries;
}
