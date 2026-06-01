#!/usr/bin/env bun
/**
 * pi-oven-setup.ts — Main CLI dispatcher for pi-oven setup wizard.
 * Spec E §3.3/§3.4 surface, §10.3 structure.
 *
 * Dispatch precedence: --override (combined with --status/--validate only)
 *                      > --status > --reset > --import > default --apply
 *
 * Environment variables for test isolation:
 *   PI_OVEN_LOCK_FILE     — override ~/.omp/plugins/omp-plugins.lock.json path (unused post-2a, kept for compat)
 *   PI_OVEN_AGENTS_DIR    — override agents directory path
 *   PI_OVEN_MOCK_SPAWN    — when "1", use a no-op spawn (skip real omp calls)
 *   PI_OVEN_VALIDATE_MODE — override --validate flag value
 */

import { parseArgs } from "node:util";
import { runStatus } from "./pi-oven-setup/status";
import { runReset } from "./pi-oven-setup/reset";
import { runImport } from "./pi-oven-setup/import";
import { runApply } from "./pi-oven-setup/apply";
import { runOverride } from "./pi-oven-setup/override";
import { normalizeLanguage, setProjectLanguage, markSetupComplete } from "./pi-oven-setup/project-config";

// ---------------------------------------------------------------------------
// Parse CLI args
// ---------------------------------------------------------------------------

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    status: { type: "boolean", default: false },
    reset: { type: "boolean", default: false },
    import: { type: "string" },
    apply: { type: "boolean", default: false },
    profile: { type: "string" },
    override: { type: "string", multiple: true },
    validate: { type: "string", default: "smoke" },
    "no-validate": { type: "boolean", default: false },
    language: { type: "string" },
  },
  strict: false,
});

// ---------------------------------------------------------------------------
// Resolve shared options from env + flags
// ---------------------------------------------------------------------------

const agentsDir = process.env.PI_OVEN_AGENTS_DIR ?? undefined;

const mockSpawn = process.env.PI_OVEN_MOCK_SPAWN === "1";
const spawnFn = mockSpawn
  ? (_cmd: string, args: string[]) => {
      // Return valid JSON for `omp config get task.agentModelOverrides --json`
      if (args[0] === "config" && args[1] === "get") {
        const payload = JSON.stringify({ key: args[2], value: {}, type: "record", description: "" });
        return { exitCode: 0, stdout: Buffer.from(payload), stderr: Buffer.from("") } as any;
      }
      // Return a minimal list-models fixture for model-id validation
      if (args[0] === "--list-models") {
        const fixture = [
          "Canonical models",
          "  canonical  selected                              provider",
          "  1          opencode-zen/gpt-5.3-codex            opencode-zen",
          "  2          openai-codex/gpt-5.3-codex            openai-codex",
          "  3          anthropic/claude-opus-4-8             anthropic",
          "  4          opencode-zen/claude-opus-4-8          opencode-zen",
          "",
        ].join("\n");
        return { exitCode: 0, stdout: Buffer.from(fixture), stderr: Buffer.from("") } as any;
      }
      return { exitCode: 0, stdout: Buffer.from("ok"), stderr: Buffer.from("") } as any;
    }
  : undefined;

// --no-validate takes precedence over --validate flag
const rawValidateMode = process.env.PI_OVEN_VALIDATE_MODE ?? (values["no-validate"] ? "none" : (values.validate as string));
const validateMode = (["smoke", "full", "none"].includes(rawValidateMode)
  ? rawValidateMode
  : "smoke") as "smoke" | "full" | "none";

// ---------------------------------------------------------------------------
// Standalone --language dispatch (Plan 2026-06-02 §2)
// Persists the per-project default RESPONSE language to <cwd>/.pi-oven/config.json.
// Independent of the profile/override paths so /pi-oven:setup Step 0 can run it alone.
// ---------------------------------------------------------------------------

if (values.language !== undefined) {
  let lang: string;
  try {
    lang = normalizeLanguage(values.language as string);
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  }
  await setProjectLanguage(lang);
  process.stdout.write(
    `Project default language set to "${lang}" (.pi-oven/config.json).\n`
  );
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Flag-combination mutual-exclusion check (§3.4)
// --override may NOT combine with --apply / --import / --reset
// ---------------------------------------------------------------------------

const overrideEntries = (values.override as string[] | undefined) ?? [];
const hasOverride = overrideEntries.length > 0;

if (hasOverride) {
  if (values.reset) {
    process.stderr.write(
      "--override and --reset are mutually exclusive. Use --override to write individual role overrides, or --reset to clear all pi-oven:* overrides.\n"
    );
    process.exit(1);
  }
  if (values.import !== undefined) {
    process.stderr.write(
      "--override and --import are mutually exclusive. Use --override to write individual role overrides, or --import to load from a file.\n"
    );
    process.exit(1);
  }
  if (values.apply || values.profile) {
    process.stderr.write(
      "--override and --apply/--profile are mutually exclusive. Use --override for personal model overrides, or --apply/--profile for maintainer profile generation.\n"
    );
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Dispatch — precedence per §3.3/§3.4:
//   --override + --status → override-write first, then status
//   --status              → status only
//   --reset               → reset
//   --import              → import
//   --profile | --apply   → apply (maintainer generate)
//   --override standalone → override-write then exit 0
// ---------------------------------------------------------------------------

let result: { exitCode: number; output: string };
// Whether the selected dispatch path actually records MODEL ROUTING (default
// --apply / --profile / --import / standalone --override). Only these mark the
// project "set up" — never --status, --reset, --language, or --validate-only.
let markRouting = false;

if (values.status) {
  // If --override present, apply overrides first (§3.4: write-before-status)
  if (hasOverride) {
    const overrideResult = await runOverride({ entries: overrideEntries, spawnFn });
    if (overrideResult.exitCode !== 0) {
      process.stderr.write(overrideResult.output);
      process.exit(overrideResult.exitCode);
    }
    process.stdout.write(overrideResult.output);
  }
  result = await runStatus({ spawnFn, agentsDir });
} else if (values.reset) {
  result = await runReset({ spawnFn });
} else if (values.import !== undefined) {
  result = await runImport(values.import as string, { spawnFn });
  markRouting = true;
} else if (values.profile || values.apply) {
  const profile = (values.profile as string | undefined) ?? "A";
  if (profile !== "A" && profile !== "B") {
    process.stderr.write(
      `Invalid profile "${profile}". Allowed: A, B.\n`
    );
    process.exit(1);
  }

  result = await runApply({
    profile: profile as "A" | "B",
    validateMode,
    spawnFn,
    agentsDir,
  });
  markRouting = true;
} else if (hasOverride) {
  // Standalone --override (no other action flag)
  const overrideResult = await runOverride({ entries: overrideEntries, spawnFn });
  result = { exitCode: overrideResult.exitCode, output: overrideResult.output };
  if (result.exitCode !== 0) {
    process.stderr.write(result.output);
    process.exit(result.exitCode);
  }
  markRouting = true;
} else {
  process.stderr.write(
    "No action specified. Use --profile <A|B>, --status, --reset, --import <file>, or --override <role>=<model>.\n"
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Output + exit
// ---------------------------------------------------------------------------

// Record the setup-completion marker only for a SUCCESSFUL model-routing path
// (default --apply / --profile / --import / standalone --override). Placed just
// before the success exit so a failure (exitCode !== 0) never marks the project.
if (markRouting && result.exitCode === 0) {
  await markSetupComplete();
}

process.stdout.write(result.output);
process.exit(result.exitCode);
