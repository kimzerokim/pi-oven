# Spec B Critic Review — Cycle 1

- Date: 2026-05-28
- Reviewer: oh-my-claudecode:critic (opus)
- Spec: `/Users/kimzerokim/work/personal/pi-oven/docs/specs/2026-05-28-pi-oven-setup-wizard.md` (745 lines)
- Cycle: 1
- Verdict: **REJECT (CONTINUE)** — 1 CRITICAL + 9 MAJOR + 8 minor

---

## 1. 🔴 BLOCKER

### CRITICAL #1 — Interactive wizard fundamentally incompatible with omp slash-command execution model

`commands/pi-oven-setup.md` loaded as `SlashCommand` (markdown prompt template only). There's no subprocess execution path for markdown slash commands. `run:` field doesn't exist; "bash block" is prompt text, not auto-executed. Custom subprocess commands require `.ts/.js` via `customCommands` loader — different surface, factory.execute(), still no stdin.

Spec §2.2 line 41 claims `omp 슬래시 커맨드 컨텍스트에서 bun scripts/pi-oven-setup.ts ... stdin/stdout 인터랙티브 프롬프트`. §10.2 line 577 claims `omp 슬래시 커맨드의 run: 필드 또는 body의 bash block`. Neither mechanism exists.

**Fix**: Pick ONE UX strategy:
- (a) `commands/pi-oven-setup.md` = prompt template that tells the LLM to run `bun scripts/pi-oven-setup.ts --status|--reset|--import` (batch-only). Interactive Q&A happens inside chat with the LLM, not subprocess stdin.
- (b) Custom TypeScript command (`commands/pi-oven-setup/index.ts`), execute() drives via repeated `/pi-oven:setup <step>` invocations + plugin-config state.
- (c) Interactive wizard runs OUT-OF-BAND via `bun scripts/pi-oven-setup.ts` (CLI, not /pi-oven:setup). Slash exposes batch only.

Choose (a) — simplest, leverages the LLM agent for prompting. Document as final.

---

### MAJOR #1 — `.omp/extensions/pi-oven.ts` already includes `anthropic/` unconditionally — contradicts Spec A §6.2

Current file: `ALLOWED_PREFIXES = ["opencode-zen/", "openai-codex/", "anthropic/"]`. Spec A says anthropic must be conditional on `isAnthropicEnabled()`. Hard whitelist option C is broken right now.

**Fix**: Spec B §10.5 (new) requires updating `pi-oven.ts` Layer 1 to compute `ALLOWED_PREFIXES` dynamically by reading `pi-oven.provider.anthropic.enabled` from `pi.getPluginSettings("pi-oven")`. Show code snippet with conditional.

---

### MAJOR #2 — Persistence does not drive dispatch; AC#6 unmeetable

`omp plugin config set` writes to `~/.omp/plugins/omp-plugins.lock.json` settings. Nothing in omp reads `pi-oven.models.<role>.primary` to override agent file `model:` arrays at dispatch time. Subagent dispatch reads file frontmatter, not config. Profile B becomes config-only theater — config says anthropic but dispatch uses Profile A from file.

§9.3 defers to Spec C ("method C") + AC#6 has parenthetical condition. Spec B cannot pass AC#6 alone.

**Fix**: Pick one:
- (a) Pull method-C agent-file in-place rewrite into Spec B scope (wizard writes config + rewrites `agents/pi-oven-*.md` model arrays in install cache). Document rollback (omp plugin upgrade overwrites cache).
- (b) Add `pi-oven.ts` runtime hook that reads plugin settings and rewrites resolved model. Acknowledge `BeforeAgentStartEvent` has no `model` field → may not be possible.
- (c) Downgrade AC#6 to "config persisted correctly" only, explicit "Profile B has no dispatch effect until Spec C".

Choose (a) — wizard rewrites agent files post-persist. Add upgrade-overwrite mitigation: wizard idempotent (re-apply on plugin upgrade detection).

---

### MAJOR #3 — Two-source-of-truth: agent file `model:` vs plugin config map

Spec A's Layer 1 validator + `lint-agents.ts` read agent files canonically. Spec B writes to plugin config. No reconciliation. User runs `/pi-oven:setup` Profile B → config says anthropic primary; agent file still says Profile A opencode-zen primary; validator passes (file value); dispatch uses file value. UX: "Profile B active" but dispatch is Profile A.

**Fix**: Tied to MAJOR #2 — picking option (a) means agent file is canonical, config is informational. State the source-of-truth rule explicitly in §9.

---

### MAJOR #4 — Auth detection ping can be served by auth-fallback (Spec A §6.3) → false positive

§3.2 smoke ping `omp -p "ping" --model anthropic/claude-haiku-4-5` may succeed via parent session fallback even if Anthropic itself unauthed. Wizard activates Profile B based on false positive; user has no Anthropic key; billing flows through opencode-zen wrapper.

**Fix**: Primary detector = parse `omp --list-models | grep "^anthropic\s"` (native provider section only, NOT opencode-zen wrappers). Smoke ping = optional confirmation via `--confirm-auth` flag; downgrade with explicit auth-fallback note.

---

### MAJOR #5 — Validation gate (§8) burns 23×LLM tokens with no opt-out

AC#2 mandates default-run. Profile B Opus rate-burns >$0.10 per setup. Transient failures cause confusing exit 1.

**Fix**: Add `--no-validate` flag. Default behavior = `--validate=smoke` (ping only MUST tier 7 roles: executor/explorer/verifier/critic/planner/code-reviewer/debugger). `--validate=full` opt-in for 23 roles.

---

### MAJOR #7 — Plugin name `pi-oven` vs `pi-oven@pi-oven` partial inconsistency

§9.1 correctly uses `pi-oven` for config ops. §12.1, §12.2 reference `pi-oven@pi-oven` — that's the install id, not the config id. installed_plugins.json key = `pi-oven@pi-oven`, but plugin.name = `pi-oven`.

**Fix**: Mark §12.1/§12.2 explicitly: marketplace install ops use `pi-oven@pi-oven`; all `omp plugin config <verb>` ops use bare `pi-oven`.

---

### MAJOR #8 — §9.4 schema-required claim is factually wrong

`plugin-cli.ts:756-772`: `if (schema) { validate... }` — un-schema'd keys flow straight to `manager.setPluginSetting` without rejection. Spec's "must declare 71-key schema" is over-engineering.

**Fix**: Strike §9.4 schema-declaration section. Optional doc-only declaration of 2 top-level keys (`pi-oven.profile`, `pi-oven.provider.anthropic.enabled`); 23×3 per-role keys un-schema'd OK.

---

### MAJOR #9 — Parent-session-violates-whitelist not addressed

User running `/pi-oven:setup` inside session with `google/gemini-flash` parent gets no warning. Spec A §6.3 hole means every unauthed-primary subagent silently routes through gemini-flash.

**Fix**: Add §6 Step a.5: detect parent session model (verify omp API: `runtime.session.activeModel` or equivalent). If prefix ∉ ALLOWED_PREFIXES, output warning before any other step.

---

### MAJOR #10 — Profile B librarian/explorer model substitution missing rationale

Profile B swaps glm-5 (1M ctx) for anthropic-haiku (200K ctx) on librarian + explorer. Large-repo workloads degrade. Rationale = single sentence.

**Fix**: Either (a) keep glm-5 as Profile B librarian + explorer primary, OR (b) explicit trade-off note in §5 with sample partial-override JSON to preserve glm-5.

---

## 2. 🟡 NIT (minor)

1. §7.1 JSON schema example: add `// 21 more roles omitted` comment.
2. §7.2 rule #3 truncates role list. Enumerate all 23 in error message.
3. §11 AC#1 fresh-install case: wizard must handle "Plugin not found" gracefully.
4. §11 AC#8: add "Profile B selection without anthropic auth detected → wizard refuses" test.
5. §11 AC#7: clarify detection trigger (on `/pi-oven:setup --status` only? boot-time also?).
6. §6 Step e validation output format inconsistent: `(alternate only)` vs `(alternate OK)`. Pick one.
7. §6 Step c "anthropic/ (if Profile B)" should be "if Profile B AND anthropic detected".
8. §10.1 file naming: no conflict, fine.

---

## 3. ⚪ PUSH-BACK

None — all 10 findings are validated.

---

## What's Missing

- Concurrency: two simultaneous `/pi-oven:setup` not addressed.
- Migration: versioned config schema not defined.
- Spec C handoff contract: what data Spec B exports to Spec C?
- Auth credential change detection: proactive vs reactive.
- `--status` output schema undefined.
- Test isolation: `omp-plugins.lock.json` mutations need fixture isolation.
- `--plugin-dir` dev mode interaction unaddressed.
- `--import -` (stdin) missing for power users.

---

## Path to ACCEPT (cycle 2)

1. Resolve CRITICAL #1: pick UX strategy (a), strike §6 stdin-interactive design.
2. Resolve MAJOR #1: §10.5 conditional ALLOWED_PREFIXES; acknowledge current pi-oven.ts violates Spec A.
3. Resolve MAJOR #2 + MAJOR #3 together: source-of-truth = agent file; wizard rewrites file post-persist (option a).
4. Resolve MAJOR #4: native-provider parse, ping demoted.
5. Resolve MAJOR #5: `--no-validate` + smoke/full split.
6. Resolve MAJOR #7: plugin-name disambiguation.
7. Resolve MAJOR #8: strike §9.4 schema-required.
8. Resolve MAJOR #9: parent-session warning.
9. Resolve MAJOR #10: librarian/explorer rationale + partial-override sample.
10. Apply 8 NITs batched.

---

## Source references (cited)

- `capability/slash-command.ts:11-23` — SlashCommand shape
- `discovery/builtin.ts:308-317` — loadFilesFromDir extensions=["md"]
- `extensibility/custom-commands/loader.ts:171` — TS custom command path
- `cli/plugin-cli.ts:692-772` — manager.list + if(schema)
- `extensibility/plugins/manager.ts:438-458` — setPluginSetting un-schema'd accept
- `.omp/extensions/pi-oven.ts:6-10` — current ALLOWED_PREFIXES includes anthropic unconditionally
