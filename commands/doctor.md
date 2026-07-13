---
name: pi-oven-doctor
description: Install and runtime-contract health check — legacy environment checks plus the shared doctor/status truth surface
---

# /pi-oven:doctor

You are running a read-only install-health diagnostic for the pi-oven omp plugin. The actual checks run in the `pi-oven-doctor.ts` script (resolved per the note below). You dispatch that script via Bash, then interpret its 11-check report and give the user fix guidance.

Namespace contract for every explanation in this flow: visible runtime agents and skills are `pov:*`; `/pi-oven:*` stays the slash-command surface; `pi-oven@kzk` stays the install/uninstall identity.

This command never performs a destructive repair, edits agent/skill/git sources, or publishes anything. At entry it may finish the setup transaction system's journaled safe rollback, exactly like `/pi-oven:setup --status`; compare-and-swap conflicts stop and produce a manual recovery path instead of overwriting newer state. The state-dir writability probe removes its own temporary file.

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

[PASS] omp version: omp 15.5.10 (>= 15.5.3)
[PASS] bun: bun 1.3.14 present
...
Summary: 11 PASS / 0 WARN / 0 FAIL — overall PASS
```

Exit code: `0` when there are no FAILs (WARNs are acceptable), `1` when any check FAILs.

### Step 2 — Interpret the report

Relay the report to the user, then walk each non-PASS line. The script prints the legacy 11-check environment matrix first and then appends the **Runtime contract truth surface** produced by the same `collectRuntimeTruthSurface()` function as `/pi-oven:setup --status`.

The shared section reports RuntimeContract version/generated parity, the exact 24-role registry, canonical/stale namespace counts, project/global setup transactions, run-ledger schema/integrity/leases, capability-policy/agent parity, offline discrimination, the last local live-canary receipt, exact package-derived OMP support, immutable marketplace/version parity, and native-team removal. Native-team success is written exactly as `removed; OMP task owns dispatch`.

If the RuntimeContract truth surface reports provider-family or routing-boundary state, make the boundary explicit: `/pi-oven:setup`, `/pi-oven:setup --status`, and `/pi-oven:doctor` are visibility/guard layers only. They can report or persist routing configuration, but the runtime still owns the current-session provider-family choice. The visible runtime agent+skill namespace is `pov:*`; `/pi-oven:*` remains the command surface and `pi-oven@kzk` remains the install identity. The shared readiness model is: global readiness comes from live `~/.omp/agent/config.yml` routing plus the machine-global prerequisites; project readiness comes from live `.omp/settings.json` routing; `setupCompletedAt` remains receipt metadata only. For workflow skills specifically, the success condition is the effective visible workflow-skill surface resolving to `skills.includeSkills = ["pov:*"]`; a populated `~/.claude/skills` source may remain on disk, but it must be explicitly filtered out rather than assumed empty. Empty `~/.claude/skills` is not the target state, and legacy compatibility aids alone do not stop `claude-plugins` or namespaced marketplace workflow skills.

Ownership truth surfaces still use three labels for workflow-skill ownership — `owned-surface active`, `compatibility aids only`, and `ownership not established` — but the shared migration/install vocabulary across runtime, setup, status, and doctor is: `healthy single pov surface`, `old config keys`, `mixed migration state`, `dual plugin surface`, and `agent namespace drift`. Treat `compatibility aids only` as non-owning: the mainline filter is still missing or wrong even if legacy maintenance flags are active. The session-start setup notice combines that ownership label with project routing state: `healthy setup — healthy single pov surface` means project routing is active **and** ownership is `owned-surface active`; `missing project routing` is a separate repo-state warning even when global routing or compatibility aids exist.

Bootstrap-level gajae parity is a **secondary OMP/architecture track** only. Surface it when present in the RuntimeContract truth section, but do not treat it as a blocker for ownership success.

- **FAIL** — a hard blocker. Surface the `fix:` hint from that line and tell the user this must be resolved before pi-oven works correctly. If multiple checks FAIL, list them in priority order (binaries/git first, then skills/agents, then eval).
- **WARN** — non-blocking, but worth noting. Explain what is degraded (e.g. eval cannot run live, project-scope routing still needs a separate global setup step, the workflow-skill surface is not actually filtered to the `pov:*` visible skill surface, or machine-global memory/async/LSP prerequisites are missing) and the optional remediation. For the memory / killer-tools WARN specifically, keep the remediation narrow: point the user to `/pi-oven:setup --repair-prereqs`.
- **NOT RUN** — the integration was not exercised. A missing live-canary receipt and JSON rollback mode for the optional SQLite ledger are `NOT RUN`, never PASS. Surface the copy-paste `fix:` command when fresh evidence is required.
- **PASS** — no action; only mention in the summary count.

If `overall PASS` or `overall WARN`, tell the user the install is healthy (or healthy-with-warnings). If `overall FAIL`, tell them the install needs attention and summarize the failing checks.

### Step 3 — Surface eval-key onboarding when provider auth FAILs

The `provider auth` check FAILs when `openai-codex` is not authenticated. When you see that FAIL, explicitly tell the user:

```
Live eval (bun "${PI_OVEN_DIR%/}/scripts/run-eval.ts") needs a provider API key.
OpenAI Codex is not currently authed, so provider-backed dispatch and live
eval execution will fail until the user authenticates it. To enable live eval:
authenticate openai-codex in omp, then re-run
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
| 1 | omp version | omp present and `>=` the exact package-derived RuntimeContract support version (`15.5.3` in this package) | omp CLI absent locally (skills/eval can't be exercised) | omp present but older than min |
| 2 | bun | bun on PATH | — | bun not found |
| 3 | git | git present AND inside a repo | — | git absent, or present but not inside a git work tree |
| 4 | provider auth | openai-codex authed | — | openai-codex not authed (live eval + provider-backed dispatch will fail) |
| 5 | mcp servers | ≥1 server in `.pi/mcp.json` or `omp mcp list` | none configured (informational; pi-oven requires none) | — |
| 6 | skills | `skills/*/SKILL.md` count == `plugin.json` skills[] length | — | count mismatch |
| 7 | agents | canonical `agents/pov-*.md` count == 24, every file carries `name: pov:<role>`, and `lint:agents` is clean | — | canonical count mismatch, `agent namespace drift`, or lint drift |
| 8 | state dir | `.pi-oven/` creatable + writable | — | not writable |
| 9 | eval runner | `scripts/run-eval.ts` present AND ≥1 smoke-tagged scenario enumerable | runner present but 0 smoke scenarios | runner script absent |
| 10 | UC5 ops connector | `skills/aws`, `skills/bitbucket-pipeline`, `skills/cloudflare` present + credential file (`.external-credentials` or `.external_certificate`; legacy `.external_cerficate` alias also accepted) detected | skill files present but no credential file | any connector skill file missing |
| 11 | memory / killer-tools | `memory.backend == "mnemopi"` AND `mnemopi.noEmbeddings` + `mnemopi.llmMode` present AND `async.enabled == true` AND `task.enableLsp == true` | any of: backend not mnemopi, mnemopi config keys absent, async disabled, or `task.enableLsp != true` | — |

Checks 5 can only WARN (never FAIL) — MCP is environmental, not an install-integrity defect. Check 10 WARN is also environmental (credential file not yet onboarded). Check 11 can only WARN — memory/async/`task.enableLsp` are configuration choices, not install-integrity defects. Any `FAIL` in either the 11-check matrix or the shared RuntimeContract truth surface makes the command exit `1`; `WARN` and `NOT RUN` do not.

## Important rules

- **No destructive auto-action.** Apart from journal-governed setup rollback recovery, doctor never mutates config, agent definition files, skills, or git. It never deletes or overwrites state to make a check green. Relay the copy-paste `fix:` hints and let the user decide.
- Dispatch `bun "${PI_OVEN_DIR%/}/scripts/pi-oven-doctor.ts"` (resolve `$PI_OVEN_DIR` first) via the Bash tool — never a cwd-relative `bun` call against `scripts/pi-oven-doctor.ts`. Do NOT pipe anything into it — it reads no stdin and runs batch-only.
- Do NOT run it more than once per request unless the user changes their environment and asks to re-check.
- When `provider auth` FAILs, always surface the eval-key onboarding note (Step 3) — live eval needs keys.
- Do NOT commit. This command produces no committable artifacts (`.pi-oven/` is gitignored).
- For setup or profile changes (model routing), point the user to `/pi-oven:setup`; for machine-global memory / async / `task.enableLsp` prerequisite WARNs, point them specifically to `/pi-oven:setup --repair-prereqs`. Doctor only diagnoses; it does not configure.
