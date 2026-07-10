---
name: pov:git-workflow
version: 0.1.0
description: "Read this skill when starting isolated feature work, executing inside a worktree, or finishing and integrating a branch. Manages the two boundaries of a development branch: set up a worktree at the start, integrate at the finish."
---

# git-workflow

One skill, two boundaries of a development branch: **start** (isolate) and **finish** (integrate). The same environment-detection logic governs both.

**Core principle:** Detect existing isolation before creating any. Defer to the harness's native worktree tooling. Fall back to raw `git worktree` only when no native tool exists. Never fight the harness with phantom state it cannot see.

## Dispatch discipline (main orchestrates, subagents do the work)

Do NOT do this skill's substantive work in the main context. Main's direct-action budget is narrow: 1–2 simple file edits (≤30 LoC) or operational commands (`git status`, `ls`, install). ANY multi-file change, 3+ file reads, 200+ LoC, or multi-step investigation/implementation MUST be dispatched. Main only dispatches, synthesizes, and reviews — it never implements inline. (See `large-task-delegation` + `subagent-driven-development`.)
**Right-agent routing** (model-fit + role-fit is first-class — use these exact names): complex history surgery / multi-file staging / rebase / any git mutation → `pi-oven:git-master`; clean-baseline + pre-finish test evidence → `pi-oven:verifier`; unclear isolation/worktree state recon → `pi-oven:explorer`.

## When to use

- **Start**: beginning feature work that must not touch the current branch, or before executing a `writing-plans` plan.
- **Finish**: implementation done, tests green, and the branch needs merge / PR / keep / discard.

Skip the start path entirely if Step 0 finds you already isolated.

---

## START — Isolate the workspace

### Step 0 — Detect existing isolation

```bash
GIT_DIR=$(cd "$(git rev-parse --git-dir)" 2>/dev/null && pwd -P)
GIT_COMMON=$(cd "$(git rev-parse --git-common-dir)" 2>/dev/null && pwd -P)
git rev-parse --show-superproject-working-tree 2>/dev/null   # non-empty = submodule, NOT a worktree
```

- `GIT_DIR != GIT_COMMON` and **not** a submodule → already in a linked worktree. Skip to Project Setup.
- `GIT_DIR == GIT_COMMON` (or a submodule) → normal checkout. If the user has not already declared a worktree preference, ask consent before creating one. Honor a declared preference without asking; if declined, work in place.

### Step 1 — Create the workspace

1. **Native tooling first.** If the harness exposes a worktree primitive (e.g. an `EnterWorktree` tool, a `/worktree` command, or a `--worktree` flag), use it and skip to Project Setup. Native tooling owns placement, branch creation, and cleanup — `git worktree add` on top of it creates state the harness cannot track.
2. **Git fallback (only if no native tool).** Directory priority: declared preference → existing `.worktrees/` (wins over `worktrees/`) → legacy global path → default `.worktrees/`. For project-local dirs, verify ignored (`git check-ignore -q .worktrees`) before creating; if not ignored, add to `.gitignore` and commit. Then `git worktree add "$path" -b "$BRANCH"`. On a sandbox permission error, tell the user and work in place.

### Step 2 — Project Setup + clean baseline

Auto-detect and install (`package.json`→install, `Cargo.toml`→build, `pyproject.toml`/`requirements.txt`→install, `go.mod`→download). Then run the project test suite to confirm a clean starting point. Report the worktree path, baseline test result, and the feature about to be built. If the baseline fails, report failures and ask before proceeding — never blur pre-existing failures into new work.

---

## FINISH — Integrate the branch

### Step 1 — Verify tests (gate)

Run the project suite. If it fails, stop and report — no menu until green. Merging or PR-ing a red branch is forbidden.

### Step 2 — Detect environment + base branch

Recompute `GIT_DIR` / `GIT_COMMON`. Resolve the base via `git merge-base HEAD main || git merge-base HEAD master`, or ask if ambiguous.

| State | Menu |
|---|---|
| Normal repo / named-branch worktree | Standard 4 options |
| Detached HEAD (externally managed) | Reduced 3 options (no local merge) |

### Step 3 — Present exactly these options (no extra prose)

**Standard:** 1) Merge to `<base>` locally  2) Push + open a PR  3) Keep as-is  4) Discard.
**Detached HEAD:** 1) Push as new branch + open a PR  2) Keep as-is  3) Discard.

### Step 4 — Execute the choice

| Option | Merge | Push | Keep worktree | Branch cleanup |
|---|---|---|---|---|
| Merge locally | yes (re-run tests on result) | — | — | `git branch -d` |
| Push + PR | — | yes (`-u`) | **yes** (PR iteration) | — |
| Keep as-is | — | — | yes | — |
| Discard | — | — | — | `git branch -D` after typed `discard` |

**Push gate (pi-oven):** never `git push` without explicit user confirmation in this turn. PR body = Summary bullets + a Test Plan checklist.

### Step 5 — Cleanup (Options 1 & 4 only; 2 & 3 always preserve)

`cd` to the main repo root **before** removing anything (`git worktree remove` fails silently from inside the target). Only remove worktrees you own — paths under `.worktrees/`, `worktrees/`, or the legacy global dir. Harness-owned or native-tool workspaces: use the native exit tool if present, otherwise leave in place. After removal, `git worktree prune`. Order is fixed: **merge → remove worktree → delete branch** (deleting the branch first makes `git worktree remove` fail).

## Red flags

Never: create a worktree when Step 0 already detected isolation · use `git worktree add` when a native tool exists · merge/PR with red tests · push or force-push without explicit confirmation · delete work without typed `discard` · remove a worktree you did not create or before merge success · run `git worktree remove` from inside the worktree.

## Integration with pi-oven disciplines

- `pre-commit-gate` runs at every commit boundary inside this flow.
- `pre-merge-sync` is the milestone checklist that precedes the Finish PR / merge options.
- `autonomous-boundary` owns the ASK-FIRST branch contract; honor any destination/name/PR-mode it already fixed instead of re-asking.

## Agent Dispatch (omp)

The main agent orchestrates the lifecycle and never runs the git ops itself.

- **All git mutations** — `worktree add` / `remove` / `prune`, branch create/`-d`/`-D`, merge, push, and `gh pr create`: dispatch `pi-oven:git-master`. It is a read+bash-only agent that executes the exact op and refuses unsafe history operations (rebasing main, force-push to main without written confirmation).
- **Clean-baseline and pre-finish test verification**: dispatch `pi-oven:verifier` for evidence that tests actually pass — the main agent must not self-declare green.
- **Existing-isolation / worktree-directory reconnaissance** when state is unclear: dispatch `pi-oven:explorer`.
