# Codebase Survey — 8-Step Checklist (Per-Step Detail)

Source: pi-oven/harness-share.md §26, codebase-survey skill

All steps run inside the `explore` subagent dispatched by main. Main reads the final evidence summary only.

---

## Step 0.5 — Tool & index availability

Before choosing any search strategy, verify what is live in the current session:

- Run `lsp_servers` to confirm LSP is attached and which language servers are active.
- Attempt one `ast_grep_search` probe on a known symbol to confirm the tool responds.
- Check whether Context7 MCP is reachable by calling `resolve-library-id` on a known package.
- Record results in a one-line status table at the top of the report:

| Tool | Status |
|---|---|
| ast_grep | ok / absent |
| lsp_workspace_symbols | ok / absent |
| Context7 | ok / absent |
| CRG | ok / absent |

Do not proceed to Step 1 until this table is complete. The table drives every downstream tool choice.

---

## Step 1 — Scope expansion

Goal: find every file that is part of the blast radius before reading any of them.

- **CRG configured**: call `query_graph` on the target symbol. Then call `get_impact_radius` to enumerate downstream dependents. An empty result is valid data — record it and continue.
- **CRG absent**: run `ast_grep_search` for the target symbol name. Supplement with `lsp_workspace_symbols` to catch renamed or re-exported variants. Use grep as a last resort for string literals that are not symbols.
- Produce a flat file list. Deduplicate. This list drives Step 2.

---

## Step 2 — Deep read + history

- Read all in-scope files in parallel (`Read` tool, parallel calls).
- For each file with 3+ recent commits, run: `git log --oneline -20 -- <file>` to surface churn hotspots.
- Annotate the file list with: last-modified date, line count, churn count.
- Do not summarise yet — raw observations only at this stage.

---

## Step 3 — Library detection

- Scan every import statement in in-scope files.
- Parse `package.json` (or `pyproject.toml` / `go.mod`) for the full dependency list.
- Produce a table: package name, version pinned, in-scope files that import it.
- Flag any package with no version pin — these are drift risks.

---

## Step 4 — Library knowledge

For each external dependency identified in Step 3, acquire current usage docs:

1. **Context7 first**: call `resolve-library-id` then `get-library-docs`. Record the doc version returned.
2. **pi-oven-* skill fallback**: if Context7 has no entry, check whether a matching pi-oven skill covers the library.
3. **WebSearch fallback**: only if both above fail. Record that WebSearch was used.

Record the source column in the library table from Step 3.

---

## Step 5 — Pattern extraction

Identify the conventions in use across the in-scope files. For each pattern, cite file + line number.

Patterns to look for:

- **Naming**: camelCase vs snake_case, prefix/suffix conventions for types vs values.
- **Error handling**: throw vs Result type vs callback, error message format.
- **Async**: Promise chains vs async/await, cancellation pattern.
- **State management**: local state vs context vs store, mutation boundaries.
- **Module boundaries**: barrel exports vs direct imports, circular dependency indicators.

---

## Step 6 — Type contracts

- List all TypeScript exported types and interfaces in scope (use `lsp_document_symbols` per file).
- For each exported type, run `lsp_find_references` to map every consumer.
- Flag types with zero references — candidates for removal.
- Flag types with 5+ references — high-impact; changes require extra review.

---

## Step 7 — Env vars

- Grep in-scope files for `process.env.`, `import.meta.env.`, `os.environ`, `os.getenv`.
- Produce a list of every env var name referenced.
- Cross-reference against `.env.example` (or equivalent). Mark each var as: `documented`, `undocumented`, or `documented-but-unused`.
- Undocumented vars used in production paths are P0 findings — flag them in the report header.

---

## Step 8 — Report

Write the final report to: `docs/harness/surveys/<YYYY-MM-DD>-<topic>-survey.md`

Required report sections:

```markdown
# Survey: <topic> — <YYYY-MM-DD>

## Tool availability
<paste Step 0.5 table>

## Scope (N files)
<file list with churn annotations from Step 2>

## Libraries (N packages)
<table from Step 3 + source column from Step 4>

## Patterns
<Step 5 findings with file:line citations>

## Type contracts
<Step 6 table — references count per type>

## Env vars
<Step 7 table — documented / undocumented / unused>

## CRG status (if configured)
```
<verbatim output of `code-review-graph status`>
```

## Evidence summary (≤200 words)
<Plain-text summary for main agent consumption>
```

The evidence summary is the last section. Main agent reads only this section before drafting the plan.
