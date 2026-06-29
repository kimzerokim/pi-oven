## Goal

Stop pi-oven setup/orchestrator guidance from causing agents to read nonexistent `skill://pi-oven:setup` or currently-unresolvable `skill://pi-oven:<name>` aliases.

## Architecture

- `/pi-oven:setup` remains a command (`commands/setup.md`), not a skill.
- Keyword-matched pi-oven skills already carry exact plugin-owned `SKILL.md` file targets via `buildKeywordMatchedSkillsPrompt`; runtime conduct should point agents to those exact targets instead of inventing namespaced `skill://` aliases.
- Documentation must align with the live resolver limitation: pi-oven-owned proof uses plugin-owned file targets for keyword matches, while command flows use their command markdown.

## Tech Stack

TypeScript runtime extension, Bun test runner, Markdown command/docs surfaces.

### Task 1 — Pin the regression in conduct tests

**Files**
- Modify: `tests/extensions/pi-oven-runtime/rules-injector.test.ts`

**Steps**

- [ ] Change the interactive conduct test name to assert plugin-owned `SKILL.md` target wording instead of generic `skill://` wording.
- [ ] Change the interactive assertion to reject `skill://pi-oven:` in the conduct block.
- [ ] Add an assertion that the conduct block mentions exact plugin-owned `SKILL.md` targets.
- [ ] Change the autonomous conduct test that currently expects `skill://pi-oven:` to reject that alias.
- [ ] Add an assertion that command flows are not skills and `/pi-oven:setup` must use command markdown.

**Code**

```typescript
expect(b).not.toContain("skill://pi-oven:");
expect(b).toMatch(/exact plugin-owned .*SKILL\.md target/i);
expect(b).toMatch(/\/pi-oven:setup.*command/i);
```

**Expected output**

```text
$ bun test tests/extensions/pi-oven-runtime/rules-injector.test.ts
<rules-injector tests pass after implementation>
```

### Task 2 — Fix orchestrator conduct wording

**Files**
- Modify: `.omp/extensions/pi-oven-runtime/rules-injector.ts`

**Steps**

- [ ] Replace shared skill precedence wording that says to load `skill://pi-oven:<name>`.
- [ ] Make both interactive and autonomous SKILL-FIRST lines point to exact plugin-owned `SKILL.md` targets injected by the runtime keyword block.
- [ ] State that `/pi-oven:*` entries are commands, not skills, and `/pi-oven:setup` must follow `commands/setup.md`.
- [ ] Keep the foreign namespace prohibition and `pi-oven:<role>` agent naming rule intact.

**Code**

```typescript
"SKILL PRECEDENCE: pi-oven skills are authoritative. When the runtime keyword block lists exact plugin-owned `SKILL.md` targets, read those file targets; do not invent `skill://pi-oven:<name>` aliases. `/pi-oven:*` entries are commands, not skills; `/pi-oven:setup` follows `commands/setup.md`. NEVER load a same-purpose skill from another plugin namespace (`superpowers:*`, `oh-my-claudecode:*`, `agentmemory:*`). On any name/purpose overlap, the pi-oven skill wins."
```

**Expected output**

```text
$ bun test tests/extensions/pi-oven-runtime/rules-injector.test.ts
<all tests in file pass>
```

### Task 3 — Align public/internal docs

**Files**
- Modify: `README.md`
- Modify: `CLAUDE.md`

**Steps**

- [ ] Update README skill activation section to say keyword matches inject exact plugin-owned `SKILL.md` targets.
- [ ] Update README description-discovery wording to avoid claiming `skill://pi-oven:<name>` is live-resolvable.
- [ ] Update CLAUDE routing invariant to replace the namespaced URI invariant with the plugin-owned target invariant.
- [ ] Preserve agent namespace guidance: agents still dispatch as `pi-oven:<role>`.

**Code**

```markdown
Runtime keyword matches inject exact plugin-owned `SKILL.md` file targets; agents must read those targets instead of inventing `skill://pi-oven:<name>` aliases.
```

**Expected output**

```text
$ bun test tests/extensions/pi-oven-runtime/rules-injector.test.ts tests/extensions/pi-oven-runtime/skill-keyword-loader.test.ts tests/extensions/pi-oven-runtime/wiring.test.ts
<targeted runtime tests pass or unrelated pre-existing dependency failures are documented>
```

### Task 4 — Verify the runtime surface

**Files**
- Test: `tests/extensions/pi-oven-runtime/rules-injector.test.ts`
- Test: `tests/extensions/pi-oven-runtime/skill-keyword-loader.test.ts`
- Test: `tests/extensions/pi-oven-runtime/wiring.test.ts`

**Steps**

- [ ] Run the focused conduct test and confirm it passes.
- [ ] Run keyword loader tests and confirm exact file targets are still emitted.
- [ ] Run wiring tests and confirm runtime prompt injection remains wired.
- [ ] Run `bun run check` to verify TypeScript.
- [ ] Record the pre-existing full-suite failures separately if `bun test` still fails in unrelated `pi-oven-ask` / dependency API tests.

**Code**

```bash
bun test tests/extensions/pi-oven-runtime/rules-injector.test.ts tests/extensions/pi-oven-runtime/skill-keyword-loader.test.ts tests/extensions/pi-oven-runtime/wiring.test.ts
bun run check
```

**Expected output**

```text
$ bun run check
<exit 0>
```

### Task 5 — Remove stale TUI mocks blocking the commit gate

**Files**
- Modify: `tests/extensions/pi-oven.test.ts`
- Modify: `tests/extensions/pi-oven-runtime/wiring.test.ts`

**Steps**

- [ ] Confirm the full suite failure is mock pollution by running `pi-oven-ask` and `run-eval` tests in isolation.
- [ ] Remove the stale `@oh-my-pi/pi-tui` root mocks from `pi-oven.test.ts`.
- [ ] Remove the stale `@oh-my-pi/pi-tui` root mocks from `wiring.test.ts`.
- [ ] Run the former mock-pollution consumers together.
- [ ] Run the full suite.

**Code**

```typescript
// Delete stale mock.module("@oh-my-pi/pi-tui", ...) blocks so tests use the
// installed package API instead of leaking incomplete root exports across files.
```

**Expected output**

```text
$ bun test
965 pass
0 fail
```
