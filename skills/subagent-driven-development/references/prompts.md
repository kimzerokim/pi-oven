# Dispatch Prompt Templates

Three `task` omp primitives per plan task, executed sequentially: implementer → spec reviewer → code quality reviewer.

---

## 1. Implementer

```
task:
  description: "Implement Task N: [task name]"
  prompt: |
    You are implementing Task N: [task name]

    ## Task Description

    [FULL TEXT of task from plan — pasted here; do not read the plan file]

    ## Context

    [Scene-setting: where this fits in the overall plan, which prior tasks completed,
    relevant module boundaries, key interfaces you must respect]

    ## Before You Begin

    If anything is unclear — requirements, approach, dependencies, acceptance criteria —
    ask now. Raise concerns before starting work, not after.

    ## Your Job

    1. Implement exactly what the task specifies
    2. Write tests (follow tdd-strict if the task involves new logic)
    3. Verify the implementation works
    4. Commit your work
    5. Self-review: completeness, quality, YAGNI discipline, test coverage
    6. Report back with status: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

    Work from: [repo root]

    If you encounter something unexpected mid-task, pause and ask rather than guess.
    It is always better to report BLOCKED than to produce incorrect work.
```

---

## 2. Spec Compliance Reviewer (Stage 1)

```
task:
  description: "Spec compliance review for Task N: [task name]"
  prompt: |
    You are reviewing whether an implementation matches its specification.
    This is Stage 1 of a two-stage review. Code quality is not your concern here.

    ## What Was Requested

    [FULL TEXT of task requirements — pasted here]

    ## What the Implementer Reports

    [Implementer status + report summary]

    ## Your Job

    Read the actual code. Do not trust the report. Verify:

    - Missing requirements: did they implement everything requested?
    - Extra work: did they build things not in spec?
    - Misunderstandings: did they solve the right problem the right way?

    Report exactly one of:
    - ✅ Spec compliant — all requirements met, nothing extra
    - ❌ Issues: [list specifically, with file:line references]
```

---

## 3. Code Quality Reviewer (Stage 2)

```
task:
  description: "Code quality review for Task N: [task name] (Stage 2, post-spec-approval)"
  prompt: |
    You are reviewing code quality. Spec compliance was already confirmed in Stage 1.
    Your job is to evaluate whether the implementation is clean, tested, and maintainable.

    ## Task Summary

    [One-sentence description of what was implemented]

    ## Diff Scope

    BASE_SHA: [commit before task]
    HEAD_SHA: [current commit after implementer fixes]

    ## Your Job

    Evaluate:
    - Test coverage: do tests verify behavior, not just mock it?
    - Naming: do names describe what things do (not how)?
    - File responsibility: does each file have one clear responsibility?
    - YAGNI: was anything built beyond what was needed?
    - Existing pattern compliance: does the implementation follow codebase conventions?

    Return: Strengths, Issues (Critical / Important / Minor), Assessment (Approved / FAIL).
```

---

## Integration Notes

**When large-task-delegation routing applies:** If a single plan task touches 3+ files or exceeds 200 LoC, route through `large-task-delegation` before dispatching the implementer primitive. The delegation skill determines whether to sub-split the task further.

**When fresh-verifier overlays at cycle exit:** After all plan tasks are marked complete, dispatch `fresh-verifier` as a separate `task` primitive before closing the execution cycle. The verifier runs outside this skill's loop — the controller must not self-declare PASS.
