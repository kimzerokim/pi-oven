---
name: team
version: 0.1.0
description: Multi-agent orchestration on shared task list; dispatches N pi-oven:* agents in parallel via task tool
trigger: "team mode, multi-agent, parallel agents on shared task, /team, /pi-oven:team"
alwaysApply: false
---

# team

## Purpose

Orchestrates N coordinated `pi-oven:*` agents working on a shared task list. The lead decomposes a high-level task into subtasks, dispatches N workers in parallel with pre-assigned ownership, monitors progress, coordinates unblocking, and synthesizes results.

Applicable when multiple independent work items can proceed simultaneously and benefit from specialized agents per task type.

## When to use

- Multiple independent tasks can run in parallel
- User says "team mode", "multi-agent", "/team", "/pi-oven:team", "parallel agents"
- Task benefits from specialized agents per subtask (executor for implementation, verifier for review, designer for UI)
- Large scope where concurrent execution significantly reduces wall time

## When not to use

- Single sequential task with no parallelism — use `subagent-driven-development` instead
- Task requires guaranteed persistence loop across failures — wrap with `autonomous-loop`
- No meaningful decomposition is possible (monolithic sequential work)

## Staged pipeline

```
team-plan → team-exec → team-verify → team-fix (loop)
```

### Stage agent routing

| Stage | Primary agents | Selection criteria |
|-------|---------------|-------------------|
| `team-plan` | `pi-oven:explorer` (haiku), `pi-oven:planner` (sonnet) | Use `pi-oven:planner` (opus) for complex system boundaries or ambiguous requirements |
| `team-exec` | `pi-oven:executor` (sonnet) | Match agent to subtask type: `pi-oven:designer` for UI, `pi-oven:debugger` for build errors, `pi-oven:writer` for docs, `pi-oven:test-engineer` for test authoring |
| `team-verify` | `pi-oven:verifier` (sonnet) | Add `pi-oven:security-reviewer` for auth/crypto changes; add `pi-oven:code-reviewer` (opus) for > 20 files or architectural changes |
| `team-fix` | `pi-oven:executor` (sonnet) | Use `pi-oven:debugger` (sonnet) for type/build errors; use `pi-oven:executor` (opus) for complex multi-file fixes |

### Verify/fix loop stop conditions

Continue `team-exec → team-verify → team-fix` until:
1. Verification passes and no required fix tasks remain, OR
2. Fix attempts exceed 3 iterations — transition to terminal `failed` state (no infinite loop)

## Execution phases

### Phase 1: Parse input

Extract from the user's message:
- **N**: agent count (1–20); default to auto-sizing based on task decomposition
- **agent-type**: override for the `team-exec` stage worker type (optional); other stages use stage-appropriate specialists
- **task**: high-level task description

### Phase 2: Analyze and decompose

Dispatch `pi-oven:explorer` or `pi-oven:planner` to analyze the codebase and break the task into N subtasks:
- Each subtask must be file-scoped or module-scoped to avoid conflicts
- Subtasks must be independent or have explicit dependency ordering
- Each subtask needs a concise subject and a detailed description
- Identify blocking dependencies between subtasks (e.g., "shared types must be fixed before consumers")

### Phase 3: Create task list

Write `.omc/team-{slug}/tasks.json`. Each entry:
```json
{
  "id": "1",
  "subject": "Fix type errors in src/auth/",
  "description": "Fix all TypeScript errors in src/auth/login.ts and src/auth/session.ts. Run tsc --noEmit to verify.",
  "owner": "worker-1",
  "status": "pending",
  "blockedBy": []
}
```

Pre-assign owners from the lead before spawning workers. There is no atomic claiming — pre-assignment prevents race conditions.

### Phase 4: Spawn workers

Dispatch N workers in parallel — all at once in a single response turn, not sequentially. Each dispatch uses the `task` tool with:
- A preamble establishing the worker protocol (see Worker preamble below)
- The worker's assigned task IDs and descriptions
- The stage handoff document for context

### Phase 5: Monitor

Periodically check task statuses via the task list file. On worker completion: mark the task done, unblock dependent tasks, assign idle workers to pending tasks.

**Watchdog**: if a task stays `in_progress` for more than 5 minutes without a result, reassign it to another worker. If a worker fails 2+ tasks, stop assigning new tasks to it.

### Phase 6: Verify and fix

After all `team-exec` tasks complete, dispatch `pi-oven:verifier` for `team-verify`. If verification fails, generate fix tasks and re-dispatch `pi-oven:executor` or `pi-oven:debugger`. Loop until verification passes or max fix iterations (3) are reached.

### Phase 7: Completion

Confirm all tasks complete. Report summary to user.

## Stage handoff convention

Each completing stage writes `.omc/handoffs/{stage}.md` before the next stage spawns. Workers receive this handoff in their prompt for full context.

**Handoff format** (10–20 lines maximum):
```markdown
## Handoff: {current-stage} → {next-stage}

- **Decided**: [key decisions made in this stage]
- **Rejected**: [alternatives considered and why rejected]
- **Risks**: [identified risks for the next stage]
- **Files**: [key files created or modified]
- **Remaining**: [items left for the next stage]
```

Handoffs accumulate — the verify stage can read all prior handoffs (plan → exec) for full decision history. Handoff files survive team cancellation and are not deleted on cleanup.

## Worker preamble

Include this preamble in every worker's prompt. Adapt per worker with their specific task assignments:

```
You are a TEAM WORKER. Your assigned tasks are listed below.
You report results by returning a JSON summary when your work is complete.

WORK PROTOCOL:
1. Read your assigned task descriptions carefully.
2. Execute the task using Read, Write, Edit, and Bash tools.
3. Do NOT spawn sub-agents. Do NOT use the task tool. Work directly.
4. Use absolute file paths at all times.
5. When done, return a JSON summary:
   { "taskId": "ID", "status": "completed", "summary": "what was done" }
   or
   { "taskId": "ID", "status": "failed", "reason": "why it failed" }

BLOCKED TASKS:
If your task has blockedBy dependencies, report back immediately:
{ "taskId": "ID", "status": "blocked", "blockedBy": ["ID"] }
The lead will re-assign when blockers clear.

RULES:
- NEVER spawn sub-agents or use the task tool
- ALWAYS use absolute file paths
- Report every task result (completed or failed) — never go silent
```

## Agent selection examples

| Task type | Agent |
|-----------|-------|
| TypeScript/build error fixes | `pi-oven:executor` (sonnet) or `pi-oven:debugger` (sonnet) |
| UI component implementation | `pi-oven:designer` (sonnet) |
| Documentation writing | `pi-oven:writer` (haiku) |
| Test authoring | `pi-oven:test-engineer` (sonnet) |
| Security audit | `pi-oven:security-reviewer` (sonnet) |
| Architecture review | `pi-oven:code-reviewer` (opus) |
| Complex multi-file refactors | `pi-oven:executor` (opus) |

## Tool usage

- `task` with `run_in_background: true` to dispatch workers in parallel (all in one turn)
- `pi-oven:explorer` / `pi-oven:planner` for task decomposition in `team-plan`
- `pi-oven:verifier` for `team-verify`
- Write for task list and handoff files (`.omc/team-{slug}/tasks.json`, `.omc/handoffs/`)

## Dispatch constraints

- Workers must not spawn sub-agents — the `task` tool is for the lead only
- Workers must use absolute file paths
- Workers report results via return value, not secondary dispatches
- The lead pre-assigns task ownership before spawning — workers work only their assigned tasks

## Stop conditions

- User says "stop" or "cancel": gracefully shut down workers, mark phase `cancelled`, preserve handoff files
- Fix loop exceeds 3 iterations: transition to terminal `failed` state, report to user
- Worker fails 2+ tasks: stop assigning to that worker, reassign its tasks

## Examples

**Parallel TypeScript error fixes:**
```
User: /pi-oven:team 3 fix all TypeScript errors across the project

[Phase 2] Decomposition:
  Subtask 1: Fix type errors in src/auth/ (owner: worker-1)
  Subtask 2: Fix type errors in src/api/ (owner: worker-2)
  Subtask 3: Fix type errors in src/utils/ (owner: worker-3)

[Phase 4] Spawn all 3 workers in parallel (single response turn, run_in_background: true)
  worker-1 → pi-oven:executor, assigned subtask 1
  worker-2 → pi-oven:executor, assigned subtask 2
  worker-3 → pi-oven:executor, assigned subtask 3

[Phase 5] Monitor: worker-1 completes, worker-2 completes, worker-3 completes

[Phase 6] pi-oven:verifier runs team-verify → passes

[Phase 7] Summary: 3 subtasks completed, 0 failed
```

**Mixed agent types — feature build:**
```
User: team mode: build the user profile feature

[Phase 2] Decomposition:
  Subtask 1: Implement profile API endpoints (owner: worker-1 → pi-oven:executor)
  Subtask 2: Build profile UI components (owner: worker-2 → pi-oven:designer)
  Subtask 3: Write profile API tests (owner: worker-3 → pi-oven:test-engineer)
  Subtask 4: Write API documentation (owner: worker-4 → pi-oven:writer)
  Note: subtasks 2, 3, 4 are blocked by subtask 1

[Phase 4] Spawn worker-1 first; workers 2, 3, 4 start after subtask 1 unblocks them
```

**Bad — sequential spawning:**
```
[Phase 4] Spawn worker-1, wait for completion, then spawn worker-2...
```
Wrong: workers must be dispatched in parallel in a single turn. Sequential spawning eliminates the parallelism benefit.

**Bad — worker spawning sub-agents:**
```
Worker-1 prompt: "You may spawn pi-oven:executor sub-agents if the task is complex."
```
Wrong: workers are leaf-node executors. Sub-spawning creates uncontrolled recursion. The lead is the sole orchestrator.
