/**
 * Vendored from upstream OMC team state paths.
 * Source: /Users/kimzerokim/.claude/plugins/marketplaces/omc/src/team/state-paths.ts
 * Upstream commit: 50f6ff05eb5d9ebed66f05d8c4580c0b119f37af
 */

import { isAbsolute, join } from "path";

export function normalizeTaskFileStem(taskId: string): string {
  return String(taskId).trim().replace(/\.json$/i, "");
}

export const TeamPaths = {
  root: (teamName: string) => `.pi-oven/state/team/${teamName}`,
  config: (teamName: string) => `.pi-oven/state/team/${teamName}/config.json`,
  startupFailure: (teamName: string) => `.pi-oven/state/team/${teamName}/startup-failure.json`,
  tasks: (teamName: string) => `.pi-oven/state/team/${teamName}/tasks`,
  taskFile: (teamName: string, taskId: string) =>
    `.pi-oven/state/team/${teamName}/tasks/${normalizeTaskFileStem(taskId)}.json`,
  workers: (teamName: string) => `.pi-oven/state/team/${teamName}/workers`,
  workerDir: (teamName: string, workerName: string) =>
    `.pi-oven/state/team/${teamName}/workers/${workerName}`,
  inbox: (teamName: string, workerName: string) =>
    `.pi-oven/state/team/${teamName}/workers/${workerName}/inbox.md`,
  ready: (teamName: string, workerName: string) =>
    `.pi-oven/state/team/${teamName}/workers/${workerName}/.ready`,
  overlay: (teamName: string, workerName: string) =>
    `.pi-oven/state/team/${teamName}/workers/${workerName}/AGENTS.md`,
  mailbox: (teamName: string, workerName: string) =>
    `.pi-oven/state/team/${teamName}/mailbox/${workerName}.json`,
  manifest: (teamName: string) => `.pi-oven/state/team/${teamName}/manifest.json`,
} as const;

export function absPath(cwd: string, relativePath: string): string {
  if (isAbsolute(relativePath)) {
    return relativePath;
  }
  return join(cwd, relativePath);
}

export function teamStateRoot(cwd: string, teamName: string): string {
  return join(cwd, TeamPaths.root(teamName));
}

export function getTaskStoragePath(cwd: string, teamName: string, taskId?: string): string {
  if (taskId !== undefined) {
    return join(cwd, TeamPaths.taskFile(teamName, taskId));
  }
  return join(cwd, TeamPaths.tasks(teamName));
}
