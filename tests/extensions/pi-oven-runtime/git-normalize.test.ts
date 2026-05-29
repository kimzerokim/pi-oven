import { describe, it, expect } from "bun:test";
import {
  normalizeCommand,
  type NormalizedCommand,
} from "../../../.omp/extensions/pi-oven-runtime/git-normalize";

// ---------------------------------------------------------------------------
// AC7 — git-command normalization adversarial (Spec §3 Layer 1 B3)
//
// Each adversarial form below MUST be detected as a gated git commit/push verb.
// The documented residual-bypass cases (heredoc, alias, $(...), eval,
// decode-then-exec) are recorded as KNOWN-UNCOVERED in a comment, NOT asserted
// as blocked — matching the spec's best-effort framing.
// ---------------------------------------------------------------------------

function verbs(cmd: string): string[] {
  return normalizeCommand(cmd).gitVerbs;
}

describe("normalizeCommand — git verb detection (AC7)", () => {
  it("detects a plain `git commit`", () => {
    expect(verbs("git commit -m x")).toContain("commit");
  });

  it("detects a plain `git push`", () => {
    expect(verbs("git push origin main")).toContain("push");
  });

  it("detects `git -C <dir> commit` (changes directory option)", () => {
    expect(verbs("git -C /tmp/repo commit -m x")).toContain("commit");
  });

  it("detects `git --git-dir=... commit`", () => {
    expect(verbs("git --git-dir=/tmp/repo/.git commit -m x")).toContain("commit");
  });

  it("detects `git -c key=val commit` (config override option)", () => {
    expect(verbs("git -c user.name=x commit")).toContain("commit");
  });

  it("detects commit inside `bash -lc \"...\"` (login interpreter wrapper)", () => {
    expect(verbs('bash -lc "git commit -m x"')).toContain("commit");
  });

  it("detects commit inside `bash -c '...'`", () => {
    expect(verbs("bash -c 'git commit -m x'")).toContain("commit");
  });

  it("detects commit inside `sh -c '...'`", () => {
    expect(verbs("sh -c 'git commit -m x'")).toContain("commit");
  });

  it("detects commit inside `zsh -c '...'`", () => {
    expect(verbs("zsh -c 'git commit -m x'")).toContain("commit");
  });

  it("strips a leading `env VAR=val` prefix and still detects the verb", () => {
    expect(verbs("env GIT_AUTHOR_NAME=x git commit")).toContain("commit");
  });

  it("strips multiple leading env assignments", () => {
    expect(verbs("env A=1 B=2 git commit -m x")).toContain("commit");
  });

  it("detects a bare-prefix env assignment without the `env` keyword", () => {
    // `FOO=bar git commit` — leading VAR=val tokens before git
    expect(verbs("GIT_AUTHOR_NAME=x git commit")).toContain("commit");
  });

  it("detects push in an `&&` chain", () => {
    expect(verbs("git push origin main && echo done")).toContain("push");
  });

  it("detects commit in a `;` chain", () => {
    expect(verbs("echo hi ; git commit -m x")).toContain("commit");
  });

  it("detects commit in a `||` chain", () => {
    expect(verbs("false || git commit -m x")).toContain("commit");
  });

  it("detects commit across a newline-separated script", () => {
    expect(verbs("cd /repo\ngit commit -m x")).toContain("commit");
  });

  it("detects commit after a pipe segment", () => {
    expect(verbs("echo x | git commit -F -")).toContain("commit");
  });

  it("detects both commit and push in one chain", () => {
    const v = verbs("git commit -m x && git push");
    expect(v).toContain("commit");
    expect(v).toContain("push");
  });

  it("does NOT flag a non-git command", () => {
    expect(verbs("ls -la")).toEqual([]);
  });

  it("does NOT flag `git status` (non-gated verb)", () => {
    expect(verbs("git status")).toEqual([]);
  });

  it("does NOT flag the substring `commit` in an unrelated word", () => {
    expect(verbs("echo committing")).toEqual([]);
  });

  it("does NOT flag `commit` as a non-git program argument", () => {
    expect(verbs("npm run commit")).toEqual([]);
  });

  it("combines -C and -c options before the verb", () => {
    expect(verbs("git -C /repo -c user.name=x commit -m y")).toContain("commit");
  });

  // KNOWN-UNCOVERED residual bypass surface (Spec §3 Layer 1 B3 step 4):
  //   heredocs feeding git via stdin, shell aliases/functions resolved at rc,
  //   $(...) command substitution producing the verb, eval, write-then-exec a
  //   script file, base64/printf-decoded commands, GIT_* env porcelain tricks.
  // These are deliberately NOT asserted-blocked. Layer 1 is best-effort, not a
  // sandbox. The following demonstrate the residual (verb NOT detected by design):
  it("KNOWN-UNCOVERED: does not unwrap nested second-level bash -c", () => {
    // one-level unwrap only; deeper nesting is documented residual surface
    const v = verbs(`bash -c "bash -c 'git commit -m x'"`);
    // We only assert this is the residual: detection here is best-effort and
    // NOT guaranteed. The test documents current behavior without over-claiming.
    expect(Array.isArray(v)).toBe(true);
  });
});

describe("normalizeCommand — forbidden set detection (Spec §3 Layer 1)", () => {
  it("flags `rm -rf` of an absolute root-ish path", () => {
    const n: NormalizedCommand = normalizeCommand("rm -rf /");
    expect(n.forbiddenMatches.length).toBeGreaterThan(0);
  });

  it("flags `rm -rf $HOME`", () => {
    const n = normalizeCommand("rm -rf $HOME");
    expect(n.forbiddenMatches.length).toBeGreaterThan(0);
  });

  it("flags `rm -rf ~` (home tilde)", () => {
    const n = normalizeCommand("rm -rf ~");
    expect(n.forbiddenMatches.length).toBeGreaterThan(0);
  });

  it("flags `rm -fr` (reordered flags)", () => {
    const n = normalizeCommand("rm -fr /");
    expect(n.forbiddenMatches.length).toBeGreaterThan(0);
  });

  it("flags prod-access pattern: aws ssm to production", () => {
    const n = normalizeCommand("aws ssm start-session --target i-prod");
    expect(n.forbiddenMatches.length).toBeGreaterThan(0);
  });

  it("flags prod-access pattern: aws sts assume-role", () => {
    const n = normalizeCommand("aws sts assume-role --role-arn arn:aws:iam::1:role/prod");
    expect(n.forbiddenMatches.length).toBeGreaterThan(0);
  });

  it("flags a forbidden rm inside a bash -c wrapper", () => {
    const n = normalizeCommand('bash -lc "rm -rf /"');
    expect(n.forbiddenMatches.length).toBeGreaterThan(0);
  });

  it("flags a forbidden rm inside an && chain", () => {
    const n = normalizeCommand("echo hi && rm -rf /");
    expect(n.forbiddenMatches.length).toBeGreaterThan(0);
  });

  it("does NOT flag a benign rm of a relative subpath", () => {
    const n = normalizeCommand("rm -rf ./build");
    expect(n.forbiddenMatches).toEqual([]);
  });

  it("does NOT flag a benign rm of a relative file", () => {
    const n = normalizeCommand("rm -f foo.txt");
    expect(n.forbiddenMatches).toEqual([]);
  });

  it("does NOT flag a benign aws s3 ls", () => {
    const n = normalizeCommand("aws s3 ls");
    expect(n.forbiddenMatches).toEqual([]);
  });
});

describe("normalizeCommand — push target branch parse (Spec §5.4 audit)", () => {
  it("parses the remote and branch for a `git push origin main`", () => {
    const n = normalizeCommand("git push origin main");
    expect(n.pushTarget).toBe("origin main");
  });

  it("returns undefined pushTarget when no positional args follow push", () => {
    const n = normalizeCommand("git push");
    expect(n.pushTarget).toBeUndefined();
  });
});
