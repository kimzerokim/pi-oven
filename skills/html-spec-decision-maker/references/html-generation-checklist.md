# HTML Generation Checklist

Run this checklist before finishing.

## Decision gate

- [ ] There is at least one unresolved user-facing question or decision.
- [ ] If no unresolved question exists, no HTML is created.
- [ ] The worksheet is for decision capture, not a frozen spec or implementation plan.
- [ ] `brainstorming` remains the owner of the question/approval loop.

## Output contract

- [ ] Exactly one self-contained `.html` file is produced.
- [ ] The file is saved under `docs/pre-decisions/` with a `YYYY-MM-DD-semantic-name-vN.html` shape.
- [ ] CSS and JavaScript are inline.
- [ ] The file is readable without external assets.

## Structure

- [ ] The six top-level headings match `worksheet-sections.md` exactly.
- [ ] The summary generator appears after the decision questions.
- [ ] The worksheet contains 1-30 cards inclusive.
- [ ] Every card has evidence, options, and `대안제시`.

## Decision quality

- [ ] Every card reduces ambiguity or changes implementation direction.
- [ ] Recommendations are grounded; weak evidence is marked as weak.
- [ ] No filler cards were added just to increase the count.
- [ ] Cross-cutting risks and open follow-ups are explicit.

## Visual contract

- [ ] The layout matches the reference example's memo style.
- [ ] Sticky TOC, flat header, amber `.dp-section`, and bottom generator are preserved.
- [ ] Option cards remain flat and clickable.
- [ ] The page does not look like an app dashboard.

## Summary generator

- [ ] Output is deterministic in card order.
- [ ] Output includes all selections.
- [ ] Output includes `대안제시`.
- [ ] Output includes unresolved follow-ups, or `없음` if none remain.
- [ ] Output is easy to copy directly into the CLI.
