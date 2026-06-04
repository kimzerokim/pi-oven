---
name: deep-init
version: 0.1.0
description: "Read this skill to initialize project context with hierarchical AGENTS.md generation, especially when AGENTS.md files are absent or stale and a full codebase map is needed. Generates per-directory AGENTS.md documentation via explorer, document-specialist, and librarian agents."
---

# deep-init

## Purpose

Generates hierarchical AGENTS.md documentation across an entire codebase. Every directory receives an AI-readable context file that summarizes its purpose, key files, subdirectories, and agent instructions. These files persist between sessions, letting agents understand module ownership and conventions without re-reading source every time.

## Dispatch discipline (main orchestrates, subagents do the work)

ENFORCEMENT: do NOT do this skill's substantive work in the main context. Main's direct-action budget is narrow — a 1-2 file simple edit (≤ 30 LoC) or an operational command (`git status`, `ls`, install). ANY multi-file change, 3+ file reads, 200+ LoC, or multi-step investigation/implementation MUST be dispatched. Main only dispatches, synthesizes, and reviews — never implements inline (see `large-task-delegation` + `subagent-driven-development`).

RIGHT-AGENT ROUTING: match the agent to the work — model-fit + role-fit is first-class. Hierarchical doc generation → `pi-oven:explorer` (map + read) + `pi-oven:document-specialist` (per-dir context authoring) + `pi-oven:librarian` (cross-reference + hierarchy validation).

## When to use

- Starting work in an unfamiliar codebase and AGENTS.md files are absent
- User says "deepinit", "deep-init", "init project context", or "scan codebase + write AGENTS.md"
- Codebase structure has changed significantly and existing AGENTS.md files are stale
- Onboarding a new agent to the project and per-directory context is missing

## When not to use

- A single directory or file needs documentation — write it directly instead
- AGENTS.md files already exist and are fresh — run a targeted update instead of a full scan
- The codebase is a single flat directory with no module structure

## Core concept: hierarchical parent references

Every AGENTS.md (except root) includes a parent reference tag:

```markdown
<!-- Parent: ../AGENTS.md -->
```

This creates a navigable hierarchy:

```
/AGENTS.md                            ← Root (no parent tag)
├── src/AGENTS.md                     ← <!-- Parent: ../AGENTS.md -->
│   ├── src/components/AGENTS.md      ← <!-- Parent: ../AGENTS.md -->
│   └── src/utils/AGENTS.md           ← <!-- Parent: ../AGENTS.md -->
└── docs/AGENTS.md                    ← <!-- Parent: ../AGENTS.md -->
```

## AGENTS.md template

Each generated file follows this structure:

```markdown
<!-- Parent: {relative_path_to_parent}/AGENTS.md -->
<!-- Generated: {timestamp} | Updated: {timestamp} -->

# {Directory Name}

## Purpose
{One-paragraph description of what this directory contains and its role}

## Key Files
| File | Description |
|------|-------------|
| `file.ts` | Brief description of purpose |

## Subdirectories
| Directory | Purpose |
|-----------|---------|
| `subdir/` | What it contains (see `subdir/AGENTS.md`) |

## For AI Agents

### Working In This Directory
{Special instructions for AI agents modifying files here}

### Testing Requirements
{How to test changes in this directory}

### Common Patterns
{Code patterns or conventions used here}

## Dependencies

### Internal
{References to other parts of the codebase this depends on}

### External
{Key external packages/libraries used}

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
```

Root AGENTS.md omits the `<!-- Parent: -->` tag. The `<!-- MANUAL: -->` sentinel marks a boundary: everything below it is user-authored and must not be touched on regeneration.

## Execution workflow

### Step 1: Map directory structure

Dispatch `pi-oven:explorer` (model: haiku) to list all directories recursively. Exclude:
`node_modules`, `.git`, `dist`, `build`, `__pycache__`, `.venv`, `coverage`, `.next`, `.nuxt`

The explorer returns a flat list organized by depth level:
```
Level 0: /
Level 1: /src, /docs, /tests
Level 2: /src/components, /src/utils, /docs/api
```

### Step 2: Create work plan

Generate one work item per directory, grouped by level. Parent levels must be completed before child levels — the parent reference tag in each child file requires the parent to exist first.

### Step 3: Generate level by level

For each level, process all directories at that depth in parallel:

- Dispatch `pi-oven:explorer` to read all files in the directory (model: haiku for small dirs, sonnet for dirs with 10+ files or complex modules)
- Dispatch `pi-oven:writer` to draft the AGENTS.md content from the explorer's findings
- Same-level directories fire in parallel with `run_in_background: true`; different levels are sequential (parent before child)

**Batching rule**: directories with fewer than 5 files are batched into a single explorer dispatch. Directories with 10+ files each get a dedicated explorer call.

### Step 4: Compare and update (when AGENTS.md already exists)

When an AGENTS.md already exists in a directory:

1. Read existing content
2. Identify auto-generated sections vs `<!-- MANUAL: -->` sections
3. Compare against current directory state (new files added, files removed, structure changed)
4. Merge: update auto-generated content, preserve manual annotations, update `Updated:` timestamp

Never delete or modify content below the `<!-- MANUAL: -->` sentinel.

### Step 5: Validate hierarchy

After all files are generated, run validation:

| Check | Command | Corrective action |
|-------|---------|-------------------|
| Parent references resolve | `grep -r "<!-- Parent:" --include="AGENTS.md" .` | Fix path or remove orphan |
| No orphaned AGENTS.md | Compare AGENTS.md locations to directory list | Delete orphaned files |
| All directories covered | `find . -name "AGENTS.md" -type f` vs directory list | Generate missing files |
| Timestamps current | Check `<!-- Generated: -->` dates | Regenerate outdated files |

## Empty directory handling

| Condition | Action |
|-----------|--------|
| No files, no subdirectories | Skip — do not create AGENTS.md |
| No files, has subdirectories | Create minimal AGENTS.md with subdirectory list only |
| Generated-files only (`*.min.js`, `*.map`, `*.d.ts`) | Skip or minimal AGENTS.md |
| Config-files only | Create AGENTS.md describing configuration purpose |

## Agent delegation

| Task | Agent |
|------|-------|
| Directory mapping | `pi-oven:explorer` (model: haiku) |
| File content analysis — small dirs | `pi-oven:explorer` (model: haiku), batched |
| File content analysis — large/complex dirs | `pi-oven:explorer` (model: sonnet), dedicated |
| AGENTS.md content authoring | `pi-oven:writer` |

## Parallelization rules

1. Same-level directories: dispatch in parallel in a single turn
2. Different levels: sequential (parent must exist before child)
3. Large directories (10+ files): one dedicated `pi-oven:explorer` per directory
4. Small directories (< 5 files): batch multiple into one `pi-oven:explorer` call

## Quality standards

Must include:
- [ ] Accurate file descriptions (not generic boilerplate)
- [ ] Correct parent reference paths
- [ ] Subdirectory links with `see subdir/AGENTS.md` cross-references
- [ ] Working-in-this-directory agent instructions
- [ ] Generated and Updated timestamps

Must avoid:
- [ ] Generic placeholders left in the output
- [ ] Incorrect file names (verify against actual directory listing)
- [ ] Broken parent reference paths
- [ ] Missing significant files in the Key Files table

## Stop conditions

- User says "stop" or "cancel": halt immediately; write a summary of which directories were completed and which remain
- Coverage threshold: if more than 95% of directories have current AGENTS.md files, offer to stop rather than regenerating unchanged files
- Error threshold: if 3 consecutive directory writes fail, halt and report the failure before proceeding

## Example output

### Root AGENTS.md
```markdown
<!-- Generated: 2026-05-28 | Updated: 2026-05-28 -->

# my-project

## Purpose
A TypeScript CLI tool for managing project context files.

## Key Files
| File | Description |
|------|-------------|
| `package.json` | Project dependencies and scripts |
| `tsconfig.json` | TypeScript configuration |

## Subdirectories
| Directory | Purpose |
|-----------|---------|
| `src/` | Application source code (see `src/AGENTS.md`) |
| `tests/` | Test suites (see `tests/AGENTS.md`) |

## For AI Agents

### Working In This Directory
- Run `bun install` after modifying package.json
- Use TypeScript strict mode

### Testing Requirements
- Run `bun test` before committing

## Dependencies

### External
- TypeScript 5.x
- Bun runtime

<!-- MANUAL: -->
```

### Nested AGENTS.md
```markdown
<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-05-28 | Updated: 2026-05-28 -->

# src

## Purpose
Application source — skill loader, eval runner, and plugin registry.

## Key Files
| File | Description |
|------|-------------|
| `index.ts` | Entry point and CLI routing |
| `loader.ts` | Skill file loader and frontmatter parser |

## Subdirectories
| Directory | Purpose |
|-----------|---------|
| `skills/` | Per-skill SKILL.md files (see `skills/AGENTS.md`) |

## For AI Agents

### Working In This Directory
- All exports go through `index.ts`
- Follow the existing loader pattern for new skill types

### Testing Requirements
- Unit tests in `tests/` mirroring the src structure

<!-- MANUAL: -->
```
