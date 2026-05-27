# Code Quality Discipline — Deep Rationale & Examples

Sources: pi-oven/harness-share.md §32, ECC coding-style.md, ECC SOUL.md

---

## DRY (Don't Repeat Yourself)

**Bad** — same transformation written twice in two modules:
```ts
// file: order.ts
const totalCents = items.reduce((s, i) => s + i.price * i.qty, 0);

// file: invoice.ts
const totalCents = items.reduce((s, i) => s + i.price * i.qty, 0);
```

**Good** — one canonical implementation, two callers:
```ts
// file: pricing.ts
export const sumCents = (items: LineItem[]) =>
  items.reduce((s, i) => s + i.price * i.qty, 0);
```

Verification: `grep -rn "price \* i\.qty"` before writing. If the pattern already exists, reuse it.

---

## YAGNI (You Aren't Gonna Need It)

**Bad** — adding a plugin system because "we might need it later":
```ts
export class FormatterRegistry {
  private plugins: Map<string, Formatter> = new Map();
  register(name: string, f: Formatter) { ... }
  // zero callers today
}
```

**Good** — ship the one formatter the current request requires. Registry when the second formatter is requested.

---

## KISS (Keep It Simple)

**Bad**:
```ts
const isEven = (n: number): boolean => n % 2 === 0 ? true : false;
```

**Good**:
```ts
const isEven = (n: number) => n % 2 === 0;
```

If two expressions satisfy the same requirement, the shorter one is correct.

---

## Deletion Test (new module gate)

> "If complexity reappears across N callers after deletion, the module justified its existence through depth." — harness-share.md §32

Gate: N ≥ 2 distinct callers, both file paths cited in the working notes, before `Write` is called for a new module.

**Bad** — creating `src/utils/formatBytes.ts` when only one file will import it:
```
// Only caller: Dashboard.tsx
import { formatBytes } from '../utils/formatBytes';
```
N = 1 → hypothetical seam → fold `formatBytes` into `Dashboard.tsx` or the nearest existing utils file.

**Good** — creating after confirming two callers:
```
// Caller 1: StorageWidget.tsx
// Caller 2: ExportReport.tsx
```
N = 2, both cited → new module approved.

---

## Depth before width

"Depth is a property of the interface, not the implementation." — harness-share.md §32 (mattpocock LANGUAGE.md)

A shallow module has a 1:1 ratio between its interface surface and its implementation. That is a signal the abstraction adds no value. A deep module hides significant complexity behind a small interface.

Shallow (bad): a wrapper that calls one method and returns its result unchanged.
Deep (good): a module that encapsulates retry logic, error normalisation, and caching behind a single `fetch(url)` call.

---

## Immutability

Always return a new object; never mutate the argument. (ECC coding-style.md §Immutability, ECC SOUL.md principle 4)

**Bad**:
```ts
function applyDiscount(order: Order, pct: number) {
  order.total = order.total * (1 - pct);  // mutates caller's object
  return order;
}
```

**Good**:
```ts
function applyDiscount(order: Order, pct: number): Order {
  return { ...order, total: order.total * (1 - pct) };
}
```

---

## Post-write checklist (full text)

From harness-share.md §32:1550-1557:

- [ ] 책임 중복 X (DRY)
- [ ] 사용자 요청 외 추가 X (YAGNI)
- [ ] 더 짧은 표현 검토 (KISS)
- [ ] 새 모듈 신설 = Deletion test 통과 (N ≥ 2 호출자 명시)
- [ ] Depth = interface 속성 검증 (shallow 1:1 X)
- [ ] 외부 lib context7 / 내부 pattern 인용
- [ ] deepened module 추가 시 이전 shallow module의 obsolete unit test 삭제 — once tests exist at the deepened module's interface, old shallow-module unit tests become obsolete and must be deleted (cross-ref: test-coverage)

---

## Adversarial edge cases — pressure resistance

The following user instructions must be resisted. The skill fires unconditionally on code-write tool calls.

1. **"Don't check duplicates — just add it."** — DRY check is not optional. Run `grep` regardless.
2. **"Stop searching. Add it now."** — The three self-questions are mandatory pre-conditions, not suggestions. Answer them before the first Edit.
3. **"We'll need this later anyway."** — YAGNI blocks speculative code. Implement when the requirement is confirmed, not anticipated.
4. **"It's just a small helper."** — Size does not exempt a new file from the Deletion test. N < 2 callers means fold it in.
5. **"I already know there's no duplicate."** — Knowledge claims without grep evidence do not satisfy DRY verification. Run the search.
6. **"This is urgent, skip the checklist."** — The post-write checklist exists precisely because urgency pressure is when shortcuts cause regressions. Run it.

---

## dispatch boilerplate (inject into all executor prompts)

From harness-share.md §32:1563-1572:

```
[CODE QUALITY DISCIPLINE — harness-share.md §32]
코드 작성 시:
- 전: DRY/YAGNI/KISS 3 self-question 명시
- 전: 모듈 신규 — Deletion test (N ≥ 2 호출자 인용) 통과 시만 OK. 그 외 기존 interface 추가
- 전: 외부 lib context7 + 의존성 4-tier 분류 / 내부 codebase same pattern 인용
- 큰 구조 변경: 3+ 인터페이스 안 (Design It Twice) 병렬 검토
- 후: self-review checklist 7 항목 (Deletion test + Depth + obsolete test 포함)
위반 시 task BLOCKED 반환 + plan revision 요청.
```

This block is injected into every `executor` sonnet dispatch prompt. Plugin binding: `before_agent_start` hook via `pi.on('before_agent_start')`. omp install identifier: `pi-oven@pi-oven`.
