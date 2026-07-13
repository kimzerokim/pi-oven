import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
import type { HomePaths } from "../../scripts/lib/home-paths";

export interface IsolatedHomePaths extends HomePaths {
  isolationRoot: string;
  workspaceRoot: string;
}

const PROVIDER_CREDENTIAL_NAMES = new Set([
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_OAUTH_TOKEN",
  "OPENAI_API_KEY",
  "OPENAI_ACCESS_TOKEN",
  "GOOGLE_API_KEY",
  "GOOGLE_APPLICATION_CREDENTIALS",
  "GEMINI_API_KEY",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_SESSION_TOKEN",
  "AZURE_OPENAI_API_KEY",
  "GITHUB_TOKEN",
  "GH_TOKEN",
  "EXA_API_KEY",
  "BRAVE_API_KEY",
  "PERPLEXITY_API_KEY",
  "PERPLEXITY_COOKIES",
  "TAVILY_API_KEY",
  "ZAI_API_KEY",
  "KIMI_SEARCH_API_KEY",
  "MOONSHOT_SEARCH_API_KEY",
]);

const CREDENTIAL_SUFFIX = /(?:^|_)(?:API_KEY|ACCESS_TOKEN|AUTH_TOKEN|OAUTH_TOKEN|BEARER_TOKEN|SECRET_KEY|SESSION_TOKEN|CREDENTIALS)$/u;

function canonicalize(path: string): string {
  const absolute = resolve(path);
  const missing: string[] = [];
  let cursor = absolute;
  while (true) {
    try {
      return resolve(realpathSync(cursor), ...missing.reverse());
    } catch {
      const parent = dirname(cursor);
      if (parent === cursor) return absolute;
      missing.push(basename(cursor));
      cursor = parent;
    }
  }
}

export function pathIsWithin(root: string, candidate: string): boolean {
  const rel = relative(canonicalize(root), canonicalize(candidate));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

export function createIsolatedHomePaths(options: {
  workspaceRoot: string;
  parentDir?: string;
  prefix?: string;
}): IsolatedHomePaths {
  const isolationRoot = mkdtempSync(
    resolve(options.parentDir ?? tmpdir(), options.prefix ?? "pi-oven-tests-")
  );
  const homeDir = resolve(isolationRoot, "home");
  const ompConfigRoot = resolve(homeDir, ".omp");
  const ompAgentDir = resolve(ompConfigRoot, "agent");
  const paths: IsolatedHomePaths = {
    isolationRoot,
    workspaceRoot: canonicalize(options.workspaceRoot),
    homeDir,
    ompConfigRoot,
    ompAgentDir,
    ompPluginCacheDir: resolve(ompConfigRoot, "plugins", "cache", "plugins"),
    piOvenConfigDir: resolve(homeDir, ".pi-oven"),
    xdgConfigHome: resolve(isolationRoot, "xdg", "config"),
    xdgCacheHome: resolve(isolationRoot, "xdg", "cache"),
    xdgStateHome: resolve(isolationRoot, "xdg", "state"),
    tmpDir: resolve(isolationRoot, "tmp"),
  };

  for (const dir of [
    paths.homeDir,
    paths.ompAgentDir,
    paths.xdgConfigHome,
    paths.xdgCacheHome,
    paths.xdgStateHome,
    paths.tmpDir,
  ]) {
    mkdirSync(dir, { recursive: true });
  }
  return paths;
}

export function scrubProviderCredentials(env: NodeJS.ProcessEnv): string[] {
  const removed: string[] = [];
  for (const name of Object.keys(env)) {
    if (PROVIDER_CREDENTIAL_NAMES.has(name) || CREDENTIAL_SUFFIX.test(name)) {
      delete env[name];
      removed.push(name);
    }
  }
  return removed.sort();
}

export function applyIsolatedHomePaths(
  paths: IsolatedHomePaths,
  env: NodeJS.ProcessEnv = process.env
): string[] {
  env.HOME = paths.homeDir;
  env.XDG_CONFIG_HOME = paths.xdgConfigHome;
  env.XDG_CACHE_HOME = paths.xdgCacheHome;
  env.XDG_STATE_HOME = paths.xdgStateHome;
  env.XDG_DATA_HOME = resolve(paths.isolationRoot, "xdg", "data");
  env.TMPDIR = paths.tmpDir;
  env.PI_CONFIG_DIR = ".omp";
  env.PI_CODING_AGENT_DIR = paths.ompAgentDir;
  env.PI_AUTH_NO_BORROW = "1";
  env.DO_NOT_TRACK = "1";
  env.NODE_ENV = "test";
  env.BUN_ENV = "test";
  env.PI_OVEN_TEST_ISOLATION_ROOT = paths.isolationRoot;
  env.PI_OVEN_TEST_WORKSPACE_ROOT = paths.workspaceRoot;
  mkdirSync(env.XDG_DATA_HOME, { recursive: true });
  return scrubProviderCredentials(env);
}

export function assertTestWritePath(
  paths: Pick<IsolatedHomePaths, "workspaceRoot" | "isolationRoot">,
  candidate: string
): void {
  const absolute = resolve(candidate);
  if (
    !pathIsWithin(paths.workspaceRoot, absolute) &&
    !pathIsWithin(paths.isolationRoot, absolute)
  ) {
    throw new Error(
      `Hermetic test blocked write outside workspace/isolation root: ${absolute}`
    );
  }
}
