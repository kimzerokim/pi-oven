import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  projectSettingsPath,
  deepMerge,
  readProjectSettingsStrict,
  readProjectSettingsSoft,
  setProjectAgentModelOverrides,
  setProjectModelRoles,
  setProjectRetryFallbackChains,
  readProjectAgentModelOverrides,
  clearProjectAgentModelOverrides,
  clearProjectOrchestrator,
} from "../../../scripts/pi-oven-setup/project-settings";

// ---------------------------------------------------------------------------
// Helpers — every test uses an isolated temp cwd; never touch the repo .omp.
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  const dir = join(
    tmpdir(),
    `project-settings-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

function seed(cwd: string, data: object): void {
  mkdirSync(join(cwd, ".omp"), { recursive: true });
  writeFileSync(projectSettingsPath(cwd), JSON.stringify(data, null, 2) + "\n", "utf-8");
}

function readFile(cwd: string): any {
  return JSON.parse(readFileSync(projectSettingsPath(cwd), "utf-8"));
}

// ---------------------------------------------------------------------------
// projectSettingsPath
// ---------------------------------------------------------------------------

describe("project-settings — projectSettingsPath", () => {
  it("resolves <cwd>/.omp/settings.json", () => {
    expect(projectSettingsPath("/foo/bar")).toBe(join("/foo/bar", ".omp", "settings.json"));
  });
});

// ---------------------------------------------------------------------------
// deepMerge (pure)
// ---------------------------------------------------------------------------

describe("project-settings — deepMerge", () => {
  it("recurses into plain objects (key-by-key merge)", () => {
    const out = deepMerge({ a: { x: 1, y: 2 } }, { a: { y: 3, z: 4 } });
    expect(out).toEqual({ a: { x: 1, y: 3, z: 4 } });
  });

  it("arrays REPLACE wholesale (never concatenate)", () => {
    const out = deepMerge({ a: [1, 2, 3] }, { a: [9] });
    expect(out).toEqual({ a: [9] });
  });

  it("scalars and type mismatches replace", () => {
    expect(deepMerge({ a: 1 }, { a: 2 })).toEqual({ a: 2 });
    expect(deepMerge({ a: { x: 1 } }, { a: 5 })).toEqual({ a: 5 });
    expect(deepMerge({ a: 5 }, { a: { x: 1 } })).toEqual({ a: { x: 1 } });
  });

  it("does not mutate either input", () => {
    const base = { a: { x: 1 } };
    const override = { a: { y: 2 } };
    deepMerge(base, override);
    expect(base).toEqual({ a: { x: 1 } });
    expect(override).toEqual({ a: { y: 2 } });
  });
});

// ---------------------------------------------------------------------------
// readProjectSettingsStrict / Soft
// ---------------------------------------------------------------------------

describe("project-settings — strict/soft reads", () => {
  let cwd: string;
  beforeEach(() => { cwd = makeTempDir(); });
  afterEach(() => { rmSync(cwd, { recursive: true, force: true }); });

  it("strict read of an ABSENT file returns ok:true with data:{}", async () => {
    const r = await readProjectSettingsStrict({ cwd });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data).toEqual({});
  });

  it("strict read of a present plain-object file returns its parsed contents", async () => {
    seed(cwd, { extensions: ["x"], task: { agentModelOverrides: { "pi-oven:critic": "m" } } });
    const r = await readProjectSettingsStrict({ cwd });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.extensions).toEqual(["x"]);
  });

  it("strict read FAILS CLOSED on a present-but-unparsable file", async () => {
    seed(cwd, {});
    writeFileSync(projectSettingsPath(cwd), "{ not json", "utf-8");
    const r = await readProjectSettingsStrict({ cwd });
    expect(r.ok).toBe(false);
  });

  it("strict read FAILS CLOSED on a present array top-level (not a plain object)", async () => {
    mkdirSync(join(cwd, ".omp"), { recursive: true });
    writeFileSync(projectSettingsPath(cwd), JSON.stringify([1, 2]), "utf-8");
    const r = await readProjectSettingsStrict({ cwd });
    expect(r.ok).toBe(false);
  });

  it("soft read returns {} on any fault (absent / unparsable / array)", async () => {
    expect(await readProjectSettingsSoft({ cwd })).toEqual({});
    seed(cwd, {});
    writeFileSync(projectSettingsPath(cwd), "{ not json", "utf-8");
    expect(await readProjectSettingsSoft({ cwd })).toEqual({});
    writeFileSync(projectSettingsPath(cwd), JSON.stringify([1]), "utf-8");
    expect(await readProjectSettingsSoft({ cwd })).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// setProjectAgentModelOverrides
// ---------------------------------------------------------------------------

describe("project-settings — setProjectAgentModelOverrides", () => {
  let cwd: string;
  beforeEach(() => { cwd = makeTempDir(); });
  afterEach(() => { rmSync(cwd, { recursive: true, force: true }); });

  it("creates the file + nested path when absent", async () => {
    await setProjectAgentModelOverrides({ "pi-oven:critic": "anthropic/claude-opus-4-8" }, { cwd });
    const parsed = readFile(cwd);
    expect(parsed.task.agentModelOverrides["pi-oven:critic"]).toBe("anthropic/claude-opus-4-8");
  });

  it("partial-merges over existing pi-oven:* keys (key-by-key)", async () => {
    seed(cwd, {
      task: { agentModelOverrides: { "pi-oven:critic": "old", "pi-oven:executor": "keep" } },
    });
    await setProjectAgentModelOverrides({ "pi-oven:critic": "new" }, { cwd });
    const parsed = readFile(cwd);
    expect(parsed.task.agentModelOverrides["pi-oven:critic"]).toBe("new");
    expect(parsed.task.agentModelOverrides["pi-oven:executor"]).toBe("keep");
  });

  it("preserves non-pi-oven:* override keys, sibling task.*, and top-level keys", async () => {
    seed(cwd, {
      extensions: ["my-ext"],
      task: {
        agentModelOverrides: { "user:foo": "modelX" },
        somethingElse: { deep: true },
      },
      modelRoles: { default: "keepme" },
    });
    await setProjectAgentModelOverrides({ "pi-oven:critic": "anthropic/claude-opus-4-8" }, { cwd });
    const parsed = readFile(cwd);
    expect(parsed.extensions).toEqual(["my-ext"]);
    expect(parsed.task.agentModelOverrides["user:foo"]).toBe("modelX");
    expect(parsed.task.agentModelOverrides["pi-oven:critic"]).toBe("anthropic/claude-opus-4-8");
    expect(parsed.task.somethingElse).toEqual({ deep: true });
    expect(parsed.modelRoles).toEqual({ default: "keepme" });
  });

  it("throws when a key does NOT start with pi-oven:", async () => {
    await expect(
      setProjectAgentModelOverrides({ "user:foo": "m" } as any, { cwd })
    ).rejects.toThrow(/pi-oven:/);
  });

  it("throws (does NOT clobber) when the existing file is present-but-malformed", async () => {
    seed(cwd, {});
    writeFileSync(projectSettingsPath(cwd), "{ not json", "utf-8");
    await expect(
      setProjectAgentModelOverrides({ "pi-oven:critic": "m" }, { cwd })
    ).rejects.toThrow();
    // The malformed file must be left untouched (not overwritten).
    expect(readFileSync(projectSettingsPath(cwd), "utf-8")).toBe("{ not json");
  });

  it("writes a final newline (repo JSON convention)", async () => {
    await setProjectAgentModelOverrides({ "pi-oven:critic": "m" }, { cwd });
    expect(readFileSync(projectSettingsPath(cwd), "utf-8").endsWith("\n")).toBe(true);
  });

  it("leaves no .tmp file behind after an atomic write", async () => {
    await setProjectAgentModelOverrides({ "pi-oven:critic": "m" }, { cwd });
    expect(existsSync(projectSettingsPath(cwd) + ".tmp")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// setProjectModelRoles / setProjectRetryFallbackChains
// ---------------------------------------------------------------------------

describe("project-settings — setProjectModelRoles", () => {
  let cwd: string;
  beforeEach(() => { cwd = makeTempDir(); });
  afterEach(() => { rmSync(cwd, { recursive: true, force: true }); });

  it("merges into modelRoles preserving sibling roles", async () => {
    seed(cwd, { modelRoles: { other: "keep" } });
    await setProjectModelRoles({ default: "d", title: "t" }, { cwd });
    const parsed = readFile(cwd);
    expect(parsed.modelRoles).toEqual({ other: "keep", default: "d", title: "t" });
  });

  it("throws on a present-but-malformed file", async () => {
    seed(cwd, {});
    writeFileSync(projectSettingsPath(cwd), "{ bad", "utf-8");
    await expect(setProjectModelRoles({ default: "d" }, { cwd })).rejects.toThrow();
  });
});

describe("project-settings — setProjectRetryFallbackChains", () => {
  let cwd: string;
  beforeEach(() => { cwd = makeTempDir(); });
  afterEach(() => { rmSync(cwd, { recursive: true, force: true }); });

  it("merges into retry.fallbackChains; arrays replace per role", async () => {
    seed(cwd, { retry: { fallbackChains: { default: ["old"] }, maxDelayMs: 1000 } });
    await setProjectRetryFallbackChains({ default: ["new1", "new2"], title: ["t"] }, { cwd });
    const parsed = readFile(cwd);
    expect(parsed.retry.fallbackChains.default).toEqual(["new1", "new2"]);
    expect(parsed.retry.fallbackChains.title).toEqual(["t"]);
    // sibling retry.* preserved
    expect(parsed.retry.maxDelayMs).toBe(1000);
  });

  it("creates the nested retry.fallbackChains path when absent", async () => {
    await setProjectRetryFallbackChains({ default: ["x"] }, { cwd });
    expect(readFile(cwd).retry.fallbackChains.default).toEqual(["x"]);
  });
});

// ---------------------------------------------------------------------------
// readProjectAgentModelOverrides
// ---------------------------------------------------------------------------

describe("project-settings — readProjectAgentModelOverrides", () => {
  let cwd: string;
  beforeEach(() => { cwd = makeTempDir(); });
  afterEach(() => { rmSync(cwd, { recursive: true, force: true }); });

  it("returns {} when absent", async () => {
    expect(await readProjectAgentModelOverrides({ cwd })).toEqual({});
  });

  it("returns only string-valued entries", async () => {
    seed(cwd, {
      task: { agentModelOverrides: { "pi-oven:critic": "m", "pi-oven:bad": 42, "user:foo": "x" } },
    });
    const out = await readProjectAgentModelOverrides({ cwd });
    expect(out["pi-oven:critic"]).toBe("m");
    expect(out["user:foo"]).toBe("x");
    expect(out["pi-oven:bad"]).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// clearProjectAgentModelOverrides
// ---------------------------------------------------------------------------

describe("project-settings — clearProjectAgentModelOverrides", () => {
  let cwd: string;
  beforeEach(() => { cwd = makeTempDir(); });
  afterEach(() => { rmSync(cwd, { recursive: true, force: true }); });

  it("removes only pi-oven:* keys, returns them SORTED", async () => {
    seed(cwd, {
      task: {
        agentModelOverrides: {
          "pi-oven:executor": "e",
          "pi-oven:critic": "c",
          "user:foo": "keep",
        },
      },
    });
    const removed = await clearProjectAgentModelOverrides({ cwd });
    expect(removed).toEqual(["pi-oven:critic", "pi-oven:executor"]);
    const parsed = readFile(cwd);
    expect(parsed.task.agentModelOverrides["user:foo"]).toBe("keep");
    expect(parsed.task.agentModelOverrides["pi-oven:critic"]).toBeUndefined();
  });

  it("prunes empty agentModelOverrides + empty task when only pi-oven:* keys existed", async () => {
    seed(cwd, {
      extensions: ["x"],
      task: { agentModelOverrides: { "pi-oven:critic": "c" } },
    });
    await clearProjectAgentModelOverrides({ cwd });
    const parsed = readFile(cwd);
    expect(parsed.task).toBeUndefined();
    expect(parsed.extensions).toEqual(["x"]);
  });

  it("REMOVES the file when data becomes {}", async () => {
    seed(cwd, { task: { agentModelOverrides: { "pi-oven:critic": "c" } } });
    await clearProjectAgentModelOverrides({ cwd });
    expect(existsSync(projectSettingsPath(cwd))).toBe(false);
  });

  it("no-op (returns []) when the file is absent — never creates one", async () => {
    const removed = await clearProjectAgentModelOverrides({ cwd });
    expect(removed).toEqual([]);
    expect(existsSync(projectSettingsPath(cwd))).toBe(false);
  });

  it("no-op (returns []) when there are no pi-oven:* keys", async () => {
    seed(cwd, { task: { agentModelOverrides: { "user:foo": "x" } } });
    const removed = await clearProjectAgentModelOverrides({ cwd });
    expect(removed).toEqual([]);
    // file untouched (sibling preserved)
    expect(readFile(cwd).task.agentModelOverrides["user:foo"]).toBe("x");
  });
});

// ---------------------------------------------------------------------------
// clearProjectOrchestrator
// ---------------------------------------------------------------------------

describe("project-settings — clearProjectOrchestrator", () => {
  let cwd: string;
  beforeEach(() => { cwd = makeTempDir(); });
  afterEach(() => { rmSync(cwd, { recursive: true, force: true }); });

  it("deletes modelRoles + retry.fallbackChains, preserving other keys", async () => {
    seed(cwd, {
      extensions: ["x"],
      modelRoles: { default: "d" },
      retry: { fallbackChains: { default: ["c"] }, maxDelayMs: 9 },
      task: { agentModelOverrides: { "pi-oven:critic": "c" } },
    });
    await clearProjectOrchestrator({ cwd });
    const parsed = readFile(cwd);
    expect(parsed.modelRoles).toBeUndefined();
    expect(parsed.retry.fallbackChains).toBeUndefined();
    expect(parsed.retry.maxDelayMs).toBe(9);
    expect(parsed.extensions).toEqual(["x"]);
    // It does NOT touch task overrides (that's clearProjectAgentModelOverrides' job).
    expect(parsed.task.agentModelOverrides["pi-oven:critic"]).toBe("c");
  });

  it("removes the whole retry key when fallbackChains was its only entry", async () => {
    seed(cwd, { modelRoles: { default: "d" }, retry: { fallbackChains: { default: ["c"] } } });
    await clearProjectOrchestrator({ cwd });
    // data became {} → file removed
    expect(existsSync(projectSettingsPath(cwd))).toBe(false);
  });

  it("no-op when the file is absent (never creates one)", async () => {
    await clearProjectOrchestrator({ cwd });
    expect(existsSync(projectSettingsPath(cwd))).toBe(false);
  });
});
