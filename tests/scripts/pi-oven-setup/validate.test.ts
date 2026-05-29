import { describe, it, expect } from "bun:test";
import { runValidate } from "../../../scripts/pi-oven-setup/validate";
import { PROFILE_A, PROFILE_B, ROLES } from "../../../scripts/pi-oven-setup/profiles";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a mock spawnFn that returns exit 0 for models in successSet, else exit 1. */
function makeSpawnFn(successModels: Set<string>) {
  return (_cmd: string, args: string[]) => {
    // omp -p "..." --model <model> --no-tools --max-tokens 5
    const modelIdx = args.indexOf("--model");
    const model = modelIdx !== -1 ? args[modelIdx + 1] : null;
    const ok = model !== null && successModels.has(model);
    return {
      exitCode: ok ? 0 : 1,
      stdout: Buffer.from(ok ? "ok" : ""),
      stderr: Buffer.from(ok ? "" : "error"),
    } as any;
  };
}

const SMOKE_ROLES = [
  "executor",
  "explorer",
  "verifier",
  "critic",
  "planner",
  "code-reviewer",
  "debugger",
] as const;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runValidate", () => {
  it("mode=none returns ok=true with no ping calls", async () => {
    const calls: string[][] = [];
    const spawnFn = (cmd: string, args: string[]) => {
      calls.push([cmd, ...args]);
      return { exitCode: 0, stdout: Buffer.from("ok"), stderr: Buffer.from("") } as any;
    };

    const result = await runValidate(PROFILE_A, { mode: "none", spawnFn });
    expect(result.ok).toBe(true);
    expect(calls.length).toBe(0);
  });

  it("mode=none returns all roles as verified (no pings)", async () => {
    const result = await runValidate(PROFILE_A, {
      mode: "none",
      spawnFn: () => ({ exitCode: 0 } as any),
    });
    expect(result.verified.length).toBe(ROLES.length);
    expect(result.unverified.length).toBe(0);
    expect(result.alternates.length).toBe(0);
  });

  it("mode=smoke pings exactly 7 MUST-tier roles", async () => {
    const pingedModels: string[] = [];
    const spawnFn = (_cmd: string, args: string[]) => {
      const modelIdx = args.indexOf("--model");
      if (modelIdx !== -1) pingedModels.push(args[modelIdx + 1]);
      return { exitCode: 0, stdout: Buffer.from("ok"), stderr: Buffer.from("") } as any;
    };

    await runValidate(PROFILE_A, { mode: "smoke", spawnFn });
    // 7 smoke roles, each pinged once (primary succeeded → no alternate ping)
    expect(pingedModels.length).toBe(7);
  });

  it("mode=smoke only covers MUST-tier roles — exactly 7 pings when all primaries succeed", async () => {
    // When all primaries succeed, smoke mode issues exactly 7 pings (one per MUST-tier role).
    // Full mode would issue 22. This verifies smoke scope without model-string reverse lookup
    // (model strings are shared across roles so reverse lookup is unreliable).
    const pingedModels: string[] = [];
    const spawnFn = (_cmd: string, args: string[]) => {
      const modelIdx = args.indexOf("--model");
      if (modelIdx !== -1) pingedModels.push(args[modelIdx + 1]);
      return { exitCode: 0, stdout: Buffer.from("ok"), stderr: Buffer.from("") } as any;
    };

    await runValidate(PROFILE_A, { mode: "smoke", spawnFn });

    // Exactly 7 pings — proves only smoke roles were covered
    expect(pingedModels.length).toBe(7);

    // Result contains exactly the 7 smoke roles as verified
    const result = await runValidate(PROFILE_A, { mode: "smoke", spawnFn: makeSpawnFn(new Set(ROLES.map(r => PROFILE_A[r].primary))) });
    expect(result.verified.length).toBe(7);
    for (const role of SMOKE_ROLES) {
      expect(result.verified).toContain(role);
    }
    // No non-smoke roles in result
    const nonSmoke = ROLES.filter((r) => !SMOKE_ROLES.includes(r as any));
    for (const role of nonSmoke) {
      expect(result.verified).not.toContain(role);
      expect(result.alternates).not.toContain(role);
      expect(result.unverified).not.toContain(role);
    }
  });

  it("mode=full pings all 22 roles", async () => {
    const pingedModels: string[] = [];
    const spawnFn = (_cmd: string, args: string[]) => {
      const modelIdx = args.indexOf("--model");
      if (modelIdx !== -1) pingedModels.push(args[modelIdx + 1]);
      return { exitCode: 0, stdout: Buffer.from("ok"), stderr: Buffer.from("") } as any;
    };

    await runValidate(PROFILE_A, { mode: "full", spawnFn });
    // 22 roles, each primary succeeds → 22 pings
    expect(pingedModels.length).toBe(22);
  });

  it("primary succeeds → role in verified list", async () => {
    // All primaries succeed
    const allPrimaries = new Set(ROLES.map((r) => PROFILE_A[r].primary));
    const result = await runValidate(PROFILE_A, {
      mode: "smoke",
      spawnFn: makeSpawnFn(allPrimaries),
    });
    for (const role of SMOKE_ROLES) {
      expect(result.verified).toContain(role);
    }
    expect(result.alternates.length).toBe(0);
    expect(result.unverified.length).toBe(0);
  });

  it("primary fails, alternate succeeds → role in alternates list", async () => {
    // Use Profile B smoke roles: all primaries are anthropic/* (unique, no overlap with alternates).
    // Only alternates (opencode-zen/*) succeed.
    const allAlternates = new Set(SMOKE_ROLES.map((r) => PROFILE_B[r].registry_alternate));
    const result = await runValidate(PROFILE_B, {
      mode: "smoke",
      spawnFn: makeSpawnFn(allAlternates),
    });
    for (const role of SMOKE_ROLES) {
      expect(result.alternates).toContain(role);
    }
    expect(result.verified.length).toBe(0);
    expect(result.unverified.length).toBe(0);
  });

  it("primary fails, alternate fails → role in unverified list, ok=false", async () => {
    // Nothing succeeds
    const result = await runValidate(PROFILE_A, {
      mode: "smoke",
      spawnFn: makeSpawnFn(new Set()),
    });
    for (const role of SMOKE_ROLES) {
      expect(result.unverified).toContain(role);
    }
    expect(result.ok).toBe(false);
    expect(result.verified.length).toBe(0);
    expect(result.alternates.length).toBe(0);
  });

  it("partial failure: some verified, some alternates, some unverified", async () => {
    // executor primary succeeds; explorer primary fails, alternate succeeds; verifier both fail
    const successModels = new Set([
      PROFILE_A.executor.primary,
      PROFILE_A.explorer.registry_alternate,
    ]);
    const result = await runValidate(PROFILE_A, {
      mode: "smoke",
      spawnFn: makeSpawnFn(successModels),
    });
    expect(result.verified).toContain("executor");
    expect(result.alternates).toContain("explorer");
    expect(result.unverified).toContain("verifier");
    expect(result.ok).toBe(false);
  });

  it("all verified or alternates → ok=true", async () => {
    // All primaries succeed
    const allPrimaries = new Set(SMOKE_ROLES.map((r) => PROFILE_A[r].primary));
    const result = await runValidate(PROFILE_A, {
      mode: "smoke",
      spawnFn: makeSpawnFn(allPrimaries),
    });
    expect(result.ok).toBe(true);
  });
});
