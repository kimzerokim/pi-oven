import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  normalizeLanguage,
  setProjectLanguage,
  readProjectLanguage,
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

  it("throws on an unknown language token", () => {
    expect(() => normalizeLanguage("fr")).toThrow();
    expect(() => normalizeLanguage("")).toThrow();
    expect(() => normalizeLanguage("japanese")).toThrow();
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

  it("returns null when the stored language is invalid", async () => {
    mkdirSync(join(cwd, ".pi-oven"), { recursive: true });
    writeFileSync(configFile(cwd), JSON.stringify({ language: "fr" }), "utf-8");
    expect(await readProjectLanguage({ cwd })).toBeNull();
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
