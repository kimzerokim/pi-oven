# Spec B Critic Review — Cycle 3

- Date: 2026-05-28
- Reviewer: oh-my-claudecode:critic (opus)
- Spec: `/Users/kimzerokim/work/personal/pi-oven/docs/specs/2026-05-28-pi-oven-setup-wizard.md` (977 lines)
- Previous: `docs/research/codex-reviews/2026-05-28-pi-oven-setup-wizard-critic-review-2.md`
- Cycle: 3
- BLOCKERs resolved since cycle 2: 4/5
- Verdict: **REJECT (CONTINUE)** — 2 NEW BLOCKERs + 8 NITs

---

## Cycle 2 BLOCKER verification

| # | Cycle 2 finding | Status | Evidence |
|---|---|---|---|
| #1 | `pi.getPluginSettings` API absent | ✓ RESOLVED — §10.5 agent-file-presence signal |
| #2 | `plugin_upgraded` event absent | ✓ RESOLVED — `session_start` (types.d.ts:532) |
| #3 | `agents/` cache empty + plugin.json patch | ✗ **BROKEN** — patch targets wrong field (BLOCKER #1) |
| #4 | Cache version segment | ⚠️ Partial — `compareSemver` undefined (BLOCKER #2) |
| #5 | `omp --status` absent | ✓ RESOLVED — `ctx.getModel()` (types.d.ts:800) + session_start file capture |

---

## 1. 🔴 BLOCKER (2 new)

### BLOCKER #1 — §10.6 `plugin.json "agents"` patch is a no-op; cycle 2 evidence misread

§10.6 (lines 823-859) requires Spec A's `.claude-plugin/plugin.json` to declare `"agents": ["./agents/..."]`. **This patch has zero effect on agent discovery.**

Evidence:
- `extensibility/plugins/types.d.ts:22-42` — `PluginManifest` interface does NOT contain `agents` field (only `tools`, `hooks`, `extensions`, `commands`, `features`, `settings`).
- `discovery/claude-plugins.ts:31-35` — `ClaudePluginManifest` interface only reads `skills`, `slash-commands`, `commands`. Agents NOT in schema.
- `task/discovery.ts:100` — `const agentsDir = path.join(plugin.path, "agents");` — agents discovered by **directory convention**, not manifest declaration.
- `extensibility/plugins/marketplace/cache.ts:79` — `await fs.cp(sourcePath, stagingPath, { recursive: true })` — install copies entire tree. plugin.json `agents` never consulted.

Cycle 2 evidence misread: empty `~/.omp/plugins/cache/plugins/pi-oven___pi-oven___0.1.0/agents/` exists because install (`installedAt: 2026-05-27T12:26`) **predates the `b4b5407` agents commit**. At install time the source had only `agents/.gitkeep`. Recursive `fs.cp` correctly copied what existed.

**Fix**: Replace entire §10.6 "Required Spec A patch" subsection. Correct precondition (one sentence):
> "Precondition: `omp plugin install pi-oven@pi-oven --force` must be run against a repo containing all 23 `agents/pi-oven-*.md` files. The omp install (`cache.ts:79` `fs.cp recursive`) populates the cache automatically; `.claude-plugin/plugin.json` does NOT have an `agents` field (verified `discovery/claude-plugins.ts:31-35`)."

Remove 23-entry enumeration block. Keep `checkAgentsCachePopulated()` precondition check (still valid). Cross-spec note: Spec A's `plugin.json:18` `"agents": []` should be REMOVED (currently inert + misleading), NOT enumerated.

This is structural drift to Spec A → REJECT.

---

### BLOCKER #2 — `compareSemver` undefined; §10.6 `resolveCacheAgentsDir` non-implementable

§10.6 line 904: `return compareSemver(vb, va);`

Verified:
- No `compareSemver` export in `@oh-my-pi/pi-coding-agent` public types.
- No `semver` dependency in `package.json`.
- No import statement in spec.

**Fix**: Inline minimal implementation in §10.6:
```typescript
function compareSemver(a: string, b: string): number {
  const pa = a.split(".").map(n => parseInt(n, 10));
  const pb = b.split(".").map(n => parseInt(n, 10));
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const va = pa[i] ?? 0;
    const vb = pb[i] ?? 0;
    if (va !== vb) return va - vb;
  }
  return 0;
}
```
~10 lines. No external dependency.

---

## 2. 🟡 NIT (8)

1. §6 Step a.5 line 256 — `pi-oven-session-model.json` no concurrency mitigation. Two omp sessions both write same path; last-write-wins. Document as known OR add `.${pid}` segment.
2. §9.6 line 627 — `fs.writeFile` not atomic. Mid-write process kill → corrupted JSON. Reader (§6 Step a.5) should treat parse failure as "absent".
3. §10.6 line 880 — `piOvenAgents.length >= 23` hardcoded. Soft-version via `EXPECTED_AGENT_COUNT` from `pi-oven-setup/profiles.ts` SoT.
4. §2.1 subcommand table (lines 32-37) — `--reapply` flag MISSING from user-facing table; §9.6, §10.6, §10.3 reference it.
5. §9.5 `--reset` shell loop (lines 592-596) — bash inside TS-impl spec. Either convert to TS pseudo-code or mark "illustrative shell equivalent".
6. §6 Step a.5 race window on `pi-oven-session-model.json` read — extend "absent/stale" semantics to "absent/stale/corrupt".
7. §10.5 race during `--reset` rewrite — actually harmless (anthropic prefix only relaxes validation, never tightens). Document explicitly: "self-consistent — partial-rewrite race never produces false WHITELIST VIOLATION".
8. §10.5 extension code path — document whether `agentFiles` param is `<cwd>/agents/*.md` (dev) or `<installPath>/agents/*.md` (claude-plugin mode). Cross-ref Spec A's `validateAgentRegistry`.

---

## 3. ⚪ PUSH-BACK (3)

1. Atomicity concern at §10.5 rewrite race — non-issue. Validator widens whitelist when anthropic/* present; partial rewrite yields SUPERSET → no false WHITELIST VIOLATION. Documented as NIT #7.
2. cwd question for `omp-plugins.lock.json` — §9.3 line 555 covers user-scope-only read. Spec B has no project-scope semantics. No change.
3. Cycle 3 "structural drift" concern — the §10.6 plugin.json patch block IS new structural drift to Spec A (false premise). Removing it returns Spec B to drift-free.

---

## What's Missing

- `compareSemver` impl (BLOCKER #2).
- `--reapply` subcommand row (NIT #4).
- JSON corruption handling (NIT #2).
- `EXPECTED_AGENT_COUNT` SoT (NIT #3).
- AC#8 enumeration for: cache-empty precondition, session_start drift handler, `resolveCacheAgentsDir` empty/single/multi cases.
- §9.6 idempotency on partial rewrite failure.

---

## Path to ACCEPT (cycle 4)

1. Remove §10.6 plugin.json patch block (lines 823-859). Replace with one-sentence precondition.
2. Define `compareSemver` inline in §10.6 above `resolveCacheAgentsDir`.
3. Apply NITs 1-8.
4. Add 4 gap items to AC#8.
5. Re-verify before next cycle.

---

## Source references

- `extensibility/plugins/types.d.ts:22-42` — PluginManifest no `agents` field
- `discovery/claude-plugins.ts:31-35` — ClaudePluginManifest no `agents` key
- `task/discovery.ts:100` — `agentsDir = path.join(plugin.path, "agents")` convention
- `extensibility/plugins/marketplace/cache.ts:79` — `fs.cp recursive` copies entire tree
- `~/.omp/plugins/installed_plugins.json` — `installedAt: 2026-05-27T12:26` predates `b4b5407`
- No `compareSemver` in public types or package.json deps
