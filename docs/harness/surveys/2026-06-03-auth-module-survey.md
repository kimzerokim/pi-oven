# Survey Report: Auth Module Discovery (2026-06-03)

## Tool Availability
- **Core Utilities**: `grep`, `find`, `ls`, `git` confirmed available.
- **Runtime**: `bun` (via `Bun.spawnSync` in scripts) and `tsc` (under `node_modules/.bin`) are primary.
- **Harness**: `omp` CLI is external but integrated via `Bun.spawn`.

## Scope Map
The "auth module" in this repository is currently focused on **provider authentication detection** for the setup wizard and diagnostic doctor.
- **Core Module**: `/scripts/pi-oven-setup/auth-detect.ts` (64 LoC)
- **Unit Test**: `/tests/scripts/pi-oven-setup/auth-detect.test.ts`
- **Primary Callsite**: `/scripts/pi-oven-doctor.ts` (Diagnostic check #4)
- **Secondary Callsite**: `/scripts/pi-oven-setup.ts` (Setup wizard flow)

## Key Exports/Contracts
- **`AuthStatus` (Interface)**: 
  ```typescript
  export interface AuthStatus {
    opencode_zen: boolean;
    openai_codex: boolean;
    anthropic: boolean;
  }
  ```
- **`detectAuth(opts?)` (Function)**: Asynchronous entry point that spawns `omp --list-models` or uses injected output to determine auth state.
- **`parseListModelsOutput(output)` (Function)**: Pure parser logic extracting provider status from raw table output.

## Dependency Notes
- **Direct Dependencies**: Depends on `Bun.spawnSync` for CLI interaction.
- **Reverse Dependencies**: 
  - `scripts/pi-oven-doctor.ts`: Imports `AuthStatus` and `detectAuth` for the `evalAuth` check.
  - `tests/scripts/pi-oven-setup/auth-detect.test.ts`: Exhaustive test suite for parsing logic.

## Patterns/Conventions
- **Pure/Impure Separation**: Follows the pattern of isolating I/O (spawn) from logic (parser) for testability.
- **Spec Alignment**: Explicitly references "Spec B §3.1" in comments, indicating a design-first approach.
- **Model Whitelisting**: Hardcoded whitelists for `opencode-zen`, `openai-codex`, and `anthropic`.

## Env Vars
- `PI_OVEN_DOCTOR_ROOT`: Used by the doctor script (callsite) for path resolution during probes.
- No direct auth tokens are stored; the module delegates auth state to the `omp` CLI session.

## Recommended Next Step
Ready for refactor. The module is small, decoupled, and well-tested. A refactor spanning 5 files / 300 LoC (e.g., adding credential validation or expanding provider support) is well-grounded in this existing structure.
