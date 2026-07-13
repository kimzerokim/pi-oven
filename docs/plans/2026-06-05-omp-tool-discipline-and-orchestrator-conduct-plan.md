> Historical; do not copy runtime syntax examples from this document.

# omp Tool Discipline + Orchestrator Conduct — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make every pi-oven agent forcefully USE omp's native tools (omp-official-agent style), make setup
enable the gated tools so the prompts have teeth, and give the main orchestrator a standing strict conduct
protocol (skill-first, wait-for-user) tuned for kimi.

**Architecture:** Three independent prongs. (A) `config-yml` gains a tool-enablement writer called by `apply.ts`
on global-scope setup. (B) `rules-injector` gains a parent-only standing conduct block; `skill-keyword-loader`
gets stronger wording + broader matching; the extension wires the conduct block parent-only with the autonomous
flag. (C) All 24 `agents/pi-oven-*.md` bodies are rewritten into omp's `<directives>`/`<procedure>`/`<critical>`
structure with strong tool mandates, and each `tools:` whitelist is widened to grant every tool the body names
(`lint-agents.ts` enforces body↔tools consistency).

**Tech Stack:** Bun + TypeScript; `bun test` (bun:test); markdown agent prompts; omp extension API.

**Spec:** `docs/specs/omp-tool-discipline-and-orchestrator-conduct.md` (read it first).

**Reference (omp official style, read before Phase C):**
`~/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent/src/prompts/agents/{explore,oracle,plan,reviewer,librarian,designer}.md`

---

## File Structure

| File | Responsibility | Prong |
|---|---|---|
| `scripts/pi-oven-setup/config-yml.ts` | +`TOOL_ENABLEMENT` SoT + `setToolEnablementConfig()` | A |
| `scripts/pi-oven-setup/apply.ts` | call `setToolEnablementConfig` on global-scope user setup | A |
| `tests/scripts/pi-oven-setup/config-yml.test.ts` | tool-enablement writer unit tests | A |
| `tests/scripts/pi-oven-setup/apply.test.ts` | apply calls it on global, NOT project | A |
| `.omp/extensions/pi-oven-runtime/rules-injector.ts` | +conduct block + dedup key + autonomous variant | B |
| `.omp/extensions/pi-oven-runtime/skill-keyword-loader.ts` | stronger matched-skill prompt + broadened matching | B |
| `.omp/extensions/pi-oven.ts` | parent-only conduct injection w/ autonomousActive | B |
| `tests/extensions/pi-oven-runtime/rules-injector.test.ts` | ADD cases: conduct block content + carve-out + dedup | B |
| `tests/extensions/pi-oven-runtime/skill-keyword-loader.test.ts` | ADD cases: broadened matching + stronger wording | B |
| `tests/extensions/pi-oven.test.ts` | ADD cases: parent-only injection wiring | B |
| `scripts/pi-oven-setup/profiles.ts` | tools/blocked_tools SoT — edit the 8 delta roles IDENTICALLY across PROFILE_A/B/C/D | C |
| `tests/scripts/pi-oven-setup/profiles.test.ts` | C/D===A tools equality stays green; ADD a PROFILE_B===A tools/blocked_tools guard | C |
| `agents/pi-oven-*.md` (24) | omp-style body rewrite + `tools:` deltas | C |
| `skills/{systematic-debugging,html-research-orchestrator,deep-dive,codebase-survey}/SKILL.md` | name omp tools | C |
| `CLAUDE.md`, `README.md`, `commands/setup.md` | doc the conventions + bump on release | D |

Commits: one semantic commit per prong-phase (no "Task N" markers). `git push` only with explicit user consent.

---

## Phase A — Prong 2: setup enables gated tools

### Task A1: `TOOL_ENABLEMENT` SoT + `setToolEnablementConfig`

**Files:**
- Modify: `scripts/pi-oven-setup/config-yml.ts`
- Test: `tests/scripts/pi-oven-setup/config-yml.test.ts`

- [ ] **Step 1: Write the failing test** (append to config-yml.test.ts)

```ts
import { setToolEnablementConfig, TOOL_ENABLEMENT } from "../../../scripts/pi-oven-setup/config-yml";

describe("setToolEnablementConfig", () => {
  it("writes every TOOL_ENABLEMENT flag via `omp config set <key> <value>`", async () => {
    const calls: string[][] = [];
    const spawnFn = (_cmd: string, args: string[]) => {
      calls.push(args);
      return { exitCode: 0, stdout: Buffer.from(""), stderr: Buffer.from("") };
    };
    await setToolEnablementConfig({ spawnFn });
    // one `config set <key> true` per enablement key
    for (const [key, val] of Object.entries(TOOL_ENABLEMENT)) {
      expect(calls).toContainEqual(["config", "set", key, String(val)]);
    }
    expect(TOOL_ENABLEMENT["inspect_image.enabled"]).toBe(true);
    expect(Object.keys(TOOL_ENABLEMENT)).toEqual([
      "inspect_image.enabled", "web_search.enabled", "lsp.enabled",
      "astGrep.enabled", "browser.enabled", "debug.enabled",
    ]);
  });

  it("throws (including stderr) on a non-zero set exit", async () => {
    const spawnFn = () => ({ exitCode: 1, stdout: Buffer.from(""), stderr: Buffer.from("boom") });
    await expect(setToolEnablementConfig({ spawnFn })).rejects.toThrow(/boom/);
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `bun test tests/scripts/pi-oven-setup/config-yml.test.ts -t setToolEnablementConfig`
Expected: FAIL (`setToolEnablementConfig`/`TOOL_ENABLEMENT` not exported).

- [ ] **Step 3: Implement** (in config-yml.ts, mirror `setMemoryAndAsyncConfig`'s scalar-write pattern)

```ts
/**
 * Tool-enablement flags written on global-scope setup so the agents' tool
 * mandates are not toothless. inspect_image defaults FALSE in omp (blocks vision
 * agents); the rest default true but are written defensively so a user toggle
 * can't silently neuter a mandated tool. Scalar keys → individual `omp config
 * set <dotted.key> <value>` (no read-merge needed; not record-typed).
 */
export const TOOL_ENABLEMENT: Record<string, boolean> = {
  "inspect_image.enabled": true,
  "web_search.enabled": true,
  "lsp.enabled": true,
  "astGrep.enabled": true,
  "browser.enabled": true,
  "debug.enabled": true,
};

export async function setToolEnablementConfig(opts?: ConfigYmlOpts): Promise<void> {
  const spawn = opts?.spawnFn ?? defaultSpawn;
  for (const [key, value] of Object.entries(TOOL_ENABLEMENT)) {
    const r = spawn("omp", ["config", "set", key, String(value)]);
    if (r.exitCode !== 0) {
      throw new Error(
        `setToolEnablementConfig: omp config set ${key} failed (exit ${String(r.exitCode)}): ${r.stderr?.toString() ?? ""}`
      );
    }
  }
}
```

- [ ] **Step 4: Run, verify pass.** `bun test tests/scripts/pi-oven-setup/config-yml.test.ts -t setToolEnablementConfig` → PASS.

### Task A2: call it from apply on global scope only

**Files:**
- Modify: `scripts/pi-oven-setup/apply.ts`
- Test: `tests/scripts/pi-oven-setup/apply.test.ts`

- [ ] **Step 1: Write the failing test** — extend apply.test.ts: under `scope:"global"` (or default), the recorded
  spawn calls include `["config","set","inspect_image.enabled","true"]`; under `scope:"project"` they do NOT
  (project scope writes routing files only, never `omp config set`).

```ts
it("global scope enables tools (inspect_image etc); project scope does not", async () => {
  const calls: string[][] = [];
  const spawnFn = (_c: string, a: string[]) => { calls.push(a);
    if (a[0]==="config"&&a[1]==="get") return { exitCode:0, stdout:Buffer.from(JSON.stringify({key:a[2],value:{},type:"record"})) };
    return { exitCode:0, stdout:Buffer.from("") }; };
  await runApply({ profile:"A", validateMode:"none", spawnFn });          // global default
  expect(calls).toContainEqual(["config","set","inspect_image.enabled","true"]);

  const cwd = makeTempDir(); const calls2:string[][]=[];
  const spawnFn2 = (_c:string,a:string[])=>{calls2.push(a); return {exitCode:0,stdout:Buffer.from("")};};
  await runApply({ profile:"A", validateMode:"none", scope:"project", cwd, spawnFn: spawnFn2 });
  expect(calls2.some(a=>a[0]==="config"&&a[1]==="set")).toBe(false);
});
```

- [ ] **Step 2: Run, verify it fails.** `bun test tests/scripts/pi-oven-setup/apply.test.ts -t "enables tools"` → FAIL.

- [ ] **Step 3: Implement** — in `apply.ts`, in the user-setup GLOBAL branch (the `else`/`scope!=="project"`
  path, alongside `setMemoryAndAsyncConfig`), add `await setToolEnablementConfig({ spawnFn: opts.spawnFn });` and
  append a line to the output: `✓ tools enabled: inspect_image, web_search, lsp, ast_grep, browser, debug`. Do
  NOT call it in the project branch. Import `setToolEnablementConfig` from `./config-yml`.
  **`--reset --full` LEAVES the tool-enablement flags** — they are omp infrastructure; a user who has
  `inspect_image.enabled=true` should not lose vision on a pi-oven reset. Document this decision in
  `commands/setup.md` (Phase D).

- [ ] **Step 4: Run, verify pass.** Then `bun test tests/scripts/pi-oven-setup/` → all green. The apply test
  MUST also assert the output line: `expect(output).toContain("✓ tools enabled:")`.

- [ ] **Step 5: Commit** — `feat(setup): enable omp gated tools (inspect_image et al) on global setup`

---

## Phase B — Prong 3: orchestrator conduct protocol

### Task B1: conduct block in RulesInjector

**Files:**
- Modify: `.omp/extensions/pi-oven-runtime/rules-injector.ts`
- Test: ADD cases to EXISTING `tests/extensions/pi-oven-runtime/rules-injector.test.ts`
  (import path: `../../../.omp/extensions/pi-oven-runtime/rules-injector` — 3-level depth)

- [ ] **Step 1: Write the failing test** (append to the existing file)

```ts
import { RulesInjector, ORCHESTRATOR_CONDUCT_DEDUP_KEY } from "../../../.omp/extensions/pi-oven-runtime/rules-injector";

describe("orchestrator conduct block", () => {
  it("interactive: contains SKILL-FIRST + WAIT-FOR-USER + dedup marker", () => {
    const inj = new RulesInjector();
    const b = inj.buildOrchestratorConductBlock({ autonomousActive: false });
    expect(b).toContain(ORCHESTRATOR_CONDUCT_DEDUP_KEY);
    expect(b).toMatch(/SKILL-FIRST/);
    expect(b).toMatch(/WAIT FOR THE USER|wait for the user/i);
    expect(b).toMatch(/skill:\/\//);
  });
  it("autonomous: relaxes WAIT and points to the boundary contract", () => {
    const inj = new RulesInjector();
    const b = inj.buildOrchestratorConductBlock({ autonomousActive: true });
    expect(b).toMatch(/autonomous/i);
    expect(b).toMatch(/boundary contract|keep going/i);
  });
});
```

- [ ] **Step 2: Run, verify fail.** `bun test tests/extensions/pi-oven-runtime/rules-injector.test.ts` → FAIL.

- [ ] **Step 3: Implement** in rules-injector.ts:

```ts
export const ORCHESTRATOR_CONDUCT_DEDUP_KEY = "pi-oven:orchestrator-conduct@v1";

buildOrchestratorConductBlock(opts: { autonomousActive: boolean }): string {
  const head = [
    `<!-- ${ORCHESTRATOR_CONDUCT_DEDUP_KEY} -->`,
    "## pi-oven orchestrator conduct (READ FIRST — hard rules)",
    "",
  ];
  if (opts.autonomousActive) {
    return [
      ...head,
      "Autonomous mode is ACTIVE. The autonomous boundary contract governs:",
      "1. SKILL-FIRST. Before substantive action, if the request matches a pi-oven skill, you MUST `read(\"skill://<name>\")` and follow it first.",
      "2. KEEP GOING per the boundary contract. Do NOT stall waiting for user input; do not emit a polite stop.",
    ].join("\n");
  }
  return [
    ...head,
    "1. SKILL-FIRST. Before ANY substantive action, decide if the request matches a pi-oven skill (the runtime keyword whitelist AND your judgment). If it does, you MUST `read(\"skill://<name>\")` and follow it BEFORE acting. Never start skill-governed work without loading the skill.",
    "2. WAIT FOR THE USER. When you ask the user anything or present options (e.g. AskUserQuestion), STOP and wait for their reply. NEVER begin executing until the user answers. A pending question is a hard stop.",
    "3. ASK WHEN AMBIGUOUS. If the request is ambiguous or the decision is the user's, ask first — do not assume a default and run.",
  ].join("\n");
}
```

- [ ] **Step 4: Run, verify pass.**

### Task B2: parent-only injection wired in the extension

**Files:**
- Modify: `.omp/extensions/pi-oven.ts`
- Test: ADD cases to EXISTING `tests/extensions/pi-oven.test.ts`
  (import path: `../../.omp/extensions/pi-oven` — 2-level depth, correct as-is)

- [ ] **Step 1: Write the failing test** — factor a tiny pure helper `applyOrchestratorConduct(systemPrompt: string[], injector, { isParentSession, autonomousActive }): string[]` exported from pi-oven.ts; test that it inserts the block once for parent (dedup on re-apply), nothing when `isParentSession=false`, and that the conduct block is FIRST in the output array.

```ts
import { applyOrchestratorConduct } from "../../.omp/extensions/pi-oven";
import { RulesInjector, ORCHESTRATOR_CONDUCT_DEDUP_KEY } from "../../.omp/extensions/pi-oven-runtime/rules-injector";
it("injects conduct for parent only, deduped, placed first", () => {
  const inj = new RulesInjector();
  const out = applyOrchestratorConduct([], inj, { isParentSession: true, autonomousActive: false });
  expect(out.some(s => s.includes(ORCHESTRATOR_CONDUCT_DEDUP_KEY))).toBe(true);
  // conduct block must be FIRST (unshifted into the post-applyToSystemPrompt array)
  expect(out[0].includes(ORCHESTRATOR_CONDUCT_DEDUP_KEY)).toBe(true);
  const twice = applyOrchestratorConduct(out, inj, { isParentSession: true, autonomousActive: false });
  expect(twice.filter(s => s.includes(ORCHESTRATOR_CONDUCT_DEDUP_KEY)).length).toBe(1);
  const sub = applyOrchestratorConduct([], inj, { isParentSession: false, autonomousActive: false });
  expect(sub.some(s => s.includes(ORCHESTRATOR_CONDUCT_DEDUP_KEY))).toBe(false);
});
```

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement** — export `applyOrchestratorConduct` in pi-oven.ts; in `before_agent_start`, after
  `injector.applyToSystemPrompt(...)`, for the parent branch call it with `autonomousActive` derived from the
  SAME value the extension already computes for `needsAutonomousReminder` (pi-oven.ts:453-455) — reuse that one
  boolean for BOTH the reminder and the conduct block; do not introduce a second/different definition. **HOIST** the
  `needsAutonomousReminder` computation above line ~439 (the outer scope of the `before_agent_start` handler) so
  the same `const` is in scope for BOTH the reminder block (the first `if(isParentSession)`, ~439-469) and the
  conduct injection (after ~471) — it is currently declared inside the first block and is out of scope at the
  injection point; failing to hoist forces a re-declaration (re-introducing the cycle-1 #7 double-definition). Insert the
  conduct block at the FRONT of the parent system prompt array (unshift) so it reads first; `applyToSystemPrompt`
  appends (rules-injector.ts:215/222/230), so the conduct block must be unshifted into the
  post-applyToSystemPrompt array.

- [ ] **Step 4: Run, verify pass.**

### Task B3: stronger + broader keyword skill matching

**Files:**
- Modify: `.omp/extensions/pi-oven-runtime/skill-keyword-loader.ts`
- Test: ADD cases to EXISTING `tests/extensions/pi-oven-runtime/skill-keyword-loader.test.ts`
  (import path: `../../../.omp/extensions/pi-oven-runtime/skill-keyword-loader` — 3-level depth)

- [ ] **Step 1: Write failing tests** — (a) `buildKeywordMatchedSkillsPrompt` output contains a hard-precondition
  phrase ("hard precondition", not merely "MUST load"); (b) `matchSkillsForText` now matches ≥1 added common
  phrasing per targeted skill (add the specific new keywords you introduce — list them in the test so the test
  IS the spec for the broadened set).

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement** — strengthen the prompt wording; broaden the curated keyword index entries for the
  skills the user actually triggers (debugging, research, spec, plan, tdd, commit). Keep the dedup marker.

- [ ] **Step 4: Run, verify pass.**

- [ ] **Step 5: Build + commit** — `bun run build`; `feat(extension): standing orchestrator conduct + stronger skill-keyword enforcement`

---

## Phase C — Prong 1: rewrite all 24 agents in omp style

**Canonical body template** (adapt per role; keep the role's existing mission + scope boundaries + any
report_finding/memory contract):

```markdown
## Role
You are pi-oven:<role>. <one-line mission, carried over from the current body>.

You are responsible for: <carry over verbatim from current body>.
You are NOT responsible for: <carry over verbatim>.

<directives>
- <MUST/SHOULD/NEVER tool mandates for this role-class — see matrix>
- You SHOULD invoke tools in parallel for independent reads/searches.
- If a search returns empty, you MUST try ≥1 alternate strategy (alt pattern, broader path, ast_grep) before concluding absence.
</directives>

<procedure>
1. <numbered steps that NAME the tools to use at each step>
...
</procedure>

<critical>
- <role-specific hard rule(s) carried over>
- You MUST keep going until the task is complete.
</critical>
```

**Role-class tool mandate text** (insert the matching block into `<directives>`):

- *Code/debug:* "You MUST use `lsp` (diagnostics, goto-def, find-refs) and `ast_grep` (structural search) over
  plain reading/`search` when navigating or auditing code. You MUST use `eval` to reproduce/compute/inspect
  runtime behavior and `bash` to run the failing build/tests. You NEVER speculate about code behavior — read it
  or run it." (+ debugging-first roles: "Use `debug` for runtime stepping/breakpoints when a bug needs live
  inspection.")
- *Research/web:* "For any external/library/API/framework/doc question you MUST use `web_search` (and read
  source where available). You NEVER answer from training data — source is truth, training data is history. If a
  lookup is empty, try ≥2 fallbacks (broader query, alternate source) and fall back to `web_search` for official
  docs before reporting failure."
- *Vision:* "You MUST use `inspect_image` to actually view any screenshot/image before describing or judging it —
  never infer from filenames or paths." (qa-tester: "Use `browser` for live UI checks.")

**Per-agent matrix — authoritative `tools:` deltas (the ONLY 8 roles that change).** `blocked_tools` unchanged
for all roles. Additions are appended to the current tools listed; all 4 profiles must receive the same edit.

| Agent | omp twin | Current `tools:` | `tools:` additions | keep |
|---|---|---|---|---|
| tracer | (debug register) | read,search,find,bash | +lsp,ast_grep,eval,debug | competing hypotheses, evidence |
| analyst | oracle | read,search,find,bash,eval,recall | +lsp,ast_grep | data/requirements analysis |
| critic | reviewer | read,search,find,report_finding,recall | +web_search | plan/code critique, severity — **bash BLOCKED** |
| verifier | reviewer | read,search,find,bash,recall,task,report_finding | +lsp | evidence-based completion, report_finding |
| security-reviewer | reviewer | read,search,find,bash,recall,web_search | +lsp,ast_grep | OWASP/secrets focus |
| planner | plan | read,search,find,bash,recall,task | +lsp,ast_grep,web_search | plan structure, spawn explorer |
| architect | plan/oracle | read,search,find,bash,lsp,ast_grep,recall,retain | +web_search | tradeoffs, read-only |
| oracle | oracle | read,search,find,bash,recall,retain | +lsp,ast_grep,web_search | consult/delegate dual mode |
| **other 16** | — | no change | — | executor/debugger/test-engineer/designer/code-simplifier/qa-tester (`["*"]`); explorer/code-reviewer/librarian/document-specialist/writer/deep-researcher/multimodal-looker/data-runner/git-master/metis (already sufficient) |

**Critic / read-only special case.** critic has `bash` in `blocked_tools`. Its rewritten body MUST NOT mandate
`bash` ("run the failing build/tests" etc). **General rule: a body must never mandate a tool that appears in that
role's `blocked_tools`.**

**Identity-preservation requirement.** Each rewrite MUST carry over the role's existing scope boundaries ("You
are responsible for / NOT responsible for") and any `report_finding`/structured-output contract verbatim. The
Phase E per-batch critic review is the ONLY automated guard against identity loss across the 24 files — it must
check that no scope boundary or output contract was dropped.

**Model-fit:** kimi/minimax/glm-backed agents → shorter, blunter numbered imperatives; gpt-5.4/opus → denser.
Content identical; phrasing density per backing model (see CLAUDE.md PROFILE_A map).

### Tasks C1–C24: rewrite each agent (batch by role-class; one commit per batch)

For EACH agent:
- [ ] For **delta roles** (the 8 above): edit `tools` IDENTICALLY in `PROFILE_A`, `PROFILE_B`, `PROFILE_C`, and
  `PROFILE_D` in `scripts/pi-oven-setup/profiles.ts`. Leave `blocked_tools` unchanged in all profiles.
- [ ] Edit the agent file `tools:` frontmatter to match the new `PROFILE_A` value.
- [ ] Rewrite the body into the template, carrying over mission + "responsible/NOT responsible" + any
  `report_finding`/memory contract; insert the role-class tool mandate; write a tool-named `<procedure>`.
  For non-delta roles: body rewrite only (no `tools:` or profiles.ts change).
- [ ] Run `bun run lint:agents` — MUST pass (tools == profiles + body↔tools consistency; model frontmatter
  unchanged).
- [ ] Run `bun test` — green (includes profiles.test.ts C/D===A equality checks).

**Before C-batch1**, add a `describe("PROFILE_B")` block to `tests/scripts/pi-oven-setup/profiles.test.ts` mirroring
the existing C/D suites — `it("tools per role matches PROFILE_A verbatim")` (`expect(PROFILE_B[role].tools).toEqual(PROFILE_A[role].tools)`)
and the `blocked_tools` twin — so the identical-edit invariant is ENFORCED for all four profiles (today PROFILE_B
has no automated guard: lint references only PROFILE_A, and profiles.test pins only C/D; a forgotten PROFILE_B edit
would silently leave `--profile B` users with the old narrow tools). Run it RED first (it passes now since B===A at
baseline — so instead assert it stays green after the delta edits; the value is catching a future B-omission).

**Batches (commit after each):** C-batch1 code/debug (debugger,tracer,executor,test-engineer,analyst,data-runner);
C-batch2 review (code-reviewer,critic,verifier,security-reviewer); C-batch3 plan/think
(architect,planner,oracle,metis); C-batch4 research/write
(explorer,deep-researcher,document-specialist,librarian,writer); C-batch5 craft+vision
(designer,code-simplifier,git-master,multimodal-looker,qa-tester).
Commit msg per batch e.g. `refactor(agents): omp-style tool discipline — <class> agents`.

---

## Phase D — skills + docs (light)

- [ ] `skills/systematic-debugging/SKILL.md` — name `lsp`/`ast_grep`/`eval`/`debug`/`bash` at the right steps
  (English-only body).
- [ ] `skills/html-research-orchestrator/SKILL.md` + `skills/deep-dive/SKILL.md` — name `web_search` ("source is
  truth, not training data").
- [ ] `skills/codebase-survey/SKILL.md` — name `lsp`/`ast_grep` for navigation.
- [ ] `bun run lint:skills` green.
- [ ] `CLAUDE.md` — add a short "Tool discipline + orchestrator conduct" note (convention + the Prong-2
  enablement keys + the parent conduct block). Update Status line on release.
- [ ] `commands/setup.md` — document: (a) global setup re-enables all 6 tool flags every run (no opt-out; this
  is intentional so a user toggle cannot silently neuter a mandated tool); (b) `--reset --full` LEAVES the tool
  flags (omp infra, not pi-oven routing); (c) project-scope-only users (those who never ran global setup) keep
  `inspect_image.enabled=false` — vision agents are toothless for them; vision requires a global-scope setup run.
- [ ] Commit `docs: tool-discipline + orchestrator-conduct conventions`.

---

## Phase E — full verification (approved)

- [ ] `bun run check` · `bun run lint:agents` · `bun run lint:skills` · `bun test` (all pass) · `bun run build`.
- [ ] Adversarial critic review of the whole diff vs the spec.
- [ ] **Live omp smoke:** throwaway project → `bun .../pi-oven-setup.ts --profile A --validate none` (global) →
  `omp config get inspect_image.enabled` etc. return `true`; spawn a pi-oven subagent (or dump the built system
  prompt) and confirm the tool-discipline text + the parent orchestrator-conduct block are present; confirm the
  conduct block relaxes under autonomous mode.
- [ ] Report. NO commit/push of release without explicit user consent (prior project-scoped-routing changes
  remain uncommitted + separate).

---

## Self-review (done at write time)

- Spec coverage: Prong 1→Phase C (all 24 + matrix), Prong 2→Phase A, Prong 3→Phase B; skills/docs→Phase D;
  verification→Phase E. ✓
- Placeholders: per-agent bodies are template+matrix-driven (content, not code) — the omp twins + role-class
  mandate text + tool deltas are concrete; "assess; +X if body names" entries are deliberate per-role judgment
  with lint as the safety net. ✓
- Type/name consistency: `setToolEnablementConfig`/`TOOL_ENABLEMENT`, `ORCHESTRATOR_CONDUCT_DEDUP_KEY`,
  `buildOrchestratorConductBlock({autonomousActive})`, `applyOrchestratorConduct(systemPrompt, injector, opts)`
  used consistently across tasks. ✓
