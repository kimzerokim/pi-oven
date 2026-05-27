# Spec B Critic Review — Cycle 2

- Date: 2026-05-28
- Reviewer: oh-my-claudecode:critic (opus)
- Spec: `/Users/kimzerokim/work/personal/pi-oven/docs/specs/2026-05-28-pi-oven-setup-wizard.md` (825 lines)
- Previous: `docs/research/codex-reviews/2026-05-28-pi-oven-setup-wizard-critic-review.md`
- Cycle: 2
- BLOCKERs resolved since cycle 1: 8/10
- Verdict: **REJECT (CONTINUE)** — 5 NEW BLOCKERs (all "API surface assumed but not verified"), 10 NITs

---

## Cycle 1 BLOCKER verification

| # | Cycle 1 finding | Status |
|---|---|---|
| CRITICAL #1 | UX strategy lock (LLM-chat-driven + batch CLI) | ✓ RESOLVED |
| MAJOR #1 | Conditional ALLOWED_PREFIXES | ✗ Implementation BROKEN (BLOCKER #1 below) |
| MAJOR #2 | Source of truth = agent file | ✓ RESOLVED (but cache packaging gap surfaced — BLOCKER #3) |
| MAJOR #3 | Two-source resolution | ✓ RESOLVED |
| MAJOR #4 | Native-provider parse auth detection | ✓ RESOLVED |
| MAJOR #5 | --validate=smoke|full|none | ✓ RESOLVED |
| MAJOR #7 | Plugin name disambiguation | ✓ RESOLVED |
| MAJOR #8 | Strike §9.4 schema-required | ✓ RESOLVED |
| MAJOR #9 | Parent-session warning | ✗ Implementation BROKEN (BLOCKER #5) |
| MAJOR #10 | Profile B librarian/explorer keeps glm-5 | ✓ RESOLVED |

8/10 resolved; #1 + #9 fixes themselves broken by new API surface assumptions.

---

## 1. 🔴 BLOCKER (5 new)

### BLOCKER #1 — `pi.getPluginSettings("pi-oven")` API does NOT exist on `ExtensionAPI`

§10.5 line 752, §10.5 line 757, §9.3 line 547 call `pi.getPluginSettings("pi-oven")`. Verified: `extensibility/extensions/types.d.ts:522-668` (full `ExtensionAPI` interface) — NO `getPluginSettings` method. The function exists at `extensibility/plugins/loader.ts:280` (standalone, `Promise<Record<string, unknown>>`, requires `cwd`) and at `PluginManager.getPluginSettings(name)` (different surface, not extension-reachable).

§10.5's conditional ALLOWED_PREFIXES — the entire MAJOR #1 resolution — is non-implementable as written.

**Fix options**:
- (a) Standalone `getPluginSettings(pluginName, cwd)` from `loader.ts:280` — async, requires cwd; `validateAgentRegistry` becomes async, import path: `@oh-my-pi/pi-coding-agent/extensibility/plugins/loader` (verify export).
- (b) Read `~/.omp/plugins/omp-plugins.lock.json` directly via `Bun.file()` + JSON parse. Direct fs.
- (c) Use agent file presence as the signal: if any agent file already contains `anthropic/` prefix in `model:`, ALLOWED_PREFIXES includes `anthropic/`. Avoids needing plugin settings — file is canonical per §9.6.

Pick (c) — minimal API surface, aligns with §9.6 source-of-truth.

---

### BLOCKER #2 — `pi.on("plugin_upgraded", ...)` event does NOT exist

§9.6 line 612 proposes registering `pi.on("plugin_upgraded", ...)` for idempotent re-apply. Verified: `types.d.ts:531-569` lists all 39 events for `pi.on()` — NO `plugin_upgraded`. Closest is `session_start`. Plugin upgrade runs out-of-band; no session active.

**Fix**: Drop `plugin_upgraded` hook. Pick:
- (a) Manual `/pi-oven:setup --reapply` documented as required after every `omp plugin upgrade pi-oven@pi-oven`. UX regression: user must remember. Mitigation: `--status` checks agent file content matches plugin config state (drift warn).
- (b) `session_start` handler that auto-detects drift and emits warning. No auto-reapply (silent rewrite = scary), just warning + suggest `--reapply`.

Pick (b) — automatic detection without silent rewrite.

---

### BLOCKER #3 — `agents/` install cache is EMPTY; AC#6 unmeetable for installed users

§9.6 line 607 targets `~/.omp/plugins/cache/plugins/pi-oven___pi-oven___<version>/agents/pi-oven-<role>.md`. Verified live: `/Users/kimzerokim/.omp/plugins/cache/plugins/pi-oven___pi-oven___0.1.0/agents/` exists but is EMPTY. `.claude-plugin/plugin.json:18` declares `"agents": []`. Spec A's 23 agent files in repo are NOT shipped to install cache.

AC#6 line 782 (`cat agents/pi-oven-executor.md | head` shows anthropic primary after Profile B) works only in dev mode (`--plugin-dir`). For installed users, Profile B is silent no-op at dispatch time.

**Cross-spec dependency**: Spec A's `.claude-plugin/plugin.json` `"agents": []` needs updating to declare agent files.

**Fix**: Spec B § new "Prerequisite — Spec A packaging gap":
- Spec B implementation phase MUST first patch `.claude-plugin/plugin.json` to declare `"agents": ["./agents/pi-oven-executor.md", ... 23 entries]` (or `"agents": ["./agents/"]` if dir-glob supported — verify).
- If `omp plugin install` doesn't populate cache automatically after `plugin.json` update, document `omp plugin install pi-oven@pi-oven --force` as required user step.
- Add precondition check: if install cache `agents/` empty, wizard refuses and outputs: `pi-oven plugin agent files not in install cache. Run \`omp plugin install pi-oven@pi-oven --force\` to refresh, or use --plugin-dir for dev mode.`

---

### BLOCKER #4 — Cache version segment unstable; lifecycle hand-waved

§9.6 line 607 hardcodes `pi-oven___pi-oven___<version>/`. `omp plugin upgrade` creates new version dir (`__0.1.0/`); old dir removed. Wizard's stored config still says Profile B; new agent files at new path show defaults. User unaware until first dispatch.

Tied to BLOCKER #2 — no upgrade event means no auto-detection.

**Fix**:
- Version discovery: enumerate `~/.omp/plugins/cache/plugins/pi-oven___pi-oven___*/`, sort by version, pick latest.
- Drift detection on every `/pi-oven:setup --status`: hash-compare agent file `model:` arrays against plugin config map. Emit warning if mismatched.
- Document "pi-oven must be re-applied after every omp plugin upgrade" as known limitation. session_start handler (BLOCKER #2 fix b) surfaces this automatically.

---

### BLOCKER #5 — `omp --status` does NOT exist; §6 Step a.5 falsely claims CLI surface

§6 Step a.5 line 254 says LLM uses `omp --status` to check parent session model. Verified: `omp --help` has no `--status`. `omp config` actions = `list|get|set|reset|path|init-xdg`. `omp stats` is usage stats. No CLI surface exposes active session model.

`getModel()` exists on `ExtensionContext` (`types.d.ts:800`) — accessible only from inside extension event handler, not from CLI script.

§12.4 acknowledges gap but §6 Step a.5 still references "or equivalent CLI surface (if the CLI exposes it; verify at implementation time)" — false promise.

**Fix**: Pick:
- (a) Drop Step a.5 entirely. Finalize §12.4 as known gap: "pi-oven cannot detect parent session model from CLI; warning surfaces only inside extension event handler at session_start."
- (b) Implement via `ctx.getModel()` in `session_start` handler; store result in `~/.omp/plugins/pi-oven-session-model.json` for CLI to read; wizard reads that file.

Pick (b) — surfaces the safety net automatically.

---

## 2. 🟡 NIT

1. §3.1 line 74 regex `^anthropic\s+claude-` correct, but table header `provider      model ...` (spec line 84 example) needs explicit exclusion — current regex correctly handles via `claude-` requirement, but document.
2. §9.1 line 511 IMPORTANT note good.
3. §6 Step a.5 line 259 recommendation: `--model opencode-zen/<role-appropriate>` — undefined. Use `opencode-zen/glm-5`.
4. §10.3 line 690 `parseArgs` `strict: false` — document why (allows --override repeated).
5. §10.3 conditional dispatch ordering: validate `--status --reset` precedence; add comment.
6. §8.4 line 487 exit-code-1 contract: LLM treats as terminal? Document LLM-vs-batch failure surface.
7. §7.1 line 369 JSON `// 21 more roles omitted` — JSON doesn't allow comments. Use prose above block.
8. §11 AC#7 line 784: clarify detection trigger (Step a auth always runs first).
9. §12.3 anthropic/claude-sonnet-4-7 absent — verified. NIT only.
10. §10.3 line 670 imports `./pi-oven-setup/import.ts` — §10.1 file structure doesn't list. Add or inline.

---

## 3. ⚪ PUSH-BACK

1. §6 Step a.5 + §9.6 + §10.5 structural additions = direct cycle-1 fix work, NOT new structural drift. Confirmed per gate rule.
2. §12.3 anthropic/claude-sonnet-4-7 monitoring = appropriate Open Question, not flaw.

---

## What's Missing

- §9.1 line 574 alt persistence (`Bun.write` to `~/.omp/plugins/pi-oven-config.json`) — no schema/key/read path defined.
- AC#8 — no mock for `spawnSync("omp", ...)` test isolation.
- AC#8 — no test for cache-empty case (BLOCKER #3) or upgrade drift (BLOCKER #4).
- Concurrency mitigation absent.
- `--reset` partial-applied Profile B handling absent.
- §9.5 23-role for-loop shell vs TypeScript ambiguity.
- §10.3 `runApply` `--override <role>=<model>` parse not documented.

---

## Path to ACCEPT (cycle 3)

1. BLOCKER #1: use agent-file presence signal (option c), import path-free.
2. BLOCKER #2: drop `plugin_upgraded`; install `session_start` drift detection (option b).
3. BLOCKER #3: add Spec A packaging fix to Spec B impl phase (`.claude-plugin/plugin.json "agents": ["./agents/..."]`); add cache-empty precondition check.
4. BLOCKER #4: version-glob discovery; drift detection algorithm; document upgrade reapply contract.
5. BLOCKER #5: implement parent-model via `session_start` handler storing to file (option b).
6. Apply 10 NITs.

---

## Source references

- `extensibility/extensions/types.d.ts:522-668` — ExtensionAPI; no getPluginSettings
- `extensibility/extensions/types.d.ts:531-569` — 39 pi.on events; no plugin_upgraded
- `extensibility/extensions/types.d.ts:800` — `getModel: () => Model | undefined` on ExtensionContextActions
- `extensibility/plugins/manager.d.ts:40-44` — manager.getPluginSettings (not extension-reachable)
- `extensibility/plugins/loader.d.ts:31` — standalone getPluginSettings(name, cwd)
- `cli/plugin-cli.ts:606-608` — `omp plugin config set <plugin> <key> <value>` parse order
- `cli/plugin-cli.ts:692-693` — `Plugin not found` from manager.list filter
- `~/.omp/plugins/cache/plugins/pi-oven___pi-oven___0.1.0/agents/` — EMPTY (0 files)
- `~/.omp/plugins/cache/plugins/pi-oven___pi-oven___0.1.0/.claude-plugin/plugin.json:18` — `"agents": []`
