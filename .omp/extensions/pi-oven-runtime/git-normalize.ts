// ---------------------------------------------------------------------------
// git-normalize.ts — PURE Bash-command normalization (Spec F §3 Layer 1 B3)
//
// Tokenize a Bash command, split into sub-commands on `;`, `&&`, `||`, `|`,
// and newlines; strip a leading `env VAR=val` (or bare VAR=val) prefix; unwrap
// ONE level of `bash -c` / `bash -lc` / `sh -c` / `zsh -c`; detect the `git`
// program even behind `-C dir` / `-c k=v` / `--git-dir=...` options; return the
// detected gated verbs (commit / push) plus the forbidden-set matches
// (rm -rf of repo/HOME roots, prod-access patterns).
//
// This is best-effort, NOT a sandbox. The documented residual bypass surface
// (heredocs, aliases, $(...), eval, decode-then-exec, deeper interpreter
// nesting) is intentionally uncovered — see Spec F §3 Layer 1 B3 step 4 and the
// AC7 test's KNOWN-UNCOVERED block.
// ---------------------------------------------------------------------------

export type GitVerb = "commit" | "push";

export interface ForbiddenMatch {
  /** A short identifier for the matched rule (used in the block reason). */
  rule: string;
  /** The sub-command text that matched. */
  segment: string;
}

export interface NormalizedCommand {
  /** Gated git verbs detected anywhere in the (unwrapped, split) command. */
  gitVerbs: GitVerb[];
  /** Forbidden-set matches (always-on floor). */
  forbiddenMatches: ForbiddenMatch[];
  /** Best-effort "<remote> <branch>" parse from the first `git push` segment. */
  pushTarget?: string;
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
      if (ch === quote) quote = null;
      else if (ch === "\\" && quote === '"' && i + 1 < input.length) cur += ch + input[++i];
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

/** Strip leading `env` keyword and any leading `VAR=val` assignment tokens. */
function stripLeadingEnv(tokens: string[]): string[] {
  let i = 0;
  if (tokens[i] === "env") i++;
  while (i < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=.*/.test(tokens[i])) i++;
  return tokens.slice(i);
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

/** Detect a destructive `rm -rf` of a repo/HOME/system root. */
function detectForbiddenRm(tokens: string[], segment: string): ForbiddenMatch | null {
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
  }
  // recursive+force with no positional target after flags is suspicious too,
  // but we only flag explicit dangerous roots to avoid false positives.
  void force;
  return null;
}

/** Detect a production-access pattern (per production-access). */
function detectForbiddenProdAccess(tokens: string[], segment: string): ForbiddenMatch | null {
  const prog = tokens[0]?.split("/").pop();
  if (prog !== "aws") return null;
  const sub = tokens[1];
  const verb = tokens[2];
  if (sub === "ssm" && (verb === "start-session" || verb === "send-command")) {
    return { rule: "prod-access-ssm", segment };
  }
  if (sub === "sts" && verb === "assume-role") {
    return { rule: "prod-access-sts", segment };
  }
  if (sub === " secretsmanager".trim() && (verb === "get-secret-value")) {
    return { rule: "prod-access-secrets", segment };
  }
  return null;
}

// --- Top-level entrypoint --------------------------------------------------

/**
 * Normalize a Bash command string into detected gated git verbs + forbidden
 * matches. One level of interpreter unwrapping is applied per sub-command.
 */
export function normalizeCommand(command: string): NormalizedCommand {
  const gitVerbs: GitVerb[] = [];
  const forbiddenMatches: ForbiddenMatch[] = [];
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
    const tokens = stripLeadingEnv(tokenize(seg));
    if (tokens.length === 0) continue;

    const git = detectGitVerb(tokens);
    if (git) {
      if (!gitVerbs.includes(git.verb)) gitVerbs.push(git.verb);
      if (git.verb === "push" && pushTarget === undefined) {
        const positional = git.rest.filter((t) => !t.startsWith("-"));
        if (positional.length > 0) pushTarget = positional.join(" ");
      }
    }

    const rm = detectForbiddenRm(tokens, seg);
    if (rm) forbiddenMatches.push(rm);
    const prod = detectForbiddenProdAccess(tokens, seg);
    if (prod) forbiddenMatches.push(prod);
  }

  return { gitVerbs, forbiddenMatches, pushTarget };
}
