# Build Pipeline Survey — 2026-06-03

## Overview
Investigation of the intermittent build failure report focusing on the OMP extension bundling and release process.

## Build Definition
- **Primary Command**: `bun build .omp/extensions/pi-oven.ts --outdir dist --target bun --format esm --external '@oh-my-pi/*'`
- **Entrypoint**: `.omp/extensions/pi-oven.ts`
- **Output**: `dist/pi-oven.js`
- **Lockfile**: `./bun.lock` (Binary format, managed by Bun)

## High-Risk Files & Churn
- **.omp/extensions/pi-oven.ts**: Complex entrypoint performing runtime agent mirroring, validation, and stop-guard injection. Recently modified (2026-06-02) to inject repo-root `CLAUDE.md`.
- **package.json**: Defines build script and external dependencies.
- **scripts/pi-oven-release/index.ts**: Orchestrates release manifests and changelog generation.

## Dependencies & External Tools
- **Bun**: Used for both bundling (`bun build`) and script execution. Intermittent issues often correlate with Bun version drift or cache pollution.
- **TypeScript**: `tsc --noEmit` for type checking.
- **@oh-my-pi/pi-coding-agent**: External peer dependency, must be available at runtime but excluded from bundle.

## Non-Determinism Vectors
1. **Agent Mirroring (`syncPiOvenAgentMirrors`)**: The extension performs async filesystem operations (`readdir`, `readFile`, `unlink`, `writeFile`) during `session_start` to mirror agent files into `.omp/agents` and `~/.omp/agent/agents`. Race conditions between concurrent sessions or permission issues in `~` can cause intermittent failures.
2. **Path Resolution**: Use of `path.resolve`, `join`, and `os.homedir()` during runtime initialization creates environment sensitivity.
3. **External Prefix Validation**: `validateAgentRegistry` uses a two-pass filesystem scan which depends on the state of the `agents/` directory at load time.
4. **Binary Lockfile**: `bun.lock` is binary; merge conflicts or corruption are harder to detect than text-based lockfiles.

## Recommendations
- Monitor Bun version in CI/CD to prevent drift.
- Audit `syncPiOvenAgentMirrors` for race conditions during parallel session initialization.
- Consider moving agent mirroring to a post-build or post-install step rather than runtime `session_start`.
