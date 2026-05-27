# Spec A Critic Review — Cycle 2

- Date: 2026-05-28
- Reviewer: oh-my-claudecode:critic (opus)
- Spec: `/Users/kimzerokim/work/personal/pi-oven/docs/specs/2026-05-28-pi-oven-agent-registry.md` (1151 lines)
- Previous: `docs/research/codex-reviews/2026-05-28-pi-oven-agent-registry-critic-review.md`
- Cycle: 2
- BLOCKERs resolved since cycle 1: 4/5 (B1 partial, B2 ✓, B3 ✓, B4 partial, B5 partial)
- Verdict: **REJECT (CONTINUE)** — 2 new BLOCKERs (B1-NEW + B4-NEW), 12 NITs

---

## 1. 🔴 BLOCKER

### B1-NEW. §9.1 / §3.2 / §5 conflate "unauthed" with "not-in-registry" — `resolveModelOverride` does NOT skip unauthed entries

**Evidence**:
- Spec §3.2 line 221 claims `resolveModelOverride` *"auth/registry에서 해석 가능한 첫 번째 항목을 resolution time에 선택"*. Spec §9.1 line 659 repeats this. This is **partially false** when verified against actual omp code.
- `resolveModelOverride` (`config/model-resolver.ts:716–734`): iterates `modelPatterns` and calls `resolveModelRoleValue`, which calls `parseModelPattern` against `modelRegistry.getAvailable()`. This is **registry-availability only**. It does NOT consult auth.
- The auth-aware function is the separate `resolveModelOverrideWithAuthFallback` (`config/model-resolver.ts:758–792`). This is what `task/executor.ts:1138` actually calls for subagent dispatch.
- The auth-aware function's fallback is **NOT to the next array entry**. Line 779: `const fallback = resolveModelOverride([parentActiveModelPattern], modelRegistry, settings);` — when primary is unauthed, it falls back to the **parent session's active model**, ignoring the rest of the user-supplied array.

So the spec's repeated claim that `model: [A, B]` selects B when A is unauthed is **wrong for the path that subagent dispatch actually takes**. Real subagent dispatch behavior:

```
modelPatterns = [A, B]
  - if A resolves in registry → use A
    - if A has no auth → fall back to PARENT model (not B)
  - if A does NOT resolve in registry → try B
    - if B resolves but has no auth → fall back to PARENT model
```

**Why this matters**: pi-oven's selling point is provider resilience. Actual mechanism delivers something weaker than spec promises. Skills written against §9.1's model will silently misbehave when subagent dispatch occurs from a session whose parent model is unrelated to either A or B. Worse, parent model may itself be a Claude/Anthropic model, defeating the Profile A whitelist when the unauthed-primary path fires.

**Fix**: Rewrite §3.2 / §5 / §9 to accurately distinguish three resolution outcomes:
1. Primary A in registry + authed → A
2. Primary A in registry + unauthed → **parent session's active model** (not B), with `authFallbackUsed: true` warning logged
3. Primary A NOT in registry → try B → if B resolves → B; else outer fail

Document the auth-fallback-to-parent behavior explicitly. Note this is a **whitelist hole**: when a pi-oven agent is dispatched from a parent session running an Anthropic model, the auth-fallback may route to Anthropic regardless of the pi-oven agent's `model:` array. Either accept this (call it out) or specify enforcement in §6.

Confidence: HIGH. Code-verified at `config/model-resolver.ts:758–792`, `task/executor.ts:1132–1152`.

---

### B4-NEW. §13.3 missing-`model:` "validator error" is logged-only — runtime failure not actually prevented

**Evidence**: Spec §13.3 lines 880–893:

```typescript
if (models.length === 0) {
  pi.logger.error(`[pi-oven] MISSING MODEL: ${file} has no model field. ...`);
  // 경고 로그 출력 후 계속 진행 — dispatch 시 omp 기본 모델로 폴백되어 추적 어려움
}
```

Comment at line 892 acknowledges that dispatch will still proceed and silently fall back to omp's default task model. This is exactly the failure class Cycle 1 BLOCKER #4 flagged. Calling this an `error` log while the code path continues and reaches a "natural fallback" is not a fix — it is a relabeling.

**Why this matters**: Plugins shipping with a missing `model:` line on one of 23 files will appear functional, dispatch will fall back to omp's `pi/task` default, agent will run with a wrong model — possibly an Anthropic model under Profile B environment, bypassing the whitelist.

**Fix**: Choose one:
- (a) Validator removes the offending agent from omp's discovery (delete file from in-memory list before omp scans, OR shadow with invalid placeholder), AND emit hard log at `pi.logger.error` level.
- (b) Validator throws during load, preventing plugin from registering. Document user-facing recovery.
- (c) Accept soft-error and explicitly document this gap: "missing-model 에이전트는 omp 기본 task 모델로 실행됩니다. Profile A 보장이 깨질 수 있음." Then add §14 acceptance criterion #6 requirement that ALL 23 files MUST have `model:` set before merge — enforced by repo CI, not runtime.

Currently the spec sits between (a) and (c) without committing — that's the bug.

Confidence: HIGH.

---

## 2. 🟡 NIT

1. **§5.1 thinkingLevel matrix mixes verification states inconsistently.** Some rows tagged "정적 분석 예측 ✓", others "확인됨". Add legend at top: `[L] = list-models verified, [S] = static analysis only`.

2. **§2.1 line 60 header still says "live verification 결과".** Body is now correct (code-cite + path) but header implies live execution. Rename to "omp의 agent discovery 동작 (소스 코드 분석 결과)".

3. **§2.6 line 176 cites `helpers.ts line 984–1013`.** Verified during this cycle ✓. NIT: prefix `discovery/` for consistency.

4. **§9.4 lines 707–713 ("autonomous-loop이 조율한다")** promises future-tense behavior not enumerated as Spec C item. Add cross-ref to Spec C scope or downgrade to soft TODO.

5. **§4.2 spawns diagram for metis** correctly enumerates whitelist. §8.2 line 648 says *"metis는 ... `spawns` 목록을 화이트리스트로 제한"* without re-stating list. Cross-link §4.2 from §8.2.

6. **§5 + §11.1 coexistence note** — consolidate. Add one-line note at top of §5: "pi-oven:librarian / pi-oven:oracle 등은 omp 번들 librarian/oracle과 name이 다르므로 shadow하지 않음 (§11.1 참조)."

7. **§7.3 line 606 "23개 agent 파일 전체에 `model:` 필드를 명시"** — cross-link to §13.3 Layer 1 (enforcement) and §14 Acceptance Criterion #6.

8. **§3.1 line 210 `output` description** awkward. Suggest "omp가 runtime에 전달하는 opaque schema 객체. 구조는 agent body에서 yield 호출 시 해석".

9. **§13.3 Layer 2 line 906–913** correctly annotated as no-op ✓. But `pi.setLabel("pi-oven v0.1.0")` at line 915 should match plugin.json name. Confirm canonical label.

10. **§16 Q1 gone** ✓.

11. **§14 examples in lines 949 / 952** use `pi-oven:executor` and `pi-oven:explorer` — confirmed match §4 table.

12. **§14 acceptance criterion #6 (line 1004)** *"pi-oven.ts load-time validator가 `model:` 필드 누락 시 오류 로그를 출력한다"* — consistent with current logged-only impl. If B4 fix moves to (a)/(b), strengthen criterion: "...validator가 model 필드 누락 시 해당 agent를 omp에 등록하지 않는다 OR plugin load를 차단한다".

---

## 3. ⚪ PUSH-BACK

None.

---

## What's Missing

- **Auth-fallback-to-parent semantics**: 0 mentions of `authFallback`, `parentActiveModelPattern`, or "parent session model" despite this being the actual runtime behavior of `resolveModelOverrideWithAuthFallback`.
- **Whitelist hole when parent model violates whitelist**: §6's whitelist enforcement applies only to agent `model:` arrays. Auth-fallback path can route pi-oven subagent to whatever parent session was running. If `anthropic/*` under future Profile B, the pi-oven subagent runs Anthropic regardless of own whitelist compliance.
- **No acceptance test for auth-fallback path**: §14 #1–8 do not test unauthed primary case. Add #9: "executor primary가 unauthed 상태에서 dispatch 시 parent model로 fallback되며, fallback model이 whitelist를 위반하면 경고가 발생한다."
- **`pi.setLabel` mismatch**: §13.3 says `setLabel("pi-oven v0.1.0")` but plugin.json says `"name": "pi-oven"`. Pick one canonical label.
- **Verification matrix in §5.1 does not include alternates**: Each row shows only primary's `(model, thinkingLevel)`. Alternate's thinkingLevel inheritance unspecified — `parseAgentFields` parses thinkingLevel as single value, not per-model. Spec should confirm: alternate inherits primary's thinkingLevel.

---

## Path to ACCEPT (cycle 3)

1. Rewrite §3.2 / §5 / §9 to accurately describe three resolution outcomes (in-registry-authed, in-registry-unauthed→parent, not-in-registry→array-next).
2. Add §6 enforcement OR documented limitation for auth-fallback-to-parent case.
3. Resolve B4 ambiguity: commit to block-on-load OR CI-time lint with explicit "runtime is soft" note.
4. Tag §5.1 matrix rows with `[L]` (list-models verified) vs `[S]` (static analysis predicted).
5. Add §14 #9: auth-fallback path test.
6. Apply 12 NITs batched.

---

## Source file evidence (cited)

- `task/executor.ts:643` — `normalizeModelPatterns`
- `task/executor.ts:1132–1152` — `resolveModelOverrideWithAuthFallback` is the actual subagent resolution call
- `config/model-resolver.ts:716–734` — `resolveModelOverride` does registry-availability lookup, NOT auth check
- `config/model-resolver.ts:758–792` — `resolveModelOverrideWithAuthFallback` falls back to parent session's active model pattern when primary is unauthed
- `discovery/helpers.ts:198–203` — `parseModelList` returns undefined for empty/missing
- `discovery/helpers.ts:222–272` — `parseAgentFields` schema; thinkingLevel single value
- `discovery/helpers.ts:984–1013` — `injectPluginDirRoots`
- `task/discovery.ts:99–101` — Plugin agent dir = `path.join(plugin.path, "agents")`
- `extensibility/extensions/types.ts:450–455` — `BeforeAgentStartEvent` no agentName/model
- `extensibility/shared-events.ts:223–229` — `AutoRetryStartEvent` no `nextModel`
