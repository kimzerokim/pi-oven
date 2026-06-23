# Decision Summary Format

The bottom summary generator must emit deterministic text in card order.

## Minimum structure

```text
Worksheet
- path: <repo-relative-html-path>
- title: <document title>
- date: <YYYY-MM-DD>
- version: <v1|v2|...>

Status
- answered cards: <n>, unanswered cards: <n>, deferred cards: <n>

Recommended direction
- <1-3 bullets summarizing the current recommended path>

Decision log
- Q-01 — <question label>
  - 선택: <selected option or 미결정>
  - 대안제시: <text or 없음>

Open follow-ups
- <follow-up 1>
- <follow-up 2>
```

## Rules

- Preserve card order.
- Include every card, even when unanswered.
- Use `미결정` for cards with no selected option.
- Include `대안제시` for every card; use `없음` when empty.
- Keep the output easy to copy into the CLI without post-processing.
- If there are no open follow-ups, emit `- 없음`.
