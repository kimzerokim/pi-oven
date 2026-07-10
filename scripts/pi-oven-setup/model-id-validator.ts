/**
 * Model ID validator for pi-oven-setup.
 * Spec E §3.5: EXACT-ID-ONLY resolver-parity validation of override model ids.
 *
 * Validates that a model id is resolvable by omp by parsing the "Canonical models"
 * section of `omp models` output — same resolution semantics as omp's
 * model-resolver (resolver parity). No glob/prefix/wildcard — EXACT-ID-ONLY.
 */

export interface ModelIdValidatorOpts {
  /** Injectable `omp models` stdout (tests, highest precedence). */
  listModelsOutput?: string;
  /** Injectable spawn (tests). */
  spawnFn?: (
    cmd: string,
    args: string[]
  ) => { exitCode: number | null; stdout?: Buffer; stderr?: Buffer };
}

export function modelBaseId(model: string): string {
  const trimmed = model.trim();
  const slashIdx = trimmed.indexOf("/");
  const colonIdx = trimmed.lastIndexOf(":");
  return colonIdx > slashIdx ? trimmed.slice(0, colonIdx) : trimmed;
}

export function isOpenAiCodexSelector(model: string): boolean {
  return modelBaseId(model).startsWith("openai-codex/");
}

/**
 * PURE parser. Input: raw `omp models` text. Output: canonical "provider/model-id" ids.
 * Defensive: THROWS if the "Canonical models" header line or its column header
 * (`canonical  selected ...`) is absent (fail loud on format drift — do not silently return []).
 */
export function parseCanonicalModelIds(listModelsOutput: string): string[] {
  const lines = listModelsOutput.split("\n");

  // Find the "Canonical models" section header line
  const headerIdx = lines.findIndex((l) => l.trim() === "Canonical models");
  if (headerIdx === -1) {
    throw new Error(
      "unexpected omp models format: 'Canonical models' header not found"
    );
  }

  // The next non-empty line must be the column-header row containing "selected"
  let colHeaderIdx = -1;
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed === "") continue;
    if (/\bselected\b/.test(trimmed)) {
      colHeaderIdx = i;
    }
    break;
  }
  if (colHeaderIdx === -1) {
    throw new Error(
      "unexpected omp models format: column-header row with 'selected' not found after 'Canonical models'"
    );
  }

  // Collect data rows from after column-header until first blank line (end of section)
  const ids: string[] = [];
  for (let i = colHeaderIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trimEnd();

    // Blank line = end of Canonical models section
    if (trimmed.trim() === "") break;

    // Split on whitespace; col-1 is the "selected" provider/model-id
    const tokens = trimmed.trim().split(/\s+/);
    const selected = tokens[1];

    // Skip rows where selected token lacks a slash (e.g., residual header tokens)
    if (!selected || !selected.includes("/")) continue;

    ids.push(selected);
  }

  return ids;
}

/**
 * Thin wrapper: obtains text via (a) opts.listModelsOutput, else (b) $PI_OVEN_LIST_MODELS_FIXTURE file,
 * else (c) spawn `omp models`. Then parseCanonicalModelIds → Set membership (EXACT-ID-ONLY).
 * No glob/prefix/wildcard.
 */
export async function isResolvableModelId(
  model: string,
  opts?: ModelIdValidatorOpts
): Promise<boolean> {
  const text = await getListModelsText(opts);
  const ids = parseCanonicalModelIds(text);
  return new Set(ids).has(modelBaseId(model));
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function getListModelsText(opts?: ModelIdValidatorOpts): Promise<string> {
  // (a) Direct injection (highest precedence — tests)
  if (opts?.listModelsOutput !== undefined) {
    return opts.listModelsOutput;
  }

  // (b) PI_OVEN_LIST_MODELS_FIXTURE env var — read file path
  const fixturePath = process.env["PI_OVEN_LIST_MODELS_FIXTURE"];
  if (fixturePath) {
    const file = Bun.file(fixturePath);
    return await file.text();
  }

  // (c) Spawn `omp models`
  const spawn =
    opts?.spawnFn ??
    ((cmd: string, args: string[]) =>
      Bun.spawnSync([cmd, ...args], { stdio: ["ignore", "pipe", "pipe"] }));

  const result = spawn("omp", ["models"]);
  const stdout = result.stdout?.toString() ?? "";
  const stderr = result.stderr?.toString() ?? "";
  return stdout || stderr;
}
