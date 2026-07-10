/**
 * Auth detection for the pi-oven setup wizard.
 * Spec B §3.1: Parse `omp models` Provider models section.
 * Spec B §3.2: Optional smoke ping confirmation.
 */

export interface AuthStatus {
  opencode_zen: boolean;
  openai_codex: boolean;
  anthropic: boolean;
}

/**
 * Detects which providers are authenticated by parsing `omp models` output.
 *
 * Primary detection (Spec B §3.1): extract the first token from each data row
 * in the Provider models section. A native `anthropic` provider row matching
 * `^anthropic\s+claude-` confirms direct Anthropic API auth.
 *
 * The alternate-provider/anthropic-claude-* wrappers (e.g. `alternate-provider  anthropic/claude-...`)
 * do NOT count as native anthropic auth — only a dedicated `anthropic` provider row does.
 *
 * @param opts.listModelsOutput  Injectable for tests to skip spawning omp.
 */
export async function detectAuth(opts?: {
  listModelsOutput?: string;
}): Promise<AuthStatus> {
  let output: string;

  if (opts?.listModelsOutput !== undefined) {
    output = opts.listModelsOutput;
  } else {
    // Spawn `omp models` and capture stdout+stderr
    const proc = Bun.spawnSync(["omp", "models"], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    output = proc.stdout?.toString() ?? "";
    if (proc.stderr) {
      output += proc.stderr.toString();
    }
  }

  return parseListModelsOutput(output);
}

/**
 * Parses the raw `omp models` output and extracts auth status per provider.
 */
function parseListModelsOutput(output: string): AuthStatus {
  const status: AuthStatus = {
    opencode_zen: false,
    openai_codex: false,
    anthropic: false,
  };

  // Split into lines, find lines in the Provider models section.
  // Each data row starts with a provider token (no leading whitespace).
  // Header row: "provider      model ..." — skip it (no `claude-` suffix on header).
  const lines = output.split("\n");

  for (const line of lines) {
    // Trim trailing whitespace; skip empty lines and headers
    const trimmed = line.trimEnd();
    if (!trimmed || trimmed.startsWith(" ") || trimmed.startsWith("\t")) continue;

    // Extract first token (provider ID)
    const firstToken = trimmed.split(/\s+/)[0];
    if (!firstToken) continue;

    // Skip table header row: "provider" or "Provider"
    if (firstToken === "provider" || firstToken === "Provider") continue;
    // Skip section header rows like "Provider models"
    if (firstToken === "Provider") continue;

    switch (firstToken) {
      case "alternate-provider":
        status.opencode_zen = true;
        break;
      case "openai-codex":
        status.openai_codex = true;
        break;
      case "anthropic":
        // Spec B §3.1: must match ^anthropic\s+claude- to confirm native auth.
        // This excludes the header row ("provider model ...") which never has "claude-".
        if (/^anthropic\s+claude-/.test(trimmed)) {
          status.anthropic = true;
        }
        break;
    }
  }

  return status;
}

