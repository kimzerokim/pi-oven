import { afterEach, describe, expect, it } from "bun:test";
import { join } from "node:path";
import {
  resolveHomePaths,
} from "../../scripts/lib/home-paths";

const ORIGINAL_HOME = process.env.HOME;
const ORIGINAL_PI_CONFIG_DIR = process.env.PI_CONFIG_DIR;
const ORIGINAL_PI_CODING_AGENT_DIR = process.env.PI_CODING_AGENT_DIR;

afterEach(() => {
  if (ORIGINAL_HOME === undefined) delete process.env.HOME;
  else process.env.HOME = ORIGINAL_HOME;
  if (ORIGINAL_PI_CONFIG_DIR === undefined) delete process.env.PI_CONFIG_DIR;
  else process.env.PI_CONFIG_DIR = ORIGINAL_PI_CONFIG_DIR;
  if (ORIGINAL_PI_CODING_AGENT_DIR === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = ORIGINAL_PI_CODING_AGENT_DIR;
});

describe("resolveHomePaths", () => {
  it("resolves HOME and supported omp overrides at call time", () => {
    process.env.HOME = "/tmp/pi-oven-home-a";
    process.env.PI_CONFIG_DIR = ".custom-omp";
    process.env.PI_CODING_AGENT_DIR = "/tmp/pi-oven-agent-a";

    const first = resolveHomePaths();

    process.env.HOME = "/tmp/pi-oven-home-b";
    process.env.PI_CONFIG_DIR = ".omp";
    delete process.env.PI_CODING_AGENT_DIR;

    const second = resolveHomePaths();

    expect(first).toMatchObject({
      homeDir: "/tmp/pi-oven-home-a",
      ompConfigRoot: "/tmp/pi-oven-home-a/.custom-omp",
      ompAgentDir: "/tmp/pi-oven-agent-a",
      ompPluginCacheDir: "/tmp/pi-oven-home-a/.custom-omp/plugins/cache/plugins",
      piOvenConfigDir: "/tmp/pi-oven-home-a/.pi-oven",
    });
    expect(second).toMatchObject({
      homeDir: "/tmp/pi-oven-home-b",
      ompConfigRoot: "/tmp/pi-oven-home-b/.omp",
      ompAgentDir: "/tmp/pi-oven-home-b/.omp/agent",
      ompPluginCacheDir: "/tmp/pi-oven-home-b/.omp/plugins/cache/plugins",
      piOvenConfigDir: "/tmp/pi-oven-home-b/.pi-oven",
    });
    expect(second.ompAgentDir).toBe(join(second.ompConfigRoot, "agent"));
  });
});
