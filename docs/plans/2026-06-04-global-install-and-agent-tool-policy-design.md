# 2026-06-04 — Global install and agent tool policy design

## Status
Approved design direction from user:
- pi-oven install is user-global only
- project-local installation is out of scope
- global install state and project setup state must be separated
- authoring roles should share a richer tool policy; read-only roles should remain constrained

## Problem statement
Two behaviors are currently misaligned with the intended product model:

1. Some pi-oven roles can end up unable to complete assigned work because role-specific tool policies are too narrow for authoring tasks.
2. Doctor/runtime notices conflate "pi-oven is installed" with "this project has completed setup", and local project markers are treated as installation evidence.

This produces false "not installed" messaging even when pi-oven is globally installed, and encourages role-by-role tool-policy patching.

## Goals
- Treat pi-oven installation as a global user-level fact.
- Remove project-local installation and project-local settings as supported concepts for now.
- Eliminate repo-local config from installation and runtime preference resolution.
- Standardize rich tools for authoring roles without collapsing read-only role boundaries.
- Make runtime/doctor messaging reflect the same model.

## Non-goals
- Supporting per-project pi-oven installation.
- Giving all 24 roles the same unrestricted tool set.
- Changing runtime branch-contract / required-skill enforcement semantics.
- Reworking model routing or role prompts beyond what tool-policy centralization requires.

## User-visible policy

### Installation
- pi-oven is considered installed when a valid global marketplace/cache installation is discoverable.
- "Installed" must not depend on `./agents`, `./skills`, or `./.pi-oven/config.json` in the current repository.
- Doctor and runtime notices must say "not installed" only when global discovery fails.

### Project setup
- Project-local setup/config is not a supported product surface for now.
- Therefore, absence of `./.pi-oven/config.json` must not produce any installation or setup warning.
- Repo-local pi-oven settings should not be read as authoritative runtime configuration.
- If project onboarding returns later, it should be introduced as a separate feature, not inferred from current local files.

### Agent tools
- Authoring roles receive a common authoring-capable tool profile.
- Read-only / review roles remain intentionally constrained.
- Role capability differences should be explainable from one source of truth, not scattered one-off markdown edits.

## Proposed architecture

### 1. Split installation detection from project state
Introduce two distinct concepts in code:

- `globalInstallState`
  - Derived from global cache / registry / marketplace discovery.
  - Answers: "Is pi-oven available on this machine?"
- `projectState`
  - Not used as a supported user-facing concept in the current product model.
  - Any existing repo-local marker files are legacy/internal artifacts, not truth for install or config.

Rules:
- Doctor install checks use `globalInstallState` only.
- Extension startup install notices use `globalInstallState` only.
- Repo-local `.pi-oven/config.json` is not used as authoritative runtime configuration.

### 2. Centralize authoring-role tool policy
Replace scattered role-by-role manual drift with a policy table in code.

Recommended model:
- Define role groups in a TypeScript source of truth, for example:
  - `authoring`: executor, debugger, document-specialist, writer, designer, code-simplifier, qa-tester, data-runner
  - `readOnly`: explorer, critic, security-reviewer, librarian, deep-researcher, analyst, architect, multimodal-looker
  - `hybrid/planning`: planner, metis, git-master, oracle, test-engineer as explicitly chosen
- Generate or validate each agent markdown `tools` / `blocked_tools` from that table.
- Keep markdown as the published artifact, but not the logical source of truth.

This preserves existing repo style:
- profiles.ts remains SoT for model routing
- new tool-policy table becomes SoT for capability routing
- lint enforces markdown parity

### 3. Narrow runtime responsibility
Runtime extension should enforce behavioral gates, not define installation policy from repo-local setup markers.

Therefore:
- `.omp/extensions/pi-oven.ts` must stop reading repo-local pi-oven config as installation or preference truth.
- Any install/onboarding notice should be driven by a shared global detection helper used by both doctor and runtime.
- If repo-local compatibility reads remain temporarily, they should be best-effort migration shims only.

## Concrete changes

### A. Global install detection helpers
Create shared helpers that:
- resolve the global cached plugin/agents location
- verify expected pi-oven assets exist globally
- return structured status such as:
  - `installed: boolean`
  - `source: "global-cache" | "global-registry" | "missing"`
  - `path?: string`

Prefer reusing and extending existing cache-resolver logic instead of duplicating probes.

### B. Doctor behavior
`scripts/pi-oven-doctor.ts` should:
- report global installation status from shared global detection
- stop counting local `agents/` and `skills/` as the primary install truth for user-facing pass/fail
- do not treat local repo markers as required state for a healthy install

Suggested output split:
- Global install: PASS/FAIL
- Legacy local config present: YES/NO (informational only, if reported at all)

### C. Runtime startup behavior
`.omp/extensions/pi-oven.ts` should:
- use shared global detection for any "not installed" notice
- avoid repo-local config reads for install or default runtime preferences
- treat local config, if touched during migration, as ignorable legacy state

### D. Agent tool policy source of truth
Add a new TypeScript module that maps roles to tool profiles.

Recommended profiles:
- `authoringTools`: `tools: ["*"]`, minimal `blocked_tools` only where truly required
- `readonlyTools`: restricted read/search/find/lsp/web/documentation set, no write/edit/task
- `hybridTools`: case-by-case, but still defined centrally

Then:
- update lint to verify each agent file matches the policy table
- optionally add a rewrite utility similar to the model frontmatter rewriter

## Role classification recommendation

### Authoring roles
Default to broad tools:
- executor
- debugger
- document-specialist
- writer
- designer
- code-simplifier
- qa-tester
- data-runner

### Read-only roles
Keep constrained:
- explorer
- critic
- security-reviewer
- librarian
- deep-researcher
- analyst
- architect
- multimodal-looker

### Hybrid / explicit decision roles
Review individually during implementation:
- planner
- metis
- git-master
- oracle
- test-engineer
- verifier
- code-reviewer
- tracer

Rationale: these roles often need either strict non-mutation guarantees or narrow operational permissions.

## Data flow

### Install detection flow
1. Shared detector checks global cache/registry.
2. Doctor/runtime consumes that shared result.
3. Repo-local pi-oven files are ignored for install truth and default preferences.
4. User messaging distinguishes only:
   - global install missing
   - global install present

### Tool policy flow
1. Policy table defines role -> tool profile.
2. Agent markdown is generated or lint-validated against the table.
3. OMP loads markdown frontmatter as before.
4. Runtime gate still enforces branch-contract / skill-read / write gating dynamically.

## Error handling
- Global detector failures should be fail-soft but explicit:
  - unreadable cache path => `installed: false`, reason attached for doctor output
- Missing local config must not escalate to install failure.
- Tool policy lint mismatch should fail CI clearly with role name, expected tools, actual tools.

## Testing strategy

### Install detection
- unit tests for global detector:
  - global cache present
  - global cache absent
  - malformed/incomplete cache
- doctor tests:
  - global install present + no local config => install PASS
  - no global install => install FAIL
- extension tests:
  - no local config + global install present => no "not installed" notice
  - local config presence/absence does not change install verdict or default runtime prefs

### Tool policy
- lint tests verifying agent markdown matches the central policy table
- focused tests for any rewriter/helper that materializes tool policies
- regression case: `document-specialist` retains enough tools to inspect and patch markdown/doc tasks when intended

## Migration plan
1. Introduce shared global install detector.
2. Convert doctor to use it.
3. Convert extension install notice to use it.
4. Add central tool-policy table.
5. Move authoring roles onto the shared authoring profile.
6. Update lint/rewrite support.
7. Adjust agent markdown artifacts to match.

## Risks and mitigations
- Risk: broadening too many roles weakens read-only guarantees.
  - Mitigation: only authoring roles move to the shared broad profile.
- Risk: hidden callers still rely on local config semantics.
  - Mitigation: search all `setupCompletedAt`, `.pi-oven/config.json`, and startup notice paths before code changes, then either delete or explicitly demote them to legacy compatibility only.
- Risk: duplicated truth between markdown and TS policy table.
  - Mitigation: make TS authoritative and lint markdown parity.

## Recommended implementation approach
Use the approved middle path:
- centralize broad tools for authoring roles
- preserve read-only roles as read-only
- treat installation as global-only
- remove project-local install/settings from the supported model

## Open decisions intentionally closed in this spec
- Project-local installation support: rejected.
- Project-local settings/config as active runtime input: rejected for now.
- All-role common tool set: rejected.
- Local config absence meaning not installed: rejected.
