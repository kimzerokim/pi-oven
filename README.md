# pi-oven

> Curated omp workflow + discipline layer. 5-source successor (omc / omo / Pocock skills / superpowers / pi-oven). omp marketplace plugin.

## Install (one line)

```sh
omp plugin marketplace add kimzerokim/pi-oven
omp plugin install pi-oven@pi-oven-marketplace
```

Pre-requisites: omp ≥ requirement, bun ≥ 1.3.14, git, **provider key 1개 이상** (OpenAI Codex OAuth / OpenCode Zen / Anthropic native).

## First-run

After install, pi-oven setup wizard auto-triggers (or run `/pi-oven:setup`):

1. Provider key detection (Codex OAuth / Zen / Anthropic optional)
2. Model role config (`models.yml` — default / smol / slow / plan / commit)
3. First benchmark (optional, model × skill matrix)
4. `docs/` skeleton (WORKING-CONTEXT / SOUL / contexts / decisions / adr / ...)
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
