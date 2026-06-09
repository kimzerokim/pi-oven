/**
 * TDD tests for §3.4 opt-in sibling-skill suppression.
 * Covers:
 *   - PI_OVEN_SIBLING_SKILL_GLOBS constant shape
 *   - readIgnoredSkillsStrict (generic reader)
 *   - setPiOvenIgnoredSkills: union-add, idempotency, user-set-sibling preservation
 *   - clearPiOvenIgnoredSkills: set-difference remove, no-op, abort-on-corrupt
 *   - runSuppressSibling: enable / disable / failure path
 */

import { describe, it, expect } from "bun:test";
import {
  PI_OVEN_SIBLING_SKILL_GLOBS,
  readIgnoredSkillsStrict,
  setPiOvenIgnoredSkills,
  clearPiOvenIgnoredSkills,
} from "../../../scripts/pi-oven-setup/config-yml";
import { runSuppressSibling } from "../../../scripts/pi-oven-setup/suppress-sibling";

// ---------------------------------------------------------------------------
// Helpers (mirror config-yml.test.ts style)
// ---------------------------------------------------------------------------

type SpawnResult = { exitCode: number | null; stdout?: Buffer; stderr?: Buffer };

function makeSpawnFn(
  responses: Array<SpawnResult | ((cmd: string, args: string[]) => SpawnResult)>
): { fn: (cmd: string, args: string[]) => SpawnResult; calls: string[][] } {
  const calls: string[][] = [];
  let idx = 0;
  return {
    fn: (cmd: string, args: string[]) => {
      calls.push([cmd, ...args]);
      const r = responses[idx++];
      return typeof r === "function" ? r(cmd, args) : r;
    },
    calls,
  };
}

function okGetArrayResult(key: string, value: string[]): SpawnResult {
  return {
    exitCode: 0,
    stdout: Buffer.from(
      JSON.stringify({ key, value, type: "array", description: "" })
    ),
    stderr: Buffer.from(""),
  };
}

function okSetResult(): SpawnResult {
  return { exitCode: 0, stdout: Buffer.from(""), stderr: Buffer.from("") };
}

function errorGetResult(): SpawnResult {
  return { exitCode: 1, stdout: Buffer.from(""), stderr: Buffer.from("err") };
}

function corruptGetResult(): SpawnResult {
  return { exitCode: 0, stdout: Buffer.from("not json{{{"), stderr: Buffer.from("") };
}

// ---------------------------------------------------------------------------
// PI_OVEN_SIBLING_SKILL_GLOBS — the SoT const
// ---------------------------------------------------------------------------

describe("PI_OVEN_SIBLING_SKILL_GLOBS", () => {
  it("contains exactly superpowers:* and oh-my-claudecode:*", () => {
    expect([...PI_OVEN_SIBLING_SKILL_GLOBS]).toEqual([
      "superpowers:*",
      "oh-my-claudecode:*",
    ]);
  });

  it("does NOT contain agentmemory:* (D5 decision)", () => {
    expect([...PI_OVEN_SIBLING_SKILL_GLOBS]).not.toContain("agentmemory:*");
  });
});

// ---------------------------------------------------------------------------
// readIgnoredSkillsStrict — generic strict reader for skills.ignoredSkills
// ---------------------------------------------------------------------------

describe("readIgnoredSkillsStrict", () => {
  it("ok:true on valid array shape, spawns `omp config get skills.ignoredSkills --json`", async () => {
    const { fn, calls } = makeSpawnFn([
      okGetArrayResult("skills.ignoredSkills", ["superpowers:*"]),
    ]);
    const result = await readIgnoredSkillsStrict({ spawnFn: fn });
    expect(calls[0]).toEqual([
      "omp",
      "config",
      "get",
      "skills.ignoredSkills",
      "--json",
    ]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.list).toEqual(["superpowers:*"]);
  });

  it("ok:true list:[] on fresh empty array", async () => {
    const { fn } = makeSpawnFn([
      okGetArrayResult("skills.ignoredSkills", []),
    ]);
    const result = await readIgnoredSkillsStrict({ spawnFn: fn });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.list).toEqual([]);
  });

  it("ok:false on non-zero exit (fail-closed)", async () => {
    const { fn } = makeSpawnFn([errorGetResult()]);
    const result = await readIgnoredSkillsStrict({ spawnFn: fn });
    expect(result.ok).toBe(false);
  });

  it("ok:false on malformed JSON (fail-closed)", async () => {
    const { fn } = makeSpawnFn([corruptGetResult()]);
    const result = await readIgnoredSkillsStrict({ spawnFn: fn });
    expect(result.ok).toBe(false);
  });

  it("ok:false when type != array (e.g. record)", async () => {
    const { fn } = makeSpawnFn([
      {
        exitCode: 0,
        stdout: Buffer.from(
          JSON.stringify({ key: "skills.ignoredSkills", value: {}, type: "record" })
        ),
        stderr: Buffer.from(""),
      },
    ]);
    const result = await readIgnoredSkillsStrict({ spawnFn: fn });
    expect(result.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// setPiOvenIgnoredSkills — union-add managed globs
// ---------------------------------------------------------------------------

describe("setPiOvenIgnoredSkills", () => {
  it("reads skills.ignoredSkills then sets with the managed globs added", async () => {
    const { fn, calls } = makeSpawnFn([
      okGetArrayResult("skills.ignoredSkills", []),
      okSetResult(),
    ]);
    const result = await setPiOvenIgnoredSkills({ spawnFn: fn });
    expect(result).toEqual([...PI_OVEN_SIBLING_SKILL_GLOBS]);

    // get call targets skills.ignoredSkills
    expect(calls[0]).toEqual([
      "omp",
      "config",
      "get",
      "skills.ignoredSkills",
      "--json",
    ]);
    // set call targets skills.ignoredSkills with the managed globs
    expect(calls[1].slice(0, 4)).toEqual([
      "omp",
      "config",
      "set",
      "skills.ignoredSkills",
    ]);
    expect(JSON.parse(calls[1][4])).toEqual([...PI_OVEN_SIBLING_SKILL_GLOBS]);
  });

  it("preserves user-set sibling globs not in managed set", async () => {
    const { fn, calls } = makeSpawnFn([
      okGetArrayResult("skills.ignoredSkills", ["someother:*"]),
      okSetResult(),
    ]);
    const result = await setPiOvenIgnoredSkills({ spawnFn: fn });
    expect(result).toContain("someother:*");
    expect(result).toContain("superpowers:*");
    expect(result).toContain("oh-my-claudecode:*");
    expect(JSON.parse(calls[1][4])).toContain("someother:*");
  });

  it("idempotent — already-set globs do not duplicate", async () => {
    const { fn, calls } = makeSpawnFn([
      okGetArrayResult("skills.ignoredSkills", [...PI_OVEN_SIBLING_SKILL_GLOBS]),
      okSetResult(),
    ]);
    const result = await setPiOvenIgnoredSkills({ spawnFn: fn });
    const written = JSON.parse(calls[1][4]) as string[];
    const supCount = written.filter((g) => g === "superpowers:*").length;
    const omcCount = written.filter((g) => g === "oh-my-claudecode:*").length;
    expect(supCount).toBe(1);
    expect(omcCount).toBe(1);
    expect(result.length).toBe(PI_OVEN_SIBLING_SKILL_GLOBS.length);
  });

  it("ABORTS on corrupt get — set NOT called (fail-closed)", async () => {
    const { fn, calls } = makeSpawnFn([corruptGetResult()]);
    await expect(setPiOvenIgnoredSkills({ spawnFn: fn })).rejects.toThrow();
    expect(calls.filter((c) => c[2] === "set").length).toBe(0);
  });

  it("ABORTS on get non-zero exit — set NOT called", async () => {
    const { fn, calls } = makeSpawnFn([errorGetResult()]);
    await expect(setPiOvenIgnoredSkills({ spawnFn: fn })).rejects.toThrow();
    expect(calls.filter((c) => c[2] === "set").length).toBe(0);
  });

  it("throws when omp config set exits non-zero", async () => {
    const { fn } = makeSpawnFn([
      okGetArrayResult("skills.ignoredSkills", []),
      { exitCode: 1, stdout: Buffer.from(""), stderr: Buffer.from("set-fail") },
    ]);
    await expect(setPiOvenIgnoredSkills({ spawnFn: fn })).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// clearPiOvenIgnoredSkills — set-difference remove managed globs
// ---------------------------------------------------------------------------

describe("clearPiOvenIgnoredSkills", () => {
  it("removes managed globs from the list and returns sorted removed globs", async () => {
    const { fn, calls } = makeSpawnFn([
      okGetArrayResult("skills.ignoredSkills", [
        "superpowers:*",
        "oh-my-claudecode:*",
        "someother:*",
      ]),
      okSetResult(),
    ]);
    const removed = await clearPiOvenIgnoredSkills({ spawnFn: fn });
    expect(removed.sort()).toEqual([...PI_OVEN_SIBLING_SKILL_GLOBS].sort());

    const written = JSON.parse(calls[1][4]) as string[];
    expect(written).toEqual(["someother:*"]);
  });

  it("preserves user-set globs not in the managed set", async () => {
    const { fn, calls } = makeSpawnFn([
      okGetArrayResult("skills.ignoredSkills", [
        "superpowers:*",
        "user-set:*",
        "oh-my-claudecode:*",
      ]),
      okSetResult(),
    ]);
    await clearPiOvenIgnoredSkills({ spawnFn: fn });
    const written = JSON.parse(calls[1][4]) as string[];
    expect(written).toContain("user-set:*");
    expect(written).not.toContain("superpowers:*");
    expect(written).not.toContain("oh-my-claudecode:*");
  });

  it("no-op (no set call) when no managed globs are present", async () => {
    const { fn, calls } = makeSpawnFn([
      okGetArrayResult("skills.ignoredSkills", ["someother:*"]),
    ]);
    const removed = await clearPiOvenIgnoredSkills({ spawnFn: fn });
    expect(removed).toEqual([]);
    expect(calls.filter((c) => c[2] === "set").length).toBe(0);
  });

  it("no-op on empty array", async () => {
    const { fn, calls } = makeSpawnFn([
      okGetArrayResult("skills.ignoredSkills", []),
    ]);
    const removed = await clearPiOvenIgnoredSkills({ spawnFn: fn });
    expect(removed).toEqual([]);
    expect(calls.filter((c) => c[2] === "set").length).toBe(0);
  });

  it("ABORTS on corrupt get — set NOT called (fail-closed)", async () => {
    const { fn, calls } = makeSpawnFn([corruptGetResult()]);
    await expect(clearPiOvenIgnoredSkills({ spawnFn: fn })).rejects.toThrow();
    expect(calls.filter((c) => c[2] === "set").length).toBe(0);
  });

  it("throws when get exits non-zero — set NOT called", async () => {
    const { fn, calls } = makeSpawnFn([errorGetResult()]);
    await expect(clearPiOvenIgnoredSkills({ spawnFn: fn })).rejects.toThrow();
    expect(calls.filter((c) => c[2] === "set").length).toBe(0);
  });

  it("throws when omp config set exits non-zero", async () => {
    const { fn } = makeSpawnFn([
      okGetArrayResult("skills.ignoredSkills", [...PI_OVEN_SIBLING_SKILL_GLOBS]),
      { exitCode: 1, stdout: Buffer.from(""), stderr: Buffer.from("set-fail") },
    ]);
    await expect(clearPiOvenIgnoredSkills({ spawnFn: fn })).rejects.toThrow();
  });

  it("provenance-loss note: also removes identical user-set globs (documented limitation)", async () => {
    // User had independently set superpowers:* — clear also removes it (no provenance tracking)
    const { fn } = makeSpawnFn([
      okGetArrayResult("skills.ignoredSkills", ["superpowers:*"]),
      okSetResult(),
    ]);
    const removed = await clearPiOvenIgnoredSkills({ spawnFn: fn });
    expect(removed).toContain("superpowers:*");
  });
});

// ---------------------------------------------------------------------------
// runSuppressSibling — the toggle wrapper (mirrors runIsolate shape)
// ---------------------------------------------------------------------------

describe("runSuppressSibling — enable", () => {
  it("writes skills.ignoredSkills with managed globs and reports what was hidden", async () => {
    const { fn, calls } = makeSpawnFn([
      okGetArrayResult("skills.ignoredSkills", []),
      okSetResult(),
    ]);
    const result = await runSuppressSibling({ enable: true, spawnFn: fn });
    expect(result.exitCode).toBe(0);
    // Should name the globs that were hidden
    expect(result.output).toContain("superpowers:*");
    expect(result.output).toContain("oh-my-claudecode:*");
    // Should include a restart hint
    expect(result.output.toLowerCase()).toMatch(/restart/);
    // Should note provenance-loss
    expect(result.output).toMatch(/provenance|also removes|identical/i);
    expect(JSON.parse(calls[1][4])).toEqual([...PI_OVEN_SIBLING_SKILL_GLOBS]);
  });

  it("preserves a pre-existing user glob", async () => {
    const { fn, calls } = makeSpawnFn([
      okGetArrayResult("skills.ignoredSkills", ["someother:*"]),
      okSetResult(),
    ]);
    const result = await runSuppressSibling({ enable: true, spawnFn: fn });
    expect(result.exitCode).toBe(0);
    const written = JSON.parse(calls[1][4]) as string[];
    expect(written).toContain("someother:*");
  });

  it("exit 1 with failure message when read fails (no set)", async () => {
    const { fn, calls } = makeSpawnFn([errorGetResult()]);
    const result = await runSuppressSibling({ enable: true, spawnFn: fn });
    expect(result.exitCode).toBe(1);
    expect(result.output).toMatch(/failed/i);
    expect(calls.filter((c) => c[2] === "set").length).toBe(0);
  });
});

describe("runSuppressSibling — disable (--no-suppress-sibling-skills)", () => {
  it("removes managed globs and reports what was cleared", async () => {
    const { fn, calls } = makeSpawnFn([
      okGetArrayResult("skills.ignoredSkills", [...PI_OVEN_SIBLING_SKILL_GLOBS]),
      okSetResult(),
    ]);
    const result = await runSuppressSibling({ enable: false, spawnFn: fn });
    expect(result.exitCode).toBe(0);
    expect(result.output).toMatch(/re-enabled|cleared|removed/i);
    expect(JSON.parse(calls[1][4])).toEqual([]);
  });

  it("reports nothing-to-undo when no managed globs present (no set call)", async () => {
    const { fn, calls } = makeSpawnFn([
      okGetArrayResult("skills.ignoredSkills", []),
    ]);
    const result = await runSuppressSibling({ enable: false, spawnFn: fn });
    expect(result.exitCode).toBe(0);
    expect(result.output).toMatch(/nothing|already|no.*suppress/i);
    expect(calls.filter((c) => c[2] === "set").length).toBe(0);
  });

  it("exit 1 with failure message when read fails (no set)", async () => {
    const { fn, calls } = makeSpawnFn([errorGetResult()]);
    const result = await runSuppressSibling({ enable: false, spawnFn: fn });
    expect(result.exitCode).toBe(1);
    expect(result.output).toMatch(/failed/i);
    expect(calls.filter((c) => c[2] === "set").length).toBe(0);
  });
});
