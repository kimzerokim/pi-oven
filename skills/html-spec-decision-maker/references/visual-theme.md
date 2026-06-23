# Visual Theme

Match the long-form decision-plan feel from `examples/2026-06-19-reference-style-decision-plan-v1.html`. Treat that example as the canonical reusable template: preserve its structure and style, then swap only the topic-specific content.

## Theme goal

The worksheet should read like a review memo:
- calm
- document-like
- high signal
- easy to scan and annotate

Use three signal families:
- **amber** for pending decisions and reviewer attention
- **blue** for evidence, structure, and neutral information
- **green** for recommendations and strong direction

## Palette contract

Use these tones or very close equivalents:
- body text: `#1f2937`
- muted text: `#6b7280`
- border: `#e5e7eb`
- neutral surface: `#f3f4f6`
- blue accent: `#2563eb`
- amber accent: `#d97706`
- amber surface: `#fffbeb`
- amber line/accent-light: `#fcd34d`
- green accent: `#059669`
- green surface: `#f0fdf4`
- green accent-light: `#6ee7b7`
- warning/red accent: `#dc2626`
- warning/red surface: `#fef2f2`

## Layout and typography rules

- white page background
- `.page-wrap` layout: `max-width: 1080px`, centered, `padding: 0 32px 80px`
- section spacing around `52px`
- Pretendard-first Korean UI text stack
- body font size: `15px`
- body line-height: about `1.65`
- `h1`: `26px`, bold, tight letter spacing
- subtitle/meta description: `14px`, muted
- `h2`: `20px`, bold, bottom border `2px solid #e5e7eb`, bottom padding `8px`
- `h3`: `16px`, bold
- `h4`: `14px`, bold, muted-dark
- sticky TOC should remain flat: white background, `top: 0`, bottom border, compact padding
- keep the page document-like; do not redesign it into a dashboard

## Component guidance

### Header
- use the flat `page-header` pattern, not a hero card
- keep metadata as small rectangular `meta-tag` chips
- keep the header directly under the sticky TOC without extra vertical fluff

### Evidence blocks
- use reference-style `info-box`, `warning-box`, `danger-box`, `table-wrap`, and `details`
- keep left borders on information callouts

### Decision sections and cards
- use `.dp-section` with the amber left border
- option cards should keep the reference border/radius/padding/background
- selected or recommended cards should use the reference green style
- cards must be clickable radio-style controls without redesigning the visuals
- include `대안제시` under each decision group

### Summary generator
- place it at the bottom as the closing action
- keep output plainly copyable
- avoid decorative motion or flashy widgets

## Avoid

- dark dashboard styling
- rainbow status systems
- external CSS frameworks for core presentation
- cramped tables
- long code dumps without commentary
