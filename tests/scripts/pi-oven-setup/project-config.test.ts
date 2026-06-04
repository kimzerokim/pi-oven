import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  normalizeLanguage,
  setProjectLanguage,
  readProjectLanguage,
  markSetupComplete,
  isSetupComplete,
  clearSetupComplete,
  type ProjectLanguage,
} from "../../../scripts/pi-oven-setup/project-config";

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
});
