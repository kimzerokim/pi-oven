---
name: code-quality-discipline
version: 0.1.0
description: DRY / YAGNI / KISS + Deletion test + Depth-before-width + Immutability principles enforce on every code-write tool call
trigger: tool_call.toolName in (Edit, Write, MultiEdit, ast_grep_replace)
alwaysApply: false
---

# code-quality-discipline

## When to use

Fires on every code-write tool call — `Edit`, `Write`, `MultiEdit`, `ast_grep_replace` — regardless of change size. No N-file threshold. A 2-line fix carries the same obligation as a 200-line feature. The three self-questions take seconds; skipping them costs hours.

## Core principles

- **DRY** — identical logic must not exist in two places. Find it before writing it.
- **YAGNI** — implement only what the current request requires. Future needs get future code.
- **KISS** — the simplest expression that satisfies the requirement is the correct one.
- **Deletion test** — a new module is justified only when N ≥ 2 distinct callers already exist. Fewer callers = hypothetical seam = do not create.
- **Immutability** — always return a new object; never mutate in place. Prevents hidden side effects, enables safe concurrency. (ECC coding-style.md §Immutability)

## 3 self-questions before writing code

코드 작성 시작 전 다음 3 질문에 *명시적 답*:

1. **DRY**: 같은 코드 codebase 안 이미 있나? `grep -rn` + CRG `semantic_search_nodes` 검증
2. **YAGNI**: 진짜 *지금* 필요? 사용자 요청 deduce minimum 만
3. **KISS**: 가장 단순? 동일 의도 더 짧은 표현 가능?

Answer all three out loud in the working notes before the first Edit or Write call. A silent answer does not count.

## Deletion test (new module gate)

새 file / module / helper 만들기 *전*:

- Confirm the existing sister-module interface (`grep` + body read) cannot absorb the logic.
- If it can be added to an existing module, add it there (default path).
- A new module is approved **only** when:
  > "If complexity reappears across N callers after deletion, the module justified its existence through depth." (harness-share.md §32)
- **N ≥ 2 callers, file paths cited** → OK to create.
- **N < 2** → "hypothetical seam" → do not create. Fold into the nearest existing module.

## Post-write checklist (7 items)

Run before commit or handoff:

- [ ] 책임 중복 X (DRY)
- [ ] 사용자 요청 외 추가 X (YAGNI)
- [ ] 더 짧은 표현 검토 (KISS)
- [ ] 새 모듈 신설 = Deletion test 통과 (N ≥ 2 호출자 명시)
- [ ] Depth = interface 속성 검증 (shallow 1:1 X)
- [ ] 외부 lib context7 / 내부 pattern 인용
- [ ] deepened module 추가 시 이전 shallow module의 obsolete unit test 삭제

## Trade-offs

**Refactor vs YAGNI** — refactoring existing duplication is not a YAGNI violation. YAGNI blocks adding speculative abstractions, not removing confirmed duplication.

**Design It Twice** — applies only to large structural changes (3+ interface candidates). Small helpers use one design. Running Design It Twice on every helper is itself a YAGNI violation.

**File size** — 200–400 lines typical, 800 lines max (ECC coding-style.md §File Organization). A file approaching 800 lines is a signal to extract, not an excuse to keep growing.

---

Deep rationale + examples: skill://pi-oven/code-quality-discipline/references/principles.md
