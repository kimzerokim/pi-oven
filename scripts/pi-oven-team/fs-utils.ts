/**
 * Vendored from upstream OMC filesystem utilities.
 * Source: /Users/kimzerokim/.claude/plugins/marketplaces/omc/src/team/fs-utils.ts
 * Upstream commit: 50f6ff05eb5d9ebed66f05d8c4580c0b119f37af
 */

import {
  closeSync,
  constants,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from "fs";
import { basename, dirname, join, relative, resolve } from "path";

export interface OrderedPersistenceMutation {
  order: number;
  surface: string;
  key: string;
  action: "save" | "delete";
  apply: () => void;
}

export function atomicWriteJson(filePath: string, data: unknown, mode: number = 0o600): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  const tmpPath = `${filePath}.tmp.${process.pid}.${Date.now()}`;
  writeFileSync(tmpPath, `${JSON.stringify(data, null, 2)}\n`, { encoding: "utf-8", mode });
  renameSync(tmpPath, filePath);
}

export function writeFileWithMode(filePath: string, data: string, mode: number = 0o600): void {
  writeFileSync(filePath, data, { encoding: "utf-8", mode });
}

export function appendFileWithMode(filePath: string, data: string, mode: number = 0o600): void {
  const fd = openSync(filePath, constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT, mode);
  try {
    writeSync(fd, data, null, "utf-8");
  } finally {
    closeSync(fd);
  }
}

export function ensureDirWithMode(dirPath: string, mode: number = 0o700): void {
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true, mode });
  }
}

export function readJsonFile<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as T;
  } catch {
    return null;
  }
}

export function removeFileIfPresent(path: string): void {
  try {
    unlinkSync(path);
  } catch {
    // best-effort cleanup
  }
}

export function planOrderedPersistenceMutations(
  mutations: readonly OrderedPersistenceMutation[]
): { ordered: OrderedPersistenceMutation[]; labels: string[] } {
  const ordered = [...mutations].sort((left, right) => {
    if (left.order !== right.order) {
      return left.order - right.order;
    }
    const surfaceOrder = left.surface.localeCompare(right.surface);
    if (surfaceOrder !== 0) {
      return surfaceOrder;
    }
    const keyOrder = left.key.localeCompare(right.key, undefined, { numeric: true });
    if (keyOrder !== 0) {
      return keyOrder;
    }
    return left.action.localeCompare(right.action);
  });
  return {
    ordered,
    labels: ordered.map((mutation) => `${mutation.surface}:${mutation.key}:${mutation.action}`),
  };
}

export function applyOrderedPersistenceMutations(mutations: readonly OrderedPersistenceMutation[]): string[] {
  const plan = planOrderedPersistenceMutations(mutations);
  for (const mutation of plan.ordered) {
    mutation.apply();
  }
  return plan.labels;
}

function safeRealpath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    const segments: string[] = [];
    let current = resolve(path);
    while (!existsSync(current)) {
      segments.unshift(basename(current));
      const parent = dirname(current);
      if (parent === current) {
        break;
      }
      current = parent;
    }
    try {
      return join(realpathSync(current), ...segments);
    } catch {
      return resolve(path);
    }
  }
}

export function validateResolvedPath(resolvedPath: string, expectedBase: string): void {
  const absResolved = safeRealpath(resolvedPath);
  const absBase = safeRealpath(expectedBase);
  const rel = relative(absBase, absResolved);
  if (rel.startsWith("..") || resolve(absBase, rel) !== absResolved) {
    throw new Error(`Path traversal detected: \"${resolvedPath}\" escapes base \"${expectedBase}\"`);
  }
}
