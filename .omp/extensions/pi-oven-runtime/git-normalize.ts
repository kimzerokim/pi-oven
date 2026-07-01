// ---------------------------------------------------------------------------
// git-normalize.ts — PURE Bash-command normalization (Spec F §3 Layer 1 B3)
//
// Tokenize a Bash command, split into sub-commands on `;`, `&&`, `||`, `|`,
// and newlines; strip a leading `env VAR=val` (or bare VAR=val) prefix; unwrap
// ONE level of `bash -c` / `bash -lc` / `sh -c` / `zsh -c`; detect the `git`
// program even behind `-C dir` / `-c k=v` / `--git-dir=...` options; return the
// detected gated verbs (commit / push) plus the destructive `rm -rf` forbidden
// floor, consent-gated external command matches, and inline secret literals.
//
// This is best-effort, NOT a sandbox. The documented residual bypass surface
// (heredocs, aliases, $(...), eval, decode-then-exec, deeper interpreter
// nesting) is intentionally uncovered — see Spec F §3 Layer 1 B3 step 4 and the
// AC7 test's KNOWN-UNCOVERED block.
// ---------------------------------------------------------------------------

import { fingerprintExternalExecSecret } from "./gate-state";

export type GitVerb = "commit" | "push";

export interface ForbiddenMatch {
  /** A short identifier for the matched rule (used in the block reason). */
  rule: string;
  /** The sub-command text that matched. */
  segment: string;
}

export type ExternalCommandKind =
  | "external-read"
  | "external-session"
  | "external-mutation"
  | "inline-secret";

export interface ExternalMatch {
  kind: Exclude<ExternalCommandKind, "inline-secret">;
  rule: string;
  segment: string;
}

export interface InlineSecretMatch {
  kind: "inline-secret";
  rule: string;
  segment: string;
  awsCredentials?: {
    provider: "aws";
    accessKeyId: string;
    accessKeyKind: "temporary" | "permanent";
    hasSessionToken: boolean;
    sessionTokenFingerprint?: string;
    secretAccessKeyFingerprint?: string;
  };
}

export interface NormalizedCommand {
  /** Gated git verbs detected anywhere in the (unwrapped, split) command. */
  gitVerbs: GitVerb[];
  /** Forbidden-set matches (always-on destructive floor only). */
  forbiddenMatches: ForbiddenMatch[];
  /** Consent-gated external command matches. */
  externalMatches: ExternalMatch[];
  /** Inline secret literals embedded directly in command text. */
  inlineSecretMatches: InlineSecretMatch[];
  /** Best-effort "<remote> <branch>" parse from the first `git push` segment. */
  pushTarget?: string;
}

/**
 * Concrete filesystem roots the forbidden `rm -rf` matcher resolves against.
 * Passed in by the caller (gate-handler.ts, wired from `process.cwd()` /
 * `os.homedir()` in pi-oven.ts) so the matcher stays a PURE, testable function —
 * it never reads process state itself.
 */
export interface NormalizeRoots {
  /** Absolute repo-root path (the workspace cwd). */
  repoRoot?: string;
  /** Absolute expanded home directory. */
  homeDir?: string;
}

const GATED_VERBS: ReadonlySet<string> = new Set(["commit", "push"]);

/** Tokenize a shell string honoring single/double quotes. Returns raw tokens. */
function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let cur = "";
  let quote: '"' | "'" | null = null;
  let has = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (quote) {
      if (ch === quote) {
        quote = null;
      } else if (ch === "\\" && quote === '"' && i + 1 < input.length) {
        cur += input[++i];
      } else {
        cur += ch;
      }
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      has = true;
    } else if (ch === "\\" && i + 1 < input.length) {
      cur += input[++i];
      has = true;
    } else if (ch === " " || ch === "\t") {
      if (has) {
        tokens.push(cur);
        cur = "";
        has = false;
      }
    } else {
      cur += ch;
      has = true;
    }
  }
  if (has) tokens.push(cur);
  return tokens;
}

/**
 * Split a command string into sub-command strings on the top-level shell
 * operators `;`, `&&`, `||`, `|`, and newlines. Splitting is quote-aware so
 * operators inside quotes (e.g. a commit message) do not split.
 */
function splitSubCommands(input: string): string[] {
  const parts: string[] = [];
  let cur = "";
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    const next = input[i + 1];
    if (quote) {
      if (ch === quote) {
        cur += ch;
        quote = null;
      } else if (ch === "\\" && quote === '"' && i + 1 < input.length) cur += ch + input[++i];
      else cur += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      cur += ch;
      continue;
    }
    if (ch === "\\" && i + 1 < input.length) {
      cur += ch + input[++i];
      continue;
    }
    if (ch === "\n" || ch === ";") {
      parts.push(cur);
      cur = "";
      continue;
    }
    if ((ch === "&" && next === "&") || (ch === "|" && next === "|")) {
      parts.push(cur);
      cur = "";
      i++; // consume the second char
      continue;
    }
    if (ch === "|") {
      // single pipe
      parts.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  parts.push(cur);
  return parts.map((p) => p.trim()).filter((p) => p.length > 0);
}

const LEADING_ENV_ASSIGNMENT = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/;

/** Strip leading `env` keyword and any leading `VAR=val` assignment tokens. */
function stripLeadingEnv(tokens: string[]): string[] {
  let i = 0;
  if (tokens[i] === "env") i++;
  while (i < tokens.length && LEADING_ENV_ASSIGNMENT.test(tokens[i])) i++;
  return tokens.slice(i);
}

function readLeadingEnvAssignments(tokens: string[]): Record<string, string> {
  let i = 0;
  if (tokens[i] === "env") i++;
  const env: Record<string, string> = {};
  while (i < tokens.length) {
    const match = tokens[i].match(LEADING_ENV_ASSIGNMENT);
    if (!match) break;
    env[match[1]] = match[2];
    i++;
  }
  return env;
}

const INTERPRETERS: ReadonlySet<string> = new Set(["bash", "sh", "zsh", "dash"]);

/**
 * If the sub-command is an interpreter wrapper (`bash -c`/`-lc`/`sh -c`/...),
 * return the inner script string for ONE level of unwrapping. Otherwise null.
 */
function unwrapInterpreter(tokens: string[]): string | null {
  if (tokens.length < 2) return null;
  const prog = tokens[0].split("/").pop() ?? tokens[0];
  if (!INTERPRETERS.has(prog)) return null;
  // find a `-c` / `-lc` / `-lic` style flag carrying the command-string mode
  for (let i = 1; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.startsWith("-") && t.includes("c")) {
      // the inner script is the next token
      return tokens[i + 1] ?? null;
    }
    if (!t.startsWith("-")) break; // first non-flag positional reached without -c
  }
  return null;
}

interface GitVerbEnvLookupState {
  sawVerb: boolean;
  hasValue: boolean;
  value?: string;
  consistent: boolean;
}

function collectLeadingEnvVarForGitVerb(
  segment: string,
  verb: GitVerb,
  name: string,
  inheritedEnv: Readonly<Record<string, string>>,
  state: GitVerbEnvLookupState
): void {
  if (!state.consistent) return;
  const rawTokens = tokenize(segment);
  const localEnv = readLeadingEnvAssignments(rawTokens);
  const effectiveEnv =
    Object.keys(localEnv).length > 0
      ? { ...inheritedEnv, ...localEnv }
      : inheritedEnv;
  const tokens = stripLeadingEnv(rawTokens);
  if (tokens.length === 0) return;

  const git = detectGitVerb(tokens);
  if (git?.verb === verb) {
    state.sawVerb = true;
    if (!Object.prototype.hasOwnProperty.call(effectiveEnv, name)) {
      state.consistent = false;
      return;
    }
    const value = effectiveEnv[name];
    if (!state.hasValue) {
      state.hasValue = true;
      state.value = value;
    } else if (state.value !== value) {
      state.consistent = false;
      return;
    }
  }

  const innerScript = unwrapInterpreter(tokens);
  if (innerScript != null) {
    for (const innerSub of splitSubCommands(innerScript)) {
      collectLeadingEnvVarForGitVerb(innerSub, verb, name, effectiveEnv, state);
      if (!state.consistent) return;
    }
  }
}

export function getLeadingEnvVarForGitVerb(
  command: string,
  verb: GitVerb,
  name: string
): string | undefined {
  const state: GitVerbEnvLookupState = {
    sawVerb: false,
    hasValue: false,
    consistent: true,
  };
  for (const sub of splitSubCommands(command)) {
    collectLeadingEnvVarForGitVerb(sub, verb, name, {}, state);
    if (!state.consistent) return undefined;
  }
  return state.sawVerb && state.hasValue ? state.value : undefined;
}

/**
 * Detect the git verb in a sub-command's tokens. Skips `git`'s own options
 * (`-C dir`, `-c k=v`, `--git-dir=...`, etc.) to find the first verb token.
 */
function detectGitVerb(tokens: string[]): { verb: GitVerb; rest: string[] } | null {
  const prog = (tokens[0]?.split("/").pop()) ?? tokens[0];
  if (prog !== "git") return null;
  let i = 1;
  while (i < tokens.length) {
    const t = tokens[i];
    if (t === "-C" || t === "-c" || t === "--exec-path" || t === "--namespace") {
      i += 2; // option that takes a separate-token value
      continue;
    }
    if (t.startsWith("--") && t.includes("=")) {
      i += 1; // --git-dir=... / --work-tree=... (value attached)
      continue;
    }
    if (t.startsWith("-")) {
      i += 1; // bare flag like -p, --paginate, --no-pager
      continue;
    }
    // first non-option token = the verb
    if (GATED_VERBS.has(t)) {
      return { verb: t as GitVerb, rest: tokens.slice(i + 1) };
    }
    return null; // a non-gated verb (status, log, ...)
  }
  return null;
}

// --- Forbidden floor -------------------------------------------------------

const HOME_ROOTS = ["$HOME", "~", "${HOME}"];

/**
 * Normalize a POSIX-style absolute path: collapse `.`/`..` segments and strip a
 * trailing slash. A pure string operation (no FS access) so the matcher stays
 * testable. Returns "/" for the filesystem root.
 */
function normalizeAbsPath(p: string): string {
  const segments = p.split("/");
  const out: string[] = [];
  for (const seg of segments) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      out.pop();
      continue;
    }
    out.push(seg);
  }
  return "/" + out.join("/");
}

/**
 * Resolve an `rm` target string to an absolute, normalized path against the
 * supplied roots. Handles a leading `~`/`$HOME`/`${HOME}` (expanded to homeDir)
 * and relative paths (resolved against repoRoot). Returns null when the target
 * cannot be resolved to an absolute path (e.g. relative path with no repoRoot).
 */
function resolveRmTarget(target: string, roots: NormalizeRoots): string | null {
  // Symbolic home expansion.
  if (roots.homeDir) {
    if (target === "~" || target === "$HOME" || target === "${HOME}") {
      return normalizeAbsPath(roots.homeDir);
    }
    if (target.startsWith("~/")) {
      return normalizeAbsPath(roots.homeDir + "/" + target.slice(2));
    }
    if (target.startsWith("$HOME/")) {
      return normalizeAbsPath(roots.homeDir + "/" + target.slice("$HOME/".length));
    }
    if (target.startsWith("${HOME}/")) {
      return normalizeAbsPath(roots.homeDir + "/" + target.slice("${HOME}/".length));
    }
  }
  if (target.startsWith("/")) {
    return normalizeAbsPath(target);
  }
  // Relative path — resolve against the repo root.
  if (roots.repoRoot) {
    return normalizeAbsPath(roots.repoRoot + "/" + target);
  }
  return null;
}

/** True when `ancestor` is the same as, or a parent directory of, `descendant`. */
function isSameOrAncestor(ancestor: string, descendant: string): boolean {
  if (ancestor === descendant) return true;
  const base = ancestor === "/" ? "/" : ancestor + "/";
  return descendant.startsWith(base);
}

/** Detect a destructive `rm -rf` of a repo/HOME/system root. */
function detectForbiddenRm(
  tokens: string[],
  segment: string,
  roots: NormalizeRoots = {}
): ForbiddenMatch | null {
  const prog = tokens[0]?.split("/").pop();
  if (prog !== "rm") return null;
  let recursive = false;
  let force = false;
  const targets: string[] = [];
  for (let i = 1; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.startsWith("-") && !t.startsWith("--")) {
      if (t.includes("r") || t.includes("R")) recursive = true;
      if (t.includes("f")) force = true;
    } else if (t === "--recursive") {
      recursive = true;
    } else if (t === "--force") {
      force = true;
    } else if (!t.startsWith("-")) {
      targets.push(t);
    }
  }
  if (!recursive) return null;
  for (const target of targets) {
    if (HOME_ROOTS.includes(target)) {
      return { rule: "rm-rf-home", segment };
    }
    // absolute root-ish path: `/`, `/usr`, `/etc`, repo root markers, single-segment absolute
    if (target === "/" || /^\/[A-Za-z0-9_.-]*\/?$/.test(target)) {
      return { rule: "rm-rf-root", segment };
    }
    // home-relative: `~/...` or `$HOME/...`
    if (target.startsWith("~/") || target.startsWith("$HOME") || target.startsWith("${HOME}")) {
      return { rule: "rm-rf-home", segment };
    }
    // Resolved-target comparison against the concrete roots (repo / HOME). A
    // target that resolves to (or is an ancestor of) the repo root or the
    // expanded HOME dir is forbidden. This catches an absolute repo path, a
    // relative `.` from the repo root, an expanded `~`/`$HOME`, etc. Benign
    // cleanup of a SUBDIR (e.g. `rm -rf ./build`) resolves strictly BELOW a
    // root and is intentionally allowed.
    const resolved = resolveRmTarget(target, roots);
    if (resolved) {
      if (roots.repoRoot) {
        const repo = normalizeAbsPath(roots.repoRoot);
        if (isSameOrAncestor(resolved, repo)) {
          return { rule: "rm-rf-repo-root", segment };
        }
      }
      if (roots.homeDir) {
        const home = normalizeAbsPath(roots.homeDir);
        if (isSameOrAncestor(resolved, home)) {
          return { rule: "rm-rf-home", segment };
        }
      }
    }
  }
  // recursive+force with no positional target after flags is suspicious too,
  // but we only flag explicit dangerous roots to avoid false positives.
  void force;
  return null;
}

function externalMatch(
  kind: ExternalMatch["kind"],
  rule: string,
  segment: string
): ExternalMatch {
  return { kind, rule, segment };
}

function inlineSecretMatch(
  rule: string,
  segment: string,
  awsCredentials?: InlineSecretMatch["awsCredentials"]
): InlineSecretMatch {
  return { kind: "inline-secret", rule, segment, ...(awsCredentials ? { awsCredentials } : {}) };
}

function findFlagValue(tokens: string[], flags: readonly string[]): string | null {
  for (let i = 1; i < tokens.length; i++) {
    const token = tokens[i];
    if (flags.includes(token)) return tokens[i + 1] ?? null;
    const prefix = flags.find((flag) => token.startsWith(`${flag}=`));
    if (prefix) return token.slice(prefix.length + 1);
    const shortFlag = flags.find((flag) => flag.length === 2 && token.startsWith(flag) && token.length > flag.length);
    if (shortFlag) return token.slice(shortFlag.length);
  }
  return null;
}

function hasFlag(tokens: string[], flags: readonly string[]): boolean {
  return tokens.some((token, index) => {
    if (index === 0) return false;
    if (flags.includes(token)) return true;
    if (flags.some((flag) => token.startsWith(`${flag}=`))) return true;
    return flags.some((flag) => flag.length === 2 && token.startsWith(flag) && token.length > flag.length);
  });
}

function firstNonFlag(tokens: string[], start: number): string | null {
  for (let i = start; i < tokens.length; i++) {
    if (!tokens[i].startsWith("-")) return tokens[i];
  }
  return null;
}

const EMPTY_FLAG_SET: ReadonlySet<string> = new Set();
const AWS_VALUE_FLAGS: ReadonlySet<string> = new Set([
  "--ca-bundle",
  "--cli-connect-timeout",
  "--cli-read-timeout",
  "--color",
  "--endpoint-url",
  "--output",
  "--profile",
  "--query",
  "--region",
]);
const AWS_BOOLEAN_FLAGS: ReadonlySet<string> = new Set([
  "--debug",
  "--no-cli-pager",
  "--no-paginate",
  "--no-sign-request",
  "--no-verify-ssl",
]);
const TERRAFORM_VALUE_FLAGS: ReadonlySet<string> = new Set(["-chdir"]);
const KUBECTL_VALUE_FLAGS: ReadonlySet<string> = new Set([
  "--as",
  "--as-group",
  "--as-uid",
  "--cache-dir",
  "--certificate-authority",
  "--client-certificate",
  "--client-key",
  "--cluster",
  "--context",
  "--kubeconfig",
  "--namespace",
  "--request-timeout",
  "--server",
  "--tls-server-name",
  "--token",
  "--user",
  "--username",
  "-n",
]);
const HELM_VALUE_FLAGS: ReadonlySet<string> = new Set([
  "--kube-context",
  "--kubeconfig",
  "--namespace",
  "--registry-config",
  "--repository-cache",
  "--repository-config",
  "-n",
]);
const CURL_MUTATION_FLAGS = ["-d", "--data", "--data-binary", "--data-raw", "--form", "-F", "--json"] as const;

function findPositionalIndex(
  tokens: string[],
  start: number,
  valueFlags: ReadonlySet<string> = EMPTY_FLAG_SET,
  booleanFlags: ReadonlySet<string> = EMPTY_FLAG_SET
): number | null {
  for (let i = start; i < tokens.length; i++) {
    const token = tokens[i];
    if (token === "--") return i + 1 < tokens.length ? i + 1 : null;
    if (!token.startsWith("-")) return i;
    if (token.includes("=") || booleanFlags.has(token)) continue;
    if (valueFlags.has(token)) {
      i++;
    }
  }
  return null;
}

function findPositional(
  tokens: string[],
  start: number,
  valueFlags: ReadonlySet<string> = EMPTY_FLAG_SET,
  booleanFlags: ReadonlySet<string> = EMPTY_FLAG_SET
): string | null {
  const index = findPositionalIndex(tokens, start, valueFlags, booleanFlags);
  return index == null ? null : tokens[index];
}

const DIRECT_API_HOSTS = new Set(["api.bitbucket.org", "api.cloudflare.com"]);
const DIRECT_API_MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function findUrlToken(tokens: string[]): string | null {
  for (let i = 1; i < tokens.length; i++) {
    const token = tokens[i];
    if (/^https?:\/\//i.test(token)) return token;
    if (token === "--url") return tokens[i + 1] ?? null;
    if (token.startsWith("--url=")) return token.slice("--url=".length);
  }
  return null;
}

function findHttpieMethod(tokens: string[], url: string): string | null {
  const urlIndex = tokens.indexOf(url);
  if (urlIndex < 0) return null;
  for (let i = 1; i < urlIndex; i++) {
    const token = tokens[i];
    if (/^(get|post|put|patch|delete|head|options)$/i.test(token)) {
      return token.toUpperCase();
    }
  }
  return null;
}

function classifyDirectApiCommand(
  prog: string,
  tokens: string[],
  segment: string
): ExternalMatch | null {
  const urlToken = findUrlToken(tokens);
  if (urlToken == null) return null;

  let host: string;
  try {
    host = new URL(urlToken).hostname.toLowerCase();
  } catch {
    return null;
  }
  if (!DIRECT_API_HOSTS.has(host)) return null;

  const explicitMethod =
    prog === "curl"
      ? findFlagValue(tokens, ["-X", "--request"])?.toUpperCase()
      : findHttpieMethod(tokens, urlToken);
  if (prog === "curl" && explicitMethod == null && hasFlag(tokens, CURL_MUTATION_FLAGS)) {
    return externalMatch("external-mutation", `${prog}-direct-api-mutation`, segment);
  }
  const method = explicitMethod ?? "GET";

  return DIRECT_API_MUTATION_METHODS.has(method)
    ? externalMatch("external-mutation", `${prog}-direct-api-mutation`, segment)
    : externalMatch("external-read", `${prog}-direct-api-read`, segment);
}
function isInlineLiteralValue(value: string | null | undefined): value is string {
  return value != null && value !== "" && !value.startsWith("-") && !/^\$(?:\{[A-Za-z_][A-Za-z0-9_]*\}|[A-Za-z_][A-Za-z0-9_]*)$/.test(value);
}

function tokenValue(token: string, nextToken: string | undefined): string | null {
  const equals = token.indexOf("=");
  return equals >= 0 ? token.slice(equals + 1) : (nextToken ?? null);
}

function isSecretEnvAssignment(token: string): boolean {
  const equals = token.indexOf("=");
  if (equals <= 0) return false;
  return /^[A-Z0-9_]*(SECRET|TOKEN|PASSWORD)[A-Z0-9_]*$/i.test(token.slice(0, equals));
}
const DB_CONNECTION_URI = /^(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\//i;
const REDIS_VALUE_FLAGS: ReadonlySet<string> = new Set(["-u", "--uri"]);
const INLINE_SECRET_HEADER_NAMES: ReadonlySet<string> = new Set([
  "authorization",
  "proxy-authorization",
  "x-auth-key",
  "x-api-key",
  "x-auth-token",
  "cf-access-client-secret",
]);

function hasDbConnectionUri(tokens: string[]): boolean {
  return tokens.some((token, index) => index > 0 && DB_CONNECTION_URI.test(token));
}

function inlineSecretHeaderLiteral(header: string, nextToken: string | undefined): string | null {
  const match = header.match(/^([^:]+):(.*)$/);
  if (match == null) return null;
  const name = match[1].toLowerCase();
  if (!INLINE_SECRET_HEADER_NAMES.has(name)) return null;

  let value = match[2].trim();
  if (/authorization$/.test(name)) {
    const authMatch = value.match(/^(?:bearer|basic|token)(?:\s+(.*))?$/i);
    if (authMatch != null) value = authMatch[1]?.trim() ?? "";
  }
  if (value === "" && nextToken != null) value = nextToken.trim();
  return isInlineLiteralValue(value) ? value : null;
}

function inlineSecretHeaderValue(token: string, nextToken: string | undefined): string | null {
  let header: string | null = null;
  if (token === "-H" || token === "--header") {
    header = nextToken ?? null;
    nextToken = undefined;
  } else if (token.startsWith("--header=")) {
    header = token.slice("--header=".length);
  } else if (token.startsWith("-H") && token.length > 2) {
    header = token.slice(2);
  }
  return header == null ? null : inlineSecretHeaderLiteral(header, nextToken);
}


function detectDbCommand(tokens: string[], segment: string): ExternalMatch | null {
  const prog = tokens[0]?.split("/").pop();
  if (prog === "psql") {
    const query = findFlagValue(tokens, ["-c", "--command"]);
    if (query != null) {
      return /^\s*(update|insert|delete|alter|drop|create|truncate|grant|revoke|merge|replace)\b/i.test(
        query
      )
        ? externalMatch("external-mutation", "db-psql-mutation", segment)
        : externalMatch("external-read", "db-psql-read", segment);
    }
    return hasDbConnectionUri(tokens) ? externalMatch("external-session", "db-psql-session", segment) : null;
  }
  if (prog === "mysql") {
    const query = findFlagValue(tokens, ["-e", "--execute"]);
    if (query != null) {
      return /^\s*(update|insert|delete|alter|drop|create|truncate|grant|revoke|merge|replace)\b/i.test(
        query
      )
        ? externalMatch("external-mutation", "db-mysql-mutation", segment)
        : externalMatch("external-read", "db-mysql-read", segment);
    }
    return hasDbConnectionUri(tokens) ? externalMatch("external-session", "db-mysql-session", segment) : null;
  }
  if (prog === "mongosh") {
    const query = findFlagValue(tokens, ["--eval"]);
    if (query != null) {
      return /(?:db\.[A-Za-z0-9_]+\.(?:insert|update|delete|remove|drop)|\bdeleteMany\b|\bupdateMany\b)/.test(
        query
      )
        ? externalMatch("external-mutation", "db-mongosh-mutation", segment)
        : externalMatch("external-read", "db-mongosh-read", segment);
    }
    return hasDbConnectionUri(tokens) ? externalMatch("external-session", "db-mongosh-session", segment) : null;
  }
  if (prog === "redis-cli") {
    const verb = findPositional(tokens, 1, REDIS_VALUE_FLAGS)?.toLowerCase();
    if (verb == null) {
      return findFlagValue(tokens, ["-u", "--uri"]) != null
        ? externalMatch("external-session", "db-redis-session", segment)
        : null;
    }
    if (["get", "mget", "keys", "scan", "hget", "smembers", "lrange"].includes(verb)) {
      return externalMatch("external-read", "db-redis-read", segment);
    }
    if (["set", "mset", "del", "eval", "hset", "sadd", "lpush", "rpush"].includes(verb)) {
      return externalMatch("external-mutation", "db-redis-mutation", segment);
    }
    return findFlagValue(tokens, ["-u", "--uri"]) != null
      ? externalMatch("external-session", "db-redis-session", segment)
      : null;
  }
  return null;
}

function detectExternalCommand(tokens: string[], segment: string): ExternalMatch | null {
  const command = tokens[0] ?? "";
  const prog = command.split("/").pop();
  if (prog == null) return null;

  if (prog === "aws") {
    const subIndex = findPositionalIndex(tokens, 1, AWS_VALUE_FLAGS, AWS_BOOLEAN_FLAGS);
    const sub = subIndex == null ? null : tokens[subIndex];
    const verb = subIndex == null ? null : findPositional(tokens, subIndex + 1);
    if (sub === "ssm" && (verb === "start-session" || verb === "send-command")) {
      return externalMatch("external-session", "aws-ssm-access", segment);
    }
    if (sub === "sts" && verb === "assume-role") {
      return externalMatch("external-session", "aws-sts-assume-role", segment);
    }
    if (sub === "secretsmanager" && verb === "get-secret-value") {
      return externalMatch("external-session", "aws-secretsmanager-access", segment);
    }
    if (verb != null) {
      if (/^(describe|get|list)(-|$)/.test(verb) || (sub === "s3" && verb === "ls")) {
        return externalMatch("external-read", "aws-read", segment);
      }
      if (
        /^(create|update|put|delete|start|stop|terminate)(-|$)/.test(verb) ||
        ["deploy", "sync", "cp", "rm", "batch-delete-image", "change-resource-record-sets"].includes(verb)
      ) {
        return externalMatch("external-mutation", "aws-mutation", segment);
      }
    }
    return null;
  }

  if (prog === "terraform" || prog === "tofu") {
    const verbIndex = findPositionalIndex(tokens, 1, TERRAFORM_VALUE_FLAGS);
    const verb = verbIndex == null ? null : tokens[verbIndex];
    const stateVerb = verbIndex == null ? null : findPositional(tokens, verbIndex + 1);
    if (["apply", "destroy", "import", "taint", "untaint"].includes(verb ?? "")) {
      return externalMatch("external-mutation", `${prog}-mutation`, segment);
    }
    if (verb === "state" && ["mv", "rm"].includes(stateVerb ?? "")) {
      return externalMatch("external-mutation", `${prog}-state-mutation`, segment);
    }
    return null;
  }

  if (prog === "kubectl") {
    const verb = findPositional(tokens, 1, KUBECTL_VALUE_FLAGS);
    if (["get", "describe", "logs"].includes(verb ?? "")) {
      return externalMatch("external-read", "kubectl-read", segment);
    }
    if (verb === "exec" || verb === "port-forward") {
      return externalMatch("external-session", "kubectl-access", segment);
    }
    if (["apply", "delete", "patch", "edit", "scale"].includes(verb ?? "")) {
      return externalMatch("external-mutation", "kubectl-mutation", segment);
    }
    return null;
  }

  if (prog === "helm") {
    const verb = findPositional(tokens, 1, HELM_VALUE_FLAGS);
    if (["install", "upgrade", "rollback", "uninstall"].includes(verb ?? "")) {
      return externalMatch("external-mutation", "helm-mutation", segment);
    }
  }
  if (prog === "curl" || prog === "http") {
    return classifyDirectApiCommand(prog, tokens, segment);
  }
  const db = detectDbCommand(tokens, segment);
  if (db) return db;

  if (prog === "ssh" || prog === "scp" || prog === "rsync") {
    return externalMatch("external-session", "remote-transport", segment);
  }

  if (
    /^(deploy|release|migrate)[^/\s]*\.sh$/i.test(prog) ||
    /(?:^|\/)scripts\/(?:deploy|release|migrate)[^/\s]*$/i.test(command)
  ) {
    return externalMatch("external-mutation", "repo-local-deploy", segment);
  }

  return null;
}

function detectInlineSecrets(rawTokens: string[], segment: string): InlineSecretMatch[] {
  const tokens = stripLeadingEnv(rawTokens);
  const isDirectHttpieApi =
    ((tokens[0]?.split("/").pop()) ?? "") === "http" && classifyDirectApiCommand("http", tokens, segment) != null;

  const matches: InlineSecretMatch[] = [];
  let awsAccessKeyIndex: number | undefined;
  let awsSecretAccessKeyIndex: number | undefined;
  let awsSessionTokenIndex: number | undefined;
  let awsAccessKeyId: string | null = null;
  let awsAccessKeyKind: "temporary" | "permanent" | null = null;
  let awsSessionTokenFingerprint: string | undefined;
  let awsSecretAccessKeyFingerprint: string | undefined;

  for (let i = 0; i < rawTokens.length; i++) {
    const token = rawTokens[i];
    const accessKeyMatch = token.match(/^AWS_ACCESS_KEY_ID=(AKIA|ASIA)([0-9A-Z]{12,})$/i);
    if (accessKeyMatch) {
      awsAccessKeyIndex = i;
      awsAccessKeyId = accessKeyMatch[1].toUpperCase() + accessKeyMatch[2].toUpperCase();
      awsAccessKeyKind = accessKeyMatch[1].toUpperCase() === "ASIA" ? "temporary" : "permanent";
      continue;
    }
    const secretAccessKeyMatch = token.match(/^AWS_SECRET_ACCESS_KEY=(.*)$/i);
    if (secretAccessKeyMatch && isInlineLiteralValue(secretAccessKeyMatch[1])) {
      awsSecretAccessKeyIndex = i;
      awsSecretAccessKeyFingerprint = fingerprintExternalExecSecret(secretAccessKeyMatch[1]);
      continue;
    }
    const sessionTokenMatch = token.match(/^AWS_SESSION_TOKEN=(.*)$/i);
    if (sessionTokenMatch && isInlineLiteralValue(sessionTokenMatch[1])) {
      awsSessionTokenIndex = i;
      awsSessionTokenFingerprint = fingerprintExternalExecSecret(sessionTokenMatch[1]);
      continue;
    }
  }

  const recognizedAwsTokenIndexes = new Set<number>();
  if (awsAccessKeyId && awsAccessKeyKind) {
    if (awsAccessKeyIndex !== undefined) recognizedAwsTokenIndexes.add(awsAccessKeyIndex);
    if (awsSecretAccessKeyIndex !== undefined) recognizedAwsTokenIndexes.add(awsSecretAccessKeyIndex);
    if (awsSessionTokenIndex !== undefined) recognizedAwsTokenIndexes.add(awsSessionTokenIndex);
    matches.push(
      inlineSecretMatch("inline-aws-access-key-id", segment, {
        provider: "aws",
        accessKeyId: awsAccessKeyId,
        accessKeyKind: awsAccessKeyKind,
        hasSessionToken: awsSessionTokenFingerprint !== undefined,
        ...(awsSessionTokenFingerprint ? { sessionTokenFingerprint: awsSessionTokenFingerprint } : {}),
        ...(awsSecretAccessKeyFingerprint
          ? { secretAccessKeyFingerprint: awsSecretAccessKeyFingerprint }
          : {}),
      })
    );
  }

  for (let i = 0; i < rawTokens.length; i++) {
    const token = rawTokens[i];
    if (recognizedAwsTokenIndexes.has(i)) continue;
    if (isDirectHttpieApi) {
      const httpieAssignment = token.match(/^([^=\s]+)==(.*)$/);
      if (httpieAssignment != null) {
        if (/(?:secret|token|password)/i.test(httpieAssignment[1]) && isInlineLiteralValue(httpieAssignment[2])) {
          matches.push(inlineSecretMatch("inline-secret-httpie-literal", segment));
        }
        continue;
      }
      if (inlineSecretHeaderLiteral(token, rawTokens[i + 1]) != null) {
        matches.push(inlineSecretMatch("inline-secret-header", segment));
        continue;
      }
    }
    if (isSecretEnvAssignment(token) && isInlineLiteralValue(tokenValue(token, rawTokens[i + 1]))) {
      matches.push(inlineSecretMatch("inline-secret-env", segment));
      continue;
    }
    if (/^--password(?:=.*)?$/i.test(token) && isInlineLiteralValue(tokenValue(token, rawTokens[i + 1]))) {
      matches.push(inlineSecretMatch("inline-password-flag", segment));
      continue;
    }
    if (
      /^(?:--access-token|--secret-token|--auth-token)(?:=.*)?$/i.test(token) &&
      isInlineLiteralValue(tokenValue(token, rawTokens[i + 1]))
    ) {
      matches.push(inlineSecretMatch("inline-token-flag", segment));
      continue;
    }
    if (inlineSecretHeaderValue(token, rawTokens[i + 1]) != null) {
      matches.push(inlineSecretMatch("inline-secret-header", segment));
    }
  }
  return matches;
}

// --- Top-level entrypoint --------------------------------------------------

/**
 * Normalize a Bash command string into detected gated git verbs + destructive
 * forbidden matches. One level of interpreter unwrapping is applied per
 * sub-command.
 *
 * `roots` (optional) supplies the concrete repo-root / HOME-dir paths the
 * forbidden `rm -rf` matcher resolves targets against. The caller wires these
 * from `process.cwd()` / `os.homedir()`; keeping them as parameters (not read
 * inside) preserves this function's purity and testability.
 */
export function normalizeCommand(command: string, roots: NormalizeRoots = {}): NormalizedCommand {
  const gitVerbs: GitVerb[] = [];
  const forbiddenMatches: ForbiddenMatch[] = [];
  const externalMatches: ExternalMatch[] = [];
  const inlineSecretMatches: InlineSecretMatch[] = [];
  let pushTarget: string | undefined;

  // Collect every segment to scan: the top-level sub-commands plus, for each
  // interpreter wrapper, ONE level of inner sub-commands.
  const segments: string[] = [];
  for (const sub of splitSubCommands(command)) {
    segments.push(sub);
    const innerScript = unwrapInterpreter(stripLeadingEnv(tokenize(sub)));
    if (innerScript != null) {
      for (const innerSub of splitSubCommands(innerScript)) {
        segments.push(innerSub);
      }
    }
  }

  for (const seg of segments) {
    const rawTokens = tokenize(seg);
    const tokens = stripLeadingEnv(rawTokens);
    if (tokens.length === 0) continue;

    const git = detectGitVerb(tokens);
    if (git) {
      if (!gitVerbs.includes(git.verb)) gitVerbs.push(git.verb);
      if (git.verb === "push" && pushTarget === undefined) {
        const positional = git.rest.filter((t) => !t.startsWith("-"));
        if (positional.length > 0) pushTarget = positional.join(" ");
      }
    }

    const rm = detectForbiddenRm(tokens, seg, roots);
    if (rm) forbiddenMatches.push(rm);

    const inlineSecrets = detectInlineSecrets(rawTokens, seg);
    if (inlineSecrets.length > 0) inlineSecretMatches.push(...inlineSecrets);

    const external = detectExternalCommand(tokens, seg);
    if (external) externalMatches.push(external);
  }

  return { gitVerbs, forbiddenMatches, externalMatches, inlineSecretMatches, pushTarget };
}
