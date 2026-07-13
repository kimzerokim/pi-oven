# Dispatch Prompt Templates

Three `task` omp primitives per plan task, executed sequentially: implementer → spec reviewer → code quality reviewer.

---

## 1. Implementer

<!-- pi-oven-contract:task-example -->
```ts
task({
  agent: "pov:executor",
  tasks: [{
    id: "implement-task-n",
    description: "Implement Task N: [task name]",
    assignment: `Implement Task N: [task name].

Task description: [FULL TEXT from the plan, pasted here].
Context: [prior tasks, module boundaries, and interfaces].
Work from: [repo root].

Implement exactly the requested scope using tdd-strict where logic changes. Run focused verification, self-review for completeness and YAGNI, and report DONE, DONE_WITH_CONCERNS, NEEDS_CONTEXT, or BLOCKED. If a requirement or dependency is unclear, report the uncertainty instead of guessing.`,
  }],
});
```

---

## 2. Spec Compliance Reviewer (Stage 1)

<!-- pi-oven-contract:task-example -->
```ts
task({
  agent: "pov:verifier",
  tasks: [{
    id: "verify-spec-compliance",
    description: "Stage 1 spec compliance review for Task N",
    assignment: `Verify the actual implementation against [FULL TEXT of task requirements] and the implementer report [status + summary]. This is Stage 1: assess missing requirements, extra work, and misunderstandings; do not perform the code-quality review. Return either "Spec compliant" or a specific issue list with file:line evidence.`,
  }],
});
```

---

## 3. Code Quality Reviewer (Stage 2)

<!-- pi-oven-contract:task-example -->
```ts
task({
  agent: "pov:code-reviewer",
  tasks: [{
    id: "review-code-quality",
    description: "Stage 2 code quality review for Task N",
    assignment: `Spec compliance passed in Stage 1. Review [task summary] between BASE_SHA [commit before task] and HEAD_SHA [current commit]. Evaluate behavioral test coverage, naming, file responsibility, YAGNI, and repository pattern compliance. Return strengths, Critical/Important/Minor issues, and Approved or FAIL.`,
  }],
});
```

---

## Integration Notes

**When large-task-delegation routing applies:** If a single plan task touches 3+ files or exceeds 200 LoC, route through `large-task-delegation` before dispatching the implementer primitive. The delegation skill determines whether to sub-split the task further.

**When fresh-verifier overlays at cycle exit:** After all plan tasks are marked complete, dispatch `fresh-verifier` as a separate `task` primitive before closing the execution cycle. The verifier runs outside this skill's loop — the controller must not self-declare PASS.
