# pi-oven maintainer handbook

This handbook contains maintainer-only generation, routing detail, and release procedure intentionally excluded from the compact runtime contract in `CLAUDE.md`.

## Sources of truth and generation

`scripts/pi-oven-setup/profiles.ts` (`DEFAULT_PROFILE`) is the release-default source for all 24 roles' model selectors, thinking levels, `tools`, and `blocked_tools`. Agent frontmatter is derived from it; agent body prose remains hand-authored.

When changing the profile:

1. Edit `DEFAULT_PROFILE`.
2. Run the maintainer apply path to regenerate only `model`, `thinkingLevel`, and other profile-owned frontmatter.
3. Review the diff to confirm every body is byte-for-byte preserved.
4. Run `bun run lint:agents`, the profile/setup tests, `bun run check`, and `bun run build`.

`agent-rewriter.ts` must never rewrite agent bodies. A tools change made only in an agent file is drift and must fail lint. Skill bodies are authored in English; Korean matching phrases belong in the runtime keyword index or user-facing examples.

The public namespace is split deliberately:

- agents: `pov:<role>`
- workflow skills: `pov:<skill>`
- slash commands: `/pi-oven:<command>`
- package/install identity: `pi-oven@kzk`

Do not use the marketplace name as an agent namespace. The legacy `skill://pi-oven:` form remains accepted only by the gate's read detector for old receipt compatibility.

## Routing mechanics

omp resolves per-role models through `task.agentModelOverrides`. Precedence is agent frontmatter, global `~/.omp/agent/config.yml`, project `<cwd>/.omp/settings.json`, then a runtime CLI override. Record settings deep-merge; arrays replace. Project discovery starts from the launch directory and does not walk to a git ancestor.

Setup writes the complete codex-only 24-role map, orchestrator `modelRoles`, `skills.includeSkills = ["pov:*"]`, and an empty fallback chain. `--profile` remains a compatibility no-op. Personal `--override` writes only the selected role to the global config without changing tracked agent files. Memory and async infrastructure remain global-only.

Global setup also enables the omp facilities required by agent contracts: image inspection, web search, LSP, structural search, browser, and debugger. Eval is ungated by omp configuration. Full routing reset intentionally leaves these global tool capabilities enabled.

## Runtime prompt maintenance

Parent prompt composition may include orchestrator conduct, discipline, language, project instructions, selected-skill obligations, and phase-specific contracts. Project instructions are parent-only and deduplicated.

Workers receive a compact context capsule containing only the canonical roster/namespace invariant, exact role and assignment, exact selected skill read targets, and relevant branch/write/verification safety. Never restore injection of the root `CLAUDE.md` or release instructions into workers.

Every fragment needs a stable id, dedup key, audience, phase, priority, and required flag. Required safety fragments are not discarded to meet a byte budget; only optional fragments may be dropped, and the composition receipt must make the reason, hash, and byte count reproducible.

For the one-release rollback window, `PI_OVEN_PROMPT_MODE=legacy` selects the unbudgeted legacy injector. The default and healthy path is `compositor`; an unset, empty, or explicit `compositor` value uses it. Both modes retain parent/worker audience separation and the exact worker namespace, assignment, skill-target, and safety capsule. Remove the legacy path after the compatibility release rather than making it a permanent profile.

After prompt changes, run:

```sh
bun test tests/extensions/pi-oven-runtime/prompt-compositor.test.ts
bun test tests/scripts/runtime-benchmark.test.ts
bun run bench:runtime
```

The checked-in corrected pre-compositor baseline is the comparison surface. The worker prompt must remain at least 50% smaller and all correctness gates must pass.

## Release ritual

`package.json.version` is the only manually edited release version source. Plugin manifests, marketplace metadata, and the immutable marketplace `vX.Y.Z` reference are derived and validated from it. Do not add hand-maintained current-version text or test-count badges to `CLAUDE.md` or other stable guides.

Before preparing a release:

1. Ensure the worktree contains only intended release changes and review `CHANGELOG.md`.
2. Run the repository checks, lints, tests, build, runtime benchmark, remediation-baseline gate, and fresh-install smoke required by the release contract.
3. Exercise `bun run release:pi-oven -- --bump patch --dry-run` (or the intended bump) and inspect the generated manifest/marketplace diff.
4. Use the prepare path only when all deterministic gates pass. It may create the validated release commit but must not tag or push.
5. Publish only through the tag-triggered release workflow. Never publish from a local ad-hoc command and never move an immutable marketplace version ref.

`git push` requires explicit user confirmation, including release pushes. A locally prepared release is not evidence that the remote tag, marketplace install, or fresh-install path works; verify the published artifacts through the workflow and smoke contract.

## Historical records

Per-release behavior and migration notes belong in `CHANGELOG.md` and git history. Design rationale belongs in `docs/specs/`; executable implementation sequences belong in `docs/plans/`; project identity belongs in `docs/SOUL.md`. Avoid copying snapshots of version, model inventory, test totals, or release status into the compact runtime contract because those facts drift.
