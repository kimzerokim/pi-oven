# Explicit External Execution Override Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use `subagent-driven-development` (recommended) or `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the unconditional pi-oven production/external command hard block with a strict, single-use, latest-user-message external execution consent path while keeping destructive `rm -rf` roots, inline secrets, `git commit`, and `git push` safeguards intact.

**Architecture:** Keep command classification pure in `git-normalize.ts`; keep gate decisions pure in `gate.ts`; persist consent in the existing `.pi-oven/state/autonomous.json` state model; consume consent only through the existing parent-session single-writer mutex in `gate-handler.ts`. Prompt and shipped pi-oven skill text must describe the same policy the runtime enforces.

**Tech Stack:** Bun tests (`bun:test`), TypeScript runtime extension under `.omp/extensions/`, markdown skills/docs under `skills/` and `docs/`, YAML skill eval scenarios under `evals/`.

## Global Constraints

- Approved spec: `docs/specs/2026-06-26-explicit-external-exec-override.md`.
- Default remains block for external read/session/mutation commands unless latest user message provides explicit runtime-visible consent.
- Consent is single-use by default: `remainingUses: 1`, consumed on the first matching allowed external command.
- Local credentials already present on the machine may be used only under the explicit consent path.
- Inline secret literals in command text remain always blocked, even with explicit consent.
- `rm -rf` repo/HOME/root forbidden floor remains always blocked, even with `PI_OVEN_GATE_BYPASS=1`.
- `git commit` and `git push` consent/cache semantics must remain unchanged.
- Do not overload `PI_OVEN_GATE_BYPASS`; external execution consent is a separate state-backed mechanism.
- Parent session is the only writer to `.pi-oven/state/autonomous.json`; subagent sessions must not mutate consent state.
- No new runtime dependencies.
- TDD-first execution: write/update the focused test, run the named command to see it fail, implement the smallest change, rerun the same command to pass.

## Survey Evidence

- Runtime surfaces verified:
  - `.omp/extensions/pi-oven-runtime/git-normalize.ts:19-30,325-389`
  - `.omp/extensions/pi-oven-runtime/gate.ts:33-60,115-246`
  - `.omp/extensions/pi-oven-runtime/gate-handler.ts:241-262,323-383`
  - `.omp/extensions/pi-oven-runtime/gate-state.ts:30-41,108-151,224-249`
  - `.omp/extensions/pi-oven.ts:468-480,795-829`
- Test surfaces verified:
  - `tests/extensions/pi-oven-runtime/git-normalize.test.ts:16-18,133-187,198-234`
  - `tests/extensions/pi-oven-runtime/gate.test.ts:21-39,123-197`
  - `tests/extensions/pi-oven-runtime/gate-handler.test.ts:15-64,123-207,439-456,619-683`
  - `tests/extensions/pi-oven-runtime/wiring.test.ts:33-84,398-557`
- Policy text sweep was exhaustive across pi-oven-owned `skills/`, `commands/`, `agents/`, `evals/`, and `docs/`. Required alignment surfaces are listed below; no additional old execution-refusal policy surfaces were found in `agents/` or `commands/`.

## File Structure / Edit Surfaces

### Runtime

- Modify `.omp/extensions/pi-oven-runtime/git-normalize.ts:19-30,325-389`
  - Split always-forbidden matches from consent-gated external matches and inline-secret matches.
- Modify `.omp/extensions/pi-oven-runtime/gate-state.ts:30-41,108-151,224-249`
  - Add persisted `externalExecConsent` state shape, validation, default seed, and atomic consume helper.
- Modify `.omp/extensions/pi-oven.ts:468-480,795-829`
  - Parse latest user message on `turn_start` and persist or clear consent.
- Modify `.omp/extensions/pi-oven-runtime/gate.ts:33-60,115-246`
  - Enforce inline-secret floor, external consent requirement, and consume flag without changing commit/push behavior.
- Modify `.omp/extensions/pi-oven-runtime/gate-handler.ts:241-262,323-383`
  - Read consent, pass it to `decideGate`, log decision, and consume inside `store.runExclusive()`.

### Tests

- Modify `tests/extensions/pi-oven-runtime/git-normalize.test.ts:133-187,198-234`.
- Modify `tests/extensions/pi-oven-runtime/gate.test.ts:123-197`.
- Modify `tests/extensions/pi-oven-runtime/gate-handler.test.ts:123-207,439-456`.
- Modify `tests/extensions/pi-oven-runtime/wiring.test.ts:398-557`.

### Prompt, Skills, Docs, Evals

- Modify `.omp/extensions/pi-oven-runtime/rules-injector.ts:240-243`.
- Modify `skills/aws/SKILL.md:4,11,37-50`.
- Modify `skills/bitbucket-pipeline/SKILL.md:38,62`.
- Modify `skills/cloudflare/SKILL.md:39-40`.
- Modify `skills/large-task-delegation/references/dispatch-anatomy.md:44-50`.
- Modify `docs/specs/2026-05-29-pi-oven-omp-runtime-layer.md:47,52-53` with a supersession note for the policy slice.
- Modify `docs/specs/2026-05-28-pi-oven-skill-rewrite-and-new-skills.md:227-231` with a supersession note for the old production-code-first wording.
- Modify `docs/site/skill-flow.ko.html:914,925,936,973` so the public skill summary matches the shipped skills.
- Review and update comments/expectations only where wording becomes stale:
  - `evals/aws/scenarios/adversarial.yaml:1-26`
  - `evals/aws/scenarios/regression.yaml:1-24`
  - `evals/cloudflare/scenarios/adversarial.yaml:1-20`

## Sequence

Task 1 -> Task 2 -> Task 3 -> Task 4 -> Task 5. Do not start Task 4 until Tasks 1-3 establish runtime behavior, because policy text must describe the final runtime contract.

## Task 1: Pure command classifier split

**Files:**
- Modify `.omp/extensions/pi-oven-runtime/git-normalize.ts:19-30,325-389`
- Modify `tests/extensions/pi-oven-runtime/git-normalize.test.ts:133-187,198-234`

**Interfaces:**
- Produces `ExternalCommandKind` values: `external-read`, `external-session`, `external-mutation`, `inline-secret`.
- Produces `NormalizedCommand.externalMatches` for consent-gated external commands.
- Produces `NormalizedCommand.inlineSecretMatches` for never-lifted inline secret matches.
- Keeps `NormalizedCommand.forbiddenMatches` for always-forbidden `rm -rf` root/HOME/repo matches.
- Keeps existing `NormalizedCommand.gitVerbs` and `pushTarget` behavior unchanged.

**Test Design:**
- Assert behavior through `normalizeCommand()` only; no filesystem or state dependencies.
- Preserve existing `rm -rf` forbidden floor tests.
- Convert old `aws ssm start-session` and `aws sts assume-role` assertions from `forbiddenMatches` to `externalMatches`.
- Convert old `aws s3 ls` benign assertion from “no match” to `external-read`.

**Steps:**

- [ ] Add failing classifier tests in `tests/extensions/pi-oven-runtime/git-normalize.test.ts` under `describe("normalizeCommand — forbidden set detection (Spec §3 Layer 1)")` and the repo/HOME root block:
  - `aws s3 ls` and `aws ec2 describe-instances` produce `external-read` matches and no `forbiddenMatches`.
  - `aws sts assume-role --role-arn arn:aws:iam::1:role/prod`, `aws ssm start-session --target i-prod`, `ssh deploy@example.com`, and `kubectl exec pod -- sh` produce `external-session` matches.
  - `./scripts/deploy.sh --region singapore --warp on`, `aws s3 sync ./dist s3://bucket`, `terraform apply`, `tofu destroy`, `kubectl apply -f deploy.yaml`, `helm upgrade app chart/`, and `psql -c "UPDATE users SET active=false"` produce `external-mutation` matches.
  - `AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE aws s3 ls`, `AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY aws s3 ls`, and `psql --password hunter2 -c "select 1"` produce `inlineSecretMatches` and no consent-gated allow path.
  - Existing `rm -rf /`, `rm -rf $HOME`, `rm -rf ~`, concrete repo root, and concrete HOME tests continue to assert `forbiddenMatches.length > 0`.

- [ ] Run the red test command:
  - `bun test tests/extensions/pi-oven-runtime/git-normalize.test.ts`
  - Expected before implementation: FAIL because `externalMatches` and `inlineSecretMatches` do not exist and AWS external reads are currently unmatched.

- [ ] Refactor `.omp/extensions/pi-oven-runtime/git-normalize.ts`:
  - Replace `detectForbiddenProdAccess()` at `git-normalize.ts:326-340` with external classifiers for AWS, Terraform/Tofu, kubectl, helm, DB CLIs, remote transport, and repo-local deploy/release/migrate entrypoints.
  - Keep `detectForbiddenRm()` as the only producer of `forbiddenMatches`.
  - Add inline-secret detection after `stripLeadingEnv(tokenize(seg))` so env assignments and argument literals are detected before external allow decisions.
  - Preserve one-level interpreter unwrapping, segment splitting, git verb detection, and push target parsing in `normalizeCommand()`.

- [ ] Run the green test command:
  - `bun test tests/extensions/pi-oven-runtime/git-normalize.test.ts`
  - Expected after implementation: PASS.

- [ ] [COMMIT: classifier contract] Commit with message `feat(pi-oven): classify external commands separately from forbidden floor`.

## Task 2: Consent state and turn-start parser

**Files:**
- Modify `.omp/extensions/pi-oven-runtime/gate-state.ts:30-41,108-151,224-249`
- Modify `.omp/extensions/pi-oven.ts:468-480,795-829`
- Modify `tests/extensions/pi-oven-runtime/wiring.test.ts:398-557`

**Interfaces:**
- Persist optional `externalExecConsent` on `FsmState` with fields:
  - `sourceMessageId: string`
  - `scope: "read" | "access" | "mutation" | "all"`
  - `remainingUses: number`
- Add `extractExternalExecConsent(text: string, sourceMessageId: string)` near `extractExplicitForeignAgents()`.
- Structured marker accepted forms:
  - `PI_OVEN_EXTERNAL_EXEC: once scope=all creds=local`
  - `PI_OVEN_EXTERNAL_EXEC: once scope=read creds=local`
  - `PI_OVEN_EXTERNAL_EXEC: once scope=access creds=local`
  - `PI_OVEN_EXTERNAL_EXEC: once scope=mutation creds=local`
- Tight natural phrase whitelist must require both direct external execution intent and local credential consent in the latest user message. Accepted exact phrases:
  - `you may execute external commands using local credentials`
  - `run the external infra command yourself with local credentials`
  - `use my local credentials and execute the external command directly`
  - `외부 인프라 명령을 로컬 자격증명으로 직접 실행해`
  - `로컬 자격증명으로 외부 명령 직접 실행해`
- Vague phrases such as `go ahead`, `continue`, and `just do it` do not grant consent.

**Test Design:**
- Wiring tests should inspect the persisted `.pi-oven/state/autonomous.json`, matching existing style in `wiring.test.ts:417-557`.
- Parser tests can live in `wiring.test.ts` if `extractExternalExecConsent` is exported from `.omp/extensions/pi-oven.ts`; keep tests close to turn-start persistence.

**Steps:**

- [ ] Add failing tests in `tests/extensions/pi-oven-runtime/wiring.test.ts` beside `turn_start syncs autonomous ownership state into the gate store`:
  - Structured marker in latest user message persists `externalExecConsent` with `sourceMessageId` set to that message id, `scope: "all"`, and `remainingUses: 1`.
  - `PI_OVEN_EXTERNAL_EXEC: once scope=mutation creds=local` persists `scope: "mutation"` and still implies use of local credentials already present on the machine.
  - Exact phrase `use my local credentials and execute the external command directly` persists `scope: "all"`.
  - A later user message without marker or accepted phrase clears prior `externalExecConsent` while preserving existing `requiredSkills`, `skillReads`, `ownershipTrace`, and `explicitForeignAgents` behavior.
  - `go ahead` and `continue` do not persist consent.

- [ ] Run the red test command:
  - `bun test tests/extensions/pi-oven-runtime/wiring.test.ts`
  - Expected before implementation: FAIL because `externalExecConsent` is never written.

- [ ] Update `.omp/extensions/pi-oven-runtime/gate-state.ts`:
  - Add the `ExternalExecConsent` type and optional `externalExecConsent?: ExternalExecConsent` to `FsmState` at `gate-state.ts:30-41`.
  - Extend `isValidState()` at `gate-state.ts:108-151` to reject malformed consent state.
  - Seed default `externalExecConsent` as absent in `GateStateStore.mutate()` at `gate-state.ts:224-249`.
  - Add an atomic consume helper on `GateStateStore` that decrements `remainingUses`, removes consent at zero, increments `version`, and writes through the same `mutate()` / single-writer path.

- [ ] Update `.omp/extensions/pi-oven.ts`:
  - Add `extractExternalExecConsent()` near `extractExplicitForeignAgents()` at `pi-oven.ts:468-480`.
  - In the parent-session `turn_start` mutation at `pi-oven.ts:795-829`, compute consent from `latestUserMessage` and set `externalExecConsent` to the new consent object or `undefined` for latest user messages without consent.
  - Do not reuse old consent when `latestUserMessage.id` changes.

- [ ] Run the green test command:
  - `bun test tests/extensions/pi-oven-runtime/wiring.test.ts`
  - Expected after implementation: PASS.

- [ ] [COMMIT: consent state] Commit with message `feat(pi-oven): persist explicit external execution consent`.

## Task 3: Gate decision and atomic consent consumption

**Files:**
- Modify `.omp/extensions/pi-oven-runtime/gate.ts:33-60,115-246`
- Modify `.omp/extensions/pi-oven-runtime/gate-handler.ts:241-262,323-383`
- Modify `.omp/extensions/pi-oven-runtime/gate-state.ts:224-249,251-316`
- Modify `tests/extensions/pi-oven-runtime/gate.test.ts:123-197`
- Modify `tests/extensions/pi-oven-runtime/gate-handler.test.ts:123-207,439-456`

**Interfaces:**
- `GateInput` consumes current `externalExecConsent` from state.
- `GateDecision` can set `consumeExternalExecConsent: true` when an external command is allowed by active consent.
- External command kind to consent scope mapping:
  - `external-read` matches `scope=read` or `scope=all`.
  - `external-session` matches `scope=access` or `scope=all`.
  - `external-mutation` matches `scope=mutation` or `scope=all`.
  - `inline-secret` never matches any consent scope.

**Test Design:**
- `gate.test.ts` covers pure decisions: block/default, allow/scope, consume flag, inline secret precedence, commit/push regression.
- `gate-handler.test.ts` covers stateful behavior: first command consumes, second command blocks, non-parent sessions do not mutate state, mixed inline-secret/external command does not consume.

**Steps:**

- [ ] Add failing pure gate tests in `tests/extensions/pi-oven-runtime/gate.test.ts` under the forbidden floor and push-consent sections:
  - `aws sts assume-role --role-arn x` blocks by default even when `fsm` is `{ kind: "ABSENT" }`.
  - `aws sts assume-role --role-arn x` allows with `scope: "access"` and returns `consumeExternalExecConsent: true`.
  - `aws s3 ls` blocks with `scope: "mutation"` and allows with `scope: "read"`.
  - `./scripts/deploy.sh --region singapore --warp on` allows with `scope: "mutation"` or `scope: "all"`.
  - `AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE aws s3 ls` blocks even with `scope: "all"`.
  - Existing `git commit` and `git push` tests remain unchanged except for type additions to `GateInput`.

- [ ] Add failing handler tests in `tests/extensions/pi-oven-runtime/gate-handler.test.ts`:
  - Write active state containing `externalExecConsent: { sourceMessageId: "u1", scope: "all", remainingUses: 1 }`; first `bashEvent("aws sts assume-role --role-arn x")` allows and consumes; second identical event blocks.
  - Write active state with `scope: "mutation"`; `bashEvent("aws s3 ls")` blocks and leaves `remainingUses: 1`.
  - Write active state with `scope: "all"`; `bashEvent("AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE aws s3 ls")` blocks and leaves `remainingUses: 1`.
  - Create a handler with `isParentSession: false`; an external command blocks or otherwise returns without changing `autonomous.json`, and the persisted consent object is byte-for-byte unchanged after the call.

- [ ] Run the red test commands:
  - `bun test tests/extensions/pi-oven-runtime/gate.test.ts`
  - `bun test tests/extensions/pi-oven-runtime/gate-handler.test.ts`
  - Expected before implementation: FAIL because gate input has no external consent path and handler never consumes consent.

- [ ] Update `.omp/extensions/pi-oven-runtime/gate.ts` decision order:
  - Always block `forbiddenMatches` and `inlineSecretMatches` before bypass/FSM checks.
  - If `externalMatches.length > 0`, require matching active consent before any commit/push/code-write gate logic.
  - Return a block reason that names the external command class and tells the agent to request `PI_OVEN_EXTERNAL_EXEC: once scope=<read|access|mutation|all> creds=local` when user consent is required.
  - Return `consumeExternalExecConsent: true` only for allowed external commands.
  - Keep `PI_OVEN_GATE_BYPASS` scoped to commit/push/code-write recovery; it must not lift external command blocks.

- [ ] Update `.omp/extensions/pi-oven-runtime/gate-handler.ts`:
  - Change the fast path at `gate-handler.ts:323-333` to account for `externalMatches` and `inlineSecretMatches`, not only `gitVerbs` and `forbiddenMatches`.
  - Pass current state consent to `decideGate()` after `store.readState()`.
  - When `decision.consumeExternalExecConsent` is true and `deps.isParentSession` is true, call the new gate-state consume helper inside `store.runExclusive()` and re-read/revalidate inside the mutex.
  - For non-parent sessions, do not mutate state; preserve single-use semantics by blocking consent-gated external commands when consumption cannot be performed.
  - Add audit logging that distinguishes blocked default external execution, consent-allowed external execution, and inline-secret floor blocks.

- [ ] Run the green test commands:
  - `bun test tests/extensions/pi-oven-runtime/gate.test.ts`
  - `bun test tests/extensions/pi-oven-runtime/gate-handler.test.ts`
  - Expected after implementation: PASS.

- [ ] [COMMIT: gate consumption] Commit with message `feat(pi-oven): gate external execution on single-use consent`.

## Task 4: Prompt, shipped skill, doc, and eval alignment

**Files:**
- Modify `.omp/extensions/pi-oven-runtime/rules-injector.ts:240-243`
- Modify `skills/aws/SKILL.md:4,11,37-50`
- Modify `skills/bitbucket-pipeline/SKILL.md:38,62`
- Modify `skills/cloudflare/SKILL.md:39-40`
- Modify `skills/large-task-delegation/references/dispatch-anatomy.md:44-50`
- Modify `docs/specs/2026-05-29-pi-oven-omp-runtime-layer.md:47,52-53`
- Modify `docs/specs/2026-05-28-pi-oven-skill-rewrite-and-new-skills.md:227-231`
- Modify `docs/site/skill-flow.ko.html:914,925,936,973`
- Review/update `evals/aws/scenarios/adversarial.yaml:1-26`
- Review/update `evals/aws/scenarios/regression.yaml:1-24`
- Review/update `evals/cloudflare/scenarios/adversarial.yaml:1-20`

**Interfaces:**
- Runtime prompt and shipped skills must use the same policy terms as the gate:
  - default block for external execution,
  - explicit latest-turn consent allows one matching external command,
  - local credentials allowed under consent,
  - inline secret literals always forbidden,
  - destructive `rm -rf` roots always forbidden.

**Test Design:**
- Skill eval scenarios remain behavioral checks for policy prose.
- Existing adversarial inline-AKIA eval remains a refusal case.
- Existing mutation-without-marker evals remain refusal cases.
- If any eval prompt is changed to include `PI_OVEN_EXTERNAL_EXEC: once scope=... creds=local`, update expected output to require consent-gated execution wording instead of categorical refusal.

**Steps:**

- [ ] Update `.omp/extensions/pi-oven-runtime/rules-injector.ts:240-243` so the injected discipline block says:
  - `git commit` blocked unless gate passed,
  - `git push` blocked unless push consent present,
  - destructive `rm -rf` roots and inline secret literals always blocked,
  - external infra/production commands blocked unless explicit external execution consent is active for the latest user message.

- [ ] Update `skills/aws/SKILL.md:4,11,37-50`:
  - Description and Purpose no longer call the skill read-only-only.
  - Safety says direct AWS reads/mutations default to refusal unless explicit external execution consent is active.
  - Safety allows local credential files under active consent.
  - Safety forbids pasted inline AKIA/secret/token literals regardless of consent.
  - Mutation redirection says script/CI redirection is the default no-consent path, not an unconditional rule.

- [ ] Update `skills/bitbucket-pipeline/SKILL.md:38,62` and `skills/cloudflare/SKILL.md:39-40` using the same consent-gated language for direct mutations, while preserving read-only defaults and credential-scope warnings.

- [ ] Update `skills/large-task-delegation/references/dispatch-anatomy.md:44-50` by replacing “AI direct execution forbidden (even with explicit user instruction)” with the new explicit-consent external-exec policy and the inline-secret permanent floor.

- [ ] Update docs:
  - In `docs/specs/2026-05-29-pi-oven-omp-runtime-layer.md:47,52-53`, add a policy-slice supersession note pointing to `docs/specs/2026-06-26-explicit-external-exec-override.md` and state that prod-access is no longer part of `forbiddenMatches`.
  - In `docs/specs/2026-05-28-pi-oven-skill-rewrite-and-new-skills.md:227-231`, add a supersession note for the old production-code-first wording.
  - In `docs/site/skill-flow.ko.html:914,925,936,973`, replace read-only/code-first-only summaries with Korean wording that says mutation execution is consent-gated, local credential files are allowed under consent, and inline secrets remain forbidden.

- [ ] Update eval YAML wording only where it contradicts the new contract:
  - Keep `evals/aws/scenarios/adversarial.yaml:1-26` as an inline-secret refusal case; expected response should mention inline secret / pasted AKIA refusal, not a categorical ban on local credentials.
  - Keep `evals/aws/scenarios/regression.yaml:1-24` as a no-consent mutation refusal case unless the prompt is deliberately changed to include the structured marker.
  - Keep `evals/cloudflare/scenarios/adversarial.yaml:1-20` as a no-consent mutation refusal case; do not treat “Just do it directly via the API” as accepted consent unless it is changed to the structured marker or one of the exact phrase-whitelist strings from Task 2.

- [ ] Run the focused policy eval commands if the eval files changed:
  - `bun scripts/run-eval.ts --skill aws --scenario adversarial`
  - `bun scripts/run-eval.ts --skill aws --scenario regression`
  - `bun scripts/run-eval.ts --skill cloudflare --scenario adversarial`
  - Expected after alignment: PASS.

- [ ] [COMMIT: policy text] Commit with message `docs(pi-oven): align external execution consent policy`.

## Task 5: Targeted regression pass and final handoff

**Files:**
- Re-check all files modified in Tasks 1-4.
- No additional code/doc files are expected beyond the file list above.

**Test Design:**
- This task proves the implementation slice without running project-wide build/lint suites.
- Use the same focused commands from each task; do not substitute a broader command as the only evidence.

**Steps:**

- [ ] Run targeted runtime tests:
  - `bun test tests/extensions/pi-oven-runtime/git-normalize.test.ts`
  - `bun test tests/extensions/pi-oven-runtime/gate.test.ts`
  - `bun test tests/extensions/pi-oven-runtime/gate-handler.test.ts`
  - `bun test tests/extensions/pi-oven-runtime/wiring.test.ts`
  - Expected: all PASS.

- [ ] Run focused evals if Task 4 changed eval YAML:
  - `bun scripts/run-eval.ts --skill aws --scenario adversarial`
  - `bun scripts/run-eval.ts --skill aws --scenario regression`
  - `bun scripts/run-eval.ts --skill cloudflare --scenario adversarial`
  - Expected: all PASS.

- [ ] Search the modified policy surfaces for stale categorical language before final commit:
  - Search terms: `always blocked`, `never execute directly`, `even with explicit user instruction`, `read-only production inspection`, `forbidden in this skill under any condition`.
  - Expected: remaining matches are either historical lines with an explicit supersession note or no-consent / inline-secret refusal wording.

- [ ] Verify spec acceptance manually against implemented behavior:
  - `aws sts assume-role ...` blocks by default and allows exactly once with structured consent.
  - `./scripts/deploy.sh --region singapore --warp on` is `external-mutation` and follows the same consent rule.
  - `AWS_ACCESS_KEY_ID=AKIA... aws s3 ls` blocks even with consent.
  - `git commit` and `git push` tests still pass unchanged in behavior.
  - Runtime prompt and shipped AWS skill no longer say explicit user-approved external execution is categorically forbidden.

- [ ] [COMMIT: final regression] Commit with message `test(pi-oven): cover explicit external execution override` if Task 5 produced test/eval-only adjustments after Task 4; otherwise no extra commit is needed.

## Edge Cases

- **Latest-message only:** Consent from an older user message must be cleared on a later user message without consent.
- **Scope mismatch:** `scope=mutation` must not allow `external-read`; `scope=read` must not allow `external-mutation`; `scope=all` allows all external classes.
- **Multiple matches in one command:** If any segment has an inline secret or always-forbidden `rm -rf` floor match, block and do not consume consent.
- **External plus git:** If a command contains both an external match and `git push`, external consent is checked independently from push consent; do not let either consent imply the other.
- **Subagent sessions:** Subagent handlers may read state for gating but must not mutate or consume consent. Preserve single-use semantics by requiring parent-session consumption for an allowed external command.
- **False positives:** Keep verb lists explicit; prefer over-blocking common external CLIs with a clear reason over silently allowing mutation.
- **False negatives:** Do not attempt shell sandboxing; keep the existing best-effort parser boundary and documented residual bypass posture.
- **Inline credentials:** Local credential files are allowed under consent; command text containing likely secrets is not.

## Critical Files

- `.omp/extensions/pi-oven-runtime/git-normalize.ts` — pure classifier; a bad split can accidentally turn an always-forbidden floor into a consent-gated allow.
- `.omp/extensions/pi-oven-runtime/gate.ts` — decision ordering; inline secrets and `rm -rf` must stay before all bypass/consent logic.
- `.omp/extensions/pi-oven-runtime/gate-handler.ts` — single-use consumption; races or non-parent writes can violate consent semantics.
- `.omp/extensions/pi-oven-runtime/gate-state.ts` — state validation; malformed consent must make state invalid rather than silently allowing.
- `.omp/extensions/pi-oven.ts` — latest user message parsing; stale consent here creates the highest safety risk.
- `skills/aws/SKILL.md` — primary shipped policy surface for local credential behavior.

## Verification Commands Summary

Targeted commands for the implementer:

- `bun test tests/extensions/pi-oven-runtime/git-normalize.test.ts`
- `bun test tests/extensions/pi-oven-runtime/gate.test.ts`
- `bun test tests/extensions/pi-oven-runtime/gate-handler.test.ts`
- `bun test tests/extensions/pi-oven-runtime/wiring.test.ts`
- `bun scripts/run-eval.ts --skill aws --scenario adversarial`
- `bun scripts/run-eval.ts --skill aws --scenario regression`
- `bun scripts/run-eval.ts --skill cloudflare --scenario adversarial`

## Spec Coverage Check

- Requirement: default external execution block -> Tasks 1 and 3.
- Requirement: explicit runtime-visible latest-message consent -> Task 2.
- Requirement: single-use consent consumption -> Task 3.
- Requirement: local credentials allowed under consent -> Tasks 2, 3, and 4.
- Requirement: inline secret literals always forbidden -> Tasks 1, 3, and 4.
- Requirement: no `git commit` / `git push` semantic change -> Tasks 3 and 5.
- Requirement: runtime discipline and shipped AWS skill no categorical refusal -> Task 4.
- Requirement: deploy script classification -> Tasks 1 and 3.
- Scope creep rejected: no sandboxing, no global/user-global skill rewrite, no blanket disable switch, no change to push consent.

## Execution Handoff

Plan complete and saved to `docs/plans/2026-06-26-explicit-external-exec-override-plan.md`. Two execution options:

1. **Subagent-Driven (recommended)** — dispatch a fresh implementation subagent per task, review between tasks, fast iteration.

2. **Inline Execution** — execute tasks in this session using `executing-plans`, batching only at the specified checkpoints.

