import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, rmSync, utimesSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  acquireTaskLock,
  areBlockersResolved,
  buildDependencyAwareBatches,
  findNextTask,
  listTaskIds,
  readTask,
  writeTaskFailure,
  releaseTaskLock,
} from "../../../scripts/pi-oven-team/task-file-ops";
import { writeTaskStateFile } from "../../../scripts/pi-oven-team/team-config";
import type { TaskFile, TeamRuntimeLaneMetadata } from "../../../scripts/pi-oven-team/types";

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
  it("preserves structured lane metadata and keeps failure sidecars out of task scans", async () => {
    const lane: TeamRuntimeLaneMetadata = {
      kind: "verification",
      objective: "verify persisted task metadata",
      independence_reason: "reads task state without mutating shared write surfaces",
      shared_state_policy: "read_only",
      output_schema: "verification_report",
      reducer: "append_results",
    };

    writeTaskStateFile(
      TEAM_NAME,
      cwd,
      "9",
      {
        subject: "Verify metadata",
        description: "Keep lane metadata round-trippable",
        owner: "worker-1",
        lane,
      },
      "worker-1"
    );
    writeTaskFailure(TEAM_NAME, "9", "transient failure", { cwd });

    expect(listTaskIds(TEAM_NAME, { cwd })).toEqual(["9"]);

    const claimed = await findNextTask(TEAM_NAME, "worker-1", { cwd });
    expect(claimed?.metadata?.lane).toEqual(lane);
    expect(readTask(TEAM_NAME, "9", { cwd })?.metadata?.lane).toEqual(lane);
  });

  it("builds dependency-aware batches with deterministic reducer order and rejects collisions", () => {
    const verificationLane: TeamRuntimeLaneMetadata = {
      kind: "verification",
      objective: "verify in parallel",
      independence_reason: "read-only verification is safe to fan out",
      shared_state_policy: "read_only",
      output_schema: "verification_report",
      reducer: "append_results",
    };
    const ownedWriteLane: TeamRuntimeLaneMetadata = {
      kind: "owned_write",
      objective: "apply isolated overlay edits",
      independence_reason: "each owned write claims one unique mutable target",
      shared_state_policy: "exclusive_write",
      output_schema: "owned_write_result",
      reducer: "owned_write_commit",
      persistence_claims: [{ surface: "worker_overlay", key: "overlay-a" }],
    };

    const plan = buildDependencyAwareBatches([
      {
        id: "2",
        blockedBy: ["1"],
        lane: ownedWriteLane,
        persistenceClaims: [
          { surface: "worker_dir", key: "worker-2" },
          { surface: "task_file", key: "2" },
          { surface: "worker_overlay", key: "overlay-a" },
        ],
      },
      {
        id: "1",
        blockedBy: [],
        lane: verificationLane,
        persistenceClaims: [
          { surface: "worker_dir", key: "worker-1" },
          { surface: "task_file", key: "1" },
        ],
      },
      {
        id: "3",
        blockedBy: [],
        lane: verificationLane,
        persistenceClaims: [
          { surface: "worker_dir", key: "worker-3" },
          { surface: "task_file", key: "3" },
        ],
      },
    ]);

    expect(plan.batches.map((batch) => batch.map((item) => item.id))).toEqual([["1", "3"], ["2"]]);
    expect(plan.reducerOrder).toEqual([
      "append_results",
      "append_results",
      "owned_write_commit",
    ]);
    expect(plan.collisionEvidence).toEqual([
      "worker_dir:worker-1",
      "task_file:1",
      "worker_dir:worker-3",
      "task_file:3",
      "worker_dir:worker-2",
      "task_file:2",
      "worker_overlay:overlay-a",
    ]);

    expect(() =>
      buildDependencyAwareBatches([
        {
          id: "7",
          blockedBy: [],
          lane: ownedWriteLane,
          persistenceClaims: [{ surface: "worker_overlay", key: "shared-doc" }],
        },
        {
          id: "8",
          blockedBy: [],
          lane: ownedWriteLane,
          persistenceClaims: [{ surface: "worker_overlay", key: "shared-doc" }],
        },
      ])
    ).toThrow(/collision/i);
  });
});
