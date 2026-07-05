---
name: pi-oven-doctor
description: Install health check — runs the pi-oven 11-check matrix (omp version, bun, git, provider auth, MCP, skills, agents, state dir, eval runner, UC5 ops connector, memory/killer-tools)
---

# /pi-oven:doctor

You are running a read-only install-health diagnostic for the pi-oven omp plugin. The actual checks run in the `pi-oven-doctor.ts` script (resolved per the note below). You dispatch that script via Bash, then interpret its 11-check report and give the user fix guidance.

This command is purely diagnostic. It NEVER mutates configuration, agent files, skills, or git state. The only filesystem touch is a create+write probe of the gitignored `.pi-oven/` state dir (check #8), which removes its own probe file.

## Resolve the plugin script dir first

pi-oven may be installed globally, so the script does NOT live under the user's project cwd. Before dispatching any `bun` command, resolve the plugin script dir once and reuse `$PI_OVEN_DIR` for every dispatch (dev cwd → `installed_plugins.json` `installPath` → cache scan via `bun -e`):

```bash
PI_OVEN_DIR="$PWD"
if [ ! -f "$PI_OVEN_DIR/scripts/pi-oven-doctor.ts" ]; then
  PI_OVEN_DIR="$(bun -e '
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const manifestPath = path.join(os.homedir(), ".omp/plugins/installed_plugins.json");
const cacheRoot = path.join(os.homedir(), ".omp/plugins/cache/plugins");
let resolved = "";

try {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  resolved = manifest?.plugins?.["pi-oven@kzk"]?.[0]?.installPath ?? "";
} catch {}

if (!resolved) {
  try {
    const entries = fs
      .readdirSync(cacheRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.startsWith("kzk___pi-oven___"))
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    resolved = entries.length ? path.join(cacheRoot, entries[entries.length - 1]) : "";
  } catch {}
}

process.stdout.write(resolved);
')"
fi
[ -n "$PI_OVEN_DIR" ] || { echo "pi-oven install not found" >&2; exit 1; }
```

Every dispatch below uses `bun "${PI_OVEN_DIR%/}/scripts/<x>.ts"` — never a cwd-relative `bun` call against `scripts/<x>.ts` (that breaks on global installs where cwd ≠ plugin dir).

## What to do

### Step 1 — Run the diagnostic

Dispatch via Bash (using the resolved `$PI_OVEN_DIR`):

```
bun "${PI_OVEN_DIR%/}/scripts/pi-oven-doctor.ts"
```

The script gathers all environment facts (spawns `omp`/`bun`/`git`, reads `.pi/mcp.json`, counts skills/agents, probes the state dir, enumerates eval scenarios) and prints a report shaped like:

```
pi-oven doctor — install health

[PASS] omp version: omp 15.5.10 (>= 15.0.0)
[PASS] bun: bun 1.3.14 present
...
Summary: 11 PASS / 0 WARN / 0 FAIL — overall PASS
```

Exit code: `0` when there are no FAILs (WARNs are acceptable), `1` when any check FAILs.

### Step 2 — Interpret the report

Relay the report to the user, then walk each non-PASS line. The script still prints the 11-check matrix first, but now also appends a **Standalone truth surface** section. Treat that section as part of the diagnostic output — it carries the same operator-facing warnings status shows.

## Temporary compatibility boundary

- Scope: vendored native worker runtime under `scripts/pi-oven-team/*` only.
- Owner: pi-oven maintainers.
- Removal condition: remove this boundary once native worker startup/scale is owned end-to-end by the omp-native control plane and no runtime path depends on `scripts/pi-oven-team/*`.

- **FAIL** — a hard blocker. Surface the `fix:` hint from that line and tell the user this must be resolved before pi-oven works correctly. If multiple checks FAIL, list them in priority order (binaries/git first, then skills/agents, then eval).
- **WARN** — non-blocking, but worth noting. Explain what is degraded (e.g. eval cannot run live, project-scope routing still needs a separate global setup step) and the optional remediation.
- **INFO** in the standalone section — state you should surface, not ignore (for example installed-topology evidence, the explicit control-plane front door, or the native worker boundary state). It does not affect the exit code, but it is still part of the truth surface.
- **PASS** — no action; only mention in the summary count.

If `overall PASS` or `overall WARN`, tell the user the install is healthy (or healthy-with-warnings). If `overall FAIL`, tell them the install needs attention and summarize the failing checks.

### Step 3 — Surface eval-key onboarding when provider auth FAILs

The `provider auth` check FAILs when no whitelisted provider (`opencode-zen` / `openai-codex` / `anthropic`) is authenticated. When you see that FAIL, explicitly tell the user:

```
Live eval (bun "${PI_OVEN_DIR%/}/scripts/run-eval.ts") needs a provider API key.
No whitelisted provider is currently authed, so provider-backed dispatch and live
eval execution will fail until the user authenticates one. To enable live eval:
authenticate a provider in omp (opencode-zen is the release default), then re-run
/pi-oven:doctor.
```

This is the onboarding bridge to the gated real-eval pipeline.

### Step 4 — Interpret memory / killer-tool check (#11)

Check #11 probes `omp config get` for memory, `task.enableLsp`, and killer-tool readiness. Walk each non-PASS sub-result:

- **memory.backend != "mnemopi" (WARN)** — native memory is off. Tell the user: run `/pi-oven:setup --repair-prereqs` to enable the mnemopi backend without rewriting model routing; the `retain`, `recall`, and `reflect` killer tools will not work without it.
- **mnemopi config incomplete (WARN)** — `mnemopi.noEmbeddings` or `mnemopi.llmMode` is absent. Both keys must be present for the backend to initialise correctly; point the user to `/pi-oven:setup --repair-prereqs` to repopulate them.
- **async.enabled != true (WARN)** — background task dispatch is off, which degrades throughput for autonomous flows; point the user to `/pi-oven:setup --repair-prereqs` to enable it.
- **task.enableLsp != true (WARN)** — omp LSP integration is off, so pi-oven's LSP-dependent roles lose diagnostics/goto-definition/find-references support; point the user to `/pi-oven:setup --repair-prereqs` to restore it.
- **killer-tool note (INFO)** — the debug, eval, browser, ast_grep, and irc killer tools are omp defaults and are always on after a global pi-oven prerequisite repair or full global setup run; `lsp` additionally depends on `task.enableLsp=true`. Only `retain`, `recall`, and `reflect` require `memory.backend=mnemopi` (covered above).

## The 11-check reference

| # | Check | PASS | WARN | FAIL |
|---|---|---|---|---|
| 1 | omp version | omp present and `>= 15.0.0` | omp CLI absent locally (skills/eval can't be exercised) | omp present but older than min |
| 2 | bun | bun on PATH | — | bun not found |
| 3 | git | git present AND inside a repo | — | git absent, or present but not inside a git work tree |
| 4 | provider auth | ≥1 of opencode-zen / openai-codex / anthropic authed | — | none authed (live eval + provider-backed dispatch will fail) |
| 5 | mcp servers | ≥1 server in `.pi/mcp.json` or `omp mcp list` | none configured (informational; pi-oven requires none) | — |
| 6 | skills | `skills/*/SKILL.md` count == `plugin.json` skills[] length | — | count mismatch |
| 7 | agents | `agents/pi-oven-*.md` count == 24 AND `lint:agents` clean | — | count mismatch, or count OK but lint drift |
| 8 | state dir | `.pi-oven/` creatable + writable | — | not writable |
| 9 | eval runner | `scripts/run-eval.ts` present AND ≥1 smoke-tagged scenario enumerable | runner present but 0 smoke scenarios | runner script absent |
| 10 | UC5 ops connector | `skills/aws`, `skills/bitbucket-pipeline`, `skills/cloudflare` present + credential file (`.external-credentials` or `.external_certificate`; legacy `.external_cerficate` alias also accepted) detected | skill files present but no credential file | any connector skill file missing |
| 11 | memory / killer-tools | `memory.backend == "mnemopi"` AND `mnemopi.noEmbeddings` + `mnemopi.llmMode` present AND `async.enabled == true` AND `task.enableLsp == true` | any of: backend not mnemopi, mnemopi config keys absent, async disabled, or `task.enableLsp != true` | — |

Checks 5 can only WARN (never FAIL) — MCP is environmental, not an install-integrity defect. Check 10 WARN is also environmental (credential file not yet onboarded). Check 11 can only WARN — memory/async/`task.enableLsp` are configuration choices, not install-integrity defects. The standalone truth-surface section may add WARN/INFO lines for installed-topology evidence, the explicit control-plane front door, the vendored native worker boundary, and project-scope remediation, but those lines do NOT change the exit code. Checks 4, 6, 7, 9-runner-absent, and 10-missing-skills are FAILs. The script's exit code reflects only FAILs.

## Important rules

- **Read-only diagnostic.** This command never mutates config, `agents/pi-oven-*.md`, skills, or git. Do not "fix" anything yourself — only relay the `fix:` hints from the report and let the user decide.
- Dispatch `bun "${PI_OVEN_DIR%/}/scripts/pi-oven-doctor.ts"` (resolve `$PI_OVEN_DIR` first) via the Bash tool — never a cwd-relative `bun` call against `scripts/pi-oven-doctor.ts`. Do NOT pipe anything into it — it reads no stdin and runs batch-only.
- Do NOT run it more than once per request unless the user changes their environment and asks to re-check.
- When `provider auth` FAILs, always surface the eval-key onboarding note (Step 3) — live eval needs keys.
- Do NOT commit. This command produces no committable artifacts (`.pi-oven/` is gitignored).
- For setup or profile changes (model routing), point the user to `/pi-oven:setup` — doctor only diagnoses, it does not configure.
