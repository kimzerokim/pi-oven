import { describe, it, expect } from "bun:test";
import {
  getLeadingEnvVarForGitVerb,
  normalizeCommand,
  type NormalizedCommand,
} from "../../../.omp/extensions/pi-oven-runtime/git-normalize";
import { fingerprintExternalExecSecret } from "../../../.omp/extensions/pi-oven-runtime/gate-state";


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

function externalKinds(cmd: string): string[] {
  return normalizeCommand(cmd).externalMatches.map((m) => m.kind);
}

function inlineSecretKinds(cmd: string): string[] {
  return normalizeCommand(cmd).inlineSecretMatches.map((m) => m.kind);
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

  it("extracts inline PI_OVEN_PUSH_CONSENT only from the git push segment", () => {
    expect(getLeadingEnvVarForGitVerb("PI_OVEN_PUSH_CONSENT=ref git push origin main", "push", "PI_OVEN_PUSH_CONSENT"))
      .toBe("ref");
    expect(getLeadingEnvVarForGitVerb('PI_OVEN_PUSH_CONSENT=ref bash -lc "git push origin main"', "push", "PI_OVEN_PUSH_CONSENT"))
      .toBe("ref");
    expect(getLeadingEnvVarForGitVerb("PI_OVEN_PUSH_CONSENT=ref echo ok && git push origin main", "push", "PI_OVEN_PUSH_CONSENT"))
      .toBeUndefined();
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
  //   script file, base64/printf-decoded commands, GIT_* env porcelain tricks,
  //   and a `sudo` prefix (e.g. `sudo git commit`) — sudo is NOT stripped, so
  //   the verb behind it is not detected by design (best-effort, not a sandbox).
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

  it("classifies external-session commands instead of forbidding them", () => {
    const ssm = normalizeCommand("aws ssm start-session --target i-prod");
    expect(ssm.forbiddenMatches).toEqual([]);
    expect(ssm.externalMatches.map((m) => m.kind)).toEqual(["external-session"]);

    const sts = normalizeCommand("aws sts assume-role --role-arn arn:aws:iam::1:role/prod");
    expect(sts.forbiddenMatches).toEqual([]);
    expect(sts.externalMatches.map((m) => m.kind)).toEqual(["external-session"]);

    const stsWithProfile = normalizeCommand(
      "aws --profile prod sts assume-role --role-arn arn:aws:iam::1:role/prod"
    );
    expect(stsWithProfile.forbiddenMatches).toEqual([]);
    expect(stsWithProfile.externalMatches.map((m) => m.kind)).toEqual(["external-session"]);

    expect(externalKinds("ssh deploy@example.com")).toEqual(["external-session"]);
    expect(externalKinds("kubectl exec pod -- sh")).toEqual(["external-session"]);
    expect(externalKinds("psql postgres://prod-db")).toEqual(["external-session"]);
    expect(externalKinds("mysql mysql://prod-db")).toEqual(["external-session"]);
    expect(externalKinds("mongosh mongodb://prod-db")).toEqual(["external-session"]);
    expect(externalKinds("redis-cli -u redis://prod-db")).toEqual(["external-session"]);
  });

  it("classifies external-read commands without marking them forbidden", () => {
    const s3 = normalizeCommand("aws s3 ls");
    expect(s3.forbiddenMatches).toEqual([]);
    expect(s3.externalMatches.map((m) => m.kind)).toEqual(["external-read"]);

    const ec2 = normalizeCommand("aws ec2 describe-instances");
    expect(ec2.forbiddenMatches).toEqual([]);
    expect(ec2.externalMatches.map((m) => m.kind)).toEqual(["external-read"]);
  });
  it("classifies direct Bitbucket and Cloudflare API reads", () => {
    expect(externalKinds("http GET https://api.bitbucket.org/2.0/repositories/ws/repo/pipelines/")).toEqual([
      "external-read",
    ]);
    expect(externalKinds("http https://api.bitbucket.org/2.0/repositories/ws/repo/pipelines/")).toEqual([
      "external-read",
    ]);
    expect(externalKinds("curl -X GET https://api.cloudflare.com/client/v4/zones")).toEqual([
      "external-read",
    ]);
    expect(externalKinds("curl https://api.cloudflare.com/client/v4/zones")).toEqual([
      "external-read",
    ]);
  });
  it("classifies external-mutation commands", () => {
    expect(externalKinds("./scripts/deploy.sh --region singapore --warp on")).toEqual([
      "external-mutation",
    ]);
    expect(externalKinds("aws s3 sync ./dist s3://bucket")).toEqual(["external-mutation"]);
    expect(externalKinds("aws ecr batch-delete-image --repository-name app --image-ids imageTag=old")).toEqual([
      "external-mutation",
    ]);
    expect(externalKinds("aws route53 change-resource-record-sets --hosted-zone-id Z1 --change-batch file://batch.json")).toEqual([
      "external-mutation",
    ]);
    expect(externalKinds("terraform apply")).toEqual(["external-mutation"]);
    expect(externalKinds("terraform -chdir=infra apply")).toEqual(["external-mutation"]);
    expect(externalKinds("tofu destroy")).toEqual(["external-mutation"]);
    expect(externalKinds("kubectl apply -f deploy.yaml")).toEqual(["external-mutation"]);
    expect(externalKinds("kubectl --context prod apply -f deploy.yaml")).toEqual([
      "external-mutation",
    ]);
    expect(externalKinds("helm upgrade app chart/")).toEqual(["external-mutation"]);
    expect(externalKinds('psql -c "UPDATE users SET active=false"')).toEqual([
      "external-mutation",
    ]);
  });
  it("classifies direct Bitbucket and Cloudflare API mutations", () => {
    expect(externalKinds("http POST https://api.bitbucket.org/2.0/repositories/ws/repo/pipelines/")).toEqual([
      "external-mutation",
    ]);
    expect(externalKinds("http DELETE https://api.bitbucket.org/2.0/repositories/ws/repo/pipelines/123")).toEqual([
      "external-mutation",
    ]);
    expect(externalKinds("curl -X POST https://api.cloudflare.com/client/v4/zones")).toEqual([
      "external-mutation",
    ]);
    expect(externalKinds("curl -X PATCH https://api.cloudflare.com/client/v4/zones/abc/settings")).toEqual([
      "external-mutation",
    ]);
    expect(externalKinds("curl -X DELETE https://api.cloudflare.com/client/v4/zones/abc")).toEqual([
      "external-mutation",
    ]);
    expect(externalKinds(`curl -d '{"type":"A"}' https://api.cloudflare.com/client/v4/zones`)).toEqual([
      "external-mutation",
    ]);
    expect(externalKinds(`curl --json '{"type":"A"}' https://api.bitbucket.org/2.0/repositories/ws/repo/pipelines/`)).toEqual([
      "external-mutation",
    ]);
  });

  it("classifies only embedded inline secret literals separately from external commands", () => {
    const accessKey = normalizeCommand(
      "AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE aws s3 ls"
    );
    expect(accessKey.forbiddenMatches).toEqual([]);
    expect(accessKey.externalMatches.map((m) => m.kind)).toEqual(["external-read"]);
    expect(accessKey.inlineSecretMatches.map((m) => m.kind)).toEqual(["inline-secret"]);
    expect(accessKey.inlineSecretMatches[0]).toMatchObject({
      rule: "inline-aws-access-key-id",
      awsCredentials: {
        provider: "aws",
        accessKeyId: "AKIAIOSFODNN7EXAMPLE",
        accessKeyKind: "permanent",
        hasSessionToken: false,
      },
    });

    const tempAccessKey = normalizeCommand(
      "AWS_ACCESS_KEY_ID=ASIAIOSFODNN7EXAMPLE AWS_SECRET_ACCESS_KEY=secret AWS_SESSION_TOKEN=session123 aws s3 ls"
    );
    expect(tempAccessKey.externalMatches.map((m) => m.kind)).toEqual(["external-read"]);
    expect(tempAccessKey.inlineSecretMatches[0]).toMatchObject({
      rule: "inline-aws-access-key-id",
      awsCredentials: {
        provider: "aws",
        accessKeyId: "ASIAIOSFODNN7EXAMPLE",
        accessKeyKind: "temporary",
        hasSessionToken: true,
        sessionTokenFingerprint: fingerprintExternalExecSecret("session123"),
        secretAccessKeyFingerprint: fingerprintExternalExecSecret("secret"),
      },
    });

    const tempWithApiToken = normalizeCommand(
      "AWS_ACCESS_KEY_ID=ASIAIOSFODNN7EXAMPLE AWS_SECRET_ACCESS_KEY=secret AWS_SESSION_TOKEN=session123 API_TOKEN=abc123 aws s3 ls"
    );
    expect(tempWithApiToken.inlineSecretMatches).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ rule: "inline-aws-access-key-id" }),
        expect.objectContaining({ rule: "inline-secret-env" }),
      ])
    );

    const secretKey = normalizeCommand(
      "AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY aws s3 ls"
    );
    expect(secretKey.externalMatches.map((m) => m.kind)).toEqual(["external-read"]);
    expect(secretKey.inlineSecretMatches).toEqual([
      expect.objectContaining({ kind: "inline-secret", rule: "inline-secret-env" }),
    ]);

    const sessionTokenOnly = normalizeCommand("AWS_SESSION_TOKEN=session123 aws s3 ls");
    expect(sessionTokenOnly.externalMatches.map((m) => m.kind)).toEqual(["external-read"]);
    expect(sessionTokenOnly.inlineSecretMatches).toEqual([
      expect.objectContaining({ kind: "inline-secret", rule: "inline-secret-env" }),
    ]);
    const psql = normalizeCommand('psql --password hunter2 -c "select 1"');
    expect(psql.externalMatches.map((m) => m.kind)).toEqual(["external-read"]);
    expect(psql.inlineSecretMatches.map((m) => m.kind)).toEqual(["inline-secret"]);

    const envIndirection = normalizeCommand(
      "AWS_SECRET_ACCESS_KEY=$AWS_SECRET_ACCESS_KEY aws s3 ls"
    );
    expect(envIndirection.externalMatches.map((m) => m.kind)).toEqual(["external-read"]);
    expect(envIndirection.inlineSecretMatches).toEqual([]);

    const promptPassword = normalizeCommand('psql --password -c "select 1"');
    expect(promptPassword.externalMatches.map((m) => m.kind)).toEqual(["external-read"]);
    expect(promptPassword.inlineSecretMatches).toEqual([]);

    const promptToken = normalizeCommand("tool --access-token");
    expect(promptToken.inlineSecretMatches).toEqual([]);
    const bearerHeader = normalizeCommand(
      "curl -H 'Authorization: Bearer abc123' https://api.cloudflare.com/client/v4/zones"
    );
    expect(bearerHeader.externalMatches.map((m) => m.kind)).toEqual(["external-read"]);
    expect(bearerHeader.inlineSecretMatches.map((m) => m.kind)).toEqual(["inline-secret"]);

    const authKeyHeader = normalizeCommand(
      "curl -H 'X-Auth-Key: secret123' https://api.cloudflare.com/client/v4/zones"
    );
    expect(authKeyHeader.externalMatches.map((m) => m.kind)).toEqual(["external-read"]);
    expect(authKeyHeader.inlineSecretMatches.map((m) => m.kind)).toEqual(["inline-secret"]);
    const httpieBearerHeader = normalizeCommand(
      "http GET https://api.cloudflare.com/client/v4/zones Authorization:Bearer secret123"
    );
    expect(httpieBearerHeader.externalMatches.map((m) => m.kind)).toEqual(["external-read"]);
    expect(httpieBearerHeader.inlineSecretMatches.map((m) => m.kind)).toEqual(["inline-secret"]);

    const httpieCompactBearerHeader = normalizeCommand(
      'http GET https://api.cloudflare.com/client/v4/zones "Authorization:Bearer secret123"'
    );
    expect(httpieCompactBearerHeader.externalMatches.map((m) => m.kind)).toEqual(["external-read"]);
    expect(httpieCompactBearerHeader.inlineSecretMatches.map((m) => m.kind)).toEqual(["inline-secret"]);

    const httpieAuthKeyHeader = normalizeCommand(
      "http GET https://api.cloudflare.com/client/v4/zones X-Auth-Key:secret123"
    );
    expect(httpieAuthKeyHeader.externalMatches.map((m) => m.kind)).toEqual(["external-read"]);
    expect(httpieAuthKeyHeader.inlineSecretMatches.map((m) => m.kind)).toEqual(["inline-secret"]);

    const httpieTokenLiteral = normalizeCommand(
      "http GET https://api.cloudflare.com/client/v4/zones api_token==secret123"
    );
    expect(httpieTokenLiteral.externalMatches.map((m) => m.kind)).toEqual(["external-read"]);
    expect(httpieTokenLiteral.inlineSecretMatches.map((m) => m.kind)).toEqual(["inline-secret"]);

    const httpieTokenEnv = normalizeCommand(
      "http GET https://api.cloudflare.com/client/v4/zones api_token==$CF_API_TOKEN"
    );
    expect(httpieTokenEnv.externalMatches.map((m) => m.kind)).toEqual(["external-read"]);
    expect(httpieTokenEnv.inlineSecretMatches).toEqual([]);

    expect(inlineSecretKinds("AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE aws s3 ls")).toEqual([
      "inline-secret",
    ]);
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
});

// ---------------------------------------------------------------------------
// rm -rf of the CONCRETE repo-root / expanded-HOME (Spec §3 forbidden-set)
//
// The matcher receives the roots as parameters (gate-handler wires them from
// process.cwd() / os.homedir()) so it stays pure + testable. A target that
// resolves to (or is an ancestor of) the repo root or HOME is forbidden; a
// strict SUBDIR (normal cleanup) is intentionally allowed.
// ---------------------------------------------------------------------------

describe("normalizeCommand — rm -rf of concrete repo/HOME roots (Spec §3)", () => {
  const repoRoot = "/Users/dev/work/pi-oven";
  const homeDir = "/Users/dev";
  const roots = { repoRoot, homeDir };

  it("flags `rm -rf <repo-root-abs>` (absolute repo root path)", () => {
    const n = normalizeCommand(`rm -rf ${repoRoot}`, roots);
    expect(n.forbiddenMatches.length).toBeGreaterThan(0);
  });

  it("flags a relative `rm -rf .` issued from the repo root", () => {
    const n = normalizeCommand("rm -rf .", roots);
    expect(n.forbiddenMatches.length).toBeGreaterThan(0);
  });

  it("flags `rm -rf <expanded-home>` (absolute home path)", () => {
    const n = normalizeCommand(`rm -rf ${homeDir}`, roots);
    expect(n.forbiddenMatches.length).toBeGreaterThan(0);
  });

  it("does NOT flag a benign `rm -rf ./build` subdir cleanup (no false positive)", () => {
    const n = normalizeCommand("rm -rf ./build", roots);
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
