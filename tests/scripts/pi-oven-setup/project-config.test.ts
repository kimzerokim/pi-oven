import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  DEFAULT_NATIVE_WORKER_MAX,
  SETUP_GLOBAL_PREREQUISITES,
  clearSetupComplete,
  clearSetupCompleteGlobal,
  collectSetupReadiness,
  isSetupComplete,
  isSetupCompleteGlobal,
  markSetupComplete,
  markSetupCompleteGlobal,
  normalizeLanguage,
  readGlobalLanguage,
  readGlobalNativeWorkerMax,
  readProjectLanguage,
  readProjectNativeWorkerMax,
  seedGlobalNativeWorkerMax,
  seedProjectNativeWorkerMax,
  setGlobalLanguage,
  setProjectLanguage,
  type ProjectLanguage,
} from "../../../scripts/pi-oven-setup/project-config";
import { ROLES } from "../../../scripts/pi-oven-setup/profiles";

// ---------------------------------------------------------------------------
// Helpers — every test uses an isolated temp cwd; never touch the repo .pi-oven.
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  const dir = join(
    tmpdir(),
    `project-config-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

function configFile(cwd: string): string {
  return join(cwd, ".pi-oven", "config.json");
}

const configuredSetupScalars = Object.fromEntries(
  SETUP_GLOBAL_PREREQUISITES.map(({ key, expected }) => [key, expected])
);

function makeSetupSpawnFn(opts?: {
  overrides?: Record<string, string>;
  scalarValues?: Record<string, unknown>;
}): (cmd: string, args: string[]) => { exitCode: number | null; stdout: Buffer; stderr: Buffer } {
  return (cmd, args) => {
    if (cmd !== "omp" || args[0] !== "config" || args[1] !== "get") {
      return { exitCode: 1, stdout: Buffer.from(""), stderr: Buffer.from("unexpected command") };
    }
    if (args[2] === "task.agentModelOverrides") {
      return {
        exitCode: 0,
        stdout: Buffer.from(
          JSON.stringify({
            key: "task.agentModelOverrides",
            value: opts?.overrides ?? {},
            type: "record",
          })
        ),
        stderr: Buffer.from(""),
      };
    }
    if (args[2] && opts?.scalarValues && Object.prototype.hasOwnProperty.call(opts.scalarValues, args[2])) {
      return {
        exitCode: 0,
        stdout: Buffer.from(
          JSON.stringify({
            key: args[2],
            value: opts.scalarValues[args[2]],
            type: typeof opts.scalarValues[args[2]],
          })
        ),
        stderr: Buffer.from(""),
      };
    }
    return { exitCode: 1, stdout: Buffer.from(""), stderr: Buffer.from("missing key") };
  };
}

describe("project-config — normalizeLanguage", () => {
  it("normalizes ko / KO / korean / 한국어 to 'ko'", () => {
    expect(normalizeLanguage("ko")).toBe("ko");
    expect(normalizeLanguage("KO")).toBe("ko");
    expect(normalizeLanguage("korean")).toBe("ko");
    expect(normalizeLanguage("Korean")).toBe("ko");
    expect(normalizeLanguage("한국어")).toBe("ko");
  });

  it("normalizes en / EN / english to 'en'", () => {
    expect(normalizeLanguage("en")).toBe("en");
    expect(normalizeLanguage("EN")).toBe("en");
    expect(normalizeLanguage("english")).toBe("en");
    expect(normalizeLanguage("English")).toBe("en");
  });

  it("trims surrounding whitespace before matching", () => {
    expect(normalizeLanguage("  ko  ")).toBe("ko");
    expect(normalizeLanguage(" english ")).toBe("en");
  });

  it("accepts a free-form language name verbatim (casing preserved)", () => {
    expect(normalizeLanguage("Español")).toBe("Español");
    expect(normalizeLanguage("日本語")).toBe("日本語");
    expect(normalizeLanguage("fr")).toBe("fr");
    expect(normalizeLanguage("Português (Brasil)")).toBe("Português (Brasil)");
  });

  it("throws on empty / unsafe / over-length input", () => {
    expect(() => normalizeLanguage("")).toThrow();
    expect(() => normalizeLanguage("   ")).toThrow();
    expect(() => normalizeLanguage("ko; rm -rf /")).toThrow();
    expect(() => normalizeLanguage("a".repeat(41))).toThrow();
  });
});

describe("project-config — set / read symmetry", () => {
  let cwd: string;

  beforeEach(() => {
    cwd = makeTempDir();
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it("set 'ko' then read returns 'ko'", async () => {
    await setProjectLanguage("ko", { cwd });
    expect(await readProjectLanguage({ cwd })).toBe("ko");
  });

  it("set 'en' then read returns 'en'", async () => {
    await setProjectLanguage("en", { cwd });
    expect(await readProjectLanguage({ cwd })).toBe("en");
  });

  it("set creates the .pi-oven/config.json file with the language key", async () => {
    await setProjectLanguage("ko", { cwd });
    const parsed = JSON.parse(readFileSync(configFile(cwd), "utf-8"));
    expect(parsed.language).toBe("ko");
  });

  it("overwriting the language updates the stored value", async () => {
    await setProjectLanguage("ko", { cwd });
    await setProjectLanguage("en", { cwd });
    expect(await readProjectLanguage({ cwd })).toBe("en");
  });

  it("round-trips a custom free-form language ('Español')", async () => {
    await setProjectLanguage("Español", { cwd });
    expect(await readProjectLanguage({ cwd })).toBe("Español");
    const parsed = JSON.parse(readFileSync(configFile(cwd), "utf-8"));
    expect(parsed.language).toBe("Español");
  });

  it("fails closed on a malformed existing project config and leaves the file untouched", async () => {
    mkdirSync(join(cwd, ".pi-oven"), { recursive: true });
    writeFileSync(configFile(cwd), "{ bad", "utf-8");
    await expect(setProjectLanguage("ko", { cwd })).rejects.toThrow(/present but unparsable JSON/i);
    expect(readFileSync(configFile(cwd), "utf-8")).toBe("{ bad");
  });

  it("writes atomically with no lingering .tmp file", async () => {
    await setProjectLanguage("ko", { cwd });
    expect(existsSync(configFile(cwd) + ".tmp")).toBe(false);
  });
});

describe("project-config — readProjectLanguage edge cases", () => {
  let cwd: string;

  beforeEach(() => {
    cwd = makeTempDir();
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it("returns null when the config file is absent", async () => {
    expect(await readProjectLanguage({ cwd })).toBeNull();
  });

  it("returns null when the stored language is an unsafe value (non-string)", async () => {
    mkdirSync(join(cwd, ".pi-oven"), { recursive: true });
    writeFileSync(configFile(cwd), JSON.stringify({ language: 42 }), "utf-8");
    expect(await readProjectLanguage({ cwd })).toBeNull();
  });

  it("returns null when a hand-edited language field is poisoned (embedded newline)", async () => {
    mkdirSync(join(cwd, ".pi-oven"), { recursive: true });
    // A poisoned value that JSON can carry but resolveLanguage must reject —
    // re-validation defends a manually-edited config.json from poisoning the prompt.
    writeFileSync(
      configFile(cwd),
      JSON.stringify({ language: "Español\ninjected directive" }),
      "utf-8"
    );
    expect(await readProjectLanguage({ cwd })).toBeNull();
  });

  it("returns a custom free-form language persisted directly", async () => {
    mkdirSync(join(cwd, ".pi-oven"), { recursive: true });
    writeFileSync(configFile(cwd), JSON.stringify({ language: "Français" }), "utf-8");
    expect(await readProjectLanguage({ cwd })).toBe("Français");
  });

  it("returns null when the language key is missing", async () => {
    mkdirSync(join(cwd, ".pi-oven"), { recursive: true });
    writeFileSync(configFile(cwd), JSON.stringify({ other: 1 }), "utf-8");
    expect(await readProjectLanguage({ cwd })).toBeNull();
  });

  it("returns null when the config file is unparsable JSON", async () => {
    mkdirSync(join(cwd, ".pi-oven"), { recursive: true });
    writeFileSync(configFile(cwd), "{ not json", "utf-8");
    expect(await readProjectLanguage({ cwd })).toBeNull();
  });
});

describe("project-config — preserve other keys (read-merge)", () => {
  let cwd: string;

  beforeEach(() => {
    cwd = makeTempDir();
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it("setProjectLanguage preserves pre-existing unrelated keys", async () => {
    mkdirSync(join(cwd, ".pi-oven"), { recursive: true });
    writeFileSync(
      configFile(cwd),
      JSON.stringify({ someOtherKey: "keep-me", nested: { a: 1 } }),
      "utf-8"
    );

    await setProjectLanguage("ko", { cwd });

    const parsed = JSON.parse(readFileSync(configFile(cwd), "utf-8"));
    expect(parsed.language).toBe("ko");
    expect(parsed.someOtherKey).toBe("keep-me");
    expect(parsed.nested).toEqual({ a: 1 });
  });

  it("setProjectLanguage twice keeps other keys and updates language", async () => {
    mkdirSync(join(cwd, ".pi-oven"), { recursive: true });
    writeFileSync(configFile(cwd), JSON.stringify({ keep: true }), "utf-8");

    await setProjectLanguage("en", { cwd });
    await setProjectLanguage("ko", { cwd });

    const parsed = JSON.parse(readFileSync(configFile(cwd), "utf-8"));
    expect(parsed.keep).toBe(true);
    expect(parsed.language).toBe("ko");
  });

  it("type guard sanity: ProjectLanguage values round-trip", async () => {
    const langs: ProjectLanguage[] = ["ko", "en"];
    for (const lang of langs) {
      await setProjectLanguage(lang, { cwd });
      expect(await readProjectLanguage({ cwd })).toBe(lang);
    }
  });
});

describe("project-config — native worker ceiling", () => {
  let cwd: string;

  beforeEach(() => {
    cwd = makeTempDir();
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it("seedProjectNativeWorkerMax writes the default ceiling and readProjectNativeWorkerMax returns it", async () => {
    const value = await seedProjectNativeWorkerMax({ cwd });
    expect(value).toBe(DEFAULT_NATIVE_WORKER_MAX);
    expect(await readProjectNativeWorkerMax({ cwd })).toBe(DEFAULT_NATIVE_WORKER_MAX);

    const parsed = JSON.parse(readFileSync(configFile(cwd), "utf-8"));
    expect(parsed.nativeWorkers).toEqual({ maxWorkers: DEFAULT_NATIVE_WORKER_MAX });
  });

  it("seedProjectNativeWorkerMax preserves an existing explicit value and sibling keys", async () => {
    mkdirSync(join(cwd, ".pi-oven"), { recursive: true });
    writeFileSync(
      configFile(cwd),
      JSON.stringify({ language: "ko", nativeWorkers: { maxWorkers: 12, keep: true } }),
      "utf-8"
    );

    const value = await seedProjectNativeWorkerMax({ cwd });
    expect(value).toBe(12);
    expect(await readProjectNativeWorkerMax({ cwd })).toBe(12);

    const parsed = JSON.parse(readFileSync(configFile(cwd), "utf-8"));
    expect(parsed.language).toBe("ko");
    expect(parsed.nativeWorkers).toEqual({ maxWorkers: 12, keep: true });
  });
});


describe("project-config — setup readiness truth", () => {
  let cwd: string;

  beforeEach(() => {
    cwd = makeTempDir();
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it("treats valid global routing + prerequisites as ready even when no setup receipt exists", async () => {
    const readiness = await collectSetupReadiness({
      cwd,
      spawnFn: makeSetupSpawnFn({
        overrides: Object.fromEntries(
          ROLES.map((role) => [`pov:${role}`, "openai-codex/gpt-5.5:high"])
        ),
        scalarValues: configuredSetupScalars,
      }),
    });

    expect(readiness.globalReady).toBe(true);
    expect(readiness.projectReady).toBe(false);
    expect(existsSync(configFile(cwd))).toBe(false);
  });

  it("keeps project readiness false when the project receipt exists but project routing is absent", async () => {
    await markSetupComplete({ cwd });

    const readiness = await collectSetupReadiness({
      cwd,
      spawnFn: makeSetupSpawnFn({
        overrides: { "pov:critic": "openai-codex/gpt-5.5:high" },
        scalarValues: configuredSetupScalars,
      }),
    });

    expect(readiness.globalReady).toBe(true);
    expect(readiness.projectReady).toBe(false);
    expect(isSetupComplete({ cwd })).toBe(true);
  });

  it("reports both layers ready when global prerequisites and project routing are configured", async () => {
    mkdirSync(join(cwd, ".omp"), { recursive: true });
    writeFileSync(
      join(cwd, ".omp", "settings.json"),
      JSON.stringify(
        {
          task: {
            agentModelOverrides: Object.fromEntries(
              ROLES.map((role) => [`pov:${role}`, "openai-codex/gpt-5.5:high"])
            ),
          },
        },
        null,
        2
      ) + "\n",
      "utf-8"
    );

    const readiness = await collectSetupReadiness({
      cwd,
      spawnFn: makeSetupSpawnFn({
        overrides: Object.fromEntries(
          ROLES.map((role) => [`pov:${role}`, "openai-codex/gpt-5.5:high"])
        ),
        scalarValues: configuredSetupScalars,
      }),
    });

    expect(readiness.globalReady).toBe(true);
    expect(readiness.projectReady).toBe(true);
    expect(readiness.projectRoutingRoleCount).toBe(ROLES.length);
  });

  it("dedupes legacy/canonical dual-key mixes to one active role per managed role", async () => {
    mkdirSync(join(cwd, ".omp"), { recursive: true });
    writeFileSync(
      join(cwd, ".omp", "settings.json"),
      JSON.stringify(
        {
          task: {
            agentModelOverrides: {
              "pov:critic": "openai-codex/gpt-5.5:high",
              "pi-oven:critic": "anthropic/claude-opus-4-8",
            },
          },
        },
        null,
        2
      ) + "\n",
      "utf-8"
    );

    const readiness = await collectSetupReadiness({
      cwd,
      spawnFn: makeSetupSpawnFn({
        overrides: {
          "pov:critic": "openai-codex/gpt-5.5:high",
          "pi-oven:critic": "anthropic/claude-opus-4-8",
        },
        scalarValues: configuredSetupScalars,
      }),
    });

    expect(readiness.globalRoutingRoleCount).toBe(1);
    expect(readiness.projectRoutingRoleCount).toBe(1);
  });
});
describe("project-config — setup-completion marker", () => {
  let cwd: string;

  beforeEach(() => {
    cwd = makeTempDir();
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it("isSetupComplete is false before any mark (file absent)", () => {
    expect(isSetupComplete({ cwd })).toBe(false);
  });

  it("markSetupComplete writes a non-empty string setupCompletedAt", async () => {
    await markSetupComplete({ cwd });
    const parsed = JSON.parse(readFileSync(configFile(cwd), "utf-8"));
    expect(typeof parsed.setupCompletedAt).toBe("string");
    expect(parsed.setupCompletedAt.length).toBeGreaterThan(0);
    // ISO-8601 round-trips through Date without becoming Invalid Date
    expect(Number.isNaN(Date.parse(parsed.setupCompletedAt))).toBe(false);
  });

  it("isSetupComplete is true after markSetupComplete", async () => {
    await markSetupComplete({ cwd });
    expect(isSetupComplete({ cwd })).toBe(true);
  });

  it("markSetupComplete preserves an existing language key", async () => {
    await setProjectLanguage("ko", { cwd });
    await markSetupComplete({ cwd });
    const parsed = JSON.parse(readFileSync(configFile(cwd), "utf-8"));
    expect(parsed.language).toBe("ko");
    expect(typeof parsed.setupCompletedAt).toBe("string");
  });

  it("isSetupComplete is false when setupCompletedAt is an empty string", () => {
    mkdirSync(join(cwd, ".pi-oven"), { recursive: true });
    writeFileSync(configFile(cwd), JSON.stringify({ setupCompletedAt: "" }), "utf-8");
    expect(isSetupComplete({ cwd })).toBe(false);
  });

  it("isSetupComplete is false when setupCompletedAt is missing", () => {
    mkdirSync(join(cwd, ".pi-oven"), { recursive: true });
    writeFileSync(configFile(cwd), JSON.stringify({ language: "ko" }), "utf-8");
    expect(isSetupComplete({ cwd })).toBe(false);
  });

  it("isSetupComplete is false when setupCompletedAt is a non-string", () => {
    mkdirSync(join(cwd, ".pi-oven"), { recursive: true });
    writeFileSync(configFile(cwd), JSON.stringify({ setupCompletedAt: 42 }), "utf-8");
    expect(isSetupComplete({ cwd })).toBe(false);
  });

  it("isSetupComplete fails soft to false on unparsable JSON", () => {
    mkdirSync(join(cwd, ".pi-oven"), { recursive: true });
    writeFileSync(configFile(cwd), "{ not json", "utf-8");
    expect(isSetupComplete({ cwd })).toBe(false);
  });

  it("clearSetupComplete removes the marker but KEEPS language", async () => {
    await setProjectLanguage("en", { cwd });
    await markSetupComplete({ cwd });
    expect(isSetupComplete({ cwd })).toBe(true);

    await clearSetupComplete({ cwd });
    expect(isSetupComplete({ cwd })).toBe(false);
    const parsed = JSON.parse(readFileSync(configFile(cwd), "utf-8"));
    expect(parsed.language).toBe("en");
    expect(parsed.setupCompletedAt).toBeUndefined();
  });

  it("clearSetupComplete is a no-op when the config file is absent", async () => {
    await clearSetupComplete({ cwd });
    expect(isSetupComplete({ cwd })).toBe(false);
    // No file was created by the no-op clear
    expect(existsSync(configFile(cwd))).toBe(false);
  });

  it("fails closed on a malformed existing project config and leaves the file untouched", async () => {
    mkdirSync(join(cwd, ".pi-oven"), { recursive: true });
    writeFileSync(configFile(cwd), "{ bad", "utf-8");
    await expect(clearSetupComplete({ cwd })).rejects.toThrow(/present but unparsable JSON/i);
    expect(readFileSync(configFile(cwd), "utf-8")).toBe("{ bad");
  });
});

// ---------------------------------------------------------------------------
// Global config helpers (os.homedir()/.pi-oven/config.json)
// Tests use an injectable homeDir so no writes go to the real ~/.pi-oven.
// ---------------------------------------------------------------------------

function globalConfigFile(homeDir: string): string {
  return join(homeDir, ".pi-oven", "config.json");
}

describe("project-config — setGlobalLanguage / readGlobalLanguage round-trip", () => {
  let homeDir: string;

  beforeEach(() => {
    homeDir = join(
      tmpdir(),
      `global-lang-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    mkdirSync(homeDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(homeDir, { recursive: true, force: true });
  });

  it("setGlobalLanguage 'ko' then readGlobalLanguage returns 'ko'", async () => {
    await setGlobalLanguage("ko", { homeDir });
    expect(await readGlobalLanguage({ homeDir })).toBe("ko");
  });

  it("setGlobalLanguage 'en' then readGlobalLanguage returns 'en'", async () => {
    await setGlobalLanguage("en", { homeDir });
    expect(await readGlobalLanguage({ homeDir })).toBe("en");
  });

  it("setGlobalLanguage writes to homeDir/.pi-oven/config.json with the language key", async () => {
    await setGlobalLanguage("ko", { homeDir });
    const parsed = JSON.parse(readFileSync(globalConfigFile(homeDir), "utf-8"));
    expect(parsed.language).toBe("ko");
  });

  it("setGlobalLanguage read-merges: preserves pre-existing sibling keys", async () => {
    mkdirSync(join(homeDir, ".pi-oven"), { recursive: true });
    writeFileSync(globalConfigFile(homeDir), JSON.stringify({ keepMe: true }), "utf-8");
    await setGlobalLanguage("ko", { homeDir });
    const parsed = JSON.parse(readFileSync(globalConfigFile(homeDir), "utf-8"));
    expect(parsed.language).toBe("ko");
    expect(parsed.keepMe).toBe(true);
  });

  it("fails closed on a malformed existing global config and leaves the file untouched", async () => {
    mkdirSync(join(homeDir, ".pi-oven"), { recursive: true });
    writeFileSync(globalConfigFile(homeDir), "{ bad", "utf-8");
    await expect(setGlobalLanguage("ko", { homeDir })).rejects.toThrow(/present but unparsable JSON/i);
    expect(readFileSync(globalConfigFile(homeDir), "utf-8")).toBe("{ bad");
  });

  it("readGlobalLanguage returns null when file is absent", async () => {
    expect(await readGlobalLanguage({ homeDir })).toBeNull();
  });

  it("readGlobalLanguage re-validates stored value (poisoned returns null)", async () => {
    mkdirSync(join(homeDir, ".pi-oven"), { recursive: true });
    writeFileSync(
      globalConfigFile(homeDir),
      JSON.stringify({ language: "ko\ninjected" }),
      "utf-8"
    );
    expect(await readGlobalLanguage({ homeDir })).toBeNull();
  });
});

describe("project-config — global native worker ceiling", () => {
  let homeDir: string;

  beforeEach(() => {
    homeDir = join(
      tmpdir(),
      `global-native-worker-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    mkdirSync(homeDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(homeDir, { recursive: true, force: true });
  });

  it("seedGlobalNativeWorkerMax writes the default ceiling and readGlobalNativeWorkerMax returns it", async () => {
    const value = await seedGlobalNativeWorkerMax({ homeDir });
    expect(value).toBe(DEFAULT_NATIVE_WORKER_MAX);
    expect(await readGlobalNativeWorkerMax({ homeDir })).toBe(DEFAULT_NATIVE_WORKER_MAX);

    const parsed = JSON.parse(readFileSync(globalConfigFile(homeDir), "utf-8"));
    expect(parsed.nativeWorkers).toEqual({ maxWorkers: DEFAULT_NATIVE_WORKER_MAX });
  });

  it("seedGlobalNativeWorkerMax preserves an existing explicit value", async () => {
    mkdirSync(join(homeDir, ".pi-oven"), { recursive: true });
    writeFileSync(
      globalConfigFile(homeDir),
      JSON.stringify({ nativeWorkers: { maxWorkers: 24 }, keepMe: true }),
      "utf-8"
    );

    const value = await seedGlobalNativeWorkerMax({ homeDir });
    expect(value).toBe(24);
    expect(await readGlobalNativeWorkerMax({ homeDir })).toBe(24);

    const parsed = JSON.parse(readFileSync(globalConfigFile(homeDir), "utf-8"));
    expect(parsed.keepMe).toBe(true);
    expect(parsed.nativeWorkers).toEqual({ maxWorkers: 24 });
  });
});

describe("project-config — markSetupCompleteGlobal / isSetupCompleteGlobal", () => {
  let homeDir: string;

  beforeEach(() => {
    homeDir = join(
      tmpdir(),
      `global-marker-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    mkdirSync(homeDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(homeDir, { recursive: true, force: true });
  });

  it("isSetupCompleteGlobal is false before any mark (file absent)", () => {
    expect(isSetupCompleteGlobal({ homeDir })).toBe(false);
  });

  it("markSetupCompleteGlobal writes a non-empty setupCompletedAt at the global path", async () => {
    await markSetupCompleteGlobal({ homeDir });
    const parsed = JSON.parse(readFileSync(globalConfigFile(homeDir), "utf-8"));
    expect(typeof parsed.setupCompletedAt).toBe("string");
    expect(parsed.setupCompletedAt.length).toBeGreaterThan(0);
    expect(Number.isNaN(Date.parse(parsed.setupCompletedAt))).toBe(false);
  });

  it("isSetupCompleteGlobal is true after markSetupCompleteGlobal", async () => {
    await markSetupCompleteGlobal({ homeDir });
    expect(isSetupCompleteGlobal({ homeDir })).toBe(true);
  });

  it("markSetupCompleteGlobal preserves an existing language key", async () => {
    await setGlobalLanguage("ko", { homeDir });
    await markSetupCompleteGlobal({ homeDir });
    const parsed = JSON.parse(readFileSync(globalConfigFile(homeDir), "utf-8"));
    expect(parsed.language).toBe("ko");
    expect(typeof parsed.setupCompletedAt).toBe("string");
  });

  it("isSetupCompleteGlobal fails soft to false on absent/unparsable file", () => {
    mkdirSync(join(homeDir, ".pi-oven"), { recursive: true });
    writeFileSync(globalConfigFile(homeDir), "{ not json", "utf-8");
    expect(isSetupCompleteGlobal({ homeDir })).toBe(false);
  });
});

describe("project-config — clearSetupCompleteGlobal", () => {
  let homeDir: string;

  beforeEach(() => {
    homeDir = join(
      tmpdir(),
      `global-clear-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    mkdirSync(homeDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(homeDir, { recursive: true, force: true });
  });

  it("removes the global marker but KEEPS language", async () => {
    await setGlobalLanguage("en", { homeDir });
    await markSetupCompleteGlobal({ homeDir });
    expect(isSetupCompleteGlobal({ homeDir })).toBe(true);

    await clearSetupCompleteGlobal({ homeDir });
    expect(isSetupCompleteGlobal({ homeDir })).toBe(false);
    const parsed = JSON.parse(readFileSync(globalConfigFile(homeDir), "utf-8"));
    expect(parsed.language).toBe("en");
    expect(parsed.setupCompletedAt).toBeUndefined();
  });

  it("is a no-op when the global config file is absent (does not create one)", async () => {
    await clearSetupCompleteGlobal({ homeDir });
    expect(isSetupCompleteGlobal({ homeDir })).toBe(false);
    expect(existsSync(globalConfigFile(homeDir))).toBe(false);
  });

  it("is a no-op when setupCompletedAt is already missing (leaves file untouched)", async () => {
    await setGlobalLanguage("ko", { homeDir });
    await clearSetupCompleteGlobal({ homeDir });
    const parsed = JSON.parse(readFileSync(globalConfigFile(homeDir), "utf-8"));
    expect(parsed.language).toBe("ko");
  });

  it("fails closed on a malformed existing global config and leaves the file untouched", async () => {
    mkdirSync(join(homeDir, ".pi-oven"), { recursive: true });
    writeFileSync(globalConfigFile(homeDir), "{ bad", "utf-8");
    await expect(clearSetupCompleteGlobal({ homeDir })).rejects.toThrow(/present but unparsable JSON/i);
    expect(readFileSync(globalConfigFile(homeDir), "utf-8")).toBe("{ bad");
  });
});
