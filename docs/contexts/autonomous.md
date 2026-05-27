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
