import { describe, it, expect } from "bun:test";
import { detectAuth } from "../../../scripts/pi-oven-setup/auth-detect";

// ---------------------------------------------------------------------------
// Stub outputs representing typical `omp models` output
// ---------------------------------------------------------------------------

const STUB_WITH_ANTHROPIC = `
Provider models
provider      model                       context  max-out  thinking   images
anthropic     claude-haiku-4-5            200K     64K      yes        yes
anthropic     claude-sonnet-4-6           1M       64K      yes        yes
anthropic     claude-opus-4-7             1M       128K     yes        yes
opencode-zen  claude-sonnet-4-6           1M       64K      yes        yes
opencode-zen  gpt-5.3-codex               200K     32K      no         no
openai-codex  gpt-5.3-codex               200K     32K      no         no
`;

const STUB_WITHOUT_ANTHROPIC_NATIVE = `
Provider models
provider      model                       context  max-out  thinking   images
opencode-zen  claude-sonnet-4-6           1M       64K      yes        yes
opencode-zen  anthropic/claude-opus-4-7   1M       128K     yes        yes
opencode-zen  gpt-5.3-codex               200K     32K      no         no
openai-codex  gpt-5.3-codex               200K     32K      no         no
`;

const STUB_WITH_OPENAI_CODEX_ONLY = `
Provider models
provider      model                       context  max-out  thinking   images
openai-codex  gpt-5.3-codex               200K     32K      no         no
openai-codex  gpt-5.4                     200K     32K      no         no
`;

const STUB_WITH_OPENCODE_ZEN_ONLY = `
Provider models
provider      model                       context  max-out  thinking   images
opencode-zen  claude-sonnet-4-6           1M       64K      yes        yes
opencode-zen  glm-5                       1M       64K      no         no
`;

const STUB_EMPTY = ``;

describe("detectAuth", () => {
  it("native anthropic row → auth.anthropic = true", async () => {
    const auth = await detectAuth({ listModelsOutput: STUB_WITH_ANTHROPIC });
    expect(auth.anthropic).toBe(true);
  });

  it("opencode-zen wrapper rows only (no native anthropic row) → auth.anthropic = false", async () => {
    const auth = await detectAuth({
      listModelsOutput: STUB_WITHOUT_ANTHROPIC_NATIVE,
    });
    expect(auth.anthropic).toBe(false);
  });

  it("openai-codex provider row → auth.openai_codex = true", async () => {
    const auth = await detectAuth({
      listModelsOutput: STUB_WITH_OPENAI_CODEX_ONLY,
    });
    expect(auth.openai_codex).toBe(true);
    expect(auth.opencode_zen).toBe(false);
    expect(auth.anthropic).toBe(false);
  });

  it("opencode-zen provider row → auth.opencode_zen = true", async () => {
    const auth = await detectAuth({
      listModelsOutput: STUB_WITH_OPENCODE_ZEN_ONLY,
    });
    expect(auth.opencode_zen).toBe(true);
    expect(auth.openai_codex).toBe(false);
    expect(auth.anthropic).toBe(false);
  });

  it("empty output → all false", async () => {
    const auth = await detectAuth({ listModelsOutput: STUB_EMPTY });
    expect(auth.opencode_zen).toBe(false);
    expect(auth.openai_codex).toBe(false);
    expect(auth.anthropic).toBe(false);
  });

  it("stub with all three providers → all true", async () => {
    const auth = await detectAuth({ listModelsOutput: STUB_WITH_ANTHROPIC });
    expect(auth.opencode_zen).toBe(true);
    expect(auth.openai_codex).toBe(true);
    expect(auth.anthropic).toBe(true);
  });
});

