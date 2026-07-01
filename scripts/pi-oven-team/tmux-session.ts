/**
 * Vendored from upstream OMC tmux readiness/runtime helpers.
 * Source: /Users/kimzerokim/.claude/plugins/marketplaces/omc/src/team/tmux-session.ts
 * Upstream commit: 50f6ff05eb5d9ebed66f05d8c4580c0b119f37af
 */

import { execFile } from "child_process";
import { promisify } from "util";
import type { TeamTmuxController } from "./types";

const execFileAsync = promisify(execFile);

export interface WaitForPaneReadyOptions {
  timeoutMs?: number;
  pollIntervalMs?: number;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function renderEnvPrefix(envVars: Record<string, string> | undefined): string {
  if (!envVars || Object.keys(envVars).length === 0) {
    return "";
  }
  const parts: string[] = [];
  for (const [key, value] of Object.entries(envVars)) {
    if (!/^[A-Z_][A-Z0-9_]*$/i.test(key)) {
      throw new Error(`Invalid tmux env key: ${key}`);
    }
    parts.push(`${key}=${shellQuote(value)}`);
  }
  return `env ${parts.join(" ")} `;
}

function paneLineLooksLikeIdlePrompt(line: string): boolean {
  return /^\s*(?:[│┃║▌▐▏▕╎┆┊]\s*)?[›>❯]\s*/u.test(line);
}

function paneHasTrustPrompt(captured: string): boolean {
  const lines = captured
    .split("\n")
    .map((line) => line.replace(/\r/g, "").trim())
    .filter((line) => line.length > 0)
    .slice(-12);
  const hasDirectoryQuestion = lines.some((line) => /Do you trust the contents of this directory\?/i.test(line));
  const hasDirectoryChoices = lines.some((line) => /Yes,\s*continue|No,\s*quit|Press enter to continue/i.test(line));
  if (hasDirectoryQuestion && hasDirectoryChoices) {
    return true;
  }
  const hasHookReview = lines.some((line) => /Hooks need review/i.test(line));
  const hasHookTrustChoice = lines.some((line) => /Continue without trusting/i.test(line));
  const hasHookConfirm = lines.some((line) => /Press enter to confirm or esc to go back/i.test(line));
  return hasHookReview && hasHookTrustChoice && hasHookConfirm;
}

function paneIsBootstrapping(captured: string): boolean {
  const lines = captured
    .split("\n")
    .map((line) => line.replace(/\r/g, "").trim())
    .filter((line) => line.length > 0);
  if (lines.some((line) => /bypass\s+permissions\s+on|shift\+tab\s+to\s+cycle|^⏵⏵\s+/i.test(line))) {
    return !lines.some(paneLineLooksLikeIdlePrompt);
  }
  return lines.some((line) =>
    /\b(loading|initializing|starting up)\b/i.test(line) ||
    /\bmodel:\s*loading\b/i.test(line) ||
    /\bconnecting\s+to\b/i.test(line)
  );
}

export function paneHasActiveTask(captured: string): boolean {
  const lines = captured
    .split("\n")
    .map((line) => line.replace(/\r/g, "").trim())
    .filter((line) => line.length > 0)
    .slice(-40);
  return lines.some((line) =>
    /\b\d+\s+background terminal running\b/i.test(line) ||
    /esc to interrupt/i.test(line) ||
    /\bbackground terminal running\b/i.test(line) ||
    /^[·✻]\s+[A-Za-z][A-Za-z0-9''-]*(?:\s+[A-Za-z][A-Za-z0-9''-]*){0,3}(?:…|\.{3})$/u.test(line)
  );
}

export function paneLooksReady(captured: string): boolean {
  const content = captured.trimEnd();
  if (content.length === 0) {
    return false;
  }
  const lines = content
    .split("\n")
    .map((line) => line.replace(/\r/g, "").trimEnd())
    .filter((line) => line.trim().length > 0);
  if (lines.length === 0) {
    return false;
  }
  if (paneHasTrustPrompt(content)) {
    return true;
  }
  if (paneIsBootstrapping(content)) {
    return false;
  }
  const lastLine = lines[lines.length - 1]!;
  if (paneLineLooksLikeIdlePrompt(lastLine)) {
    return true;
  }
  return lines.some(paneLineLooksLikeIdlePrompt);
}

export async function waitForPaneReady(
  tmux: Pick<TeamTmuxController, "capturePane">,
  paneId: string,
  opts: WaitForPaneReadyOptions = {}
): Promise<boolean> {
  const envTimeout = Number.parseInt(process.env.PI_OVEN_SHELL_READY_TIMEOUT_MS ?? "", 10);
  const timeoutMs = Number.isFinite(opts.timeoutMs) && (opts.timeoutMs ?? 0) > 0
    ? Number(opts.timeoutMs)
    : Number.isFinite(envTimeout) && envTimeout > 0
    ? envTimeout
    : 30_000;
  const pollIntervalMs = Number.isFinite(opts.pollIntervalMs) && (opts.pollIntervalMs ?? 0) > 0
    ? Number(opts.pollIntervalMs)
    : 250;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const captured = await tmux.capturePane(paneId);
    if (paneLooksReady(captured) && !paneHasActiveTask(captured)) {
      return true;
    }
    await Bun.sleep(pollIntervalMs);
  }

  console.warn(
    `[pi-oven-team/tmux-session] waitForPaneReady: pane ${paneId} timed out after ${timeoutMs}ms ` +
      `(set PI_OVEN_SHELL_READY_TIMEOUT_MS to tune)`
  );
  return false;
}

export function createProcessTmuxController(binary: string = "tmux"): TeamTmuxController {
  return {
    async createTeamSession(teamName: string, _workerCount: number, cwd: string, options?: { newWindow?: boolean }) {
      const targetName = `pi-oven-team-${teamName}`;
      const args = options?.newWindow
        ? ["new-session", "-d", "-P", "-F", "#{session_name}|#{pane_id}", "-s", targetName, "-c", cwd]
        : ["new-session", "-d", "-P", "-F", "#{session_name}|#{pane_id}", "-s", targetName, "-c", cwd];
      const { stdout } = await execFileAsync(binary, args, { cwd });
      const [sessionName, leaderPaneId] = stdout.trim().split("|");
      if (!sessionName || !leaderPaneId) {
        throw new Error(`Failed to create tmux session for ${teamName}`);
      }
      return { sessionName, leaderPaneId, workerPaneIds: [] };
    },
    async splitWorkerPane(splitTarget: string, direction: "right" | "down", cwd: string) {
      const splitFlag = direction === "right" ? "-h" : "-v";
      const { stdout } = await execFileAsync(binary, [
        "split-window",
        splitFlag,
        "-t",
        splitTarget,
        "-d",
        "-P",
        "-F",
        "#{pane_id}",
        "-c",
        cwd,
      ]);
      const paneId = stdout.trim().split("\n")[0]?.trim();
      if (!paneId) {
        return null;
      }
      return paneId;
    },
    async spawnWorkerInPane(paneId: string, spec: { teamName: string; workerName: string; command: string; envVars?: Record<string, string> }) {
      const launchLine = `${renderEnvPrefix(spec.envVars)}${spec.command}`;
      await execFileAsync(binary, ["send-keys", "-t", paneId, "-l", launchLine]);
      await execFileAsync(binary, ["send-keys", "-t", paneId, "Enter"]);
    },
    async capturePane(paneId: string) {
      const { stdout } = await execFileAsync(binary, ["capture-pane", "-t", paneId, "-p", "-S", "-80"]);
      return stdout;
    },
    async sendPaneKey(paneId: string, key: string) {
      await execFileAsync(binary, ["send-keys", "-t", paneId, key]);
    },
    async killPane(paneId: string) {
      await execFileAsync(binary, ["kill-pane", "-t", paneId]);
    },
    async killSession(sessionName: string) {
      await execFileAsync(binary, ["kill-session", "-t", sessionName]);
    },
  };
}
