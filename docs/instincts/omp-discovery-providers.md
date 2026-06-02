---
name: omp-discovery-providers
description: omp discovery-provider model — how omp ingests the ~/.claude Claude-Code layer, the disabledProviders knob, and the repo-root CLAUDE.md gap
confidence: high
captured: 2026-06-02
source: omp-isolate-pi-oven workflow (5 read-only finders over @oh-my-pi/pi-coding-agent@15.7.5 src/)
---

# omp Discovery Providers (v15.7.5, observed)

## Action

When reasoning about what omp loads (skills / context files / hooks / commands /
agents / mcp) and how to scope it, use the **provider** model below as fact. omp
runs from TS source: `omp -> src/cli.ts` in
`~/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent`.

## Provider model

Each ecosystem is a **provider** registered per capability in `src/discovery/*.ts`.
Providers carry an `id` + `priority`; capabilities merge by provider priority
(first-wins on name collision).

| provider id | priority | reads |
|---|---|---|
| `native` (builtin) | 100 | `.omp/` (project) + `~/.omp/agent/` (user): skills, AGENTS.md, settings |
| `omp-plugins` | 90 | installed omp plugins under `~/.omp/plugins/cache/` — **this is how pi-oven loads** (skills/commands/agents/extensions) |
| `claude` | 80 | `~/.claude/CLAUDE.md`, `~/.claude/skills`, `<cwd>/.claude/{CLAUDE.md,skills,commands,hooks}`, `.claude/settings.json` |
| `claude-plugins` | 70 | Claude marketplace plugins under `~/.claude/plugins/cache/` (skills/commands/hooks/tools/mcp) — e.g. `omc`, `agentmemory` |
| `agents-md` | 10 | repo-root + ancestor `AGENTS.md` (walk-up from cwd; skips dot-dirs) |
| `codex` / `gemini` / `opencode` | — | `~/.codex/AGENTS.md`, `GEMINI.md`, opencode skills |

The `claude-plugins` ("Claude Code Marketplace") provider registers a
marketplace-plugin's **commands** (and skills) as `<plugin>:<file-basename>`
colon namespacing — so a command file's basename becomes the slash name and
must NOT carry the plugin-name prefix. See `omp-marketplace-command-namespacing.md`.

## The single isolation knob: `disabledProviders`

`src/config/settings-schema.ts:337` `disabledProviders: array`. At startup
`capability/index.ts:251-259` snapshots it into a Set; `filterProviders`
(`capability/index.ts:211`) drops those provider ids from **every** capability.

- `disabledProviders: [claude, claude-plugins]` in user-global
  `~/.omp/agent/config.yml` (or project `<repo>/.omp/settings.json`) makes omp
  **ignore the entire `~/.claude` Claude-Code layer** (omc CLAUDE.md + pi-oven
  skills + omc plugin/MCP + Claude hooks) while keeping `omp-plugins` (pi-oven) and
  `native` intact. It is omp-only — never touches `~/.claude` on disk, so real
  Claude Code sessions are unaffected.
- Snapshotted once at startup → **restart omp** to apply. No env var.
- `claude`/`claude-plugins` here are **discovery**-provider ids, NOT model-provider
  ids (anthropic/openai-codex/…), so adding them disables no LLM backend.
- Finer knobs exist if you want partial: `skills.enableClaudeUser/Project`,
  `commands.enableClaudeUser/Project`, `disabledExtensions: ['context-file:user:CLAUDE.md']`.

## The repo-root CLAUDE.md gap (why pi-oven injects it)

The **only** CLAUDE.md readers in omp src are `src/discovery/claude.ts:134`
(`~/.claude/CLAUDE.md`) and `:147` (`<cwd>/.claude/CLAUDE.md`). **No omp code reads
the repo-root `<cwd>/CLAUDE.md`** — that is the Claude Code project-memory
convention omp does not honor. `agents-md` reads root `AGENTS.md`, not CLAUDE.md.

pi-oven fills this in its extension: `readProjectInstructions(<repoRoot>/CLAUDE.md)`
→ `RulesInjector.setProjectInstructions` → injected into the main+sub agent system
prompt via `before_agent_start` (dedup key `pi-oven:project-instructions`). This is
how omp comes to honor a project's local CLAUDE.md while the global `~/.claude`
layer stays disabled via `disabledProviders`.

## How to apply

1. Isolate omp from `~/.claude`: set `disabledProviders: [claude, claude-plugins]`.
2. Keep project-local guidance: pi-oven auto-injects `<repoRoot>/CLAUDE.md`
   (default ON; opt out with `.pi-oven/config.json` `{ "projectInstructions": false }`).
3. Verify after applying: in omp, `skill://autonomous-boundary` (a pi-oven
   skill) throws Unknown skill while `skill://autonomous-loop` (a pi-oven skill) still
   resolves.

## Related

- `before_agent_start` returns `{systemPrompt}` which **replaces** the agent system
  prompt (`session/agent-session.ts:4359-4360`) — reaches the MAIN agent, not just
  subagents. Proven by the language directive shaping main-session output.
- `docs/instincts/omp-install-layout.md` — plugin install dir layout.
