/**
 * Model ID validator for pi-oven-setup.
 * Spec E §3.5: EXACT-ID-ONLY resolver-parity validation of override model ids.
 *
 * Validates that a model id is resolvable by omp by parsing `omp models`
 * output. Supports the historical "Canonical models" section and the current
 * provider-grouped table format. No glob/prefix/wildcard — EXACT-ID-ONLY.
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
 * Defensive: THROWS if no recognized model ids can be extracted.
 */
export function parseCanonicalModelIds(listModelsOutput: string): string[] {
  const lines = listModelsOutput.split("\n");

  const canonicalIds = parseCanonicalSection(lines);
  if (canonicalIds.length > 0) {
    return canonicalIds;
  }

  const providerIds = parseProviderSections(lines);
  if (providerIds.length > 0) {
    return providerIds;
  }

  throw new Error("unexpected omp models format: no provider/model ids found");
}

function parseCanonicalSection(lines: string[]): string[] {
  const headerIdx = lines.findIndex((l) => l.trim() === "Canonical models");
  if (headerIdx === -1) {
    return [];
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

function parseProviderSections(lines: string[]): string[] {
  const ids = new Set<string>();
  let currentProviderGroup: string | undefined;
  let inProviderModelsTable = false;

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed) {
      currentProviderGroup = undefined;
      inProviderModelsTable = false;
      continue;
    }

    const providerGroupHeader = trimmed.match(/^([A-Za-z0-9_.-]+)\s+\(\d+\)$/);
    if (providerGroupHeader) {
      currentProviderGroup = providerGroupHeader[1];
      inProviderModelsTable = false;
      continue;
    }

    if (trimmed === "Provider models") {
      currentProviderGroup = undefined;
      inProviderModelsTable = true;
      continue;
    }

    if (currentProviderGroup) {
      const model = firstModelToken(trimmed);
      if (!model) continue;
      ids.add(model.includes("/") ? model : `${currentProviderGroup}/${model}`);
      continue;
    }

    if (inProviderModelsTable) {
      const tokens = trimmed.split(/\s+/);
      const provider = tokens[0];
      const model = tokens[1];
      if (!provider || !model || provider === "provider") continue;
      ids.add(model.includes("/") ? model : `${provider}/${model}`);
    }
  }

  return [...ids];
}

function firstModelToken(trimmedLine: string): string | undefined {
  const tableCellDelimiter = String.fromCharCode(0x2502);
  const firstCell = trimmedLine.includes(tableCellDelimiter)
    ? trimmedLine
        .split(tableCellDelimiter)
        .map((cell) => cell.trim())
        .find(Boolean)
    : undefined;
  const token = firstCell ?? trimmedLine.split(/\s+/)[0];
  if (!token || token === "model") return undefined;
  return /^[A-Za-z0-9][A-Za-z0-9_.-]*(?:\/[A-Za-z0-9][A-Za-z0-9_.-]*)?$/.test(token)
    ? token
    : undefined;
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
