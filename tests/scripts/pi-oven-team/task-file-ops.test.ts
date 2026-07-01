import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  acquireTaskLock,
  areBlockersResolved,
  findNextTask,
  readTask,
  releaseTaskLock,
} from "../../../scripts/pi-oven-team/task-file-ops";
import type { TaskFile } from "../../../scripts/pi-oven-team/types";

const TEAM_NAME = "demo-team";
let cwd = "";
let tasksDir = "";

function writeTask(task: TaskFile): void {
  mkdirSync(tasksDir, { recursive: true });
  writeFileSync(join(tasksDir, `${task.id}.json`), JSON.stringify(task, null, 2), "utf-8");
}

beforeEach(() => {
  cwd = join(tmpdir(), `pi-oven-team-task-ops-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  tasksDir = join(cwd, ".pi-oven", "state", "team", TEAM_NAME, "tasks");
  mkdirSync(tasksDir, { recursive: true });
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

describe("pi-oven-team/task-file-ops", () => {
  it("claims the next pending owned task atomically", async () => {
    writeTask({
      id: "1",
      subject: "Task 1",
      description: "Do work",
      status: "pending",
      owner: "worker-1",
      blocks: [],
      blockedBy: [],
    });

    const claimed = await findNextTask(TEAM_NAME, "worker-1", { cwd });

    expect(claimed?.status).toBe("in_progress");
    expect(claimed?.claimedBy).toBe("worker-1");
    expect(existsSync(join(tasksDir, "1.lock"))).toBe(false);
    expect(readTask(TEAM_NAME, "1", { cwd })?.status).toBe("in_progress");
  });

  it("respects blocker resolution before claiming", async () => {
    writeTask({
      id: "1",
      subject: "Blocker",
      description: "Finish first",
      status: "pending",
      owner: "worker-1",
      blocks: [],
      blockedBy: [],
    });
    writeTask({
      id: "2",
      subject: "Blocked",
      description: "Wait for blocker",
      status: "pending",
      owner: "worker-1",
      blocks: [],
      blockedBy: ["1"],
    });

    expect(areBlockersResolved(TEAM_NAME, ["1"], { cwd })).toBe(false);
    const firstClaim = await findNextTask(TEAM_NAME, "worker-1", { cwd });
    expect(firstClaim?.id).toBe("1");

    writeTask({
      id: "1",
      subject: "Blocker",
      description: "Finish first",
      status: "completed",
      owner: "worker-1",
      blocks: [],
      blockedBy: [],
    });
    expect(areBlockersResolved(TEAM_NAME, ["1"], { cwd })).toBe(true);

    const secondClaim = await findNextTask(TEAM_NAME, "worker-1", { cwd });
    expect(secondClaim?.id).toBe("2");
  });

  it("prevents duplicate claims while a live lock exists and reaps stale locks", async () => {
    writeTask({
      id: "7",
      subject: "Locked",
      description: "Lock me",
      status: "pending",
      owner: "worker-1",
      blocks: [],
      blockedBy: [],
    });

    const handle = acquireTaskLock(TEAM_NAME, "7", { cwd, workerName: "worker-1" });
    expect(handle).not.toBeNull();
    expect(acquireTaskLock(TEAM_NAME, "7", { cwd, workerName: "worker-2" })).toBeNull();
    releaseTaskLock(handle!);

    const stalePath = join(tasksDir, "8.lock");
    writeFileSync(
      stalePath,
      JSON.stringify({ pid: 999999999, workerName: "dead-worker", timestamp: Date.now() - 60_000 }),
      "utf-8"
    );
    const old = new Date(Date.now() - 60_000);
    utimesSync(stalePath, old, old);

    const reaped = acquireTaskLock(TEAM_NAME, "8", { cwd, staleLockMs: 1 });
    expect(reaped).not.toBeNull();
    releaseTaskLock(reaped!);
  });
});
