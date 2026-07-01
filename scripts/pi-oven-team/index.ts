import { existsSync } from "node:fs";
import * as path from "node:path";
import {
  DEFAULT_NATIVE_WORKER_MAX,
  readGlobalNativeWorkerMax,
  readProjectNativeWorkerMax,
} from "../pi-oven-setup/project-config";
import { startTeamV2 } from "./runtime-v2";
import { scaleUp } from "./scaling";
import { createProcessTmuxController } from "./tmux-session";
import type {
  ScaleUpOptions,
  ScaleUpResult,
  ScaleError,
  StartTeamV2Options,
  TeamRuntimeHandle,
  TeamTmuxController,
} from "./types";

export const PI_OVEN_NATIVE_RUNTIME_CONTROL_PATH = "scripts/pi-oven-team/index.ts";
export const PI_OVEN_NATIVE_RUNTIME_IMPL_PATH = "scripts/pi-oven-team/runtime-v2.ts";

export type NativeWorkerRuntimeConfigSource =
  | "project-local override"
  | "machine-global config"
  | "pi-oven default";

export interface NativeWorkerRuntimeStatus {
  active: boolean;
  owner: "pi-oven-vendored";
  controlPath: string;
  implementationPath: string;
  maxWorkers: number;
  maxWorkersConfigPath: string;
  maxWorkersSource: NativeWorkerRuntimeConfigSource;
  degradedReason?: string;
}

export interface ResolveNativeWorkerRuntimeStatusOptions {
  pluginRoot?: string;
  projectRoot?: string;
  homeDir?: string;
}

export interface StartNativeTeamRuntimeOptions
  extends Omit<StartTeamV2Options, "tmux" | "maxWorkers"> {
  pluginRoot?: string;
  homeDir?: string;
  tmux?: TeamTmuxController;
  tmuxBinary?: string;
}

export interface ScaleNativeTeamRuntimeOptions
  extends Omit<ScaleUpOptions, "tmux"> {
  pluginRoot?: string;
  homeDir?: string;
  tmux?: TeamTmuxController;
  tmuxBinary?: string;
}


function fileLabel(pluginRoot: string, relativePath: string): string {
  const absolute = path.resolve(pluginRoot, relativePath);
  return absolute.startsWith(pluginRoot)
    ? path.relative(pluginRoot, absolute) || relativePath
    : relativePath;
}

export async function resolveNativeWorkerRuntimeStatus(
  opts: ResolveNativeWorkerRuntimeStatusOptions = {}
): Promise<NativeWorkerRuntimeStatus> {
  const pluginRoot = opts.pluginRoot ?? path.resolve(import.meta.dir, "..", "..");
  const projectRoot = opts.projectRoot ?? process.cwd();
  const projectNativeWorkerMax = await readProjectNativeWorkerMax({ cwd: projectRoot });
  const globalNativeWorkerMax = await readGlobalNativeWorkerMax({ homeDir: opts.homeDir });
  const maxWorkers =
    projectNativeWorkerMax ?? globalNativeWorkerMax ?? DEFAULT_NATIVE_WORKER_MAX;
  const maxWorkersConfigPath =
    projectNativeWorkerMax !== null
      ? path.join(projectRoot, ".pi-oven", "config.json")
      : "~/.pi-oven/config.json";
  const maxWorkersSource: NativeWorkerRuntimeConfigSource =
    projectNativeWorkerMax !== null
      ? "project-local override"
      : globalNativeWorkerMax !== null
        ? "machine-global config"
        : "pi-oven default";

  const controlPath = fileLabel(pluginRoot, PI_OVEN_NATIVE_RUNTIME_CONTROL_PATH);
  const implementationPath = fileLabel(pluginRoot, PI_OVEN_NATIVE_RUNTIME_IMPL_PATH);
  const controlPresent = existsSync(path.resolve(pluginRoot, PI_OVEN_NATIVE_RUNTIME_CONTROL_PATH));
  const implementationPresent = existsSync(
    path.resolve(pluginRoot, PI_OVEN_NATIVE_RUNTIME_IMPL_PATH)
  );
  const active = controlPresent && implementationPresent;

  let degradedReason: string | undefined;
  if (!active) {
    const missing: string[] = [];
    if (!controlPresent) missing.push(controlPath);
    if (!implementationPresent) missing.push(implementationPath);
    degradedReason =
      missing.length === 1
        ? `missing vendored runtime file ${missing[0]}`
        : `missing vendored runtime files ${missing.join(", ")}`;
  }

  return {
    active,
    owner: "pi-oven-vendored",
    controlPath,
    implementationPath,
    maxWorkers,
    maxWorkersConfigPath,
    maxWorkersSource,
    degradedReason,
  };
}

export function describeNativeWorkerRuntime(status: NativeWorkerRuntimeStatus): string {
  const base =
    `vendored launcher ${status.controlPath} → ${status.implementationPath} ` +
    (status.active ? "is ACTIVE" : "is INACTIVE");
  return status.active
    ? `${base}; pi-oven owns native worker startup and scale decisions through this path.`
    : `${base}; ${status.degradedReason ?? "runtime files unavailable"}.`;
}

function resolveTmuxController(opts: {
  tmux?: TeamTmuxController;
  tmuxBinary?: string;
}): TeamTmuxController {
  if (opts.tmux) {
    return opts.tmux;
  }
  const tmuxBinary = opts.tmuxBinary ?? Bun.which("tmux");
  if (!tmuxBinary) {
    throw new Error(
      "pi-oven vendored native runtime prerequisites missing: tmux is not available on PATH"
    );
  }
  return createProcessTmuxController(tmuxBinary);
}

export async function startNativeTeamRuntime(
  options: StartNativeTeamRuntimeOptions
): Promise<TeamRuntimeHandle> {
  const status = await resolveNativeWorkerRuntimeStatus({
    pluginRoot: options.pluginRoot,
    projectRoot: options.cwd,
    homeDir: options.homeDir,
  });
  if (!status.active) {
    throw new Error(
      `pi-oven vendored native runtime is inactive: ${status.degradedReason ?? "runtime files unavailable"}`
    );
  }

  const { pluginRoot: _pluginRoot, homeDir: _homeDir, tmuxBinary, tmux, ...startOptions } =
    options;
  return startTeamV2({
    ...startOptions,
    tmux: resolveTmuxController({ tmux, tmuxBinary }),
    maxWorkers: status.maxWorkers,
  });
}

export async function scaleNativeTeamRuntime(
  options: ScaleNativeTeamRuntimeOptions
): Promise<ScaleUpResult | ScaleError> {
  const status = await resolveNativeWorkerRuntimeStatus({
    pluginRoot: options.pluginRoot,
    projectRoot: options.cwd,
    homeDir: options.homeDir,
  });
  if (!status.active) {
    return {
      ok: false,
      error: `pi-oven vendored native runtime is inactive: ${status.degradedReason ?? "runtime files unavailable"}`,
    };
  }

  const { pluginRoot: _pluginRoot, homeDir: _homeDir, tmuxBinary, tmux, ...scaleOptions } =
    options;
  return scaleUp({
    ...scaleOptions,
    tmux: resolveTmuxController({ tmux, tmuxBinary }),
    maxWorkers: status.maxWorkers,
  });
}

export { startTeamV2, scaleUp };
export type { StartTeamV2Options, ScaleUpOptions, TeamRuntimeHandle };
