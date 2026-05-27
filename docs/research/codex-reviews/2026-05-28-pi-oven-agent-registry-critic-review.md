# Spec A Critic Review — Cycle 1

- Date: 2026-05-28
- Reviewer: oh-my-claudecode:critic (opus)
- Spec: `/Users/kimzerokim/work/personal/pi-oven/docs/specs/2026-05-28-pi-oven-agent-registry.md` (1080 lines)
- Verdict: **REJECT (CONTINUE)** — 5 BLOCKERs, 11 NITs

---

## 1. 🔴 BLOCKER

1. **§5 / §9 "model array = rate-limit fallback" is factually wrong.** Spec §5 and §9.1–9.3 design runtime around primary→fallback-on-429. omp does NOT do this. `task/executor.ts:643` calls `normalizeModelPatterns(modelOverride ?? agent.model)` and feeds the array into `resolveModelOverride` (`config/model-resolver.ts:716–734`), which iterates patterns and returns the **first pattern that resolves to an available model at resolution time** — this is auth/registry availability, NOT 429 retry. omp's runtime retry (`shared-events.ts:222–229` `AutoRetryStartEvent { attempt, maxAttempts, delayMs, errorMessage }`) is **same-model sleep-backoff with retry-after**; there is no `nextModel` field anywhere. Every spec claim that 429 triggers the second array entry is false, and the rationale in §9.5 ("openai-codex 쿼터 소진 → opencode-zen 동일 모델로 전환") will never happen at runtime. **Fix**: either (a) drop "fallback chain" framing and reduce to "resolution-time alternates if primary is unauthed", or (b) commit to implementing 429 failover inside `pi-oven.ts` using `auto_retry_end(success=false)` + new dispatch — write that pseudocode.

2. **§5 executor primary model + §6 enforcement contradict the lock.** Spec §5 sets `executor.primary = "openai-codex/gpt-5.3-codex"` and §6.1/§13.3 says any string starting with `openai-codex/` is whitelisted. But Q5 (§16) flags openai-codex auth as unverified. The dogfood failure that originated this spec was authentication (401) against unknown-model strings. Shipping the default with an unverified auth dependency reproduces the exact failure mode the spec exists to prevent. **Fix**: either (a) verify openai-codex auth status before §5 lockdown and document the test in §14, or (b) flip executor primary to `opencode-zen/gpt-5.3-codex` (confirmed in `omp --list-models`) and demote openai-codex variants to alternate role.

3. **§13.3 calls a nonexistent omp API: `pi.pi.getPluginDir()`.** Pseudocode `const agentsDir = path.join(pi.pi.getPluginDir(), "agents");` is presented as implementation path. `ExtensionAPI` (`extensibility/extensions/types.ts:827–907`) exposes `logger`, `typebox`, `zod`, `pi: typeof piCodingAgent`, event registration — no `getPluginDir`. `ExtensionContext` (`types.ts:259–289`) exposes `cwd`, `sessionManager`, `modelRegistry`, `model` — no plugin path. Only way to locate plugin install root from inside extension is rely on extension file path (`import.meta.url` or `__dirname`) — spec never says this. **Fix**: specify the exact API used.

4. **§7.3 / §3.3 "model field required on every agent file" contradicts §5/§13.3 enforcement.** §7.3 says "23개 agent 파일 전체에 `model:` 필드를 명시하는 것이 필수다". But §13.3 Layer 1 only inspects files matching `pi-oven-*.md`. `parseAgentFields` returns `model: undefined` when empty (`discovery/helpers.ts:198–203`). Layer 1 pseudocode (lines 820–842) iterates `for (const model of models)` — if `models` is `[]`, loop body never runs, so missing `model:` field passes validation but produces dispatch failure at runtime. **Fix**: add "missing `model:` on `pi-oven-*.md` is a validator error (not a skip)."

5. **§2.3 "live test result" is fictional.** §2.3 reports test results in past tense ("테스트 파일은 검증 후 즉시 삭제") but `ls /Users/kimzerokim/work/personal/pi-oven/agents/` contains only `.gitkeep`. No test was actually run; section presents speculation as verified fact. Pattern repeats in §2.7 / §16 Q7 ("이미 확인됨"). Flat-discovery claim happens to be correct (verified independently — `task/discovery.ts:33–49`), but **colon-in-name claim was never tested live** — `parseAgentFields` (`discovery/helpers.ts:222–228`) only checks `typeof === "string"`, never validates colon behavior in downstream dispatch resolution. **Fix**: replace "live 테스트 결과" prose with either real test artifacts (commit + log link) or honest "static analysis predicts X — to be empirically verified in §14 step N."

---

## 2. 🟡 NIT

1. §5 model rationale "kimi-k2.6 ... thinking 지원 확인" correct (`omp --list-models` shows `minimal,low,medium,high,xhigh`) but spec assigns `verifier.thinkingLevel: medium` — fine. Add verified thinking-level matrix to §5 so reviewers don't re-derive.

2. §14 단계 1–9 uses "단계 N" numbering. User's lock-list forbids "Plan N / Task M" leakage. "단계 N" is Korean alias; equally problematic for same downstream-skill SKILL.md rewrite reason. Either drop numbering or commit that "단계" is intentionally retained. Lines 869, 875, 884, 889, 893, 899, 905, 912, 933.

3. §1.1 still says "Plan 2 진입" (line 12, 27). User's lock-list says to confirm spec body avoids "Plan N / Task M". Rephrase to "v0.1.0 dogfood failure".

4. §4 lists `pi-oven:explore` vs `pi-oven:explorer` — naming inconsistent. Spec C will need mapping table; document here.

5. §4.2 spawns diagram shows `metis` with "pi-oven: namespace whitelist" — `parseAgentFields` (`discovery/helpers.ts:237–250`) parses spawns as `"*"` or `string[]`. No namespace-prefix semantic; enumerate explicit list.

6. §3.1 frontmatter table claims `output: object` "JTD 스키마". `output` is opaque to `parseAgentFields`. Tighten to "any output schema object honored by the agent runtime; see omp examples".

7. §5 `git-master.thinkingLevel: minimal` — git-master uses `opencode-zen/claude-haiku-4-5` (supports minimal ✓). But cross-validate `(model, thinkingLevel)` pairs in §5 to catch next mismatch.

8. §16 Q1 same as BLOCKER #1. Once resolved, delete Q1.

9. §13.3 layer 2 `pi.on("before_agent_start", ...)` — `BeforeAgentStartEvent` (`types.ts:450–455`) has no agentName; `BeforeAgentStartEventResult` (`types.ts:774–778`) accepts only `message` and `systemPrompt`. Layer 2 as drafted is no-op. Either delete or specify concrete enforcement.

10. §2.5 conflict matrix says "omp bundled" for `librarian` — `task/agents.ts:44–72` shows bundled set includes `librarian, oracle, explore, plan, designer, reviewer, task, quick_task`. Tighten wording.

11. §15.1 lists 23 dispatch names but §11.1 reuses `oracle.md`/`librarian.md` from omp bundled — pi-oven:oracle/pi-oven:librarian shadow nothing because different `name:` values, but explicitly note omp's bundled `oracle`/`librarian` remain dispatchable alongside pi-oven-prefixed.

---

## 3. ⚪ PUSH-BACK

None.

---

## Verdict justification

**BLOCKER #1**: critical. Half of §9 and rationale in §5 designed around behavior omp does not implement. Without fix, pi-oven.ts validator appears to "support fallback" while runtime 429s hard-fail with no model switch.

**BLOCKER #2**: critical. Mitigated only by Spec B setup wizard (out of scope). Profile A is release default per lock — shipping unauthed default is v0.1.0 failure reborn.

**BLOCKER #3**: critical. Validator code cannot be written until agents-dir resolution path is specified.

**BLOCKER #4**: critical. Silent pass + runtime dispatch failure is exactly the class of bug the spec exists to prevent.

**BLOCKER #5**: critical. Fabricated empirical evidence as load-bearing argument. Trust hazard for downstream Spec C author.

**Path to ACCEPT (cycle 2)**:
1. Rewrite §5/§9 with accurate fallback semantics OR commit pi-oven.ts pseudocode for 429 failover.
2. Flip executor primary to `opencode-zen/gpt-5.3-codex` OR add §14 gating step for openai-codex auth.
3. Specify concrete API for `agents/` dir resolution (likely `import.meta.dir` or path relative to extension file).
4. Add validator rule: missing `model:` on `pi-oven-*.md` is error, not skip.
5. Remove fabricated live-test prose OR replace with reproducible commands.

NITs may be batched into cycle 2 without re-review.

---

## Relevant source references (omp internal, cited)

- `task/discovery.ts:33–49, 92–101` — flat-only agent discovery confirmed
- `task/agents.ts:44–72` — bundled agents: explore, plan, designer, reviewer, librarian, oracle, task, quick_task
- `task/executor.ts:76–85, 643` — `normalizeModelPatterns` + `resolveModelOverride` resolution-time alternate (NOT 429 failover)
- `discovery/helpers.ts:198–271` — `parseAgentFields` schema; `model: undefined` when empty; colon-in-name only `typeof === "string"` checked
- `config/model-resolver.ts:716–734, 758–795` — first-resolvable-match-wins resolution
- `extensibility/extensions/types.ts:259–289, 450–455, 774–778, 827–907` — ExtensionAPI / ExtensionContext shape; no `getPluginDir`; `BeforeAgentStartEvent` no agentName/model
- `extensibility/shared-events.ts:222–237` — `AutoRetryStartEvent { attempt, maxAttempts, delayMs, errorMessage }` (no `nextModel`)
