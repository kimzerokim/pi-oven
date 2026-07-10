import { describe, expect, it } from "bun:test";
import { DEFAULT_PROFILE, ROLES } from "../../../scripts/pi-oven-setup/profiles";
import { modelBaseId, parseCanonicalModelIds } from "../../../scripts/pi-oven-setup/model-id-validator";
import { runValidate, SMOKE_ROLES } from "../../../scripts/pi-oven-setup/validate";

const MODELS_FIXTURE = [
  "Provider models",
  "provider      model                    aliases",
  "openai-codex  openai-codex/gpt-5.5    -",
  "openai-codex  openai-codex/gpt-5.4    -",
  "",
  "Canonical models",
  "  canonical  selected                 provider",
  "  1          openai-codex/gpt-5.5     openai-codex",
  "  2          openai-codex/gpt-5.4     openai-codex",
  "",
].join("\n");

describe("model id validation", () => {
  it("parses canonical model ids from omp models output", () => {
    expect(parseCanonicalModelIds(MODELS_FIXTURE)).toEqual([
      "openai-codex/gpt-5.5",
      "openai-codex/gpt-5.4",
    ]);
  });

  it("strips reasoning-effort suffixes before validation", () => {
    expect(modelBaseId("openai-codex/gpt-5.5:xhigh")).toBe("openai-codex/gpt-5.5");
    expect(modelBaseId("openai-codex/gpt-5.4")).toBe("openai-codex/gpt-5.4");
  });
});

describe("runValidate", () => {
  it("mode=none returns every role as verified", async () => {
    const result = await runValidate(DEFAULT_PROFILE, { mode: "none" });
    expect(result.ok).toBe(true);
    expect(result.verified.length).toBe(ROLES.length);
    expect(result.unverified).toEqual([]);
  });

  it("mode=smoke validates only smoke roles against canonical ids", async () => {
    const result = await runValidate(DEFAULT_PROFILE, {
      mode: "smoke",
      listModelsOutput: MODELS_FIXTURE,
    });

    expect(result.ok).toBe(true);
    expect(result.verified).toEqual(SMOKE_ROLES);
  });

  it("reports roles whose base model id is absent from omp models", async () => {
    const result = await runValidate(
      {
        ...DEFAULT_PROFILE,
        executor: { ...DEFAULT_PROFILE.executor, primary: "openai-codex/missing-model" },
      },
      { mode: "smoke", listModelsOutput: MODELS_FIXTURE }
    );

    expect(result.ok).toBe(false);
    expect(result.unverified).toEqual(["executor"]);
  });
});
