# pi-oven Plan 0 — Scaffold Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create the omp marketplace plugin skeleton, publish to GitHub, register with omp, and verify a no-op `omp plugin install pi-oven@pi-oven` succeeds. Stop condition = end of this plan (user check-in before Plan 1).

**Architecture:** Single Bun/TypeScript package. `.claude-plugin/marketplace.json` self-references its own GitHub repo as the only plugin entry (Q1 successor / Q2 omp-only / Q6 Approach B). TS extension entry is a no-op factory (hooks wired in Plan 3). Skills/agents are empty stubs (filled in Plan 1+). CI is typecheck-only at this stage.

**Tech Stack:** Bun ≥ 1.3.14, TypeScript (bun-types), `@oh-my-pi/pi-coding-agent` SDK, git, gh CLI, GitHub Actions, omp marketplace.

**Spec reference:** `docs/specs/2026-05-27-pi-oven-foundation-design.md` Section 1 (Component Map) + Section 4 (Install Lifecycle) + Section 1-ter Plan 0 preview.

---

## File Structure (created in this plan)

| Path | Responsibility |
|---|---|
| `package.json` | Bun package metadata + omp SDK dep + scripts |
| `tsconfig.json` | Bun-types TypeScript config |
| `LICENSE` | MIT license |
| `.claude-plugin/marketplace.json` | omp catalog (self-references pi-oven) |
| `.claude-plugin/plugin.json` | Plugin manifest (skills/agents/commands metadata) |
| `.omp/extensions/pi-oven.ts` | Extension entry (empty factory; hooks Plan 3) |
| `commands/pi-oven-setup.md` | Slash command stub |
| `commands/pi-oven-doctor.md` | Slash command stub |
| `commands/pi-oven-autonomous.md` | Slash command stub |
| `scripts/run-eval.ts` | Eval runner stub (no-op; real runner Plan 1) |
| `models.yml` | Default routing template (Codex / Zen / Anthropic) |
| `README.md` | 1-line install + setup wizard preview |
| `.github/workflows/ci.yml` | Typecheck + extension build |
| `docs/WORKING-CONTEXT.md` | Current sprint + latest exec notes (Layer 4) |
| `docs/SOUL.md` | Project identity + principles (Layer 4) |
| `docs/contexts/dev.md` | Dev mode profile |
| `docs/contexts/research.md` | Research mode profile |
| `docs/contexts/review.md` | Review mode profile |
| `docs/contexts/autonomous.md` | Autonomous mode profile |
| `docs/harness/harness-flow-progress.md` | Meta cycle tracking initial entry |
| `docs/adr/0001-omp-marketplace-distribution.md` | First ADR |

Empty placeholders for: `skills/`, `agents/`, `rules/`, `evals/`, `hooks/` (created as empty dirs with `.gitkeep`; filled in Plan 1+).

---

## Task 1 — Bun Package + TypeScript Config

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`

- [ ] **Step 1.1: Create `package.json`**

```json
{
  "name": "pi-oven",
  "version": "0.1.0",
  "private": true,
  "description": "Curated omp workflow + discipline layer (5-source successor)",
  "type": "module",
  "license": "MIT",
  "author": "kimzerokim <ky200223@gmail.com>",
  "repository": {
    "type": "git",
    "url": "https://github.com/kimzerokim/pi-oven.git"
  },
  "scripts": {
    "check": "tsc --noEmit",
    "build": "bun build .omp/extensions/pi-oven.ts --outdir dist --target bun --format esm",
    "eval": "bun scripts/run-eval.ts"
  },
  "dependencies": {
    "@oh-my-pi/pi-coding-agent": "*"
  },
  "devDependencies": {
    "bun-types": "*",
    "typescript": "^5.5.0"
  },
  "omp": {
    "extensions": ["./.omp/extensions/pi-oven.ts"]
  }
}
```

- [ ] **Step 1.2: Install deps**

Run: `bun install`
Expected: `bun.lock` created, `node_modules/` populated, exit 0.

- [ ] **Step 1.3: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noEmit": true,
    "lib": ["ESNext"],
    "types": ["bun-types"],
    "esModuleInterop": true,
    "skipLibCheck": true,
    "allowSyntheticDefaultImports": true,
    "resolveJsonModule": true
  },
  "include": [".omp/extensions/**/*.ts", "scripts/**/*.ts"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 1.4: Verify typecheck (extension/scripts not created yet → vacuous PASS)**

Run: `bun check 2>&1 || true`
Expected: no errors (no input files yet → silent pass).

- [ ] **Step 1.5: Commit**

```bash
git add package.json tsconfig.json bun.lock
git commit -m "build: bun package + ts config (Plan 0 Task 1)"
```

---

## Task 2 — Marketplace Catalog + Plugin Manifest

**Files:**
- Create: `.claude-plugin/marketplace.json`
- Create: `.claude-plugin/plugin.json`
- Create: `LICENSE`

- [ ] **Step 2.1: Create `.claude-plugin/marketplace.json`**

```json
{
  "$schema": "https://anthropic.com/claude-code/marketplace.schema.json",
  "name": "pi-oven",
  "owner": { "name": "kimzerokim", "email": "ky200223@gmail.com" },
  "description": "omp marketplace catalog for pi-oven (single successor layer)",
  "plugins": [
    {
      "name": "pi-oven",
      "description": "Curated omp workflow + discipline layer absorbed from 5 frozen sources (omc/omo/Pocock/superpowers/pi-oven)",
      "source": {
        "source": "git-subdir",
        "url": "https://github.com/kimzerokim/pi-oven.git",
        "path": ".",
        "ref": "main"
      },
      "version": "0.1.0",
      "category": "workflow",
      "tags": ["autonomous", "tdd", "team-mode", "cross-vendor-critic", "pi-oven"],
      "homepage": "https://github.com/kimzerokim/pi-oven"
    }
  ]
}
```

- [ ] **Step 2.2: Create `.claude-plugin/plugin.json`**

```json
{
  "name": "pi-oven",
  "version": "0.1.0",
  "description": "Curated omp workflow + discipline layer",
  "skills": [],
  "agents": [],
  "commands": [
    "./commands/pi-oven-setup.md",
    "./commands/pi-oven-doctor.md",
    "./commands/pi-oven-autonomous.md"
  ],
  "hooks": [],
  "mcpServers": {}
}
```

- [ ] **Step 2.3: Create `LICENSE` (MIT)**

```
MIT License

Copyright (c) 2026 kimzerokim

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

- [ ] **Step 2.4: Validate JSON parseable**

Run: `jq . .claude-plugin/marketplace.json > /dev/null && jq . .claude-plugin/plugin.json > /dev/null && echo OK`
Expected: `OK`

- [ ] **Step 2.5: Commit**

```bash
git add .claude-plugin/ LICENSE
git commit -m "build: marketplace catalog + plugin manifest + MIT license (Plan 0 Task 2)"
```

---

## Task 3 — Extension Entry + Slash Command Stubs + models.yml

**Files:**
- Create: `.omp/extensions/pi-oven.ts`
- Create: `commands/pi-oven-setup.md`
- Create: `commands/pi-oven-doctor.md`
- Create: `commands/pi-oven-autonomous.md`
- Create: `models.yml`

- [ ] **Step 3.1: Create `.omp/extensions/pi-oven.ts` (no-op factory)**

```ts
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";

/**
 * pi-oven extension entry.
 *
 * Plan 0 = no-op factory. Hooks wired in Plan 3 (workflow orchestration).
 * See docs/specs/2026-05-27-pi-oven-foundation-design.md Section 2.
 */
export default function piOvenPi(pi: ExtensionAPI): void {
  pi.setLabel("pi-oven v0.1.0 (Plan 0 scaffold)");
  pi.logger.info("pi-oven loaded (no-op scaffold)");
}
```

- [ ] **Step 3.2: Create `commands/pi-oven-setup.md`**

```markdown
---
name: pi-oven-setup
description: First-run setup wizard — provider key detection, models.yml, docs/ skeleton, hook activation, doctor check
---

# /pi-oven:setup

First-run setup wizard for pi-oven. Plan 0 = stub. Plan 4 fills in real wizard (7 steps).

For now: echo readiness state.
```

- [ ] **Step 3.3: Create `commands/pi-oven-doctor.md`**

```markdown
---
name: pi-oven-doctor
description: Install health check — omp version, bun, git, provider keys, MCP, skills, state dir, eval runner
---

# /pi-oven:doctor

Sanity check. Plan 0 = stub returning "pi-oven v0.1.0 scaffold installed".

Plan 4 will implement full 9-check matrix.
```

- [ ] **Step 3.4: Create `commands/pi-oven-autonomous.md`**

```markdown
---
name: pi-oven-autonomous
description: Enter autonomous mode (ASK-FIRST 3-slot contract + state machine)
argument-hint: <task description>
---

# /pi-oven:autonomous

Enter the pi-oven autonomous loop. Plan 0 = stub returning "autonomous loop not implemented yet (Plan 3)".

Plan 3 wires the real state machine (`docs/specs/2026-05-27-pi-oven-foundation-design.md` Section 2 (A)).
```

- [ ] **Step 3.5: Create `models.yml`**

```yaml
# pi-oven default model routing
# Spec: docs/specs/2026-05-27-pi-oven-foundation-design.md Axiom 2 + 3

modelRoles:
  default:
    provider: openai-codex
    model: gpt-5
    notes: Codex OAuth subscription, primary path
  smol:
    provider: opencode-zen
    model: glm-4.5-flash
    notes: Cheap fan-out for subagents / parallel critic
  slow:
    provider: openai-codex
    model: o3
    notes: Deep reasoning / planning
  plan:
    provider: openai-codex
    model: o3
  commit:
    provider: opencode-zen
    model: glm-4.5-flash

retry:
  fallbackChains:
    default:
      - { provider: openai-codex, model: gpt-5 }
      - { provider: opencode-zen, model: glm-4.6 }
      - { provider: anthropic, model: claude-opus-4-7, opt_in: true }
    smol:
      - { provider: opencode-zen, model: glm-4.5-flash }
      - { provider: opencode-zen, model: kimi-k2 }

# Anthropic native = opt-in (Pro/Max 가 3rd party 호출 불가 → token billing 사용자 only)
optional_providers:
  anthropic:
    enabled: false
    notes: Set enabled=true and ANTHROPIC_API_KEY to add to fallback chain
```

- [ ] **Step 3.6: Verify typecheck passes**

Run: `bun check 2>&1`
Expected: no TS errors. (extension is single file with logger; omp SDK types resolved.)

- [ ] **Step 3.7: Commit**

```bash
git add .omp/ commands/ models.yml
git commit -m "feat: extension entry stub + 3 slash commands + models.yml (Plan 0 Task 3)"
```

---

## Task 4 — Eval Runner Stub + CI Workflow

**Files:**
- Create: `scripts/run-eval.ts`
- Create: `.github/workflows/ci.yml`

- [ ] **Step 4.1: Create `scripts/run-eval.ts` (no-op skeleton)**

```ts
#!/usr/bin/env bun
/**
 * pi-oven eval runner (Plan 0 stub).
 *
 * Plan 1 implements the real runner using omp SDK
 * (createAgentSession + ModelRegistry).
 *
 * See docs/specs/2026-05-27-pi-oven-foundation-design.md Section 1-bis.
 */

interface EvalArgs {
  skill?: string;
  scenario?: string;
  tag?: string;
}

function parseArgs(argv: string[]): EvalArgs {
  const args: EvalArgs = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--skill") args.skill = argv[++i];
    else if (a === "--scenario") args.scenario = argv[++i];
    else if (a === "--tag") args.tag = argv[++i];
  }
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(Bun.argv.slice(2));
  console.log("pi-oven eval runner (Plan 0 stub)");
  console.log("Args:", JSON.stringify(args));
  console.log("→ No-op. Real runner in Plan 1.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 4.2: Run eval stub to verify**

Run: `bun scripts/run-eval.ts --skill demo --tag smoke`
Expected output:
```
pi-oven eval runner (Plan 0 stub)
Args: {"skill":"demo","tag":"smoke"}
→ No-op. Real runner in Plan 1.
```
Exit 0.

- [ ] **Step 4.3: Create `.github/workflows/ci.yml`**

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  typecheck-and-build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: 1.3.14
      - name: Install deps
        run: bun install --frozen-lockfile
      - name: Typecheck
        run: bun check
      - name: Build extension
        run: bun run build
      - name: Eval stub smoke
        run: bun scripts/run-eval.ts --tag smoke
      - name: Validate marketplace catalog JSON
        run: |
          jq . .claude-plugin/marketplace.json > /dev/null
          jq . .claude-plugin/plugin.json > /dev/null
```

- [ ] **Step 4.4: yamllint locally (best-effort)**

Run: `yamllint .github/workflows/ci.yml 2>/dev/null || python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml'))" && echo OK`
Expected: `OK` (parses).

- [ ] **Step 4.5: Commit**

```bash
git add scripts/run-eval.ts .github/workflows/ci.yml
git commit -m "ci: eval runner stub + GitHub Actions typecheck pipeline (Plan 0 Task 4)"
```

---

## Task 5 — README + docs/ Skeleton + ADR 0001

**Files:**
- Create: `README.md`
- Create: `docs/WORKING-CONTEXT.md`
- Create: `docs/SOUL.md`
- Create: `docs/contexts/dev.md`
- Create: `docs/contexts/research.md`
- Create: `docs/contexts/review.md`
- Create: `docs/contexts/autonomous.md`
- Create: `docs/harness/harness-flow-progress.md`
- Create: `docs/adr/0001-omp-marketplace-distribution.md`
- Create: `skills/.gitkeep`, `agents/.gitkeep`, `rules/.gitkeep`, `evals/.gitkeep`, `hooks/.gitkeep`

- [ ] **Step 5.1: Create `README.md`**

```markdown
# pi-oven

> Curated omp workflow + discipline layer. 5-source successor (omc / omo / Pocock skills / superpowers / pi-oven). omp marketplace plugin.

## Install (one line)

```sh
omp plugin marketplace add kimzerokim/pi-oven
omp plugin install pi-oven@pi-oven
```

Pre-requisites: omp ≥ requirement, bun ≥ 1.3.14, git, **provider key 1개 이상** (OpenAI Codex OAuth / OpenCode Zen / Anthropic native).

## First-run

After install, pi-oven setup wizard auto-triggers (or run `/pi-oven:setup`):

1. Provider key detection (Codex OAuth / Zen / Anthropic optional)
2. Model role config (models.yml — default / smol / slow / plan / commit)
3. First benchmark (optional, model × skill matrix)
4. docs/ skeleton (WORKING-CONTEXT / SOUL / contexts / decisions / adr / ...)
5. Hook + TTSR activation
6. MCP server detection + opt-in (github / Context7 required)
7. `/pi-oven:doctor` sanity check

## Current Status

**v0.1.0 (Plan 0 scaffold)** — empty plugin shell. Skills + agents + workflow extension land in Plan 1-4.

See `docs/specs/2026-05-27-pi-oven-foundation-design.md` for the full design.

## Documentation

- `docs/specs/` — design specs
- `docs/plans/` — implementation plans
- `docs/adr/` — architecture decisions
- `docs/SOUL.md` — project identity
- `docs/WORKING-CONTEXT.md` — current sprint state

## License

MIT
```

- [ ] **Step 5.2: Create `docs/WORKING-CONTEXT.md`**

```markdown
# Working Context

Last updated: 2026-05-27

## Purpose

pi-oven v1 build. omp marketplace plugin as single successor for 5 frozen sources (omc / omo / Pocock / superpowers / pi-oven).

## Current Sprint

- **v0.1.0 (Plan 0)** — Scaffold + GitHub repo + omp marketplace add + plugin install verify. **In progress.**

## Active Queues

- Plan 0: 8 tasks (scaffold + publish + install verify)
- Plan 1 (queued): Bootstrap 12 core skills
- Plan 2/3/4 (deferred): Standard expansion / TS extension / Polish + release

## Current Constraints

- omp-only (Q2). Claude Code cross-harness 동작은 부산물, maintain 안 함.
- Distributed SoT (Approach B). No `harness-share.md` hub.
- Codex OAuth + Zen 양대 default. Anthropic native opt-in.

## Latest Execution Notes

- 2026-05-27: Foundation design spec committed (`ed6c4c3`). Plan 0 작성 시작.
- 2026-05-27: brainstorming session (Q1-Q6 + 3 axioms + ECC pattern absorption + memory layer + install lifecycle + testing strategy) 완료.
- 2026-05-27: Previous design + Plan 1 installer foundation (1313 LoC) SUPERSEDED. Pivot to omp-native, marketplace-distributed.

## Update Rule

Detailed for current sprint + blockers + next actions only. Completed work summarized into archive once it stops shaping execution.
```

- [ ] **Step 5.3: Create `docs/SOUL.md`**

```markdown
# Soul — pi-oven

## Core Identity

pi-oven is the omp-native workflow + discipline layer. Single successor for 5 frozen sources (omc / omo / Pocock / superpowers / pi-oven). Distributed as one omp marketplace plugin.

## Core Principles

1. **Tool × Workflow Ceiling** — omp 의 tool 성능 × omo/omc/superpowers/pi-oven 의 workflow orchestration pattern. 둘 다 최고.
2. **Distributed SoT (Approach B)** — 각 SKILL.md 자기-완결. shared discipline 은 TS extension + TTSR + inline boilerplate 3 layer 로 enforce. no hub doc.
3. **Self-Evaluating** — eval scenarios + CI + invariant audits 가 distributed SoT 의 누락을 catch.
4. **Dogfood** — pi-oven 가 자기 자신을 build 하는 cycle 자체가 가장 가혹한 eval.
5. **OSS, single-plugin publisher** — commercial layer 없음, multi-tenancy 없음, billing 없음. 우리는 omp marketplace 의 한 entry 일 뿐.
6. **OpenCode Zen first + Codex OAuth 헤비 + Anthropic native opt-in** — 모델 routing 의 cost reality.

## Agent Orchestration Philosophy

ralph autonomous loop (single agent self-improvement) + team mode (multi-agent parallel) 둘 다 first-class. ASK-FIRST 3-slot contract (destination / branch / PR) mandatory before autonomous entry. Fresh-verifier exit gate mandatory before cycle transition. Polite stop forbidden.

## Cross-Harness Stance

omp 1급 target. Claude Code 자동 디스커버리는 부산물 (markdown 자원만 동작, TS extension 의 시그니처 hook 은 omp-only).
```

- [ ] **Step 5.4: Create `docs/contexts/dev.md`**

```markdown
# Development Mode Profile

Mode: Active development
Focus: Implementation, coding, building features

## Behavior
- Write code first, explain after
- Prefer working solutions; refactor in separate pass
- Run tests + typecheck after changes
- Atomic commits (conventional commit style)

## Priorities
1. Get it working (TDD red → green)
2. Get it right (refactor)
3. Get it clean (final lint + invariant audit)

## Tools to favor
- omp `read` / `edit` / `ast_edit` for code
- omp `bash` for tests / builds / git
- omp `task` for subagent dispatch (sonnet executor)
- omp `lsp` for navigation / rename
```

- [ ] **Step 5.5: Create `docs/contexts/research.md`**

```markdown
# Research Mode Profile

Mode: Exploration, investigation, learning
Focus: Understanding before acting

## Behavior
- Read widely before concluding
- Document findings as you go (docs/research/<date>-<topic>.md)
- Don't write code until understanding is clear

## Process
1. Understand the question
2. Explore code/docs (omp `task` Explore subagent)
3. Form hypothesis
4. Verify with evidence
5. Summarize findings

## Tools to favor
- omp `read` / `search` / `find` for code
- omp `web_search` / Context7 for external docs
- omp `task` Explore subagent for big questions
```

- [ ] **Step 5.6: Create `docs/contexts/review.md`**

```markdown
# Review Mode Profile

Mode: PR review, code analysis
Focus: Quality, security, maintainability

## Behavior
- Read thoroughly before commenting
- Prioritize by severity (P0 > P1 > P2 > P3)
- Suggest fixes, not just point out problems
- Check for security vulnerabilities

## Checklist
- Logic errors / edge cases
- Error handling
- Security (injection, auth, secrets)
- Performance hot paths
- Readability
- Test coverage
- SoT consistency (decisions / ADR / WORKING-CONTEXT alignment)

## Output Format
Group by file, severity-first.
```

- [ ] **Step 5.7: Create `docs/contexts/autonomous.md`**

```markdown
# Autonomous Mode Profile

Mode: Autonomous execution (ralph / loop)
Focus: Multi-cycle self-driving with discipline gates

## Behavior
- ASK-FIRST 3-slot contract on entry (destination / branch / PR mode)
- Fresh-verifier mandatory exit gate before cycle transition
- Polite stop FORBIDDEN. Force continue via TTSR rule.
- Auto `/compact` at 50% context with remaining-tasks summary

## Gates
- Pre-commit Gate 0-5 (sequential, FAIL = block)
- Fact-force gate (first-edit per file demand investigation)
- Config protection (linter/formatter config edits blocked)
- MCP health check (server unhealthy → block tool exec)

## Stuck Detection
- subagent ≥ 5min no progress → kill + diagnose + retry
- first-prompt-watchdog 90s (cold-start)
- main turn idle ≥ 3min → wake-up

## State
- `.pi-oven/state/autonomous.json` persists state machine
- `docs/harness/user-queue.md` collects ambiguous decisions for user batch resolve
- `docs/harness/harness-flow-progress.md` tracks meta cycles
```

- [ ] **Step 5.8: Create `docs/harness/harness-flow-progress.md`**

```markdown
# Harness Flow Progress

Meta cycle tracking. Each entry = one self-improvement / build cycle of pi-oven.

## 2026-05-27 — Plan 0 Scaffold

- Cycle: pi-oven v0.1.0 bootstrap
- Source: brainstorm session 2026-05-27 (Q1-Q6, 3 axioms, 5 sections)
- Spec: `docs/specs/2026-05-27-pi-oven-foundation-design.md`
- Plan: `docs/plans/2026-05-27-pi-oven-plan-0-scaffold.md`
- Mode: autonomous, stop condition = end of Plan 0
- Status: in progress
```

- [ ] **Step 5.9: Create `docs/adr/0001-omp-marketplace-distribution.md`**

```markdown
# ADR 0001 — omp Marketplace as Sole Distribution Channel

- **Date:** 2026-05-27
- **Status:** Accepted
- **Context:** pi-oven 의 install / upgrade / uninstall 메커니즘 결정 필요.

## Decision

pi-oven 의 sole distribution mechanism = **omp marketplace** (`.claude-plugin/marketplace.json` 호환 catalog, GitHub repo self-hosted). 자체 인스톨러 / npm direct mirror (v1) / commercial registry 없음.

## Rationale

1. omp marketplace 가 bun-install 백엔드 + lockfile + version-pin + scope (user/project) + feature flags 모두 처리 → 우리가 멱등성 / upgrade / rollback 인프라 새로 만들 필요 없음.
2. 이전 design (Plan 1 installer foundation, 1313 LoC) 가 SUPERSEDED 된 이유 = omp marketplace 가 그 책임 흡수.
3. catalog 가 GitHub repo self-reference → catalog + plugin source 같은 repo 안 동거 (가장 단순).
4. Cross-harness 자동 디스커버리 (omp 가 `.claude/`, `.cursor/`, `.codex/` 등 디스커버리) → pi-oven markdown 자원 자동 cross-harness 부산물.

## Consequences

- npm publish 는 v2 옵션 (현재 skip)
- catalog `plugins[]` = 1 entry (pi-oven 자신). sub-plugin 분할 없음 (Q1 successor 단일 layer 결정과 align)
- single-plugin publisher 정체성. marketplace operator / plugin scoring / commercial layer 없음.

## Alternatives Considered

- Self-hosted installer (Plan 1 SUPERSEDED): 인프라 부담 + omp marketplace 와 중복
- npm direct (`bun install -g @pi-oven/pi`): omp 가 npm source 도 지원하지만 marketplace 단순성 우선
- Multi-marketplace (pi-oven-core / superpowers-port 분할): Q1 successor 결정 충돌

## Spec Reference

`docs/specs/2026-05-27-pi-oven-foundation-design.md` Section 4 (Install Lifecycle)
```

- [ ] **Step 5.10: Create empty placeholders**

```bash
mkdir -p skills agents rules evals hooks
touch skills/.gitkeep agents/.gitkeep rules/.gitkeep evals/.gitkeep hooks/.gitkeep
```

- [ ] **Step 5.11: Commit**

```bash
git add README.md docs/ skills/.gitkeep agents/.gitkeep rules/.gitkeep evals/.gitkeep hooks/.gitkeep
git commit -m "docs: README + WORKING-CONTEXT + SOUL + contexts + ADR 0001 + scaffold dirs (Plan 0 Task 5)"
```

---

## Task 6 — GitHub Repo Create + Remote + Push

**Files:** (no local file changes; GitHub + git remote ops)

- [ ] **Step 6.1: Create GitHub repo via gh**

Run:
```bash
gh repo create kimzerokim/pi-oven --public \
  --description "Curated omp workflow + discipline layer — 5-source successor (omc/omo/Pocock/superpowers/pi-oven) as a single omp marketplace plugin"
```

Expected: `✓ Created repository kimzerokim/pi-oven on GitHub`

- [ ] **Step 6.2: Verify repo created**

Run: `gh repo view kimzerokim/pi-oven --json name,visibility,defaultBranchRef -q '.name + " " + .visibility'`
Expected: `pi-oven PUBLIC`

- [ ] **Step 6.3: Add remote**

Run: `git remote add origin https://github.com/kimzerokim/pi-oven.git && git remote -v`
Expected: `origin  https://github.com/kimzerokim/pi-oven.git (fetch)` + `(push)`

- [ ] **Step 6.4: Push main**

Run: `git push -u origin main`
Expected: `Branch 'main' set up to track 'origin/main'.` + commits pushed.

- [ ] **Step 6.5: Verify catalog fetchable**

Run: `curl -sf https://raw.githubusercontent.com/kimzerokim/pi-oven/main/.claude-plugin/marketplace.json | jq -r '.name'`
Expected: `pi-oven`

---

## Task 7 — omp Marketplace Register + Plugin Install Verify

**Files:** (no local changes; omp plugin operations)

- [ ] **Step 7.1: Add marketplace to omp**

Run: `omp plugin marketplace add kimzerokim/pi-oven`
Expected: marketplace catalog cloned + cached + listed.

If `omp` CLI not on PATH: skip with warning + manual verification log; continue (omp install is user-side, may be verified later in setup wizard).

- [ ] **Step 7.2: List marketplaces (verify registration)**

Run: `omp plugin marketplace list 2>&1`
Expected: `pi-oven` 표시.

- [ ] **Step 7.3: Install pi-oven plugin**

Run: `omp plugin install pi-oven@pi-oven 2>&1`
Expected (v15.5.3 observed): plugin cache 디렉토리 생성 (`~/.omp/plugins/cache/plugins/pi-oven___pi-oven___0.1.0/`) → `~/.omp/plugins/installed_plugins.json` (v2 schema) 에 entry 추가.

- [ ] **Step 7.4: Verify install on disk**

Run:
```bash
ls -la ~/.omp/plugins/cache/plugins/pi-oven___pi-oven___0.1.0/ 2>&1 | head -20
jq '.plugins."pi-oven@pi-oven"[0]' ~/.omp/plugins/installed_plugins.json
```
Expected: plugin cache 디렉토리 존재 + installed_plugins.json 에 `{scope, version, installPath, installedAt, lastUpdated}` entry.

- [ ] **Step 7.5: Verify omp loads the plugin (extension log line)**

Run: `omp --version 2>&1` (or smoke test that doesn't enter TUI)
Expected: pi-oven extension load 메시지 ("pi-oven loaded (no-op scaffold)") 또는 silent OK.

If omp 가 first-load 시 setup wizard 자동 trigger 안 한다면 (Plan 0 에서는 wizard 가 stub), 그냥 plugin discovery 성공 확인으로 충분.

---

## Task 8 — Final Commit + Working-Context Update + STOP

**Files:**
- Modify: `docs/WORKING-CONTEXT.md` (add Plan 0 완료 latest exec note)
- Modify: `docs/harness/harness-flow-progress.md` (Plan 0 status = done)

- [ ] **Step 8.1: Append Plan 0 완료 entry to `docs/WORKING-CONTEXT.md`**

Add under "Latest Execution Notes":

```markdown
- 2026-05-27: Plan 0 scaffold completed. GitHub repo kimzerokim/pi-oven published. omp marketplace add + plugin install verified. v0.1.0 shell live.
```

- [ ] **Step 8.2: Update `docs/harness/harness-flow-progress.md` Plan 0 status**

Change `Status: in progress` → `Status: completed (v0.1.0)`. Add link to commit SHA range.

- [ ] **Step 8.3: Verify clean tree before final commit**

Run: `git status --short`
Expected: 2 modified files (WORKING-CONTEXT.md + harness-flow-progress.md).

- [ ] **Step 8.4: Final commit + push**

```bash
git add docs/WORKING-CONTEXT.md docs/harness/harness-flow-progress.md
git commit -m "docs: Plan 0 scaffold completed — v0.1.0 published + installed (Plan 0 Task 8)"
git push origin main
```

- [ ] **Step 8.5: Tag v0.1.0 release**

```bash
git tag -a v0.1.0 -m "v0.1.0 Plan 0 scaffold — empty plugin shell"
git push origin v0.1.0
gh release create v0.1.0 --title "v0.1.0 Plan 0 Scaffold" \
  --notes "Empty plugin shell. Skills + agents + workflow extension land in Plan 1-4. See docs/specs/2026-05-27-pi-oven-foundation-design.md."
```

- [ ] **Step 8.6: STOP — user check-in**

Stop condition reached (3-slot contract). Report to user:
- v0.1.0 published at https://github.com/kimzerokim/pi-oven
- omp plugin install verified
- next: Plan 1 (Bootstrap 12 core skills) requires user check-in to proceed

Wait for user OK before invoking writing-plans for Plan 1.

---

## Failure Modes & Recovery

| Step | Failure | Recovery |
|---|---|---|
| 1.2 `bun install` | network / registry | retry; if persistent, check `~/.npmrc` / Bun version |
| 4.2 eval stub | TS error | run `bun check` first, fix |
| 6.1 `gh repo create` | repo already exists | use existing repo (`gh repo view ...`); skip create |
| 6.4 `git push` | non-fast-forward / auth | `gh auth status`; pull then push |
| 7.1 `omp plugin marketplace add` | omp CLI missing | log warning + skip; resume in setup wizard (Plan 4) |
| 7.3 `omp plugin install` | bun install failure inside omp | check `~/.omp/plugins/installed_plugins.json` (v2) + plugin cache dir; retry |

---

## Self-Review Checklist (run after writing this plan)

- ✓ Spec coverage: Plan 0 의 모든 Task 가 design spec Section 1 + 4 + 1-ter Plan 0 preview 와 일치
- ✓ Placeholder scan: 모든 step 이 actual code / command / expected output 포함
- ✓ Type consistency: ExtensionAPI / Bun import / yaml schema 모두 일관
- ✓ File path 명시: 모든 Files 섹션 + step 의 path 정확
- ✓ Commit granularity: 각 Task 의 마지막 step = 1 commit (총 7 commits + 1 final + 1 tag)

## Acceptance for Plan 0

- ✓ GitHub repo `kimzerokim/pi-oven` public, main branch, commits + tag v0.1.0 pushed
- ✓ `.claude-plugin/marketplace.json` fetchable + valid
- ✓ `omp plugin install pi-oven@pi-oven` exit 0, plugin entry in lockfile
- ✓ `~/.omp/plugins/cache/plugins/pi-oven___pi-oven___0.1.0/` 디렉토리 존재 + `.claude-plugin/` + `.omp/extensions/pi-oven.ts` 모두 present (v15.5.3 actual layout)
- ✓ CI run on first push = green (typecheck + extension build + eval stub + JSON validate)
- ✓ docs/ skeleton (WORKING-CONTEXT / SOUL / contexts / ADR 0001 / harness-flow-progress) 모두 commit
- ✓ STOP — Plan 1 진입 전 user check-in 대기
