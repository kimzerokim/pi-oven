# Cycle review — 2026-05-28 nightly run

> Temporary record of the overnight autonomous run. Delete after review.

## TL;DR

3-spec model-routing + subagent-consolidation initiative completed end-to-end on branch `feature/standard-expansion`. **v0.1.0 baseline achieved** (23 pi-oven-* agents + `/pi-oven:setup` wizard + 15 self-contained skills + zero external dispatch dependency). 152 bun tests pass; lint:agents exit 0; typecheck + build clean.

**Nothing has been pushed.** Three semantic commits + a pending cleanup turn live only locally on `feature/standard-expansion`.

---

## Commits (chronological, local only)

```
<uncommitted cleanup turn>
5c7b3f9  feat: v0.1.0 — Spec C: 3 new skills + sweep + boost
dfd709a  feat: /pi-oven:setup wizard — Spec B
b4b5407  feat: pi-oven-prefixed agent registry — Spec A
0a388c8  (origin/main)  ← remote still here from Plan 1
```

| Commit | Spec | Cycles to ACCEPT | Net diff |
|---|---|---|---|
| `b4b5407` | A — agent registry | 4 cycles | 37 files / +5960 -6 |
| `dfd709a` | B — setup wizard | 4 cycles | 34 files / +6134 -13 |
| `5c7b3f9` | C — skill rewrite + new | 3 cycles | 32 files / +2632 -75 |

Critic verdicts are stored under `docs/research/codex-reviews/2026-05-28-*-critic-review*.md` (11 verdict files total across the 11 cycles).

---

## Uncommitted cleanup turn (working tree)

Six small follow-ups after Spec C ACCEPT — not yet committed. Push decision rests with you.

| # | Change | Files |
|---|---|---|
| 1 | Executor primary swap: `openai-codex/gpt-5.3-codex` is now primary (Profile A); `opencode-zen/gpt-5.3-codex` demoted to registry_alternate | `agents/pi-oven-executor.md`, `scripts/pi-oven-setup/profiles.ts`, `tests/scripts/pi-oven-setup/profiles.test.ts`, `docs/specs/2026-05-28-pi-oven-agent-registry.md` (8 line edits), `docs/specs/2026-05-28-pi-oven-setup-wizard.md` L133, `README.md` |
| 2 | Momus absorption into `pi-oven:critic` — added "Multi-model fan-out" + "Practical-reviewer mode (Momus-inspired)" sections | `agents/pi-oven-critic.md` |
| 3 | `commands/pi-oven-autonomous.md` stub → full English LLM prompt template (3-slot contract + 3 execution modes + polite-stop ban + exit gate) | `commands/pi-oven-autonomous.md` |
| 4 | `docs/decisions/0001-dogfood-switch.md` got `## v0.1.0 Boost` section appended | `docs/decisions/0001-dogfood-switch.md` |
| 5 | `plugin.json "agents": []` inert field removed (omp's ClaudePluginManifest schema doesn't read it) | `.claude-plugin/plugin.json` |
| 6 | All 15 SKILL.md `version:` frontmatter bumped 0.1.0/0.1.0 → **0.1.0** (matches plugin version) | `skills/*/SKILL.md` (15 files) |
| 7 | Plan 2 draft + survey marked **SUPERSEDED** (kept as historical, not deleted) | `docs/plans/2026-05-27-pi-oven-plan-2-standard-expansion.md`, `docs/harness/surveys/2026-05-27-plan-2-standard-expansion-survey.md` |

### Suggested commit message for the cleanup

```
chore: v0.1.0 cleanup — executor swap, momus absorption, autonomous prompt, skill versions

- Profile A executor primary: openai-codex/gpt-5.3-codex (was opencode-zen wrapper).
  Codex 5.3+ ChatGPT subscription becomes the release default; zen wrapper is the
  registry_alternate fallback. Propagated across agent file, profiles.ts, tests,
  spec A § 5 / 11, spec B Profile A table, README.

- pi-oven:critic absorbs omo Momus pattern: Multi-model fan-out section
  documents the spec-and-review skill's cross-vendor critic dispatch
  (opencode-zen claude + openai-codex gpt-5.4); Practical-reviewer
  opt-in mode codifies the approval-bias review style.

- commands/pi-oven-autonomous.md replaces the Plan-0-era stub with the full
  LLM prompt template (3-slot branch contract + 3 execution modes +
  9 polite-stop ban patterns + fresh-verifier exit gate).

- docs/decisions/0001-dogfood-switch.md adds the v0.1.0 boost section
  recording the agent-registry / wizard / skill-rewrite delta from v0.1.0.

- plugin.json removes the inert "agents": [] field (not in ClaudePluginManifest
  schema; agents discovered by directory convention).

- All 15 SKILL.md frontmatter version fields bumped to 0.1.0 for consistency
  with the plugin manifest.

- Plan 2 standard-expansion draft + survey marked SUPERSEDED — replaced
  by the Spec A/B/C model-routing initiative that actually shipped v0.2.0.
```

---

## Tests / build / lint state

```
$ bun test     → 152 passed, 0 failed, 20 files, 636 expect() calls
$ bun check    → 0 errors (tsc --noEmit)
$ bun run build → pi-oven.js 6.33 KB
$ bun run lint:agents → exit 0
```

CI workflow (`.github/workflows/ci.yml`) already covers all four locally.

---

## v0.1.0 baseline summary

### Files shipped

| Layer | Count | Path |
|---|---|---|
| Agents | 23 | `agents/pi-oven-*.md` |
| Skills | 15 | `skills/*/SKILL.md` (12 existing + 3 new: deep-init, deep-dive, team) |
| Setup wizard | 1 slash + 1 batch CLI + 11 submodules | `commands/pi-oven-setup.md`, `scripts/pi-oven-setup.ts`, `scripts/pi-oven-setup/*.ts` |
| Extension | 1 | `.omp/extensions/pi-oven.ts` (load-time validator + session_start drift detection + parent-session model capture) |
| CI lint | 1 | `scripts/lint-agents.ts` |
| Eval runner | existing | `scripts/run-eval.ts`, `scripts/lib/eval-runner.ts` |

### Specs + critics

| Spec | Lines | Cycles | Verdict files |
|---|---|---|---|
| Agent registry | 1268 | 4 (REJECT×3 → ACCEPT) | `docs/research/codex-reviews/2026-05-28-pi-oven-agent-registry-critic-review{,-2,-3,-4}.md` |
| Setup wizard | 993 | 4 (REJECT×3 → ACCEPT) | `docs/research/codex-reviews/2026-05-28-pi-oven-setup-wizard-critic-review{,-2,-3,-4}.md` |
| Skill rewrite + new | 1160 | 3 (REJECT×2 → ACCEPT) | `docs/research/codex-reviews/2026-05-28-pi-oven-skill-rewrite-and-new-skills-critic-review{,-2,-3}.md` |

### Provider whitelist (post-cleanup #1)

| Provider | Status | Profile A primary roles |
|---|---|---|
| `openai-codex` | Always allowed | executor (primary) — Codex 5.3+ ChatGPT subscription |
| `opencode-zen` | Always allowed | all reasoning roles + executor.registry_alternate |
| `anthropic` | Opt-in (Profile B only) | promoted for reasoning-heavy roles when user has Anthropic Pro/Max |

---

## What you should do at wake (recommended order)

1. **Skim `feature/standard-expansion` commit messages** (~3 min):
   ```
   git log --oneline feature/standard-expansion ^main
   ```
2. **Spot-check 1-2 agent files** (`agents/pi-oven-executor.md`, `agents/pi-oven-critic.md`) — verify they look like what you expect.
3. **Spot-check 1 critic verdict** (e.g. `docs/research/codex-reviews/2026-05-28-pi-oven-setup-wizard-critic-review-4.md`) — confirm the review depth feels right.
4. **Decide on the cleanup turn**:
   - Approve as-is → commit message above + `git push origin feature/standard-expansion`.
   - Want adjustments → tell me what to change.
   - Decline some items → tell me which.
5. **Push decision**:
   - **Option A (recommended for review)**: push `feature/standard-expansion` to GitHub, open a PR, review the diff in browser, then merge after CI green.
   - **Option B**: force-push `main` (only if you're confident; remote still has the old Plan-1-end state from `0a388c8`).
6. **Tag v0.1.0 + GitHub release** (after push):
   ```sh
   git tag -a v0.1.0 -m "v0.1.0 — agent registry + setup wizard + skill rewrite"
   git push origin v0.1.0
   gh release create v0.1.0 --title "v0.1.0 — Self-Contained pi-oven Registry"
   ```
7. **Apply to your local omp**:
   ```sh
   omp plugin install pi-oven@pi-oven --force
   omp plugin list | grep pi-oven    # expect 0.1.0
   ```
8. **Optional**: run `/pi-oven:setup --apply --profile B` to activate Anthropic routing if you want to spend extra-usage tokens. Or stick with Profile A (release default) — that's what other users will see.

---

## Known limitations (carried forward)

- **Auth-fallback whitelist hole** (Spec A §6.3): when a pi-oven agent's primary model is unauthed, omp's `resolveModelOverrideWithAuthFallback` falls back to the **parent session's active model**, NOT to the pi-oven agent's registry_alternate. If the parent session runs on a model outside the pi-oven whitelist (`google/gemini-flash` etc.), the subagent silently routes through it. Spec B's `session_start` handler captures the parent model to `~/.omp/plugins/pi-oven-session-model.json` for the wizard to warn.

- **`omp plugin upgrade` resets agent files**: the install cache `agents/` directory gets overwritten on every plugin upgrade. After upgrading, re-run `/pi-oven:setup --reapply` to restore Profile B (Profile A is the default, so no reapply needed if you stay on A).

- **Install cache may be empty if upgrading from old install**: `~/.omp/plugins/cache/plugins/pi-oven___pi-oven___0.x.x/agents/` must contain the 23 agent files. If empty (`ls ... | wc -l` → 0), force a reinstall.

- **`anthropic/claude-sonnet-4-7` not yet in registry**: Profile B uses `claude-sonnet-4-6` (1M context) until 4-7 ships in `omp --list-models`.

- **`/pi-oven:autonomous` is now LLM-driven, not state-machine** (cleanup #3): the slash command is a prompt template that drives `autonomous-loop` skill behavior in the conversation. There is no separate TypeScript state machine — this is intentional.

---

## What we did NOT do (out of scope this cycle)

- **Push to remote** — push policy memory says explicit user confirmation required.
- **Tag v0.1.0** — same reason.
- **Run eval suite retroactively** — LLM keys are now available but the eval-runner integration test (AC#10 in Spec C) only checks SKILL.md content, not live model behavior. Full live eval = future Plan.
- **Anthropic native key wiring beyond Profile B opt-in** — Profile B activation logic exists, but you must run `/pi-oven:setup --apply --profile B` yourself to switch.
- **Plan 2 ~33-skill expansion** (the original meaning of "Plan 2") — this cycle delivered v0.1.0 via a different path (agent registry + wizard + skill rewrite). The Plan 2 draft is marked SUPERSEDED. If you want the original 33-skill expansion later, that's a future cycle.
- **`prometheus` / `hephaestus` / `atlas` from omo** — you explicitly said to skip them. `momus` was absorbed into `pi-oven:critic`.

---

## Files to look at first (priority order)

1. `README.md` — fresh v0.1.0 docs you can show to others.
2. `docs/decisions/0001-dogfood-switch.md` — see the v0.1.0 Boost section appended.
3. `commands/pi-oven-autonomous.md` — see the rewritten English prompt template.
4. `agents/pi-oven-critic.md` — see the new "Multi-model fan-out" + "Practical-reviewer mode" sections (Momus absorption).
5. `docs/research/codex-reviews/2026-05-28-pi-oven-setup-wizard-critic-review-4.md` — example final-cycle ACCEPT verdict.

---

*Delete this file when done with review.*
