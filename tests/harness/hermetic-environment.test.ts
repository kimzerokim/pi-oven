import { describe, expect, it } from "bun:test";
import { existsSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  applyIsolatedHomePaths,
  createIsolatedHomePaths,
  pathIsWithin,
} from "../helpers/home-paths";

function listFiles(root: string): string[] {
  if (!existsSync(root)) return [];
  const result: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) result.push(...listFiles(path));
    else result.push(path);
  }
  return result;
}

describe("hermetic test environment", () => {
  it("redirects user-scoped state before suite imports", () => {
    const isolationRoot = process.env.PI_OVEN_TEST_ISOLATION_ROOT;
    expect(isolationRoot).toBeTruthy();
    expect(pathIsWithin(isolationRoot!, process.env.HOME!)).toBe(true);
    expect(pathIsWithin(isolationRoot!, process.env.XDG_CONFIG_HOME!)).toBe(true);
    expect(pathIsWithin(isolationRoot!, process.env.XDG_CACHE_HOME!)).toBe(true);
    expect(pathIsWithin(isolationRoot!, process.env.XDG_STATE_HOME!)).toBe(true);
    expect(pathIsWithin(isolationRoot!, process.env.TMPDIR!)).toBe(true);
    expect(pathIsWithin(isolationRoot!, process.env.PI_CODING_AGENT_DIR!)).toBe(true);
    expect(process.env.DO_NOT_TRACK).toBe("1");
    expect(process.env.PI_AUTH_NO_BORROW).toBe("1");
  });

  it("starts the hermetic subprocess with an inaccessible original HOME", () => {
    if (process.env.PI_OVEN_HERMETIC_SUBPROCESS !== "1") return;
    const originalHome = process.env.PI_OVEN_TEST_ORIGINAL_HOME;
    expect(originalHome).toBeTruthy();
    expect(originalHome).not.toBe(process.env.HOME);
    expect(statSync(originalHome!).isFile()).toBe(true);
    expect(() =>
      writeFileSync(join(originalHome!, ".omp", "must-not-exist"), "blocked")
    ).toThrow("Hermetic test blocked write outside workspace/isolation root");
  });

  it("blocks writes outside the workspace and isolation root", () => {
    const forbidden = resolve(process.env.PI_OVEN_TEST_ISOLATION_ROOT!, "..", "forbidden.txt");
    expect(() => writeFileSync(forbidden, "must not be written")).toThrow(
      "Hermetic test blocked write outside workspace/isolation root"
    );
    expect(existsSync(forbidden)).toBe(false);
  });

  it("imports the extension without creating omp logs or auth databases", () => {
    const child = createIsolatedHomePaths({
      workspaceRoot: process.cwd(),
      parentDir: process.env.TMPDIR,
      prefix: "import-only-",
    });
    const env = { ...process.env };
    applyIsolatedHomePaths(child, env);
    const result = Bun.spawnSync(
      [process.execPath, "-e", 'await import("./.omp/extensions/pi-oven.ts")'],
      { cwd: process.cwd(), env, stdout: "pipe", stderr: "pipe" }
    );
    expect(result.exitCode).toBe(0);
    expect(new TextDecoder().decode(result.stderr)).toBe("");

    const forbidden = listFiles(child.isolationRoot).filter((path) =>
      /(?:agent\.db|auth[^/]*\.db|\/logs\/|omp\.[^/]+\.log$)/u.test(path)
    );
    expect(forbidden).toEqual([]);
  });

  it("scrubs provider credentials from child environments", () => {
    const child = createIsolatedHomePaths({
      workspaceRoot: process.cwd(),
      parentDir: process.env.TMPDIR,
      prefix: "credentials-",
    });
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      OPENAI_API_KEY: "should-not-escape",
      AWS_SESSION_TOKEN: "should-not-escape",
    };
    const removed = applyIsolatedHomePaths(child, env);
    expect(removed).toContain("OPENAI_API_KEY");
    expect(removed).toContain("AWS_SESSION_TOKEN");
    expect(env.OPENAI_API_KEY).toBeUndefined();
    expect(env.AWS_SESSION_TOKEN).toBeUndefined();
  });
});
