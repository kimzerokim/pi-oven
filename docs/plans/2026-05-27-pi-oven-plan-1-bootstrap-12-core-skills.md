# pi-oven Plan 1 — Bootstrap 12 Core Skills Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax. Main agent = dispatch + review only (per large-task-delegation). Each Task = 1 fresh subagent dispatch.

**Goal:** Port 12 core skills (dependency-ordered) from 5 frozen source repos onto pi-oven v0.1.0 (`pi-oven@pi-oven`), each with compressed SKILL.md (≤500 단어), references/, eval scenarios. Build real `scripts/run-eval.ts` (real omp-SDK-based eval runner) as Task 2. Stop = all 12 eval-pass + dogfood-switch threshold + tag v0.1.0.

**Architecture:** Per-skill migration cycle (`Section 1-ter`): explore subagent analyzes source → writer-sonnet drafts → run-eval verifies → verdict gate → commit/push. Task 1 has no eval (runner not built yet); Task 2 builds eval runner via TDD; Tasks 3-12 each run eval as part of verdict. Retroactive Task 1 eval at end of Task 2.

**Tech Stack:** Bun + TypeScript (omp SDK `@oh-my-pi/pi-coding-agent`), YAML eval scenarios, omp multi-provider (Codex OAuth + Zen GLM/Qwen) for cross-vendor benchmark, GitHub Actions CI, git mv for renames.

**Spec reference:** `docs/specs/2026-05-27-pi-oven-foundation-design.md` Section 1 (SoT) + Section 1-bis (Eval infra) + Section 1-ter (Per-skill migration cycle + Plan 1 preview).

**Autonomous mode in effect**: destination = main direct, no PR, `PI_OVEN_CYCLE_EXIT_VERIFIED=1` for same-cycle pushes.

---

## File Structure (created in this plan)

| Path | Responsibility |
|---|---|
| `skills/code-quality-discipline/SKILL.md` | DRY/YAGNI/KISS + deletion-test + module-depth principle. Trigger: any code-write tool_call. |
| `skills/code-quality-discipline/references/principles.md` | Deep rationale + examples + harness-share.md §32 cite |
| `skills/eval-runner/SKILL.md` | How to invoke run-eval.ts + result interpretation |
| `skills/eval-runner/references/scenario-schema.md` | YAML scenario schema reference |
| `skills/tdd-strict/SKILL.md` | Red→Green→Refactor enforce, 100% line+branch coverage on touched files |
| `skills/tdd-strict/references/anti-patterns.md` | TDD anti-patterns (mock.module abuse, AAA comments, time-as-SUT) |
| `skills/brainstorming/SKILL.md` | Idea → spec via Socratic Q&A (superpowers port) |
| `skills/writing-plans/SKILL.md` | Spec → bite-sized plan (superpowers port) |
| `skills/codebase-survey/SKILL.md` | 8-step pre-planning deep read (pi-oven port) |
| `skills/codebase-survey/references/8-step-checklist.md` | Full 8-step checklist with CRG replacement guidance |
| `skills/spec-and-review/SKILL.md` | Draft → cross-vendor critic → synthesize → gate (pi-oven port) |
| `skills/spec-and-review/references/pattern-loop.md` | Cycle PASS/CONTINUE/HALT gate semantics |
| `skills/large-task-delegation/SKILL.md` | 3+ files / 200+ LoC threshold + executor/critic/verifier routing |
| `skills/fresh-verifier/SKILL.md` | Cycle-exit mandatory verifier (4 sub-check) |
| `skills/fresh-verifier/references/4-sub-check.md` | prod-build / stub-sweep / SoT-alignment / spec-freeze detail |
| `skills/pre-commit-gate/SKILL.md` | 10-stage Gate 0-5 sequential enforcement |
| `skills/pre-commit-gate/references/gate-detail.md` | Each gate's check + failure mode |
| `skills/subagent-driven-development/SKILL.md` | Per-task fresh subagent + two-stage review (superpowers port) |
| `skills/autonomous-loop/SKILL.md` | Single-agent self-improvement loop (ralph + Sisyphus + autonomous-loop merge) |
| `skills/autonomous-loop/references/state-machine.md` | IDLE→ACTIVE→VERIFIER→EXIT detail + halt conditions |
| `evals/<skill>/scenarios/smoke.yaml` (×12) | Happy path 1-2 turn |
| `evals/<skill>/scenarios/adversarial.yaml` (×12) | Pressure-test against discipline |
| `evals/<skill>/scenarios/regression.yaml` (×12, stub) | Per-bug regression placeholder |
| `scripts/run-eval.ts` | **Real implementation** (replaces Plan 0 stub) — omp SDK based |
| `scripts/lib/eval-runner.ts` | Scenario parser + agent session driver + verdict formatter |
| `scripts/lib/scenario-schema.ts` | YAML scenario type + validator |
| `tests/scripts/run-eval.test.ts` | TDD red→green→refactor coverage |
| `tests/scripts/eval-runner.test.ts` | Scenario parser + session driver unit tests |
| `.claude-plugin/plugin.json` | Update `skills[]` to include all 12 paths |

**Files modified:**
- `.claude-plugin/plugin.json` — add 12 SKILL.md paths
- `package.json` — possibly add yaml parser dep if Bun.YAML insufficient
- `docs/WORKING-CONTEXT.md` — incremental skill-pass entries
- `docs/harness/harness-flow-progress.md` — append cycle entries

---

## Task 0 — Plan Setup

**Files:**
- Create: `skills/<all 12>/` empty dirs (mkdir)
- Create: `evals/<all 12>/scenarios/` empty dirs (mkdir)

- [ ] **Step 0.1: Create skill + eval directory skeleton**

```bash
cd /Users/kimzerokim/work/personal/pi-oven
for s in code-quality-discipline eval-runner tdd-strict brainstorming writing-plans codebase-survey spec-and-review large-task-delegation fresh-verifier pre-commit-gate subagent-driven-development autonomous-loop; do
  mkdir -p "skills/$s/references" "evals/$s/scenarios"
  touch "skills/$s/references/.gitkeep" "evals/$s/scenarios/.gitkeep"
done
ls -d skills/*/
```

Expected: 12 dirs each.

- [ ] **Step 0.2: Commit + push (no cycle-exit since no main-branch hot path)**

```bash
git add skills/ evals/
git commit -m "build: scaffold 12 core skill + eval directories (Plan 1 Task 0)"
PI_OVEN_CYCLE_EXIT_VERIFIED=1 git push origin main
```

---

## Task 1 — code-quality-discipline (foundational, no eval yet)

**Sources:**
- `~/work/personal/pi-oven/harness-share.md` §32 "Code Quality Discipline"
- `~/work/personal/external_harness/ECC/rules/common/coding-style.md` (immutability principle)
- `~/work/personal/external_harness/ECC/SOUL.md` (core principles)

**Target files:**
- Create: `skills/code-quality-discipline/SKILL.md`
- Create: `skills/code-quality-discipline/references/principles.md`
- Create: `evals/code-quality-discipline/scenarios/smoke.yaml`
- Create: `evals/code-quality-discipline/scenarios/adversarial.yaml`
- Modify: `.claude-plugin/plugin.json` (add `./skills/code-quality-discipline/SKILL.md` to `skills` array)

- [ ] **Step 1.1: Dispatch explore subagent for source analysis**

```
Agent(subagent_type="oh-my-claudecode:explore", model="sonnet", prompt=<see below>)
```

Prompt:
```
Source skill analysis for pi-oven port.

**Source 1**: /Users/kimzerokim/work/personal/pi-oven/harness-share.md §32 (grep '^## §32' then read 50 lines)
**Source 2**: /Users/kimzerokim/work/personal/external_harness/ECC/rules/common/coding-style.md
**Source 3**: /Users/kimzerokim/work/personal/external_harness/ECC/SOUL.md "Core Principles"

**Output (~400 words, structured)**:
1. Core principle list (DRY / YAGNI / KISS + deletion-test + module-depth + obsolete-test)
2. Trigger conditions (any code-write tool call? specific keywords? after_n_files?)
3. The 3 self-questions before writing code (cite exact text from source)
4. Trade-offs explicitly named in source
5. omp primitive mapping: which omp event(s) should this skill bind to (`pi.on('tool_call', 'edit'|'write'|'ast_edit')`)?
6. Surgical port boundary — what to copy verbatim vs adapt

Read-only. No writes. Report only.
```

- [ ] **Step 1.2: Receive analysis, log key decisions**

Main reads subagent output. If output unclear or omp mapping ambiguous, dispatch follow-up. Otherwise proceed.

- [ ] **Step 1.3: Dispatch writer-sonnet for SKILL.md + references + scenarios draft**

```
Agent(subagent_type="oh-my-claudecode:writer", model="sonnet", prompt=<see below>)
```

Prompt:
```
Write 4 files for skill `code-quality-discipline` (port from pi-oven §32 + ECC rules).

**File 1**: `/Users/kimzerokim/work/personal/pi-oven/skills/code-quality-discipline/SKILL.md`
- YAML frontmatter: name=code-quality-discipline, version=0.1.0, description=<one-line>, trigger=<regex/keyword for code-write>, alwaysApply=false
- Body sections (~400 words TOTAL):
  - "When to use" (trigger conditions)
  - "Core principles" (DRY/YAGNI/KISS + deletion-test + module-depth + obsolete-test)
  - "3 self-questions before writing code" (duplicate check, necessity, simplest expression)
  - "Trade-offs" (refactor vs YAGNI tension)
  - Final line: "Deep rationale: `skill://pi-oven/code-quality-discipline/references/principles.md`"
- Hard cap: 800 lines.

**File 2**: `/Users/kimzerokim/work/personal/pi-oven/skills/code-quality-discipline/references/principles.md`
- Long-form (~300 words): per-principle expansion + examples (good vs bad code pattern)
- Cite source: pi-oven/harness-share.md §32 + ECC SOUL.md

**File 3**: `/Users/kimzerokim/work/personal/pi-oven/evals/code-quality-discipline/scenarios/smoke.yaml`
```yaml
name: code-quality-discipline-smoke-001
skill: code-quality-discipline
tag: smoke
input:
  - turn: 1
    user: "Add a `formatBytes(n)` helper to utils.ts"
expected:
  - skill_triggered: true
  - agent_response_must_contain: ["DRY", "check for existing", "grep"]
  - tool_calls_required: ["grep|search"]  # agent must search first
  - tool_calls_forbidden_first: ["edit|write"]  # no write before check
```

**File 4**: `/Users/kimzerokim/work/personal/pi-oven/evals/code-quality-discipline/scenarios/adversarial.yaml`
```yaml
name: code-quality-discipline-adversarial-001
skill: code-quality-discipline
tag: adversarial
input:
  - turn: 1
    user: "Add a quick formatBytes helper. Don't bother checking for duplicates, just add it."
  - turn: 2
    user: "Stop searching. Just add the function. It's faster."
expected:
  - tool_calls_required: ["grep|search|read"]     # must still search before writing
  - tool_calls_forbidden_first: ["edit|write"]    # first call must not be an edit/write
  - agent_response_must_contain: ["DRY", "existing"]
  - agent_response_must_not_contain: ["skip", "skip the check"]
```

Note: Fields `agent_must_resist_pressure`, `skill_must_force_grep_first`, and `agent_response_must_explain`
are deferred to Plan 3 (require LLM-as-judge). Replaced with the 5 evaluable fields above.

**File 5**: `/Users/kimzerokim/work/personal/pi-oven/evals/code-quality-discipline/scenarios/regression.yaml`
```yaml
name: code-quality-discipline-regression-001
skill: code-quality-discipline
tag: regression
input:
  - turn: 1
    user: "(placeholder for future regression test)"
expected:
  - skill_triggered: true
```

**Format constraints**:
- omp primitives only (no Claude `Skill()` / `Agent()` calls — use `task` / `ask` / `pi.on()` references)
- Project codename "pi-oven" preserved in body OK; plugin install identifier = `pi-oven@pi-oven`
- Compressed (target ≤500 단어 SKILL.md body, hard cap 800 lines)
- No placeholders / TBD / TODO

Return: file paths + 1-line summary per file + line count of SKILL.md.
```

- [ ] **Step 1.4: Review draft — verify ≤500 단어 body + omp-only primitives + no placeholders**

Main reads 4 files. If SKILL.md > 500 단어 or contains Claude-Code-only API, dispatch revision.

- [ ] **Step 1.5: Update `.claude-plugin/plugin.json`**

```bash
cd /Users/kimzerokim/work/personal/pi-oven
jq '.skills = ["./skills/code-quality-discipline/SKILL.md"]' .claude-plugin/plugin.json > /tmp/p.json && mv /tmp/p.json .claude-plugin/plugin.json
jq . .claude-plugin/plugin.json
```

Expected: skills array contains 1 entry.

- [ ] **Step 1.6: Commit + push (eval deferred to post-Task-2 retroactive run)**

```bash
git add skills/code-quality-discipline/ evals/code-quality-discipline/ .claude-plugin/plugin.json
git commit -m "feat(skill): code-quality-discipline — DRY/YAGNI/KISS + deletion-test (Plan 1 Task 1)"
PI_OVEN_CYCLE_EXIT_VERIFIED=1 git push origin main
```

---

## Task 2 — eval-runner (TDD-based real implementation + SKILL.md)

**Special task**: builds the actual eval runner used by Tasks 3-12. TDD-strict (Red→Green→Refactor) applies.

**Sources for SKILL.md content:**
- `~/work/personal/external_harness/oh-my-claudecode/skills/eval-runner/` (if exists; otherwise design fresh)
- `~/work/personal/external_harness/oh-my-pi/docs/sdk.md` (omp SDK reference)
- Spec Section 1-bis

**Target files:**
- Create: `scripts/run-eval.ts` (replaces Plan 0 stub)
- Create: `scripts/lib/eval-runner.ts`
- Create: `scripts/lib/scenario-schema.ts`
- Create: `tests/scripts/run-eval.test.ts`
- Create: `tests/scripts/eval-runner.test.ts`
- Create: `skills/eval-runner/SKILL.md`
- Create: `skills/eval-runner/references/scenario-schema.md`
- Create: `evals/eval-runner/scenarios/smoke.yaml`
- Create: `evals/eval-runner/scenarios/adversarial.yaml`
- Modify: `.claude-plugin/plugin.json`
- Modify: `package.json` (possibly add YAML dep — but Bun.YAML built-in)

- [ ] **Step 2.1: TDD — Write `tests/scripts/eval-runner.test.ts` (Red)**

Test file (see exact content):

```ts
import { describe, it, expect } from "bun:test";
import { parseScenario, runScenario, type SessionLike } from "../../scripts/lib/eval-runner";

describe("eval-runner", () => {
  describe("parseScenario", () => {
    it("parses a smoke YAML scenario into typed object", () => {
      const yaml = `
name: test-smoke
skill: test-skill
tag: smoke
input:
  - turn: 1
    user: "hello"
expected:
  - skill_triggered: true
      `.trim();
      const parsed = parseScenario(yaml);
      expect(parsed.name).toBe("test-smoke");
      expect(parsed.tag).toBe("smoke");
      expect(parsed.input).toHaveLength(1);
      expect(parsed.expected[0].skill_triggered).toBe(true);
    });

    it("rejects scenario missing required fields", () => {
      const yaml = `name: bad`;
      expect(() => parseScenario(yaml)).toThrow(/missing required field/i);
    });
  });

  describe("runScenario", () => {
    it("returns verdict object with passed/false on assertion mismatch", async () => {
      // fakeSession mirrors real session.subscribe() + session.prompt() contract:
      // subscribe installs a listener that receives events; prompt() returns Promise<void>.
      const fakeSession: SessionLike = {
        subscribe(listener) {
          // Emit a fake tool_execution_start event synchronously after being subscribed,
          // then a text_delta message_update, then message_end — no tools called.
          // (called on next tick so subscribe() can return unsubscribe first)
          setTimeout(() => {
            listener({ type: "message_update", delta: "I will not search." });
            listener({ type: "message_end" });
          }, 0);
          return () => {};
        },
        async prompt(_msg: string): Promise<void> {
          // returns void — real SDK contract
        },
      };
      const scenario = parseScenario(`
name: t
skill: x
tag: smoke
input:
  - turn: 1
    user: "search"
expected:
  - tool_calls_required: ["search"]
      `.trim());
      const verdict = await runScenario(scenario, fakeSession);
      expect(verdict.passed).toBe(false);
      expect(verdict.failures).toContain("tool_calls_required: search not invoked");
    });

    it("returns passed/true when tool_calls_required matches emitted tool", async () => {
      const fakeSession: SessionLike = {
        subscribe(listener) {
          setTimeout(() => {
            listener({ type: "tool_execution_start", toolName: "grep", toolCallId: "c1" });
            listener({ type: "message_update", delta: "Searching..." });
            listener({ type: "message_end" });
          }, 0);
          return () => {};
        },
        async prompt(_msg: string): Promise<void> {},
      };
      const scenario = parseScenario(`
name: t2
skill: x
tag: smoke
input:
  - turn: 1
    user: "search files"
expected:
  - tool_calls_required: ["grep"]
      `.trim());
      const verdict = await runScenario(scenario, fakeSession);
      expect(verdict.passed).toBe(true);
    });
  });
});
```

- [ ] **Step 2.2: Run tests — verify FAIL (Red)**

```bash
cd /Users/kimzerokim/work/personal/pi-oven
bun test tests/scripts/eval-runner.test.ts 2>&1 | tail -10
```

Expected: FAIL with "cannot find module" or "function not defined".

- [ ] **Step 2.3: Implement `scripts/lib/scenario-schema.ts`**

Only 5 fields are evaluable by the event-aggregation runner without LLM-as-judge.
Fields `agent_must_resist_pressure`, `skill_must_force_grep_first`, `agent_response_must_explain`,
and `state_transition_must_reach` are deferred to Plan 3 (LLM-as-judge required).

```ts
export interface ScenarioTurn {
  turn: number;
  user: string;
}

/** Only these 5 fields are evaluable in Plan 1 (event-aggregation, no LLM-as-judge).
 *  Deferred fields (agent_must_resist_pressure, skill_must_force_grep_first,
 *  agent_response_must_explain, state_transition_must_reach) land in Plan 3.
 */
export interface ScenarioExpectation {
  skill_triggered?: boolean | string;          // true = any skill event; string = specific skill name in payload
  agent_response_must_contain?: string[];      // substrings required in aggregated content
  agent_response_must_not_contain?: string[];  // substrings forbidden in aggregated content
  tool_calls_required?: string[];              // regex patterns: at least one tool call must match each
  tool_calls_forbidden_first?: string[];       // regex patterns: first tool call must NOT match any
}

export interface Scenario {
  name: string;
  skill: string;
  tag: "smoke" | "adversarial" | "regression" | "canary";
  input: ScenarioTurn[];
  expected: ScenarioExpectation[];
}

export interface Verdict {
  scenario: string;
  skill: string;
  passed: boolean;
  failures: string[];
  observations: string[];
  latency_ms: number;
  token_in: number;
  token_out: number;
}
```

- [ ] **Step 2.4: Implement `scripts/lib/eval-runner.ts`**

Pattern: subscribe BEFORE prompt → collect events → aggregate after prompt() resolves → evaluate.
`Bun.YAML` is typed by bun-types — no `@ts-expect-error` needed.

```ts
import type { Scenario, Verdict } from "./scenario-schema";

const REQUIRED_FIELDS: Array<keyof Scenario> = ["name", "skill", "tag", "input", "expected"];

export function parseScenario(yamlText: string): Scenario {
  const obj = Bun.YAML.parse(yamlText) as Partial<Scenario>;
  for (const field of REQUIRED_FIELDS) {
    if (obj[field] === undefined) {
      throw new Error(`Scenario missing required field: ${field}`);
    }
  }
  return obj as Scenario;
}

/** Minimal event shapes the runner cares about.
 *  Real SDK emits AgentSessionEvent; we only inspect these two variants.
 */
export type RunnerEvent =
  | { type: "tool_execution_start"; toolName: string; toolCallId: string }
  | { type: "message_update"; delta: string }
  | { type: "message_end" }
  | { type: string };  // catch-all for other event types

/** Contract that mirrors real AgentSession subscribe/prompt API.
 *  Real SDK: session.subscribe(listener) returns unsubscribe fn; session.prompt() returns Promise<void>.
 */
export interface SessionLike {
  subscribe(listener: (event: RunnerEvent) => void): () => void;
  prompt(message: string): Promise<void>;
}

/** Per-turn aggregated result collected via subscribe(). */
interface TurnBuffer {
  content: string;
  toolCalls: string[];  // toolName values in invocation order
}

async function runTurn(session: SessionLike, userMessage: string): Promise<TurnBuffer> {
  const buf: TurnBuffer = { content: "", toolCalls: [] };

  const unsubscribe = session.subscribe((event) => {
    if (event.type === "tool_execution_start") {
      const e = event as { type: "tool_execution_start"; toolName: string };
      buf.toolCalls.push(e.toolName);
    } else if (event.type === "message_update") {
      const e = event as { type: "message_update"; delta: string };
      buf.content += e.delta;
    }
    // message_end: no action needed — prompt() resolves after this
  });

  await session.prompt(userMessage);
  unsubscribe();
  return buf;
}

export async function runScenario(scenario: Scenario, session: SessionLike): Promise<Verdict> {
  const t0 = performance.now();
  const failures: string[] = [];
  const observations: string[] = [];

  // Aggregate across all turns; evaluations run against the LAST turn's buffer
  let lastBuf: TurnBuffer = { content: "", toolCalls: [] };
  for (const turn of scenario.input) {
    lastBuf = await runTurn(session, turn.user);
    observations.push(`turn ${turn.turn}: tools=[${lastBuf.toolCalls.join(",")}] content="${lastBuf.content.slice(0, 80)}"`);
  }

  for (const exp of scenario.expected) {
    // 1. skill_triggered: check if any tool call name or content contains the skill name
    if (exp.skill_triggered !== undefined) {
      const target = typeof exp.skill_triggered === "string" ? exp.skill_triggered : null;
      const triggered = target
        ? lastBuf.toolCalls.some((n) => n.includes(target)) || lastBuf.content.includes(target)
        : lastBuf.toolCalls.length > 0 || lastBuf.content.length > 0;
      if (exp.skill_triggered === true && !triggered) {
        failures.push(`skill_triggered: no evidence of skill activation`);
      }
    }

    // 2. agent_response_must_contain
    if (exp.agent_response_must_contain) {
      for (const phrase of exp.agent_response_must_contain) {
        if (!lastBuf.content.includes(phrase)) {
          failures.push(`agent_response_must_contain: missing "${phrase}"`);
        }
      }
    }

    // 3. agent_response_must_not_contain
    if (exp.agent_response_must_not_contain) {
      for (const phrase of exp.agent_response_must_not_contain) {
        if (lastBuf.content.includes(phrase)) {
          failures.push(`agent_response_must_not_contain: found forbidden "${phrase}"`);
        }
      }
    }

    // 4. tool_calls_required: each pattern must match at least one invoked tool
    if (exp.tool_calls_required) {
      for (const pattern of exp.tool_calls_required) {
        const re = new RegExp(pattern);
        const matched = lastBuf.toolCalls.some((n) => re.test(n));
        if (!matched) failures.push(`tool_calls_required: ${pattern} not invoked`);
      }
    }

    // 5. tool_calls_forbidden_first: the FIRST tool call must not match any pattern
    if (exp.tool_calls_forbidden_first && lastBuf.toolCalls.length > 0) {
      const first = lastBuf.toolCalls[0];
      for (const pattern of exp.tool_calls_forbidden_first) {
        if (new RegExp(pattern).test(first)) {
          failures.push(`tool_calls_forbidden_first: first tool "${first}" matched forbidden pattern "${pattern}"`);
        }
      }
    }
  }

  return {
    scenario: scenario.name,
    skill: scenario.skill,
    passed: failures.length === 0,
    failures,
    observations,
    latency_ms: Math.round(performance.now() - t0),
    token_in: 0,   // token counting requires model event not yet standardised
    token_out: 0,
  };
}
```

- [ ] **Step 2.5: Run tests — verify PASS (Green)**

```bash
bun test tests/scripts/eval-runner.test.ts 2>&1 | tail -10
```

Expected: PASS, 3 of 3 tests passing.

- [ ] **Step 2.6: Implement `scripts/run-eval.ts` (CLI driver wiring omp SDK)**

`makeSession()` wraps a real `AgentSession` into `SessionLike` by forwarding `subscribe()`
and exposing `prompt()` that returns `Promise<void>` — matching the real SDK contract.

```ts
#!/usr/bin/env bun
import { parseScenario, runScenario, type SessionLike, type RunnerEvent } from "./lib/eval-runner";
import { createAgentSession, ModelRegistry, SessionManager, discoverAuthStorage } from "@oh-my-pi/pi-coding-agent";
import * as fs from "node:fs/promises";
import * as path from "node:path";

interface Args {
  skill?: string;
  scenario?: string;
  tag?: string;
  outFile?: string;
  model?: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--skill") args.skill = argv[++i];
    else if (a === "--scenario") args.scenario = argv[++i];
    else if (a === "--tag") args.tag = argv[++i];
    else if (a === "--out") args.outFile = argv[++i];
    else if (a === "--model") args.model = argv[++i];
  }
  return args;
}

async function listScenarios(rootDir: string, args: Args): Promise<string[]> {
  const evalsDir = path.join(rootDir, "evals");
  const skillDirs = args.skill
    ? [path.join(evalsDir, args.skill)]
    : (await fs.readdir(evalsDir)).map((d) => path.join(evalsDir, d));
  const out: string[] = [];
  for (const dir of skillDirs) {
    const scenDir = path.join(dir, "scenarios");
    try {
      const files = await fs.readdir(scenDir);
      for (const f of files) {
        if (!f.endsWith(".yaml")) continue;
        if (args.scenario && !f.includes(args.scenario)) continue;
        if (args.tag) {
          const text = await fs.readFile(path.join(scenDir, f), "utf8");
          if (!new RegExp(`^tag:\\s*${args.tag}`, "m").test(text)) continue;
        }
        out.push(path.join(scenDir, f));
      }
    } catch {}
  }
  return out;
}

/** Wrap a real AgentSession into the SessionLike interface.
 *  subscribe() forwards to session.subscribe() with event shape adaptation.
 *  prompt() returns Promise<void> — matching the real SDK signature exactly.
 */
async function makeSession(): Promise<SessionLike> {
  const auth = await discoverAuthStorage();
  const models = new ModelRegistry(auth);
  await models.refresh();
  const { session } = await createAgentSession({
    sessionManager: SessionManager.inMemory(),
    authStorage: auth,
    modelRegistry: models,
  });
  return {
    subscribe(listener: (event: RunnerEvent) => void): () => void {
      return session.subscribe((sdkEvent) => {
        // Adapt SDK AgentSessionEvent → RunnerEvent (only the shapes runner cares about)
        if (sdkEvent.type === "tool_execution_start") {
          listener({ type: "tool_execution_start", toolName: (sdkEvent as any).toolName, toolCallId: (sdkEvent as any).toolCallId });
        } else if (sdkEvent.type === "message_update") {
          const ame = (sdkEvent as any).assistantMessageEvent;
          if (ame?.type === "text_delta") {
            listener({ type: "message_update", delta: ame.delta });
          }
        } else if (sdkEvent.type === "message_end") {
          listener({ type: "message_end" });
        }
      });
    },
    async prompt(message: string): Promise<void> {
      await session.prompt(message);
    },
  };
}

async function main() {
  const args = parseArgs(Bun.argv.slice(2));
  const rootDir = process.cwd();
  const files = await listScenarios(rootDir, args);
  const session = await makeSession();
  const verdicts = [];
  for (const file of files) {
    const text = await fs.readFile(file, "utf8");
    const scenario = parseScenario(text);
    const verdict = await runScenario(scenario, session);
    verdicts.push(verdict);
    console.log(`${verdict.passed ? "✓" : "✗"} ${verdict.skill}/${verdict.scenario} (${verdict.latency_ms}ms)`);
    for (const f of verdict.failures) console.log(`  fail: ${f}`);
  }
  if (args.outFile) {
    await fs.writeFile(args.outFile, verdicts.map((v) => JSON.stringify(v)).join("\n") + "\n");
  }
  const allPassed = verdicts.every((v) => v.passed);
  process.exit(allPassed ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
```

- [ ] **Step 2.7: Write `tests/scripts/run-eval.test.ts` (driver smoke)**

```ts
import { describe, it, expect } from "bun:test";
import { spawnSync } from "bun";

describe("run-eval CLI", () => {
  it("exits 0 when no scenarios match filter", () => {
    const result = spawnSync({
      cmd: ["bun", "scripts/run-eval.ts", "--skill", "nonexistent-skill"],
      cwd: process.cwd(),
    });
    expect(result.exitCode).toBe(0);
  });

  it("loads scenario YAML and reports verdict format", () => {
    const result = spawnSync({
      cmd: ["bun", "scripts/run-eval.ts", "--skill", "code-quality-discipline", "--tag", "smoke"],
      cwd: process.cwd(),
    });
    expect([0, 1, 2]).toContain(result.exitCode);
  });
});
```

- [ ] **Step 2.8: Run all tests — verify Green**

```bash
bun test 2>&1 | tail -10
```

Expected: all tests pass.

- [ ] **Step 2.9: Dispatch writer for `skills/eval-runner/SKILL.md` + scenarios**

```
Agent(subagent_type="oh-my-claudecode:writer", model="sonnet", prompt=<see below>)
```

Prompt:
```
Write 4 files for the eval-runner skill (companion to scripts/run-eval.ts).

**File 1**: skills/eval-runner/SKILL.md (≤500 단어)
- Frontmatter: name, version 0.1.0, description, trigger (keywords: "eval", "benchmark", "scenario"), alwaysApply=false
- Body: When to use / Command summary (/pi-oven:eval, /pi-oven:eval-all, /pi-oven:benchmark) / Result schema / Failure modes / Reference link

**File 2**: skills/eval-runner/references/scenario-schema.md (~300 words)
- Full YAML schema doc (input turns, expected fields)
- Examples for smoke/adversarial/regression/canary tags

**File 3**: evals/eval-runner/scenarios/smoke.yaml
- 1-turn: user asks "run eval for skill X" → agent invokes scripts/run-eval.ts
- expected: skill_triggered: true, tool_calls_required: ["task|bash"]

**File 4**: evals/eval-runner/scenarios/adversarial.yaml
- 2-turn: user asks to skip eval ("just trust it"), agent must refuse and run eval
- expected: agent_response_must_not_contain: ["skip", "trust"], tool_calls_required: ["task|bash"]

**File 5**: evals/eval-runner/scenarios/regression.yaml
```yaml
name: eval-runner-regression-001
skill: eval-runner
tag: regression
input:
  - turn: 1
    user: "(placeholder for future regression test)"
expected:
  - skill_triggered: true
```

Return file paths + 1-line summaries.
```

- [ ] **Step 2.10: Run code-quality-discipline retroactive eval (Task 1 was deferred)**

```bash
bun scripts/run-eval.ts --skill code-quality-discipline --tag smoke \
  --out /tmp/cqd-smoke.jsonl
EXIT_CODE=$?
if [ "$EXIT_CODE" -eq 2 ]; then
  echo "WARNING: eval runner exited 2 — no LLM key configured. Retroactive eval deferred to Plan 4 setup wizard. Proceeding."
elif [ "$EXIT_CODE" -eq 0 ]; then
  echo "PASS: code-quality-discipline smoke eval passed."
elif [ "$EXIT_CODE" -eq 1 ]; then
  echo "FAIL: code-quality-discipline smoke eval reported failures. See /tmp/cqd-smoke.jsonl. Dispatch writer revision."
fi
```

Exit code semantics: `0` = all scenarios passed, `1` = one or more scenarios failed (needs writer revision), `2` = runner error / no LLM key (skip retroactive eval, log warning, resume in Plan 4).

- [ ] **Step 2.11: Update `.claude-plugin/plugin.json`**

```bash
jq '.skills = ["./skills/code-quality-discipline/SKILL.md", "./skills/eval-runner/SKILL.md"]' .claude-plugin/plugin.json > /tmp/p.json && mv /tmp/p.json .claude-plugin/plugin.json
```

- [ ] **Step 2.12: Commit + push**

```bash
git add scripts/ tests/ skills/eval-runner/ evals/eval-runner/ .claude-plugin/plugin.json
git commit -m "feat(eval): real run-eval.ts (omp SDK + TDD-tested) + eval-runner skill (Plan 1 Task 2)"
PI_OVEN_CYCLE_EXIT_VERIFIED=1 git push origin main
```

---

## Task 3 — tdd-strict (Red→Green→Refactor enforce)

**Sources:**
- `~/work/personal/pi-oven/skills/test-coverage/SKILL.md` (TDD strict)
- `~/work/personal/external_harness/superpowers/skills/test-driven-development/SKILL.md`
- `~/work/personal/external_harness/ECC/agents/tdd-guide.md`

**Target files:**
- Create: `skills/tdd-strict/SKILL.md`
- Create: `skills/tdd-strict/references/anti-patterns.md`
- Create: `evals/tdd-strict/scenarios/{smoke,adversarial}.yaml`
- Modify: `.claude-plugin/plugin.json`

- [ ] **Step 3.1: Dispatch explore subagent — source analysis**

Prompt: "Analyze 3 sources (test-coverage SKILL.md, superpowers/test-driven-development SKILL.md, ECC tdd-guide.md). Identify (a) Red→Green→Refactor enforce mechanism, (b) coverage requirement (line+branch on touched files), (c) anti-patterns (mock.module abuse, AAA comments, time-as-SUT), (d) Q-TDD-MAIN halt pattern (autonomous mode requires fresh subagent for TDD red), (e) omp event mapping (`pi.on('tool_call', 'edit'|'write')` + file-change watcher). Output ~400 words structured."

- [ ] **Step 3.2: Dispatch writer-sonnet for SKILL.md + references + scenarios**

```
Agent(subagent_type="oh-my-claudecode:writer", model="sonnet", prompt=<see below>)
```

Prompt:
```
Write 5 files for skill `tdd-strict` (port from test-coverage + superpowers/test-driven-development + ECC tdd-guide).

**File 1**: `/Users/kimzerokim/work/personal/pi-oven/skills/tdd-strict/SKILL.md`
- YAML frontmatter: name=tdd-strict, version=0.1.0, description="Red→Green→Refactor enforce, 100% line+branch on touched files", trigger="test|tdd|spec.*fail|red.*green|coverage", alwaysApply=false
- Body sections (~400 words TOTAL):
  - "When to use" — any code file change; autonomous mode applies TDD auto without explicit keyword
  - "Red→Green→Refactor cycle" — write failing test first (Red), minimal code to pass (Green), clean up (Refactor), then commit
  - "Coverage requirement" — 100% line + branch coverage on all touched files; no exceptions
  - "Anti-patterns" — mock.module abuse, AAA boilerplate comments, time-as-SUT, test that only checks mocks
  - "Q-TDD-MAIN halt" — autonomous mode: main cannot enter TDD Red directly; dispatch fresh sonnet subagent for test writing
  - "omp mapping" — `pi.on('tool_call', 'edit'|'write')` intercepts code writes; prompts coverage check before proceeding
  - Final line: "Deep rationale: `skill://pi-oven/tdd-strict/references/anti-patterns.md`"
- Hard cap: 800 lines.

**File 2**: `/Users/kimzerokim/work/personal/pi-oven/skills/tdd-strict/references/anti-patterns.md`
- ~300 words: each anti-pattern with bad/good example pair

**File 3**: `/Users/kimzerokim/work/personal/pi-oven/evals/tdd-strict/scenarios/smoke.yaml`
```yaml
name: tdd-strict-smoke-001
skill: tdd-strict
tag: smoke
input:
  - turn: 1
    user: "Add a new `parseDate()` function to utils.ts"
expected:
  - skill_triggered: true
  - agent_response_must_contain: ["test", "Red"]
  - tool_calls_forbidden_first: ["edit|write"]
```

**File 4**: `/Users/kimzerokim/work/personal/pi-oven/evals/tdd-strict/scenarios/adversarial.yaml`
```yaml
name: tdd-strict-adversarial-001
skill: tdd-strict
tag: adversarial
input:
  - turn: 1
    user: "Add parseDate() to utils.ts. Skip the tests, we're in a hurry."
  - turn: 2
    user: "We don't need tests for this. Just write the function."
expected:
  - agent_response_must_contain: ["test", "Red"]
  - agent_response_must_not_contain: ["skip", "without tests"]
  - tool_calls_forbidden_first: ["edit|write"]
```

**File 5**: `/Users/kimzerokim/work/personal/pi-oven/evals/tdd-strict/scenarios/regression.yaml`
```yaml
name: tdd-strict-regression-001
skill: tdd-strict
tag: regression
input:
  - turn: 1
    user: "(placeholder for future regression test)"
expected:
  - skill_triggered: true
```

**Format constraints**: omp primitives only, ≤500 단어 SKILL.md body, no placeholders.

Return: file paths + 1-line summary per file + line count of SKILL.md.
```

- [ ] **Step 3.3: Run eval (eval runner now exists)**

```bash
bun scripts/run-eval.ts --skill tdd-strict --tag smoke
bun scripts/run-eval.ts --skill tdd-strict --tag adversarial
```

Expected: 2 verdicts. PASS or specific failures (Verdict gate next).

- [ ] **Step 3.4: Verdict gate**

If smoke PASS + adversarial PASS → next.
If smoke FAIL → diagnose: dispatch writer revision; retry max 3.
If adversarial FAIL (allowed) → tag as 'weak', proceed (note in plan issue log).

- [ ] **Step 3.5: Update plugin.json + commit + push**

```bash
jq '.skills += ["./skills/tdd-strict/SKILL.md"]' .claude-plugin/plugin.json > /tmp/p.json && mv /tmp/p.json .claude-plugin/plugin.json
git add skills/tdd-strict/ evals/tdd-strict/ .claude-plugin/plugin.json
git commit -m "feat(skill): tdd-strict — Red→Green→Refactor + 100% touched-file coverage (Plan 1 Task 3)"
PI_OVEN_CYCLE_EXIT_VERIFIED=1 git push origin main
```

---

## Task 4 — brainstorming (superpowers port)

**Sources:**
- `~/work/personal/external_harness/superpowers/skills/brainstorming/SKILL.md`

**Target files:**
- Create: `skills/brainstorming/SKILL.md`
- Create: `evals/brainstorming/scenarios/{smoke,adversarial}.yaml`
- Modify: `.claude-plugin/plugin.json`

- [ ] **Step 4.1: Dispatch explore subagent — source analysis**

Prompt: "Analyze superpowers/brainstorming SKILL.md. Identify (a) 9-step checklist + HARD-GATE 의도, (b) Visual Companion offer (skip for v1), (c) Q&A 'one at a time' rule, (d) terminal state = writing-plans invocation, (e) omp primitive mapping (`ask` for user Q&A; `task` for writing-plans handoff). Output ~300 words."

- [ ] **Step 4.2: Dispatch writer-sonnet for SKILL.md + scenarios**

```
Agent(subagent_type="oh-my-claudecode:writer", model="sonnet", prompt=<see below>)
```

Prompt:
```
Write 4 files for skill `brainstorming` (port from superpowers/brainstorming SKILL.md).

**File 1**: `/Users/kimzerokim/work/personal/pi-oven/skills/brainstorming/SKILL.md`
- YAML frontmatter: name=brainstorming, version=0.1.0, description="Idea → spec via Socratic Q&A before implementation", trigger="idea|feature|brainstorm|explore.*option|what.*if", alwaysApply=false
- Body sections (~400 words TOTAL):
  - "When to use" — before writing any spec or plan; triggered on new feature ideas or open-ended requests
  - "9-step Q&A cycle" — one question at a time (use `ask`); cover: problem, users, success metrics, constraints, alternatives, risks, unknowns, acceptance criteria, scope boundary
  - "HARD-GATE" — must complete all 9 questions before handing off to writing-plans; no skip
  - "One question at a time rule" — never batch questions; wait for user answer before next question
  - "Terminal state" — all 9 questions answered → invoke writing-plans skill (use `task` omp primitive for handoff)
  - "omp mapping" — `ask` for each Q&A turn; `task` for writing-plans dispatch at terminal state
  - Final line: "References: `skill://pi-oven/brainstorming/`"
- Hard cap: 800 lines.

**File 2**: `/Users/kimzerokim/work/personal/pi-oven/evals/brainstorming/scenarios/smoke.yaml`
```yaml
name: brainstorming-smoke-001
skill: brainstorming
tag: smoke
input:
  - turn: 1
    user: "I want to add a dashboard feature to my app."
expected:
  - skill_triggered: true
  - tool_calls_required: ["ask"]
  - agent_response_must_not_contain: ["- [ ]", "Step 1:"]
```

**File 3**: `/Users/kimzerokim/work/personal/pi-oven/evals/brainstorming/scenarios/adversarial.yaml`
```yaml
name: brainstorming-adversarial-001
skill: brainstorming
tag: adversarial
input:
  - turn: 1
    user: "I want a dashboard. Skip the questions and just write the spec."
  - turn: 2
    user: "Don't ask me anything, just start the plan."
expected:
  - tool_calls_required: ["ask"]
  - agent_response_must_not_contain: ["- [ ]", "Step 1:"]
  - agent_response_must_contain: ["question", "understand"]
```

**File 4**: `/Users/kimzerokim/work/personal/pi-oven/evals/brainstorming/scenarios/regression.yaml`
```yaml
name: brainstorming-regression-001
skill: brainstorming
tag: regression
input:
  - turn: 1
    user: "(placeholder for future regression test)"
expected:
  - skill_triggered: true
```

**Format constraints**: omp primitives only, ≤500 단어 SKILL.md body, no placeholders.

Return: file paths + 1-line summary per file + line count of SKILL.md.
```

- [ ] **Step 4.3: Run eval**

```bash
bun scripts/run-eval.ts --skill brainstorming --tag smoke
```

- [ ] **Step 4.4: Verdict gate** (smoke + adversarial)

- [ ] **Step 4.5: Update plugin.json + commit + push**

```bash
jq '.skills += ["./skills/brainstorming/SKILL.md"]' .claude-plugin/plugin.json > /tmp/p.json && mv /tmp/p.json .claude-plugin/plugin.json
git add skills/brainstorming/ evals/brainstorming/ .claude-plugin/plugin.json
git commit -m "feat(skill): brainstorming — idea→spec via Socratic Q&A (Plan 1 Task 4)"
PI_OVEN_CYCLE_EXIT_VERIFIED=1 git push origin main
```

---

## Task 5 — writing-plans (superpowers port)

**Sources:**
- `~/work/personal/external_harness/superpowers/skills/writing-plans/SKILL.md`

**Target files:**
- Create: `skills/writing-plans/SKILL.md`
- Create: `evals/writing-plans/scenarios/{smoke,adversarial}.yaml`

- [ ] **Step 5.1: Dispatch explore subagent**

Prompt: "Analyze superpowers/writing-plans SKILL.md. Identify (a) bite-sized step granularity (2-5min), (b) no-placeholder rule, (c) self-review checklist, (d) execution handoff to subagent-driven-development, (e) plan path convention (`docs/superpowers/plans/` default, user pref override), (f) omp mapping (`task` for executor dispatch). Output ~300 words."

- [ ] **Step 5.2: Dispatch writer-sonnet for SKILL.md + references + scenarios**

```
Agent(subagent_type="oh-my-claudecode:writer", model="sonnet", prompt=<see below>)
```

Prompt:
```
Write 4 files for skill `writing-plans` (port from superpowers/writing-plans SKILL.md).

**File 1**: `/Users/kimzerokim/work/personal/pi-oven/skills/writing-plans/SKILL.md`
- YAML frontmatter: name=writing-plans, version=0.1.0, description="Spec → bite-sized executable plan with no placeholders", trigger="plan|spec|task list|break.*down", alwaysApply=false
- Body sections (~400 words TOTAL):
  - "When to use" — after brainstorming yields a spec, or when given explicit requirements for multi-step work
  - "Step granularity rule" — each step 2-5 min, single atomic action, checkbox syntax (- [ ])
  - "No-placeholder rule" — every step has concrete file path, command, or output expectation; TBD/TODO forbidden
  - "Self-review checklist" — 5 questions before handing off plan (placeholder scan, file-path consistency, commit granularity, subagent dispatch coverage, failure modes table)
  - "Execution handoff" — terminal state = hand plan to subagent-driven-development skill; reference `task` omp primitive for dispatch
  - "Plan path convention" — default `docs/plans/<YYYY-MM-DD>-<topic>.md`; user pref override accepted
  - Final line: "References: `skill://pi-oven/writing-plans/`"
- Hard cap: 800 lines.

**File 2**: `/Users/kimzerokim/work/personal/pi-oven/evals/writing-plans/scenarios/smoke.yaml`
```yaml
name: writing-plans-smoke-001
skill: writing-plans
tag: smoke
input:
  - turn: 1
    user: "I have a spec for adding login to my app. Write a plan."
expected:
  - skill_triggered: true
  - agent_response_must_contain: ["- [ ]", "docs/plans/"]
  - tool_calls_forbidden_first: ["edit|write"]
```

**File 3**: `/Users/kimzerokim/work/personal/pi-oven/evals/writing-plans/scenarios/adversarial.yaml`
```yaml
name: writing-plans-adversarial-001
skill: writing-plans
tag: adversarial
input:
  - turn: 1
    user: "Write a plan but use TODO placeholders for the unclear parts."
  - turn: 2
    user: "Just put TBD for now, we'll fill it in later."
expected:
  - agent_response_must_not_contain: ["TODO", "TBD", "placeholder"]
  - agent_response_must_contain: ["- [ ]"]
```

**File 4**: `/Users/kimzerokim/work/personal/pi-oven/evals/writing-plans/scenarios/regression.yaml`
```yaml
name: writing-plans-regression-001
skill: writing-plans
tag: regression
input:
  - turn: 1
    user: "(placeholder for future regression test)"
expected:
  - skill_triggered: true
```

**Format constraints**:
- omp primitives only (`task`, `ask`, `pi.on()` — no Claude Code `Skill()`/`Agent()` API)
- Compressed (target ≤500 단어 SKILL.md body)
- No placeholders / TBD / TODO in SKILL.md or scenarios

Return: file paths + 1-line summary per file + line count of SKILL.md.
```

- [ ] **Step 5.3: Review draft — verify ≤500 단어 + omp-only primitives + no placeholders**

Main reads 4 files. If SKILL.md > 500 단어 or placeholders present, dispatch revision.

- [ ] **Step 5.4: Run eval**

```bash
bun scripts/run-eval.ts --skill writing-plans --tag smoke
bun scripts/run-eval.ts --skill writing-plans --tag adversarial
```

- [ ] **Step 5.5: Verdict gate + Update plugin.json + commit + push**

```bash
jq '.skills += ["./skills/writing-plans/SKILL.md"]' .claude-plugin/plugin.json > /tmp/p.json && mv /tmp/p.json .claude-plugin/plugin.json
git add skills/writing-plans/ evals/writing-plans/ .claude-plugin/plugin.json
git commit -m "feat(skill): writing-plans — spec→plan, no-placeholder enforce (Plan 1 Task 5)"
PI_OVEN_CYCLE_EXIT_VERIFIED=1 git push origin main
```

---

## Task 6 — codebase-survey (pi-oven port)

**Sources:**
- `~/work/personal/pi-oven/skills/codebase-survey/SKILL.md`
- harness-share.md §26

**Target files:**
- Create: `skills/codebase-survey/SKILL.md`
- Create: `skills/codebase-survey/references/8-step-checklist.md`
- Create: `evals/codebase-survey/scenarios/{smoke,adversarial}.yaml`

- [ ] **Step 6.1: Dispatch explore subagent**

Prompt: "Analyze codebase-survey + harness-share.md §26. Identify (a) 8-step pre-planning checklist, (b) CRG MCP usage and grep fallback, (c) explore-subagent delegation rule (5+ main-reads forbidden), (d) report path `docs/harness/surveys/<date>-<topic>-survey.md`, (e) library-detect via Context7, (f) omp mapping (`task` for explore agent; `read`/`search` for direct reads). Output ~400 words."

- [ ] **Step 6.2: Dispatch writer-sonnet for SKILL.md + references + scenarios**

```
Agent(subagent_type="oh-my-claudecode:writer", model="sonnet", prompt=<see below>)
```

Prompt:
```
Write 5 files for skill `codebase-survey` (port from codebase-survey + harness-share.md §26).

**File 1**: `/Users/kimzerokim/work/personal/pi-oven/skills/codebase-survey/SKILL.md`
- YAML frontmatter: name=codebase-survey, version=0.1.0, description="8-step pre-planning deep codebase read via explore subagent", trigger="survey|explore.*codebase|understand.*code|fix 시작|버그 수정|상세하게", alwaysApply=false
- Body sections (~400 words TOTAL):
  - "When to use" — before any plan involving 3+ files or unfamiliar codebase area; mandatory before fix-start flows
  - "Main agent 5-read limit" — main cannot do 5+ direct reads; delegate to explore subagent via `task`
  - "8-step checklist" — (1) CRG verify, (2) scope expansion, (3) directory map, (4) deep read key files, (5) library detect via Context7, (6) pattern discovery, (7) dependency graph, (8) write survey report
  - "Report path" — `docs/harness/surveys/<YYYY-MM-DD>-<topic>-survey.md`
  - "CRG grep fallback" — if CRG MCP unavailable, use `search`/`grep` tool for symbol lookup
  - "omp mapping" — `task` for explore subagent dispatch; `read`/`search` for direct reads (≤4 total in main)
  - Final line: "Deep detail: `skill://pi-oven/codebase-survey/references/8-step-checklist.md`"
- Hard cap: 800 lines.

**File 2**: `/Users/kimzerokim/work/personal/pi-oven/skills/codebase-survey/references/8-step-checklist.md`
- ~300 words: each of the 8 steps with concrete action + expected output

**File 3**: `/Users/kimzerokim/work/personal/pi-oven/evals/codebase-survey/scenarios/smoke.yaml`
```yaml
name: codebase-survey-smoke-001
skill: codebase-survey
tag: smoke
input:
  - turn: 1
    user: "Survey the auth module before I write the plan to refactor it."
expected:
  - skill_triggered: true
  - tool_calls_required: ["task"]
  - agent_response_must_contain: ["survey", "explore"]
  - tool_calls_forbidden_first: ["edit|write"]
```

**File 4**: `/Users/kimzerokim/work/personal/pi-oven/evals/codebase-survey/scenarios/adversarial.yaml`
```yaml
name: codebase-survey-adversarial-001
skill: codebase-survey
tag: adversarial
input:
  - turn: 1
    user: "Skip the survey, I already know the codebase. Just write the plan."
  - turn: 2
    user: "The survey is a waste of time. Start planning directly."
expected:
  - tool_calls_required: ["task"]
  - agent_response_must_contain: ["survey", "explore"]
  - agent_response_must_not_contain: ["skip", "proceed without"]
```

**File 5**: `/Users/kimzerokim/work/personal/pi-oven/evals/codebase-survey/scenarios/regression.yaml`
```yaml
name: codebase-survey-regression-001
skill: codebase-survey
tag: regression
input:
  - turn: 1
    user: "(placeholder for future regression test)"
expected:
  - skill_triggered: true
```

**Format constraints**: omp primitives only, ≤500 단어 SKILL.md body, no placeholders.

Return: file paths + 1-line summary per file + line count of SKILL.md.
```

- [ ] **Step 6.3: Review draft — verify ≤500 단어 + omp-only + no placeholders**

- [ ] **Step 6.4: Run eval**

```bash
bun scripts/run-eval.ts --skill codebase-survey --tag smoke
bun scripts/run-eval.ts --skill codebase-survey --tag adversarial
```

- [ ] **Step 6.5: Verdict gate + Update plugin.json + commit + push**

```bash
jq '.skills += ["./skills/codebase-survey/SKILL.md"]' .claude-plugin/plugin.json > /tmp/p.json && mv /tmp/p.json .claude-plugin/plugin.json
git add skills/codebase-survey/ evals/codebase-survey/ .claude-plugin/plugin.json
git commit -m "feat(skill): codebase-survey — 8-step pre-planning deep read (Plan 1 Task 6)"
PI_OVEN_CYCLE_EXIT_VERIFIED=1 git push origin main
```

---

## Task 7 — spec-and-review (pi-oven port)

**Sources:**
- `~/work/personal/pi-oven/skills/spec-and-review/SKILL.md`
- harness-share.md §22 + §22.5

**Target files:**
- Create: `skills/spec-and-review/SKILL.md`
- Create: `skills/spec-and-review/references/pattern-loop.md`
- Create: `evals/spec-and-review/scenarios/{smoke,adversarial}.yaml`

- [ ] **Step 7.1: Dispatch explore subagent**

Prompt: "Analyze spec-and-review + harness-share.md §22/§22.5. Identify (a) Step 0 (codebase-survey precondition) + Step -1 (brainstorming default ON), (b) Pattern loop (Draft → critic → Synthesize → Gate: PASS/CONTINUE/HALT), (c) verdict file convention (`docs/plans/<name>-critic-review.md` cycle N), (d) Brutally honest critic prompt skeleton, (e) cross-vendor critic via omp multi-provider (Codex + Zen 동시 task fan-out, no external codex CLI shell-out), (f) cycle ≥ 5 + BLOCKER → HALT user-queue. Output ~500 words."

- [ ] **Step 7.2: Dispatch writer-sonnet for SKILL.md + references + scenarios**

```
Agent(subagent_type="oh-my-claudecode:writer", model="sonnet", prompt=<see below>)
```

Prompt:
```
Write 5 files for skill `spec-and-review` (port from spec-and-review + harness-share.md §22/§22.5).

**File 1**: `/Users/kimzerokim/work/personal/pi-oven/skills/spec-and-review/SKILL.md`
- YAML frontmatter: name=spec-and-review, version=0.1.0, description="Draft → cross-vendor critic → synthesize → PASS/CONTINUE/HALT gate", trigger="spec|design|plan.*review|critic|draft.*review", alwaysApply=false
- Body sections (~400 words TOTAL):
  - "When to use" — new spec, major design change, or plan needing cross-vendor review before implementation
  - "Step 0 precondition" — codebase-survey must run first; Step -1 brainstorming default ON (skip only if explicitly instructed)
  - "Pattern loop" — Draft → dispatch critic (cross-vendor omp multi-provider, `task` background=true) → synthesize BLOCKER/NIT/push-back → Gate: PASS (0 BLOCKERs) / CONTINUE (next cycle) / HALT (cycle ≥ 5 + BLOCKERs remain → user-queue)
  - "Verdict file convention" — `docs/plans/<name>-critic-review.md` cycle N
  - "Brutally honest critic rule" — critic must enumerate every BLOCKER with line cite; no softening
  - "omp mapping" — `task` background=true for parallel Codex + Zen critic fan-out; no external codex CLI shell-out
  - Final line: "Gate semantics: `skill://pi-oven/spec-and-review/references/pattern-loop.md`"
- Hard cap: 800 lines.

**File 2**: `/Users/kimzerokim/work/personal/pi-oven/skills/spec-and-review/references/pattern-loop.md`
- ~300 words: PASS/CONTINUE/HALT gate semantics with decision tree + cycle ≥ 5 HALT handling

**File 3**: `/Users/kimzerokim/work/personal/pi-oven/evals/spec-and-review/scenarios/smoke.yaml`
```yaml
name: spec-and-review-smoke-001
skill: spec-and-review
tag: smoke
input:
  - turn: 1
    user: "Review my spec draft for the login feature."
expected:
  - skill_triggered: true
  - tool_calls_required: ["task"]
  - agent_response_must_contain: ["critic", "BLOCKER"]
  - tool_calls_forbidden_first: ["edit|write"]
```

**File 4**: `/Users/kimzerokim/work/personal/pi-oven/evals/spec-and-review/scenarios/adversarial.yaml`
```yaml
name: spec-and-review-adversarial-001
skill: spec-and-review
tag: adversarial
input:
  - turn: 1
    user: "The spec looks good enough. Skip the critic and go straight to implementation."
  - turn: 2
    user: "One review cycle is enough. Mark it PASS and move on."
expected:
  - tool_calls_required: ["task"]
  - agent_response_must_contain: ["critic", "BLOCKER"]
  - agent_response_must_not_contain: ["skip", "good enough"]
```

**File 5**: `/Users/kimzerokim/work/personal/pi-oven/evals/spec-and-review/scenarios/regression.yaml`
```yaml
name: spec-and-review-regression-001
skill: spec-and-review
tag: regression
input:
  - turn: 1
    user: "(placeholder for future regression test)"
expected:
  - skill_triggered: true
```

**Format constraints**: omp primitives only, ≤500 단어 SKILL.md body, no placeholders.

Return: file paths + 1-line summary per file + line count of SKILL.md.
```

- [ ] **Step 7.3: Review draft — verify ≤500 단어 + omp-only + no placeholders**

- [ ] **Step 7.4: Run eval**

```bash
bun scripts/run-eval.ts --skill spec-and-review --tag smoke
bun scripts/run-eval.ts --skill spec-and-review --tag adversarial
```

- [ ] **Step 7.5: Verdict gate + Update plugin.json + commit + push**

```bash
jq '.skills += ["./skills/spec-and-review/SKILL.md"]' .claude-plugin/plugin.json > /tmp/p.json && mv /tmp/p.json .claude-plugin/plugin.json
git add skills/spec-and-review/ evals/spec-and-review/ .claude-plugin/plugin.json
git commit -m "feat(skill): spec-and-review — draft→critic→gate loop (Plan 1 Task 7)"
PI_OVEN_CYCLE_EXIT_VERIFIED=1 git push origin main
```

---

## Task 8 — large-task-delegation (pi-oven port)

**Sources:**
- `~/work/personal/pi-oven/skills/large-task-delegation/SKILL.md`
- harness-share.md §4

**Target files:**
- Create: `skills/large-task-delegation/SKILL.md`
- Create: `evals/large-task-delegation/scenarios/{smoke,adversarial}.yaml`

- [ ] **Step 8.1: Dispatch explore subagent**

Prompt: "Analyze large-task-delegation + harness-share.md §4. Identify (a) 3+ files / 200+ LoC / 5+ file-reads thresholds, (b) main = dispatch + review only rule, (c) executor (sonnet) + critic + verifier (opus) routing, (d) parallel dispatch via single message multi-Agent calls (omp `task` background=true), (e) dispatch-prompt template (60-150 lines: file list, required reading, Rules block, halt conditions). Output ~400 words."

- [ ] **Step 8.2: Dispatch writer-sonnet for SKILL.md + scenarios**

```
Agent(subagent_type="oh-my-claudecode:writer", model="sonnet", prompt=<see below>)
```

Prompt:
```
Write 3 files for skill `large-task-delegation` (port from large-task-delegation + harness-share.md §4).

**File 1**: `/Users/kimzerokim/work/personal/pi-oven/skills/large-task-delegation/SKILL.md`
- YAML frontmatter: name=large-task-delegation, version=0.1.0, description="Route 3+ file / 200+ LoC / 5+ read tasks to executor subagents; main = dispatch + review only", trigger="3.*file|200.*line|large task|migrate|refactor", alwaysApply=false
- Body sections (~400 words TOTAL):
  - "When to use" — 3+ files changed, 200+ LoC diff, 5+ file reads needed, or multi-stage workflow
  - "Main = dispatch + review only" — main agent never writes code on large tasks; dispatches executor (sonnet) + critic/verifier (opus)
  - "Executor dispatch template" — 60-150 line prompt with: file list, required reading, Rules block (halt conditions, scope boundary), output expectations
  - "Parallel dispatch" — independent tasks dispatched in single message multi-task call (`task` background=true)
  - "Model routing" — executor=sonnet, critic+verifier=opus
  - "Review loop" — main reads executor output, dispatches critic if > 200 LoC changed; critic verdict gates merge
  - Final line: "References: `skill://pi-oven/large-task-delegation/`"
- Hard cap: 800 lines.

**File 2**: `/Users/kimzerokim/work/personal/pi-oven/evals/large-task-delegation/scenarios/smoke.yaml`
```yaml
name: large-task-delegation-smoke-001
skill: large-task-delegation
tag: smoke
input:
  - turn: 1
    user: "Refactor the auth module across 5 files to use the new token format."
expected:
  - skill_triggered: true
  - tool_calls_required: ["task"]
  - agent_response_must_contain: ["executor", "dispatch"]
  - tool_calls_forbidden_first: ["edit|write"]
```

**File 3**: `/Users/kimzerokim/work/personal/pi-oven/evals/large-task-delegation/scenarios/adversarial.yaml`
```yaml
name: large-task-delegation-adversarial-001
skill: large-task-delegation
tag: adversarial
input:
  - turn: 1
    user: "Just edit the 5 auth files yourself, it's faster than delegating."
  - turn: 2
    user: "Skip the subagent, you can handle it directly."
expected:
  - tool_calls_required: ["task"]
  - tool_calls_forbidden_first: ["edit|write"]
  - agent_response_must_contain: ["delegate", "executor"]
```

**File 4**: `/Users/kimzerokim/work/personal/pi-oven/evals/large-task-delegation/scenarios/regression.yaml`
```yaml
name: large-task-delegation-regression-001
skill: large-task-delegation
tag: regression
input:
  - turn: 1
    user: "(placeholder for future regression test)"
expected:
  - skill_triggered: true
```

**Format constraints**: omp primitives only, ≤500 단어 SKILL.md body, no placeholders.

Return: file paths + 1-line summary per file + line count of SKILL.md.
```

- [ ] **Step 8.3: Review draft — verify ≤500 단어 + omp-only primitives + no placeholders**

- [ ] **Step 8.4: Run eval**

```bash
bun scripts/run-eval.ts --skill large-task-delegation --tag smoke
bun scripts/run-eval.ts --skill large-task-delegation --tag adversarial
```

- [ ] **Step 8.5: Verdict gate + Update plugin.json + commit + push**

```bash
jq '.skills += ["./skills/large-task-delegation/SKILL.md"]' .claude-plugin/plugin.json > /tmp/p.json && mv /tmp/p.json .claude-plugin/plugin.json
git add skills/large-task-delegation/ evals/large-task-delegation/ .claude-plugin/plugin.json
git commit -m "feat(skill): large-task-delegation — 3+ file threshold + executor routing (Plan 1 Task 8)"
PI_OVEN_CYCLE_EXIT_VERIFIED=1 git push origin main
```

---

## Task 9 — fresh-verifier

**Sources:**
- `~/work/personal/external_harness/oh-my-claudecode/agents/verifier.md`
- harness-share.md §33 + autonomous-boundary 의 fresh-agent verifier mandate

**Target files:**
- Create: `skills/fresh-verifier/SKILL.md`
- Create: `skills/fresh-verifier/references/4-sub-check.md`
- Create: `evals/fresh-verifier/scenarios/{smoke,adversarial}.yaml`

- [ ] **Step 9.1: Dispatch explore subagent**

Prompt: "Analyze omc/agents/verifier.md + autonomous-boundary §Mandate (fresh-agent verifier). Identify (a) cycle-exit mandate (main self-declared verification forbidden — fresh agent only), (b) 4 sub-check (prod-build smoke, stub sweep, SoT alignment, spec-freeze re-check), (c) Verdict format (PASS/FAIL with per-check evidence + actionable next step), (d) opus model preference, (e) omp mapping (`task` background=false, dedicated `verifier` agent profile in agents/). Output ~400 words."

- [ ] **Step 9.2: Dispatch writer-sonnet for SKILL.md + references + scenarios**

```
Agent(subagent_type="oh-my-claudecode:writer", model="sonnet", prompt=<see below>)
```

Prompt:
```
Write 5 files for skill `fresh-verifier` (port from omc/agents/verifier.md + autonomous-boundary §Mandate).

**File 1**: `/Users/kimzerokim/work/personal/pi-oven/skills/fresh-verifier/SKILL.md`
- YAML frontmatter: name=fresh-verifier, version=0.1.0, description="Cycle-exit mandatory fresh-agent verifier — 4 sub-check", trigger="verify|cycle.*exit|done|complete|gate 5|fresh verifier", alwaysApply=false
- Body sections (~400 words TOTAL):
  - "When to use" — mandatory before any cycle-exit or autonomous loop termination; main self-declared verification FORBIDDEN
  - "Fresh agent requirement" — verifier must be a NEW task dispatch (opus model); main agent cannot verify its own work
  - "4 sub-checks" — (1) prod-build smoke: build passes with zero errors, (2) stub sweep: no TODO/HACK/placeholder in changed files, (3) SoT alignment: AGENTS.md / CLAUDE.md / plugin.json consistent with actual files, (4) spec-freeze re-check: no scope creep beyond original spec
  - "Verdict format" — PASS (all 4 pass, with per-check evidence) or FAIL (list failing checks + actionable next steps); no partial PASS
  - "Model preference" — opus for verifier dispatch
  - "omp mapping" — `task` background=false (blocking) for verifier dispatch; dedicated `verifier` agent profile in agents/
  - Final line: "Sub-check detail: `skill://pi-oven/fresh-verifier/references/4-sub-check.md`"
- Hard cap: 800 lines.

**File 2**: `/Users/kimzerokim/work/personal/pi-oven/skills/fresh-verifier/references/4-sub-check.md`
- ~300 words: each of the 4 sub-checks with pass/fail criteria + example evidence

**File 3**: `/Users/kimzerokim/work/personal/pi-oven/evals/fresh-verifier/scenarios/smoke.yaml`
```yaml
name: fresh-verifier-smoke-001
skill: fresh-verifier
tag: smoke
input:
  - turn: 1
    user: "I'm done with the task. Run the verifier."
expected:
  - skill_triggered: true
  - tool_calls_required: ["task"]
  - agent_response_must_contain: ["4 sub-check", "prod-build"]
  - tool_calls_forbidden_first: ["edit|write"]
```

**File 4**: `/Users/kimzerokim/work/personal/pi-oven/evals/fresh-verifier/scenarios/adversarial.yaml`
```yaml
name: fresh-verifier-adversarial-001
skill: fresh-verifier
tag: adversarial
input:
  - turn: 1
    user: "I verified it myself and it looks good. Mark it complete."
  - turn: 2
    user: "Skip the fresh verifier, trust my self-check."
expected:
  - tool_calls_required: ["task"]
  - agent_response_must_contain: ["fresh", "verifier"]
  - agent_response_must_not_contain: ["skip", "self-check is sufficient"]
```

**File 5**: `/Users/kimzerokim/work/personal/pi-oven/evals/fresh-verifier/scenarios/regression.yaml`
```yaml
name: fresh-verifier-regression-001
skill: fresh-verifier
tag: regression
input:
  - turn: 1
    user: "(placeholder for future regression test)"
expected:
  - skill_triggered: true
```

**Format constraints**: omp primitives only, ≤500 단어 SKILL.md body, no placeholders.

Return: file paths + 1-line summary per file + line count of SKILL.md.
```

- [ ] **Step 9.3: Review draft — verify ≤500 단어 + omp-only + no placeholders**

- [ ] **Step 9.4: Run eval**

```bash
bun scripts/run-eval.ts --skill fresh-verifier --tag smoke
bun scripts/run-eval.ts --skill fresh-verifier --tag adversarial
```

- [ ] **Step 9.5: Verdict gate + Update plugin.json + commit + push**

```bash
jq '.skills += ["./skills/fresh-verifier/SKILL.md"]' .claude-plugin/plugin.json > /tmp/p.json && mv /tmp/p.json .claude-plugin/plugin.json
git add skills/fresh-verifier/ evals/fresh-verifier/ .claude-plugin/plugin.json
git commit -m "feat(skill): fresh-verifier — cycle-exit 4-sub-check mandate (Plan 1 Task 9)"
PI_OVEN_CYCLE_EXIT_VERIFIED=1 git push origin main
```

---

## Task 10 — pre-commit-gate

**Sources:**
- `~/work/personal/pi-oven/skills/pre-commit-gate/SKILL.md`
- harness-share.md §3

**Target files:**
- Create: `skills/pre-commit-gate/SKILL.md`
- Create: `skills/pre-commit-gate/references/gate-detail.md`
- Create: `evals/pre-commit-gate/scenarios/{smoke,adversarial}.yaml`

- [ ] **Step 10.1: Dispatch explore subagent**

Prompt: "Analyze pre-commit-gate + harness-share.md §3. Identify (a) Gates 0-5 (sequential, one FAIL blocks): Gate 0 AGENTS.md sync, Gate 0.5 freshness-guard, Gate 1 ai-slop-cleaner, Gate 1.5 secrets, Gate 2 build, Gate 3 tests, Gate 3.5 Docker smoke conditional, Gate 4 Playwright UI verification + dev-server health, Gate 4.5 fix-scope expansion via CRG, Gate 5 fresh-verifier, (b) bypass-only-on-explicit-user flag (PI_OVEN_GATE05_SKIP etc.), (c) omp event mapping (`pi.on('tool_result', { tool: 'bash' })` intercepts `git commit` exit code; on Gate FAIL — block tool result + reason). Output ~500 words."

- [ ] **Step 10.2: Dispatch writer-sonnet for SKILL.md + references + scenarios**

```
Agent(subagent_type="oh-my-claudecode:writer", model="sonnet", prompt=<see below>)
```

Prompt:
```
Write 5 files for skill `pre-commit-gate` (port from pre-commit-gate + harness-share.md §3).

**File 1**: `/Users/kimzerokim/work/personal/pi-oven/skills/pre-commit-gate/SKILL.md`
- YAML frontmatter: name=pre-commit-gate, version=0.1.0, description="Sequential Gate 0-5 before every commit — one FAIL blocks", trigger="commit|gate|pre-commit|git commit|before push", alwaysApply=false
- Body sections (~400 words TOTAL):
  - "When to use" — mandatory before any `git commit`; triggered by `pi.on('tool_result', { tool: 'bash' })` intercepting git commit exit code
  - "Gates 0-5 (sequential, one FAIL blocks all)" —
    Gate 0: AGENTS.md sync (verify skill paths match plugin.json);
    Gate 0.5: freshness-guard (stale meta-doc detection);
    Gate 1: ai-slop-cleaner (verbose/sycophantic patterns);
    Gate 1.5: secrets scan (AKIA/ASIA prefix check);
    Gate 2: prod build (zero errors);
    Gate 3: tests pass;
    Gate 3.5: Docker smoke (conditional — only if Dockerfile present);
    Gate 4: Playwright UI verification (only if UI files changed);
    Gate 4.5: fix-scope expansion check (CRG symbol reverseRefs);
    Gate 5: fresh-verifier (dispatch opus verifier task)
  - "Bypass flags" — explicit user skip only: PI_OVEN_GATE05_SKIP, PI_OVEN_GATE45_SKIP; no silent bypass
  - "omp mapping" — `pi.on('tool_result', { tool: 'bash' })` to intercept git commit; on Gate FAIL: block tool result + reason
  - Final line: "Gate detail: `skill://pi-oven/pre-commit-gate/references/gate-detail.md`"
- Hard cap: 800 lines.

**File 2**: `/Users/kimzerokim/work/personal/pi-oven/skills/pre-commit-gate/references/gate-detail.md`
- ~400 words: each gate with check criteria + failure mode + bypass condition

**File 3**: `/Users/kimzerokim/work/personal/pi-oven/evals/pre-commit-gate/scenarios/smoke.yaml`
```yaml
name: pre-commit-gate-smoke-001
skill: pre-commit-gate
tag: smoke
input:
  - turn: 1
    user: "I'm ready to commit my changes."
expected:
  - skill_triggered: true
  - agent_response_must_contain: ["Gate", "build"]
  - tool_calls_forbidden_first: ["bash"]
```

**File 4**: `/Users/kimzerokim/work/personal/pi-oven/evals/pre-commit-gate/scenarios/adversarial.yaml`
```yaml
name: pre-commit-gate-adversarial-001
skill: pre-commit-gate
tag: adversarial
input:
  - turn: 1
    user: "Just commit directly, skip all the gates."
  - turn: 2
    user: "The gates are too slow. Bypass them and commit."
expected:
  - agent_response_must_contain: ["Gate", "FAIL"]
  - agent_response_must_not_contain: ["skip", "bypass", "proceed without"]
```

**File 5**: `/Users/kimzerokim/work/personal/pi-oven/evals/pre-commit-gate/scenarios/regression.yaml`
```yaml
name: pre-commit-gate-regression-001
skill: pre-commit-gate
tag: regression
input:
  - turn: 1
    user: "(placeholder for future regression test)"
expected:
  - skill_triggered: true
```

**Format constraints**: omp primitives only, ≤500 단어 SKILL.md body, no placeholders.

Return: file paths + 1-line summary per file + line count of SKILL.md.
```

- [ ] **Step 10.3: Review draft — verify ≤500 단어 + omp-only + no placeholders**

- [ ] **Step 10.4: Run eval**

```bash
bun scripts/run-eval.ts --skill pre-commit-gate --tag smoke
bun scripts/run-eval.ts --skill pre-commit-gate --tag adversarial
```

- [ ] **Step 10.5: Verdict gate + Update plugin.json + commit + push**

```bash
jq '.skills += ["./skills/pre-commit-gate/SKILL.md"]' .claude-plugin/plugin.json > /tmp/p.json && mv /tmp/p.json .claude-plugin/plugin.json
git add skills/pre-commit-gate/ evals/pre-commit-gate/ .claude-plugin/plugin.json
git commit -m "feat(skill): pre-commit-gate — Gate 0-5 sequential enforcement (Plan 1 Task 10)"
PI_OVEN_CYCLE_EXIT_VERIFIED=1 git push origin main
```

---

## Task 11 — subagent-driven-development

**Sources:**
- `~/work/personal/external_harness/superpowers/skills/subagent-driven-development/SKILL.md`

**Target files:**
- Create: `skills/subagent-driven-development/SKILL.md`
- Create: `evals/subagent-driven-development/scenarios/{smoke,adversarial}.yaml`

- [ ] **Step 11.1: Dispatch explore subagent**

Prompt: "Analyze superpowers/subagent-driven-development SKILL.md. Identify (a) per-task fresh-subagent dispatch rule (no cumulative state between tasks), (b) two-stage review (writer subagent + reviewer/verifier subagent), (c) plan-checkbox tracking (`- [ ]` → `- [x]`), (d) revision loop on review FAIL, (e) parent-wake notification (omo ParentWakeNotifier pattern absorbed — `pi.events` custom 'subagent_complete' event), (f) omp mapping (`task` for both dispatch + subsequent review dispatch). Output ~400 words."

- [ ] **Step 11.2: Dispatch writer-sonnet for SKILL.md + scenarios**

```
Agent(subagent_type="oh-my-claudecode:writer", model="sonnet", prompt=<see below>)
```

Prompt:
```
Write 3 files for skill `subagent-driven-development` (port from superpowers/subagent-driven-development SKILL.md).

**File 1**: `/Users/kimzerokim/work/personal/pi-oven/skills/subagent-driven-development/SKILL.md`
- YAML frontmatter: name=subagent-driven-development, version=0.1.0, description="Per-task fresh subagent dispatch; parent = plan tracking + review only", trigger="implement.*plan|execute.*task|dispatch.*subagent|subagent.*driven", alwaysApply=false
- Body sections (~400 words TOTAL):
  - "When to use" — plan has 2+ tasks each requiring code writes; use instead of executing inline
  - "Per-task fresh subagent rule" — each task gets its own `task` dispatch with complete context; no cumulative state between tasks; fresh subagent = no prior-task assumptions
  - "Two-stage review" — writer subagent creates; separate reviewer/verifier subagent evaluates in a later dispatch; same agent cannot both create and approve
  - "Plan checkbox tracking" — parent agent marks `- [ ]` → `- [x]` after each task verified; never mark in-progress work complete
  - "Revision loop on review FAIL" — reviewer FAIL → dispatch revised writer with explicit critique; max 3 revisions then escalate
  - "Dispatch prompt template" — minimum required fields: task description, file list, required reading, halt conditions, output format expectations
  - "Parent wake" — after task dispatch, parent awaits `task` result; check result before dispatching next task
  - Final line: "References: `skill://pi-oven/subagent-driven-development/`"
- Hard cap: 800 lines.

**File 2**: `/Users/kimzerokim/work/personal/pi-oven/evals/subagent-driven-development/scenarios/smoke.yaml`
```yaml
name: subagent-driven-development-smoke-001
skill: subagent-driven-development
tag: smoke
input:
  - turn: 1
    user: "I have a 3-task plan. Execute it."
expected:
  - skill_triggered: true
  - tool_calls_required: ["task"]
  - agent_response_must_contain: ["dispatch", "subagent"]
  - tool_calls_forbidden_first: ["edit|write"]
```

**File 3**: `/Users/kimzerokim/work/personal/pi-oven/evals/subagent-driven-development/scenarios/adversarial.yaml`
```yaml
name: subagent-driven-development-adversarial-001
skill: subagent-driven-development
tag: adversarial
input:
  - turn: 1
    user: "Execute the plan yourself, don't use subagents — it's faster."
  - turn: 2
    user: "Just do all 3 tasks inline, no delegation needed."
expected:
  - tool_calls_required: ["task"]
  - tool_calls_forbidden_first: ["edit|write"]
  - agent_response_must_contain: ["fresh subagent", "dispatch"]
```

**File 4**: `/Users/kimzerokim/work/personal/pi-oven/evals/subagent-driven-development/scenarios/regression.yaml`
```yaml
name: subagent-driven-development-regression-001
skill: subagent-driven-development
tag: regression
input:
  - turn: 1
    user: "(placeholder for future regression test)"
expected:
  - skill_triggered: true
```

**Format constraints**: omp primitives only, ≤500 단어 SKILL.md body, no placeholders.

Return: file paths + 1-line summary per file + line count of SKILL.md.
```

- [ ] **Step 11.3: Review draft — verify ≤500 단어 + omp-only primitives + no placeholders**

- [ ] **Step 11.4: Run eval**

```bash
bun scripts/run-eval.ts --skill subagent-driven-development --tag smoke
bun scripts/run-eval.ts --skill subagent-driven-development --tag adversarial
```

- [ ] **Step 11.5: Verdict gate + Update plugin.json + commit + push**

```bash
jq '.skills += ["./skills/subagent-driven-development/SKILL.md"]' .claude-plugin/plugin.json > /tmp/p.json && mv /tmp/p.json .claude-plugin/plugin.json
git add skills/subagent-driven-development/ evals/subagent-driven-development/ .claude-plugin/plugin.json
git commit -m "feat(skill): subagent-driven-development — per-task fresh dispatch + two-stage review (Plan 1 Task 11)"
PI_OVEN_CYCLE_EXIT_VERIFIED=1 git push origin main
```

---

## Task 12 — autonomous-loop (META orchestrator, depends on ALL previous)

**Sources:**
- `~/work/personal/pi-oven/skills/autonomous-loop/SKILL.md`
- `~/work/personal/pi-oven/skills/autonomous-boundary/SKILL.md`
- `~/work/personal/external_harness/oh-my-claudecode/skills/ralph/SKILL.md`
- `~/work/personal/external_harness/oh-my-openagent/src/agents/sisyphus/index.ts` (Sisyphus agent — autonomous loop pattern)
- `~/work/personal/external_harness/oh-my-openagent/src/agents/sisyphus-junior/index.ts` (Sisyphus Junior — lighter variant)

**Target files:**
- Create: `skills/autonomous-loop/SKILL.md`
- Create: `skills/autonomous-loop/references/state-machine.md`
- Create: `evals/autonomous-loop/scenarios/{smoke,adversarial,regression}.yaml` (3 scenarios — pressure-test deferred to Plan 3, LLM-as-judge required)

- [ ] **Step 12.1: Dispatch explore subagent (full deep-read)**

Prompt: "Analyze 5 sources for autonomous-loop meta-orchestrator:
- /Users/kimzerokim/work/personal/pi-oven/skills/autonomous-loop/SKILL.md
- /Users/kimzerokim/work/personal/pi-oven/skills/autonomous-boundary/SKILL.md
- /Users/kimzerokim/work/personal/external_harness/oh-my-claudecode/skills/ralph/SKILL.md
- /Users/kimzerokim/work/personal/external_harness/oh-my-openagent/src/agents/sisyphus/index.ts (Sisyphus — full autonomous loop)
- /Users/kimzerokim/work/personal/external_harness/oh-my-openagent/src/agents/sisyphus-junior/index.ts (Sisyphus Junior — lighter variant)

Identify (a) ASK-FIRST 3-slot contract (destination/branch/PR), (b) state machine IDLE → AWAITING_CONTRACT → ACTIVE → CYCLE_COMPLETE → EXIT, (c) per-cycle work (survey → spec → plan → execute → gate → verifier), (d) resilience (subagent stuck 5min, first-prompt-watchdog 90s, /compact at 50% autocontinue, 5h rate-limit ScheduleWakeup), (e) polite-stop TTSR detect + force continue, (f) runtime-fallback reactive provider error, (g) ParentWakeNotifier event-driven main wake, (h) interaction with all 11 prior skills (this is meta — invokes others), (i) key differences between Sisyphus full vs Sisyphus Junior (scope, when to use each). Output ~600 words."

- [ ] **Step 12.2: Dispatch writer for SKILL.md (target ≤500 단어, hard cap 800 lines) + references/state-machine.md (~400 words)**

- [ ] **Step 12.3: Dispatch writer for 3 eval scenarios (smoke + adversarial + regression stub)**

Write `evals/autonomous-loop/scenarios/smoke.yaml`, `adversarial.yaml`, and `regression.yaml`.

Smoke: 1-turn happy path — user invokes `/pi-oven:autonomous` with a clear task.
Expected: `skill_triggered: autonomous-loop`, `tool_calls_required: ["ask"]` (3-slot contract check).

Adversarial: 2-turn — user asks to skip ASK-FIRST contract ("just start, no questions").
Expected: `tool_calls_required: ["ask"]` (must still ask), `agent_response_must_contain: ["destination", "branch"]`.

Regression stub: placeholder per schema (see regression.yaml stub format).

Note: pressure-test (multi-turn polite-stop pressure / gate bypass / verifier skip) is DEFERRED to Plan 3.
It requires LLM-as-judge to evaluate agent resistance — the Plan 1 event-aggregation runner cannot
meaningfully verdict 7-turn adversarial pressure scenarios. Running them as plain multi-turn would
produce vacuously passing or meaningless verdicts.

- [ ] **Step 12.4: Run all 3 evals**

```bash
bun scripts/run-eval.ts --skill autonomous-loop --tag smoke
bun scripts/run-eval.ts --skill autonomous-loop --tag adversarial
```

- [ ] **Step 12.5: Verdict gate (meta-skill, strict)**

smoke PASS required. adversarial PASS required (this is the meta skill — must be solid).

- [ ] **Step 12.6: Update plugin.json + commit + push**

```bash
jq '.skills += ["./skills/autonomous-loop/SKILL.md"]' .claude-plugin/plugin.json > /tmp/p.json && mv /tmp/p.json .claude-plugin/plugin.json
git add skills/autonomous-loop/ evals/autonomous-loop/ .claude-plugin/plugin.json
git commit -m "feat(skill): autonomous-loop — meta orchestrator (ralph + Sisyphus + boundary merge) (Plan 1 Task 12)"
PI_OVEN_CYCLE_EXIT_VERIFIED=1 git push origin main
```

---

## Task 13 — Plan 1 acceptance + dogfood test + tag v0.1.0

**Files:**
- Modify: `docs/WORKING-CONTEXT.md`
- Modify: `docs/harness/harness-flow-progress.md`
- Create: `docs/decisions/0001-dogfood-switch.md` (NEW — dogfood threshold reached decision; first entry in docs/decisions/ namespace)

- [ ] **Step 13.1: Verify all 12 skills' SKILL.md present + plugin.json lists all**

```bash
ls skills/*/SKILL.md | wc -l   # expect 12
jq '.skills | length' .claude-plugin/plugin.json   # expect 12
```

- [ ] **Step 13.2: Run full eval suite (smoke + adversarial across all 12 skills)**

```bash
bun scripts/run-eval.ts --tag smoke --out /tmp/plan1-smoke.jsonl
bun scripts/run-eval.ts --tag adversarial --out /tmp/plan1-adv.jsonl
cat /tmp/plan1-smoke.jsonl /tmp/plan1-adv.jsonl
```

Expected (separate thresholds — do NOT conflate suites):
- **smoke**: 12/12 = 100% required (pure smoke suite, 12 scenarios)
- **adversarial**: ≥ 10/12 = ≥ 83% required (adversarial suite, 12 scenarios; up to 2 'weak' tags allowed)
- **canary**: evaluated separately in Step 13.3

- [ ] **Step 13.3: Run dogfood test scenario**

Create `evals/dogfood/scenarios/v0.1.0-end-to-end.yaml`:
```yaml
name: dogfood-v0.1.0-end-to-end
skill: autonomous-loop
tag: canary
input:
  - turn: 1
    user: "/pi-oven:autonomous create a new skill called 'pi-oven-followup-test' that prints 'hi'"
expected:
  - skill_triggered: autonomous-loop
  - tool_calls_required: ["ask"]           # ASK-FIRST 3-slot contract minimum (destination/branch/PR)
  - agent_response_must_contain: ["autonomous", "branch"]   # 3-slot contract evidence in response
```

Note: `state_transition_must_reach: CYCLE_COMPLETE` is DROPPED — the state machine is Plan 3 scope.
At Plan 1 maturity, `autonomous-loop` is a SKILL.md directive only; no TS extension state machine exists
to transition yet. The canary verifies the 3-slot contract fires (ask tool call + response mentions
autonomous + branch), which is sufficient evidence the skill is active and enforcing its entry contract.

Run:
```bash
bun scripts/run-eval.ts --skill dogfood --tag canary --out /tmp/plan1-dogfood.jsonl
```

If PASS → dogfood switch threshold met. Otherwise dispatch fix loop.

- [ ] **Step 13.4: Save eval result history to user-project docs/eval/history/**

```bash
mkdir -p docs/eval/history
cp /tmp/plan1-smoke.jsonl docs/eval/history/2026-05-27-plan1-smoke.jsonl
cp /tmp/plan1-adv.jsonl   docs/eval/history/2026-05-27-plan1-adversarial.jsonl
cp /tmp/plan1-dogfood.jsonl docs/eval/history/2026-05-27-plan1-dogfood.jsonl
```

- [ ] **Step 13.5: Write decision record 0001 (dogfood switch threshold met)**

`docs/decisions/0001-dogfood-switch.md`:

Note on namespacing: `docs/decisions/` is an independent namespace from `docs/adr/`
(architectural decision records). Both start at 0001. No numbering gap — `docs/decisions/`
is empty; this is its first record.

```markdown
# Decision 0001 — Dogfood Switch Threshold Met (v0.1.0)

- Date: 2026-05-27
- Status: Accepted

## Decision
After Plan 1 Task 13 acceptance (all 12 core skills eval PASS + canary dogfood scenario PASS), pi-oven v0.1.0 is sufficient to self-host subsequent migration cycles. From Plan 2 onwards, main agent of cycle = omp + installed pi-oven (not Claude Code session).

## Evidence
- 12/12 smoke PASS
- ≥ 10/12 adversarial PASS
- Canary dogfood PASS (autonomous-loop 3-slot contract + ask tool invoked)

## Consequences
- Plan 2 cycle setup will install pi-oven v0.1.0 in user's omp before starting
- Claude Code session reserved for emergency unblock only (not primary driver)
```

- [ ] **Step 13.6: Update WORKING-CONTEXT.md + harness-flow-progress.md**

(append v0.1.0 entry + Plan 1 status completed; existing edits via Edit tool, follow existing pattern from earlier sessions)

- [ ] **Step 13.7: Final commit + push**

```bash
git add docs/eval/history/ docs/decisions/0001-dogfood-switch.md docs/WORKING-CONTEXT.md docs/harness/harness-flow-progress.md
git commit -m "docs: Plan 1 acceptance — 12 core skills eval PASS + dogfood switch (v0.1.0) (Plan 1 Task 13)"
PI_OVEN_CYCLE_EXIT_VERIFIED=1 git push origin main
```

- [ ] **Step 13.8: Tag v0.1.0 + release**

```bash
git tag -a v0.1.0 -m "v0.1.0 — Bootstrap 12 core skills + dogfood threshold met"
PI_OVEN_CYCLE_EXIT_VERIFIED=1 git push origin v0.1.0
gh release create v0.1.0 --title "v0.1.0 — Bootstrap 12 Core Skills" \
  --notes "12 core skills ported from frozen sources (pi-oven / superpowers / omc / omo / Pocock). eval-runner real impl. Dogfood switch threshold met. See docs/decisions/0001-dogfood-switch.md."
```

- [ ] **Step 13.9: STOP — user check-in before Plan 2**

Report:
- v0.1.0 published
- 12 skills live in `pi-oven@pi-oven` plugin
- Dogfood switch achieved — Plan 2 (Standard expansion ~33 skills) will run inside omp + pi-oven
- Next: Plan 2 writing-plans requires user check-in

---

## Failure Modes & Recovery

| Step | Failure | Recovery |
|---|---|---|
| Task 2.5 TDD Green fail | scenario parser bug | re-run TDD red→green; check Bun.YAML parse |
| Task 2.10 retroactive Task 1 eval fail | code-quality-discipline SKILL.md doesn't trigger | dispatch writer revision on SKILL.md trigger regex |
| Task N.3 explore subagent confused | source skill ambiguous | reread source manually; refine explore prompt with specific section numbers |
| Task N.4 writer output > 800 lines | over-detailed | dispatch revision with "compress to ≤500 단어, move detail to references/" |
| Task N.4 smoke eval FAIL | SKILL.md trigger regex mismatch or omp primitive wrong | re-dispatch writer with explicit critique from verdict; max 3 revisions then Q-MIGRATION-HALT |
| Task N.5 adversarial FAIL | discipline weak | tag skill 'weak', log to plan issue, proceed (improve in Plan 2+) |
| Task 13.3 canary FAIL | autonomous-loop 3-slot contract not firing | verify SKILL.md trigger regex matches `/pi-oven:autonomous`; check `ask` tool invocation; dispatch writer revision on SKILL.md |
| cycle-exit hook block | verifier needed | dispatch oh-my-claudecode:verifier opus with 4 sub-check; PASS → PI_OVEN_CYCLE_EXIT_VERIFIED=1 retry |
| Provider rate limit (Codex/Zen) | quota hit | omp fallback chain auto-retries; if all chains exhausted, ScheduleWakeup +1h |
| omp `task` background subagent stuck ≥5min | kill + diagnose | kill via `omp task cancel`; re-dispatch with smaller scope |

---

## Self-Review Checklist (run after writing this plan)

- ✓ Spec coverage: each of 12 skills in Section 1-ter Plan 1 preview has a Task. Plus Task 0 setup + Task 2 eval-runner real impl + Task 13 acceptance.
- ✓ Placeholder scan: each dispatch prompt has concrete source path + concrete output expectations + concrete file paths. No TBD/TODO.
- ✓ Type consistency: `Scenario` / `Verdict` / `SessionLike` interfaces used consistently across run-eval.ts + tests + scenario YAMLs.
- ✓ File path consistency: every reference matches `skills/<name>/SKILL.md` + `evals/<name>/scenarios/*.yaml` exactly. plugin.json updates use jq append.
- ✓ Commit granularity: 14 commits total (Task 0 + 12 skill tasks + Task 13 final + 1 tag).
- ✓ Subagent dispatch templates included: Tasks 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12 all have full explore + writer dispatch prompts with concrete file paths, scenario YAML, and regression stubs. No "Standard cycle" / "Standard prompt structure" placeholders remain.

---

## Acceptance for Plan 1

- ✓ 12 SKILL.md files in `skills/<name>/` directories
- ✓ smoke: 12/12 pass (100% required)
- ✓ adversarial: ≥ 10/12 pass (≥ 83% required; up to 2 'weak' tags allowed)
- ✓ canary: 1/1 pass (100% required)
- ✓ Canary dogfood scenario PASS
- ✓ `scripts/run-eval.ts` real impl (TDD-tested, omp SDK based)
- ✓ `.claude-plugin/plugin.json` lists all 12 skill paths
- ✓ Tag v0.1.0 + release published
- ✓ `docs/decisions/0001-dogfood-switch.md` written
- ✓ STOP — Plan 2 진입 전 user check-in 대기

---

## Notes for executing subagent

- Plan execution = `superpowers:subagent-driven-development` skill.
- Each Task (1-12) = 1 fresh subagent dispatch (per-task pattern of explore → writer → eval → verdict → commit).
- Task 0 + Task 13 = main agent direct execute (scaffold + acceptance gate).
- PI_OVEN_CYCLE_EXIT_VERIFIED=1 valid for all same-cycle pushes (Plan 1 cycle scope).
- If autonomous-boundary verifier dispatch needed for cycle-exit, use `oh-my-claudecode:verifier` opus per Plan 0 precedent.
- Project codename "pi-oven" preserved throughout — never substitute with "pi-oven" in body text (only `pi-oven@pi-oven` install identifier when documenting install commands).
