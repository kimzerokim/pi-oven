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
import { runApply, runRepairPrereqs } from "./pi-oven-setup/apply";
import { runOverride } from "./pi-oven-setup/override";
import { runIsolate } from "./pi-oven-setup/isolate";
import { runSuppressSibling } from "./pi-oven-setup/suppress-sibling";
import { resolveDefaultAgentsDir } from "./pi-oven-setup/cache-resolver";
import {
  normalizeLanguage,
  setProjectLanguage,
  setGlobalLanguage,
  seedProjectNativeWorkerMax,
  seedGlobalNativeWorkerMax,
  markSetupComplete,
  markSetupCompleteGlobal,
} from "./pi-oven-setup/project-config";

// ---------------------------------------------------------------------------
// Parse CLI args
// ---------------------------------------------------------------------------

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    status: { type: "boolean", default: false },
    reset: { type: "boolean", default: false },
    full: { type: "boolean", default: false },
    import: { type: "string" },
    "repair-prereqs": { type: "boolean", default: false },
    apply: { type: "boolean", default: false },
    profile: { type: "string" },
    override: { type: "string", multiple: true },
    validate: { type: "string", default: "smoke" },
    "no-validate": { type: "boolean", default: false },
    language: { type: "string" },
    isolate: { type: "boolean", default: false },
    "no-isolate": { type: "boolean", default: false },
    "suppress-sibling-skills": { type: "boolean", default: false },
    "no-suppress-sibling-skills": { type: "boolean", default: false },
    scope: { type: "string" },
  },
  strict: false,
});

// ---------------------------------------------------------------------------
// Resolve + validate --scope (default "global"). Governs WHERE --language /
// --profile|--apply / --override / --reset write, and which completion marker is
// recorded. "global" preserves today's behavior byte-for-byte.
// ---------------------------------------------------------------------------

const rawScope = (values.scope as string | undefined) ?? "global";
if (rawScope !== "global" && rawScope !== "project") {
  process.stderr.write(`Invalid scope "${rawScope}". Allowed: global, project.\n`);
  process.exit(1);
}
const scope = rawScope as "global" | "project";

// ---------------------------------------------------------------------------
// Resolve shared options from env + flags
// ---------------------------------------------------------------------------

// RAW agents dir from env (or undefined). This drives apply.ts's maintainer-vs-
// user mode selector (defined → maintainer generate; undefined → user setup), so
// it must stay env-or-undefined and must NOT be defaulted globally. Read-only
// display paths (--status) resolve their own install-relative dir below.
const agentsDir = process.env.PI_OVEN_AGENTS_DIR ?? undefined;

const mockSpawn = process.env.PI_OVEN_MOCK_SPAWN === "1";
const spawnFn = mockSpawn
  ? (_cmd: string, args: string[]) => {
      // Return valid JSON for `omp config get <key> --json`
      if (args[0] === "config" && args[1] === "get") {
        // disabledProviders, skills.includeSkills, and skills.ignoredSkills are
        // ARRAY-typed settings; everything else is a record.
        if (
          args[2] === "disabledProviders" ||
          args[2] === "skills.includeSkills" ||
          args[2] === "skills.ignoredSkills"
        ) {
          const value = args[2] === "skills.includeSkills" ? ["pov:*"] : [];
          const payload = JSON.stringify({ key: args[2], value, type: "array", description: "" });
          return { exitCode: 0, stdout: Buffer.from(payload), stderr: Buffer.from("") };
        }
        const payload = JSON.stringify({ key: args[2], value: {}, type: "record", description: "" });
        return { exitCode: 0, stdout: Buffer.from(payload), stderr: Buffer.from("") };
      }
      // Return a minimal `omp models` fixture for model-id validation / auth detection
      if (args[0] === "models") {
        const fixture = [
          "Provider models",
          "provider      model                                 aliases",
          "opencode-zen  opencode-zen/gpt-5.3-codex            -",
          "openai-codex  openai-codex/gpt-5.3-codex            -",
          "anthropic     claude-opus-4-8                       -",
          "",
          "Canonical models",
          "  canonical  selected                              provider",
          "  1          opencode-zen/gpt-5.3-codex            opencode-zen",
          "  2          openai-codex/gpt-5.3-codex            openai-codex",
          "  3          anthropic/claude-opus-4-8             anthropic",
          "  4          opencode-zen/claude-opus-4-8          opencode-zen",
          "",
        ].join("\n");
        return { exitCode: 0, stdout: Buffer.from(fixture), stderr: Buffer.from("") };
      }
      return { exitCode: 0, stdout: Buffer.from("ok"), stderr: Buffer.from("") };
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
  if (scope === "project") {
    await setProjectLanguage(lang);
    process.stdout.write(
      `Default response language set to "${lang}" project-locally (.pi-oven/config.json).\n`
    );
  } else {
    await setGlobalLanguage(lang);
    process.stdout.write(
      `Default response language set to "${lang}" globally (~/.pi-oven/config.json).\n`
    );
  }
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
      "--override and --reset are mutually exclusive. Use --override to write individual role overrides, or --reset to clear all pi-oven-managed role overrides.\n"
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

// --isolate / --no-isolate are legacy home-layer compatibility toggles
// (disabledProviders). They are mutually exclusive with each other but MAY
// combine with any primary action (runs after it). Standalone is also valid.
// GLOBAL-ONLY: rejected under --scope project because they write
// ~/.omp/agent/config.yml.
const wantIsolate = Boolean(values.isolate);
const wantNoIsolate = Boolean(values["no-isolate"]);
if (wantIsolate && wantNoIsolate) {
  process.stderr.write(
    "--isolate and --no-isolate are mutually exclusive legacy compatibility aids.\n"
  );
  process.exit(1);
}
const hasIsolate = wantIsolate || wantNoIsolate;
if (hasIsolate && scope === "project") {
  process.stderr.write(
    "--isolate and --no-isolate are global-only legacy compatibility aids: they write ~/.omp/agent/config.yml and cannot be used with --scope project.\n"
  );
  process.exit(1);
}

// --suppress-sibling-skills / --no-suppress-sibling-skills are legacy
// marketplace skill-visibility compatibility toggles (skills.ignoredSkills).
const wantSuppressSibling = Boolean(values["suppress-sibling-skills"]);
const wantNoSuppressSibling = Boolean(values["no-suppress-sibling-skills"]);
if (wantSuppressSibling && wantNoSuppressSibling) {
  process.stderr.write(
    "--suppress-sibling-skills and --no-suppress-sibling-skills are mutually exclusive legacy compatibility aids.\n"
  );
  process.exit(1);
}
const hasSuppressSibling = wantSuppressSibling || wantNoSuppressSibling;
if (hasSuppressSibling && scope === "project") {
  process.stderr.write(
    "--suppress-sibling-skills and --no-suppress-sibling-skills are global-only legacy compatibility aids: they write ~/.omp/agent/config.yml and cannot be used with --scope project.\n"
  );
  process.exit(1);
}

const repairPrereqs = Boolean(values["repair-prereqs"]);
if (repairPrereqs && scope === "project") {
  process.stderr.write(
    "--repair-prereqs is global-only: it writes ~/.omp/agent/config.yml and cannot be used with --scope project.\n"
  );
  process.exit(1);
}
if (
  repairPrereqs &&
  (values.status ||
    values.reset ||
    values.import !== undefined ||
    values.profile ||
    values.apply ||
    hasOverride ||
    hasIsolate ||
    hasSuppressSibling)
) {
  process.stderr.write(
    "--repair-prereqs is a standalone repair-only action. Do not combine it with --status, --reset, --import, --apply/--profile, --override, or any legacy compatibility aid.\n"
  );
  process.exit(1);
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
// --apply / --profile / --import / standalone --override). Successful routing
// writes still refresh the setup receipt metadata, but readiness now comes from
// live routing + prerequisite state — never this receipt alone.
let markRouting = false;

if (repairPrereqs) {
  result = await runRepairPrereqs({ spawnFn });
} else if (values.status) {
  // If --override present, apply overrides first (§3.4: write-before-status)
  if (hasOverride) {
    const overrideResult = await runOverride({ entries: overrideEntries, spawnFn, scope });
    if (overrideResult.exitCode !== 0) {
      process.stderr.write(overrideResult.output);
      process.exit(overrideResult.exitCode);
    }
    process.stdout.write(overrideResult.output);
  }
  // Resolve the agents dir to READ from the script's own install location, not
  // the user's cwd — so --status shows frontmatter defaults for users who
  // installed pi-oven globally (PI_OVEN_AGENTS_DIR unset).
  const statusAgentsDir = agentsDir ?? (await resolveDefaultAgentsDir(import.meta.dir));
  result = await runStatus({ spawnFn, agentsDir: statusAgentsDir });
} else if (values.reset) {
  result = await runReset({ spawnFn, full: Boolean(values.full), scope });
} else if (values.import !== undefined) {
  result = await runImport(values.import as string, { spawnFn, scope });
  markRouting = true;
} else if (values.profile || values.apply) {
  const profile = (values.profile as string | undefined) ?? "A";
  if (profile !== "A" && profile !== "B" && profile !== "C" && profile !== "D") {
    process.stderr.write(
      `Invalid profile "${profile}". Allowed: A, B, C, D.\n`
    );
    process.exit(1);
  }

  result = await runApply({
    profile: profile as "A" | "B" | "C" | "D",
    validateMode,
    spawnFn,
    agentsDir,
    scope,
  });
  markRouting = true;
} else if (hasOverride) {
  // Standalone --override (no other action flag)
  const overrideResult = await runOverride({ entries: overrideEntries, spawnFn, scope });
  result = { exitCode: overrideResult.exitCode, output: overrideResult.output };
  if (result.exitCode !== 0) {
    process.stderr.write(result.output);
    process.exit(result.exitCode);
  }
  markRouting = true;
} else if (hasIsolate || hasSuppressSibling) {
  // Standalone legacy compatibility toggles (no primary model-routing action).
  // The toggles themselves run in the shared post-dispatch step below.
  result = { exitCode: 0, output: "" };
} else {
  process.stderr.write(
    "No action specified. Use --profile <A|B|C|D>, --repair-prereqs, --status, --reset, --import <file>, or --override <role>=<model>. Add --scope <global|project> to target the global config or this project's .omp/settings.json.\n"
  );
  process.exit(1);
}

// Legacy compatibility toggles run AFTER the primary action (if any) and only
// on its success, so e.g. `--profile A --isolate` applies the profile first.
if (hasIsolate && result.exitCode === 0) {
  const iso = await runIsolate({ enable: wantIsolate, spawnFn });
  result = { exitCode: iso.exitCode, output: result.output + iso.output };
}

// Marketplace skill-visibility compatibility toggle runs after isolate (if
// any), also only on success.
if (hasSuppressSibling && result.exitCode === 0) {
  const suppress = await runSuppressSibling({ enable: wantSuppressSibling, spawnFn });
  result = { exitCode: suppress.exitCode, output: result.output + suppress.output };
}

// ---------------------------------------------------------------------------
// Output + exit
// ---------------------------------------------------------------------------

// Refresh the setup receipt metadata only for a SUCCESSFUL model-routing path
// (default --apply / --profile / --import / standalone --override). Readiness
// is derived elsewhere from live routing + prerequisite facts.
if (markRouting && result.exitCode === 0) {
  if (scope === "project") {
    await seedProjectNativeWorkerMax();
    await markSetupComplete();
  } else {
    await seedGlobalNativeWorkerMax();
    await markSetupCompleteGlobal();
  }
}

process.stdout.write(result.output);
process.exit(result.exitCode);
