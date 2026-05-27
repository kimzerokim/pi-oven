# writing-plans — Full Template & TDD Example

Source: superpowers:writing-plans (ported to pi-oven)

---

## Full plan header template

```markdown
# Plan: <feature name>

## Goal

Add a `parseConfig(yaml: string): Config` function that reads a YAML string and returns a validated `Config` object, enabling the CLI to load project settings from disk.

## Architecture

- `src/config.ts` — exports `parseConfig`; depends on `js-yaml` for parsing and `zod` for schema validation
- `src/config.test.ts` — unit tests; no I/O; all fixtures are inline strings
- Called by `src/cli.ts` at startup; `Config` type is consumed by every downstream command

## Tech Stack

- Runtime: Bun 1.x
- Language: TypeScript 5.x (strict mode)
- Parse: `js-yaml` 4.x
- Validation: `zod` 3.x
- Test: `bun:test`
```

---

## Full task example — TDD Red → Green → Refactor → Commit

```markdown
### Task 1 — Implement `parseConfig` with YAML parsing and schema validation

**Files**
- Create: `src/config.ts`
- Create: `src/config.test.ts`

**Steps**

- [ ] Write the failing test in `src/config.test.ts` (see Code block below — test file only)
- [ ] Run `bun test src/config.test.ts` and confirm it exits non-zero with "Cannot find module" or equivalent
- [ ] Create `src/config.ts` with the `parseConfig` implementation (see Code block below — source file)
- [ ] Run `bun test src/config.test.ts` and confirm all tests pass (exit zero)
- [ ] Run `bun test --coverage src/config.test.ts` and confirm 100% line and branch coverage on `src/config.ts`
- [ ] Commit with message `feat: add parseConfig`

**Code — `src/config.test.ts`** (complete)

\```typescript
import { describe, expect, it } from "bun:test";
import { parseConfig } from "./config";

describe("parseConfig", () => {
  it("parses a valid config string", () => {
    const yaml = `
project: my-app
version: 1
`;
    const result = parseConfig(yaml);
    expect(result.project).toBe("my-app");
    expect(result.version).toBe(1);
  });

  it("throws on missing required field 'project'", () => {
    const yaml = `version: 1`;
    expect(() => parseConfig(yaml)).toThrow("Required");
  });

  it("throws on non-integer version", () => {
    const yaml = `
project: my-app
version: "not-a-number"
`;
    expect(() => parseConfig(yaml)).toThrow("Expected number");
  });
});
\```

**Code — `src/config.ts`** (complete)

\```typescript
import { load } from "js-yaml";
import { z } from "zod";

const ConfigSchema = z.object({
  project: z.string(),
  version: z.number().int(),
});

export type Config = z.infer<typeof ConfigSchema>;

export function parseConfig(yaml: string): Config {
  const raw = load(yaml);
  return ConfigSchema.parse(raw);
}
\```

**Expected output**

\```
$ bun test src/config.test.ts
bun test v1.x
src/config.test.ts:
✓ parses a valid config string
✓ throws on missing required field 'project'
✓ throws on non-integer version

3 pass, 0 fail
\```
```

---

## Self-Review walkthrough for the example above

- [ ] **Spec coverage** — the spec Goal "reads a YAML string and returns a validated Config object" maps directly to Task 1. Every Goal is covered.
- [ ] **Placeholder scan** — search result: zero matches for TBD, TODO, "fill in", "implement later", "appropriate error handling". The error messages in the test (`"Required"`, `"Expected number"`) are exact strings from the zod schema, not placeholders.
- [ ] **Type consistency** — `Config` is defined in `src/config.ts` via `z.infer<typeof ConfigSchema>`. The test imports from `./config`. No phantom types referenced.

All three checks pass. Plan is ready to write to `docs/plans/YYYY-MM-DD-<feature>.md`.
