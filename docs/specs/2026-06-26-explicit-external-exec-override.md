# Spec: explicit user-consented external execution override for pi-oven

**Status**: DRAFT — 2026-06-26. User requested that pi-oven allow AI-executed production / external-infra commands when the user explicitly authorizes them, including use of local credentials. During design review the user selected the broader scope (`감지 가능한 외부 mutation 전반`) and then said `계속 해줘`, which this draft treats as approval to write the spec.
**Supersedes (policy slice only)**: the unconditional "prod-access forbidden floor" portion of `docs/specs/2026-05-29-pi-oven-omp-runtime-layer.md` §3 Layer 1 B3.
**Inputs (evidence)**:
- hard block today: `.omp/extensions/pi-oven-runtime/gate.ts:129-135`
- prod matcher today: `.omp/extensions/pi-oven-runtime/git-normalize.ts:325-340`
- current discipline text: `.omp/extensions/pi-oven-runtime/rules-injector.ts:238-243`
- current tests: `tests/extensions/pi-oven-runtime/gate.test.ts:136-140`, `tests/extensions/pi-oven-runtime/git-normalize.test.ts:154-162`
- current explicit-intent state pattern: `.omp/extensions/pi-oven.ts:468-480`, `.omp/extensions/pi-oven.ts:805-829`, `.omp/extensions/pi-oven-runtime/gate-handler.ts:110-214`

---

## 1. Goal

Allow pi-oven to execute externally mutating or privileged infrastructure commands **when and only when** the latest user message gives explicit approval. Local credentials already present on the machine are allowed under that explicit approval path.

The new policy must preserve a real safety boundary:
- default remains **block**
- approval must be **explicit** and **runtime-visible**
- approval must be **single-use** by default
- secrets pasted directly into prompts / commands remain **forbidden**

## 2. Non-goals

- No blanket "disable the guardrail forever" switch.
- No silent inference from vague language like "go ahead".
- No attempt to perfectly sandbox shell execution; this remains best-effort command classification, like the existing git / rm guard.
- No inline acceptance of pasted permanent secrets; this spec allows **local credential usage**, not **literal secret injection into commands**.
- No change to `git push` / `git commit` consent semantics.

## 3. Problem

Current pi-oven behavior is too rigid for the user's intended workflow.

### 3.1 Runtime behavior today

The runtime blocks every command whose normalized command hits `forbiddenMatches`, before any FSM / bypass / consent logic is considered:

- `.omp/extensions/pi-oven-runtime/gate.ts:129-135`

The current "prod-access" matcher is narrow and unconditional:

- `aws ssm start-session`
- `aws ssm send-command`
- `aws sts assume-role`
- `aws secretsmanager get-secret-value`

Evidence:
- `.omp/extensions/pi-oven-runtime/git-normalize.ts:325-340`

The discipline prompt reinforces the same unconditional rule:
- `.omp/extensions/pi-oven-runtime/rules-injector.ts:238-243`

Tests lock that behavior in:
- `tests/extensions/pi-oven-runtime/gate.test.ts:136-140`
- `tests/extensions/pi-oven-runtime/git-normalize.test.ts:154-162`

### 3.2 Credential behavior today

pi-oven runtime does **not** currently inspect the machine's local AWS credential store or distinguish `AKIA` vs `ASIA` at the shell-boundary. That refusal lives in skill/policy prose, not in the runtime gate.

Therefore the real design problem is:
1. the runtime unconditionally blocks a small set of external-access commands, and
2. the skill/prompt layer tells the agent to refuse local permanent credentials categorically.

## 4. Decision summary

Replace the unconditional prod-access floor with an **explicit user-consent external-exec gate**.

### 4.1 New model

Classify commands into four buckets:

1. **Always forbidden**
   - repo/HOME-root destructive `rm -rf`
   - inline secret injection into command text
2. **External read**
   - explicit user consent required
3. **External privileged/session access**
   - explicit user consent required
4. **External mutation**
   - explicit user consent required

User consent is persisted from the latest user message into runtime state and consumed on first matching command.

### 4.2 High-level policy

| Command class | Default | With explicit consent | Notes |
|---|---|---|---|
| `rm -rf` repo/HOME root | Block | Block | unchanged hard floor |
| inline secret literal | Block | Block | new permanent floor |
| external read | Block | Allow once | explicit user-authorized only |
| external session / credential escalation | Block | Allow once | explicit user-authorized only |
| external mutation | Block | Allow once | explicit user-authorized only |

## 5. Explicit user consent contract

### 5.1 Source of truth

Use the existing turn-start state pattern already used for explicit foreign-agent dispatches:
- parse latest user message in `.omp/extensions/pi-oven.ts`
- persist normalized consent state in `.pi-oven/state/autonomous.json`
- read + consume it inside the gate handler / state mutex

### 5.2 Consent shape

Add a new optional state field, e.g.

```ts
externalExecConsent?: {
  sourceMessageId: string;
  scope: "read" | "access" | "mutation" | "all";
  remainingUses: number;
}
```

Initial behavior:
- default `scope = "all"` for strong explicit override phrases
- default `remainingUses = 1`
- explicit consent already means pi-oven may use local credentials present on the machine

### 5.3 How consent is granted

Ship a strict parser, not fuzzy intent inference.

Two accepted paths:

1. **Structured marker** — recommended and stable
   - e.g. `PI_OVEN_EXTERNAL_EXEC: once scope=all creds=local`
2. **Tight phrase whitelist** — ergonomic bridge for natural chat
   - Korean / English phrases meaning "you execute it directly / ignore the guardrail / use local credentials"
   - exact phrases list is code-owned, short, and unit-tested

If neither pattern is present, consent is absent.

### 5.4 Consumption

Consent is consumed inside the same single-writer state mutex used by existing gate state writes.

Rules:
- matching external command + active consent → allow, decrement `remainingUses`
- once `remainingUses === 0` → remove the field
- new user turn without renewed consent does not resurrect an old grant

## 6. Command classification redesign

### 6.1 Replace `detectForbiddenProdAccess`

Current `ForbiddenMatch` is too coarse. Replace it with a richer classifier that can report:

```ts
type ExternalCommandKind =
  | "external-read"
  | "external-session"
  | "external-mutation"
  | "inline-secret";
```

The normalized command result should carry these matches separately from the always-forbidden `rm -rf` floor.

### 6.2 Initial coverage

Best-effort classifiers should cover at least:

- `aws`
  - read: `describe-*`, `get-*`, `list-*`
  - session/access: `ssm start-session`, `ssm send-command`, `sts assume-role`, `secretsmanager get-secret-value`
  - mutation: `create-*`, `update-*`, `put-*`, `delete-*`, `start-*`, `stop-*`, `terminate-*`, `deploy`, `sync`, `cp`, `rm`
- `terraform` / `tofu`
  - mutation: `apply`, `destroy`, `import`, `state mv/rm`, `taint`, `untaint`
- `kubectl`
  - read: `get`, `describe`, `logs`
  - mutation/access: `apply`, `delete`, `patch`, `edit`, `scale`, `exec`, `port-forward`
- `helm`
  - mutation: `install`, `upgrade`, `rollback`, `uninstall`
- DB CLIs (`psql`, `mysql`, `mongosh`, `redis-cli`)
  - read vs mutation best-effort by subcommand / SQL verb heuristics
- remote transport (`ssh`, `scp`, `rsync`)
  - privileged/session/access bucket
- repo-local deploy entrypoints
  - `deploy*.sh`, `release*.sh`, `migrate*.sh`, `scripts/deploy*`, `scripts/release*`, `scripts/migrate*`

This remains heuristic, not a shell sandbox. The goal is predictable policy for common real commands.

### 6.3 Inline secret floor

Add a new always-blocked classifier for command text that directly embeds likely credential literals, for example:
- `AWS_ACCESS_KEY_ID=AKIA...`
- `AWS_SECRET_ACCESS_KEY=...`
- `--password ...`
- raw access-token / secret-token literals in the command string

This floor is never lifted by explicit consent. It preserves the distinction between:
- **allowed**: using credentials already configured locally
- **forbidden**: injecting secrets directly into the command text

## 7. Runtime gate changes

### 7.1 `git-normalize.ts`

Refactor from:
- `forbiddenMatches: ForbiddenMatch[]`

to something like:
- `forbiddenMatches` for root-destructive `rm -rf`
- `externalMatches` for consent-gated external commands
- `inlineSecretMatches` for permanent block

### 7.2 `gate.ts`

Change decision order:

1. always-forbidden floor (`rm -rf` root, inline secrets) → block
2. commit/push/code-write logic unchanged
3. if command has external match:
   - no consent → block with explicit reason
   - consent present and scope matches → allow + mark `consumeExternalExecConsent`

Do **not** overload `PI_OVEN_GATE_BYPASS` for this feature. Recovery bypass and user-authorized external execution are different mechanisms.

### 7.3 `gate-handler.ts`

After a successful allow on an external match, consume consent through the state store under the single-writer mutex.

### 7.4 `gate-state.ts`

Persist + validate `externalExecConsent`.
Provide helpers to:
- read current consent
- consume current consent atomically
- drop stale / exhausted consent

### 7.5 `pi-oven.ts`

At `turn_start`, parse latest user message and persist the new consent state alongside `requiredSkills`, `skillReads`, and `explicitForeignAgents`.

Reuse the existing pattern:
- latest-user-message based
- exact normalized state
- parent-session writes only

## 8. Skill / prompt policy changes

### 8.1 Runtime discipline text

Update `.omp/extensions/pi-oven-runtime/rules-injector.ts` so the prompt no longer says production-access commands are always blocked.

New wording should say:
- external infra / production commands are blocked **unless explicit user consent is active**
- local credentials may be used under that explicit consent path
- inline secret literals remain forbidden

### 8.2 Shipped skill docs

Update pi-oven-owned skills that currently mandate unconditional refusal, especially:
- `skills/aws/SKILL.md`
- any shipped references that restate the old unconditional prod-access rule

New rule:
- default refuse direct external execution
- if explicit user authorization is active in the current turn, AI execution is allowed
- local credentials already on the machine are allowed
- pasted secrets are still forbidden

### 8.3 Out of scope

Global non-pi-oven skills outside this repo (for example user-global harness skills) are not rewritten by this spec. This change is for pi-oven-owned runtime + shipped skills.

## 9. Tests

Required test updates:

### 9.1 `tests/extensions/pi-oven-runtime/git-normalize.test.ts`
- classify external read / access / mutation examples
- classify inline-secret examples
- keep `rm -rf` root floor coverage intact

### 9.2 `tests/extensions/pi-oven-runtime/gate.test.ts`
- external command blocks by default
- matching consent allows exactly once
- exhausted consent blocks again
- inline secret still blocks even with consent

### 9.3 `tests/extensions/pi-oven-runtime/gate-handler.test.ts`
- consent is consumed atomically
- non-parent sessions do not mutate consent state
- mixed command classes behave correctly

### 9.4 `tests/extensions/pi-oven/wiring.test.ts`
- `turn_start` persists parsed consent from the latest user message
- new user message replaces / clears prior consent as designed

## 10. Risks / trade-offs

1. **Classifier false positives**
   - broad external matching can over-block harmless commands
   - mitigation: narrow exact verb lists, targeted tests, clear block reasons
2. **Classifier false negatives**
   - best-effort parser can miss shell-obfuscated execution
   - accepted limitation; same class as existing git normalization residuals
3. **Natural-language consent ambiguity**
   - mitigation: structured marker support + small exact phrase whitelist
4. **Policy divergence with global skills**
   - pi-oven-owned runtime may allow what upstream/global prose still discourages
   - acceptable; this spec only governs pi-oven-owned behavior

## 11. Acceptance criteria

1. A command like `aws sts assume-role ...` is blocked by default and allowed once with explicit consent.
2. A command like `./scripts/deploy.sh --region singapore --warp on` is classifiable as external execution and follows the same consent rule.
3. A command like `AWS_ACCESS_KEY_ID=AKIA... aws s3 ls` stays blocked even with consent.
4. Existing `git commit` / `git push` gates still behave exactly as before.
5. The runtime discipline text and shipped AWS skill no longer state that explicit user-approved external execution is categorically forbidden.

## 12. Implementation sketch

Target files:
- `.omp/extensions/pi-oven-runtime/git-normalize.ts`
- `.omp/extensions/pi-oven-runtime/gate.ts`
- `.omp/extensions/pi-oven-runtime/gate-handler.ts`
- `.omp/extensions/pi-oven-runtime/gate-state.ts`
- `.omp/extensions/pi-oven.ts`
- `tests/extensions/pi-oven-runtime/{git-normalize,gate,gate-handler}.test.ts`
- `tests/extensions/wiring.test.ts`
- `skills/aws/SKILL.md`
- `docs/specs/2026-05-29-pi-oven-omp-runtime-layer.md`
- any pi-oven-owned docs that restate the unconditional prod-access floor

---

## Self-review

- No `TODO` / `TBD` placeholders left.
- Scope is focused on pi-oven runtime + shipped skills only.
- Prior runtime architecture is preserved: single-writer state, turn-start extraction, tool-boundary enforcement.
- The main policy shift is explicit and testable: unconditional prod-access floor → consent-gated external-exec path + permanent inline-secret floor.
