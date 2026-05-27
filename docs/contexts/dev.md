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
