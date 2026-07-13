import { homedir, tmpdir } from "node:os";
import { isAbsolute, resolve } from "node:path";

export interface HomePaths {
  homeDir: string;
  ompConfigRoot: string;
  ompAgentDir: string;
  ompPluginCacheDir: string;
  piOvenConfigDir: string;
  xdgConfigHome: string;
  xdgCacheHome: string;
  xdgStateHome: string;
  tmpDir: string;
}

export interface ResolveHomePathsOptions {
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
}

function nonEmpty(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function resolveUnderHome(homeDir: string, value: string): string {
  return isAbsolute(value) ? resolve(value) : resolve(homeDir, value);
}

/**
 * Resolve user-scoped paths from the current environment on every call.
 *
 * `node:os.homedir()` is cached by Bun, so HOME must be consulted directly to
 * keep repeated in-process invocations independent. The explicit `homeDir`
 * option is the injection seam for callers that must not read ambient state.
 */
export function resolveHomePaths(options: ResolveHomePathsOptions = {}): HomePaths {
  const env = options.env ?? process.env;
  const homeDir = resolve(options.homeDir ?? nonEmpty(env.HOME) ?? homedir());
  const ompConfigRoot = resolveUnderHome(homeDir, nonEmpty(env.PI_CONFIG_DIR) ?? ".omp");
  const ompAgentDir = resolve(
    nonEmpty(env.PI_CODING_AGENT_DIR) ?? resolve(ompConfigRoot, "agent")
  );

  return {
    homeDir,
    ompConfigRoot,
    ompAgentDir,
    ompPluginCacheDir: resolve(ompConfigRoot, "plugins", "cache", "plugins"),
    piOvenConfigDir: resolve(homeDir, ".pi-oven"),
    xdgConfigHome: resolve(nonEmpty(env.XDG_CONFIG_HOME) ?? resolve(homeDir, ".config")),
    xdgCacheHome: resolve(nonEmpty(env.XDG_CACHE_HOME) ?? resolve(homeDir, ".cache")),
    xdgStateHome: resolve(
      nonEmpty(env.XDG_STATE_HOME) ?? resolve(homeDir, ".local", "state")
    ),
    tmpDir: resolve(nonEmpty(env.TMPDIR) ?? tmpdir()),
  };
}
