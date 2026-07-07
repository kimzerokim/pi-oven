# Handoff / header / runtime survey (2026-07-07)

## Scope

- Unstaged diff surveyed:
  - `.omp/extensions/pi-oven-runtime/deep-interview-runtime.ts`
  - `.omp/extensions/pi-oven-runtime/gate.ts`
  - `.omp/extensions/pi-oven-runtime/pi-oven-ask.ts`
  - `tests/extensions/pi-oven-runtime/deep-interview-runtime.test.ts`
  - `tests/extensions/pi-oven-runtime/gate.test.ts`
  - `tests/extensions/pi-oven-runtime/pi-oven-ask.test.ts`
- Direct contract / proof surfaces additionally checked because this diff depends on them:
  - `.omp/extensions/pi-oven-runtime/skill-keyword-loader.ts:14-30,141-150,303-318,423-457`
  - `.omp/extensions/pi-oven.ts:1142-1193`
  - `.omp/extensions/pi-oven-runtime/gate-handler.ts:293-321,358-408`
  - `skills/autonomous-loop/SKILL.md:11-20,109-137,141-154`
  - `skills/improve-codebase-architecture/SKILL.md:9-18,41-70`
  - `tests/extensions/pi-oven-runtime/skill-keyword-loader.test.ts:134-192`
  - `tests/extensions/pi-oven-runtime/gate-handler.test.ts:710-758`
  - `tests/extensions/pi-oven-runtime/wiring.test.ts:623-639`
- Verification run during survey:
  - `bun test tests/extensions/pi-oven-runtime/deep-interview-runtime.test.ts tests/extensions/pi-oven-runtime/gate.test.ts tests/extensions/pi-oven-runtime/pi-oven-ask.test.ts tests/extensions/pi-oven-runtime/skill-keyword-loader.test.ts tests/extensions/pi-oven-runtime/gate-handler.test.ts tests/extensions/pi-oven-runtime/wiring.test.ts`
  - Result: `207 pass, 0 fail`
- Extra runtime check: `updateSkillKeywordLoaderOnTurnStart("자율 실행, 리팩토링 기회 찾아줘")` was executed in JS eval and returned `code-quality-discipline`, `autonomous-loop`, `improve-codebase-architecture` in that order.

## Findings

### 1) 이번 6파일 diff가 실제로 바꾸는 것

1. **approval answer를 canonical token + display label로 분리 저장한다.**
   - `deep-interview-runtime.ts:179-329` adds `CanonicalApprovalSelection`, token normalization, legacy/localized approval decoding, and `selectedDisplayLabel` preservation.
   - `deep-interview-runtime.ts:600-648,789-856` now resolves approval status from canonical tokens while preserving the human-visible label in `resolved.displayLabel`.
   - `pi-oven-ask.ts:273-301,942-977` converts UI/headless choices into canonical persisted values before calling `runtime.recordAnswer(...)`.
   - Evidence in tests:
     - localized proceed path persists `selected: "proceed"`, `displayLabel: "계속"` — `deep-interview-runtime.test.ts:292-323`
     - localized approve-only handoff persists `selected: "approve"`, `displayLabel: "승인"` — `pi-oven-ask.test.ts:811-895`
     - legacy/localized affirmative resume repairs to approved + `displayLabel: "이대로 진행"` — `deep-interview-runtime.test.ts:525-609`, `gate.test.ts:806-852`

2. **approval ownership을 root `approvalFlow`로 밀어 넣고, `deepInterview` 쪽 handoff/routing residue는 runtime read surface에서 숨긴다.**
   - `deep-interview-runtime.ts:93-109` sanitizes `deepInterview` so top-level `approvalHandoff`, `routingApproval`, and pending-question embedded copies do not leak back to callers after handoff.
   - `deep-interview-runtime.ts:859-930` final spec persistence explicitly nulls `pendingQuestion`, `approvalHandoff`, and `routingApproval`, then seeds root `approvalFlow` as the source of truth.
   - Tests prove the cutover:
     - `seeded.approvalHandoff` and nested pending meta are absent while root `approvalFlow` is pending — `deep-interview-runtime.test.ts:267-289`
     - resumed `deepInterview` no longer exposes `approvalHandoff` / `routingApproval` after answer persistence — `deep-interview-runtime.test.ts:324-331,365-372,631-634`

3. **write-lane guard는 stale / localized approval 상태를 해석해서 불필요한 block을 풀도록 바뀐다.**
   - `gate.ts:153-229` adds a legacy approval decoder, computes `effectiveApprovalStatus`, and only keeps the brainstorming mutation guard when approval is truly pending or brainstorming is still active.
   - The guard is still strict during active brainstorming, but it stops treating stale localized approved answers as rejected.
   - Tests:
     - sanctioned final spec receipt lifts the guard even while `approvalFlow.status === "pending"` — `gate.test.ts:763-805`
     - legacy localized affirmative root approval no longer blocks code-write — `gate.test.ts:806-852`

4. **`pi-oven_ask` visual diff는 header verticalization이 아니라 question/section/option spacing patch다.**
   - landed spacing primitives:
     - `QUESTION_LINE_GAP`, `OPTION_BLOCK_SPACER_LINES`, `DETAIL_BLOCK_SPACER_LINES` — `pi-oven-ask.ts:174-177`
     - `LineGapComponent` inserts visible blank spacer lines between wrapped markdown lines — `pi-oven-ask.ts:229-270`
     - `appendOptionRows` adds per-option description/detail blocks and `VerticalSpacer(2)` between option groups — `pi-oven-ask.ts:508-533`
   - render tests assert this spacing contract in both call/result paths — `pi-oven-ask.test.ts:357-470,472-578`

### 2) handoff / write-lane bug-fix 방향 판단

#### 2.1 stale state reset 관점

**Verdict: 맞는 방향이다.**

- The fix is not only “store better data”; it also **repairs stale persisted approval state on resume**.
  - `deep-interview-runtime.ts:246-319` computes effective approval state from persisted `resolved.selected`, `resolved.displayLabel`, and the latest approval round, then rewrites stale `approvalFlow.status` / `resolved` if needed.
  - `deep-interview-runtime.ts:665-668` applies that repair on every runtime snapshot read.
- The fix also **cleans ownership residue** so old handoff metadata does not keep shadowing root approval state.
  - `deep-interview-runtime.ts:93-109,894-896`
  - validated by `deep-interview-runtime.test.ts:324-331,371-372,631-634`
- For keyword-proof state, turn-start also resets stale read proofs to the current user message’s owned targets only:
  - `.omp/extensions/pi-oven.ts:1153-1183,1192`
  - `wiring.test.ts:623-639` shows `requiredSkills` + `ownedSkillReadTargets` are persisted together and `skillReads` starts empty for a new matched-skill turn.

#### 2.2 approval status 관점

**Verdict: 맞는 방향이다.**

- The new model explicitly distinguishes:
  - `approve`
  - `proceed`
  - `override per role`
  - `ask about these choices`
  - source: `deep-interview-runtime.ts:179-216`
- Status handling now lines up with semantics instead of raw string equality:
  - `approve` => approved unless routing buckets remain unresolved — `deep-interview-runtime.ts:620-625`
  - `proceed` => fully approved — `deep-interview-runtime.ts:622-623`
  - `override per role` => pending until bucket approvals finish — `deep-interview-runtime.ts:624-625`
  - `ask about these choices` => pending — `deep-interview-runtime.ts:626-627`
- This is consistent with the tests that now keep canonical state while preserving localized display labels:
  - `deep-interview-runtime.test.ts:302-323,383-423,484-523,525-609`
  - `pi-oven-ask.test.ts:865-895,938-949`

#### 2.3 brainstorming mutation guard 관점

**Verdict: 방향은 맞고, 현재 코드/테스트와도 일치한다.**

- The guard’s job is no longer “pending approval exists => always block.” It is now “deep-interview still owns the lane, unless the sanctioned completion receipt has cut ownership over.”
  - block conditions: `gate.ts:199-229`
  - sanctioned receipt detection: `gate.ts:126-138`
- This matches the runtime’s own sanctioned completion path:
  - final docs/specs write + root `approvalFlow` seed happens only in `persistFinalSpecAndSeedApprovalFlow(...)` — `deep-interview-runtime.ts:859-930`
- The tests confirm the intended ownership transfer:
  - still block while active brainstorming owns the lane — existing guard section `gate.test.ts:656-762`
  - lift after sanctioned spec persistence receipt even if `approvalFlow` remains pending — `gate.test.ts:763-805`
  - also lift for stale localized approved answers — `gate.test.ts:806-852`

### 3) header verticalization vs already-landed spacing patch

**Header verticalization은 아직 미구현이다. spacing/section/option patch만 들어왔다.**

- `renderCall(...)` still renders all `contextHeaders` in **one joined line**:
  - `pi-oven-ask.ts:547-556`
- `renderResult(...)` does the same:
  - `pi-oven-ask.ts:597-605`
- There is **no header-specific vertical container/spacer/helper** analogous to `appendContextSection(...)`, `LineGapComponent`, or `appendOptionRows(...)`.
- The current render tests feed multiple headers, but the assertions are about question wrapping / section spacing / option spacing, not per-header vertical stacking:
  - header inputs exist at `pi-oven-ask.test.ts:365-368,481-482`
  - actual spacing assertions start at question/body/option gaps `pi-oven-ask.test.ts:417-469,526-578`
- Therefore the current patch landed:
  - question vertical spacing
  - section separation
  - option/description/detail separation
  - ask-about-choices / other affordance spacing
- It did **not** land:
  - vertical header rows
  - header-specific spacing contract tests

### 4) runtime keyword skill trigger / proof surface check (`"자율 실행, 리팩토링 기회 찾아줘"`)

1. **Keyword whitelist is wired for the requested phrase.**
   - `autonomous-loop` includes `자율 실행` — `skill-keyword-loader.ts:15-30`
   - `improve-codebase-architecture` includes `리팩토링 기회` — `skill-keyword-loader.ts:141-150`
   - `code-quality-discipline` also includes the broader `리팩토링` token — `skill-keyword-loader.ts:64-70`

2. **Matching logic is pure substring inclusion after normalization, with no specificity pruning.**
   - `matchSkillsForText(...)` — `skill-keyword-loader.ts:295-318`
   - Because of this, the exact phrase `자율 실행, 리팩토링 기회 찾아줘` legitimately matches **three** skills, not two.

3. **The runtime proof surface is correctly threaded into state and gate enforcement.**
   - prompt injection explains `requiredSkills`, `ownedSkillReadTargets`, `skillReads` as the only proof surface — `skill-keyword-loader.ts:423-457`
   - turn start persists `requiredSkills`, resets/filter `skillReads`, and stores `ownedSkillReadTargets` — `.omp/extensions/pi-oven.ts:1142-1193`
   - gate handler records only exact owned-target reads into `skillReads` — `gate-handler.ts:293-321`
   - write-lane gate blocks until those exact reads exist — `gate-handler.ts:377-400`, `gate.ts:100-124,570-595`
   - proof tests:
     - prompt text + exact-target framing — `skill-keyword-loader.test.ts:134-192`
     - exact owned-target read required before unblocking code-write — `gate-handler.test.ts:710-758`
     - persisted runtime state carries `requiredSkills` + `ownedSkillReadTargets` together — `wiring.test.ts:623-639`

4. **Skill semantics are consistent with the current triple-match.**
   - `autonomous-loop` explicitly routes refactor / architecture-improvement work into `improve-codebase-architecture` before code write — `skills/autonomous-loop/SKILL.md:133-137`
   - `improve-codebase-architecture` explicitly says it is the single entry point for refactoring/deepening analysis — `skills/improve-codebase-architecture/SKILL.md:9-18,41-48`
   - `code-quality-discipline` is broader and non-conflicting; it adds DRY/YAGNI/KISS constraints before any eventual write, not a different flow.

**Trigger verdict:** the runtime keyword trigger is functioning correctly for this phrase. If the product intent is “only autonomous-loop + improve-codebase-architecture should fire,” that would require a deliberate matcher/whitelist design change; it is not a current bug.

## Direction verdict

- **Handoff/write-lane bug fix:** `GO`.
  - The stale-state repair, canonical approval storage, localized-display preservation, and brainstorming guard relaxation all point in the right direction and are backed by direct tests.
- **Header verticalization:** `NOT DONE`.
  - The shipped diff improves spacing around question / sections / options, but headers still render horizontally as a single joined line.
- **Runtime keyword trigger for `자율 실행, 리팩토링 기회 찾아줘`:** `WORKING AS CODED`.
  - It matches `autonomous-loop`, `improve-codebase-architecture`, and `code-quality-discipline` through the current normalized substring strategy.
  - No code fix is required unless the team wants to suppress the broader `code-quality-discipline` overlap.

## Missing implementation

1. **If header verticalization is part of this ticket, it still needs code.**
   - Change `renderCall(...)` / `renderResult(...)` header rendering from single joined `Text` rows (`pi-oven-ask.ts:547-556,597-605`) into per-header vertical rows or a header container.
   - Add render tests that assert multi-header vertical stacking explicitly, not just downstream spacing.

2. **Add an exact regression for the real user phrase that triggered this review.**
   - Current tests prove generic multi-skill matching (`skill-keyword-loader.test.ts:134-172`) but not the exact combo `자율 실행, 리팩토링 기회 찾아줘`.
   - Add one loader/wiring test that freezes the intended matched-skill set and owned-target order/contents.

3. **Add a handler-level regression for stale localized approved state if the write-lane bug was observed end-to-end.**
   - `gate.test.ts:806-852` proves the pure gate decision.
   - `deep-interview-runtime.test.ts:525-609` proves runtime resume repair.
   - There is still no end-to-end `gate-handler` test that starts from a persisted stale localized approval file and proves an actual `edit` tool call is allowed without a re-read side effect.

## Refactor opportunities

1. **Unify approval token normalization into one shared helper/module.**
   - `deep-interview-runtime.ts:185-216` and `gate.ts:144-175` both normalize overlapping approval strings.
   - Today they are intentionally similar but duplicated; drift risk is high.

2. **Extract a small approval-resolution module.**
   - Current responsibilities are split across:
     - `resolvePersistedApprovalSelection(...)` — `pi-oven-ask.ts:273-301`
     - `buildApprovalFlowResolution(...)` — `deep-interview-runtime.ts:600-648`
     - `readEffectiveApprovalStatus(...)` — `gate.ts:177-197`
   - A shared value object for `{ canonicalSelection, displayLabel, status }` would reduce cross-file divergence.

3. **Deduplicate header rendering between call/result paths once verticalization lands.**
   - `renderCall(...)` and `renderResult(...)` currently repeat the same `contextHeaders` join logic (`pi-oven-ask.ts:547-556` and `597-605`).
   - If header layout changes, centralizing it will prevent one path from drifting.

## Test anchors

- **Executed during survey:**
  - `bun test tests/extensions/pi-oven-runtime/deep-interview-runtime.test.ts tests/extensions/pi-oven-runtime/gate.test.ts tests/extensions/pi-oven-runtime/pi-oven-ask.test.ts tests/extensions/pi-oven-runtime/skill-keyword-loader.test.ts tests/extensions/pi-oven-runtime/gate-handler.test.ts tests/extensions/pi-oven-runtime/wiring.test.ts`
  - Result: `207 pass, 0 fail`

- **Key assertions to revisit while implementing:**
  - root approvalFlow owns handoff; deepInterview no longer leaks top-level approval metadata — `deep-interview-runtime.test.ts:267-332`
  - stale localized affirmative resume repairs to approved state — `deep-interview-runtime.test.ts:525-609`
  - sanctioned completion receipt lifts brainstorming guard — `gate.test.ts:763-805`
  - legacy localized affirmative answer no longer blocks write lane — `gate.test.ts:806-852`
  - localized approval-only ask persists canonical action + display label — `pi-oven-ask.test.ts:811-899`
  - current render contract covers spacing, not header verticalization — `pi-oven-ask.test.ts:357-578`
  - matched-skill prompt and proof-surface messaging — `skill-keyword-loader.test.ts:134-192`
  - only exact plugin-owned skill reads unblock code-write — `gate-handler.test.ts:710-758`
  - persisted runtime state includes `requiredSkills` / `ownedSkillReadTargets` — `wiring.test.ts:623-639`

## Unknowns

1. **Should `code-quality-discipline` also auto-trigger on `리팩토링 기회`, or is that now considered noise?**
   - Current behavior says yes; code and skill prose are internally consistent.
   - If product intent changed, the fix surface is `SKILL_KEYWORD_WHITELIST` / match-specificity behavior, not the handoff runtime.

2. **What exactly counts as “header verticalization”?**
   - Only `renderCall`?
   - Both `renderCall` and `renderResult`?
   - Also the headless/workflow-gate representation?
   - Current diff answers none of these; it only improves spacing around the existing layout.

3. **There is no screenshot-level proof for the ask UI.**
   - Evidence is string-render tests and code inspection only.
   - If visual polish matters, a narrow TUI snapshot or QA pass will still be useful.
