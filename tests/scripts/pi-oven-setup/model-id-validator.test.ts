import { describe, it, expect } from "bun:test";
import {
  parseCanonicalModelIds,
  isResolvableModelId,
} from "../../../scripts/pi-oven-setup/model-id-validator";

// ---------------------------------------------------------------------------
// Fixtures — realistic shape of `omp models` "Canonical models" section
// (plan §Task 1.2: column-header row is `canonical  selected  variants ...`;
//  data rows: col-0 = canonical alias, col-1 = selected provider/model-id)
// ---------------------------------------------------------------------------

const FIXTURE_CANONICAL_SECTION = `Canonical models
canonical              selected                          variants
opus-4-8               anthropic/claude-opus-4-8         anthropic/claude-opus-4-8
sonnet-4-6             anthropic/claude-sonnet-4-6       anthropic/claude-sonnet-4-6
gpt-5-codex            openai-codex/gpt-5.3-codex        openai-codex/gpt-5.3-codex

Provider models
provider      model                       context  max-out  thinking   images
anthropic     claude-opus-4-8             1M       128K     yes        yes
`;

// A fixture with more rows for length assertion
const FIXTURE_THREE_ROWS = `Canonical models
canonical              selected                          variants
opus-4-8               anthropic/claude-opus-4-8         anthropic/claude-opus-4-8
sonnet-4-6             anthropic/claude-sonnet-4-6       anthropic/claude-sonnet-4-6
gpt-5-codex            openai-codex/gpt-5.3-codex        openai-codex/gpt-5.3-codex

Provider models
provider      model                       context
anthropic     claude-opus-4-8             1M
`;

const FIXTURE_NO_CANONICAL_HEADER = `random text
some other line
Provider models
provider      model
anthropic     claude-opus-4-8
`;

const FIXTURE_MISSING_COLUMN_HEADER = `Canonical models

Provider models
provider      model
anthropic     claude-opus-4-8
`;

const FIXTURE_EMPTY = ``;

// ---------------------------------------------------------------------------
// PURE parser tests (no subprocess)
// ---------------------------------------------------------------------------

describe("parseCanonicalModelIds", () => {
  it("extracts provider/model-id from fixture", () => {
    const ids = parseCanonicalModelIds(FIXTURE_THREE_ROWS);
    expect(ids).toContain("anthropic/claude-opus-4-8");
    expect(ids).toContain("openai-codex/gpt-5.3-codex");
    expect(ids.length).toBe(3);
  });

  it("skips column-header row and Provider-models section", () => {
    const ids = parseCanonicalModelIds(FIXTURE_CANONICAL_SECTION);
    // column-header token "selected" must not appear
    expect(ids).not.toContain("selected");
    // bare canonical alias without slash must not appear
    expect(ids).not.toContain("claude-opus-4-8");
    // provider section model ids must not appear
    expect(ids).not.toContain("anthropic");
  });

  it("throws when 'Canonical models' header is absent", () => {
    expect(() => parseCanonicalModelIds(FIXTURE_NO_CANONICAL_HEADER)).toThrow(
      /unexpected omp models format/i
    );
  });

  it("throws when column-header row is absent", () => {
    expect(() => parseCanonicalModelIds(FIXTURE_MISSING_COLUMN_HEADER)).toThrow(
      /unexpected omp models format/i
    );
  });

  it("throws on empty output", () => {
    expect(() => parseCanonicalModelIds(FIXTURE_EMPTY)).toThrow(
      /unexpected omp models format/i
    );
  });
});

// ---------------------------------------------------------------------------
// Wrapper tests (no real omp spawn — all use listModelsOutput injection)
// ---------------------------------------------------------------------------

describe("isResolvableModelId", () => {
  it("returns true for exact canonical id present in fixture", async () => {
    const result = await isResolvableModelId("anthropic/claude-opus-4-8", {
      listModelsOutput: FIXTURE_CANONICAL_SECTION,
    });
    expect(result).toBe(true);
  });

  it("returns false for retired id not in fixture (NEGATIVE AC#3b)", async () => {
    const result = await isResolvableModelId("anthropic/claude-opus-4-7", {
      listModelsOutput: FIXTURE_CANONICAL_SECTION,
    });
    expect(result).toBe(false);
  });

  it("returns false for pattern-like input — EXACT-ID-ONLY", async () => {
    const result = await isResolvableModelId("anthropic/claude-*", {
      listModelsOutput: FIXTURE_CANONICAL_SECTION,
    });
    expect(result).toBe(false);
  });

  it("returns false for bare canonical alias without provider prefix", async () => {
    const result = await isResolvableModelId("claude-opus-4-8", {
      listModelsOutput: FIXTURE_CANONICAL_SECTION,
    });
    expect(result).toBe(false);
  });

  it("rejects (throws) when listModelsOutput is empty — surfaces parser throw", async () => {
    await expect(
      isResolvableModelId("anthropic/claude-opus-4-8", {
        listModelsOutput: "",
      })
    ).rejects.toThrow(/unexpected omp models format/i);
  });
});
