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
import { resolveDefaultAgentsDir } from "./pi-oven-setup/cache-resolver";
import { runValidate } from "./pi-oven-setup/validate";
import { DEFAULT_PROFILE } from "./pi-oven-setup/profiles";
import {
  normalizeLanguage,
  setProjectLanguage,
  setGlobalLanguage,
  markSetupComplete,
  markSetupCompleteGlobal,
} from "./pi-oven-setup/project-config";
import {
  formatSetupTransactionHealth,
  recoverSetupTransactionsOnStartup,
} from "./pi-oven-setup/setup-transaction";

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
const mockConfig = new Map<string, unknown>();
const mockAbsent = new Set<string>();
const spawnFn = mockSpawn
  ? (_cmd: string, args: string[]) => {
      // Return valid JSON for `omp config get <key> --json`
      if (args[0] === "config" && args[1] === "get") {
        const key = args[2];
        if (mockAbsent.has(key)) {
          return { exitCode: 1, stdout: Buffer.from(""), stderr: Buffer.from("missing key") };
        }
        // disabledProviders, skills.includeSkills, and skills.ignoredSkills are
        // ARRAY-typed settings; everything else is a record.
        const arrayKey =
          key === "disabledProviders" ||
          key === "skills.includeSkills" ||
          key === "skills.ignoredSkills";
        const value = mockConfig.has(key)
          ? mockConfig.get(key)
          : arrayKey
            ? key === "skills.includeSkills" ? ["pov:*"] : []
            : {};
        if (arrayKey) {
          const payload = JSON.stringify({ key, value, type: "array", description: "" });
          return { exitCode: 0, stdout: Buffer.from(payload), stderr: Buffer.from("") };
        }
        const type = typeof value === "object" ? "record" : typeof value;
        const payload = JSON.stringify({ key, value, type, description: "" });
        return { exitCode: 0, stdout: Buffer.from(payload), stderr: Buffer.from("") };
      }
      if (args[0] === "config" && args[1] === "set") {
        try {
          mockConfig.set(args[2], JSON.parse(args[3]));
        } catch {
          mockConfig.set(args[2], args[3]);
        }
        mockAbsent.delete(args[2]);
        return { exitCode: 0, stdout: Buffer.from(""), stderr: Buffer.from("") };
      }
      if (args[0] === "config" && args[1] === "reset") {
        const defaults: Record<string, unknown> = {
          "skills.includeSkills": [],
          modelRoles: {},
          "retry.fallbackChains": {},
          setupVersion: 0,
        };
        mockConfig.set(args[2], defaults[args[2]] ?? {});
        mockAbsent.delete(args[2]);
        return { exitCode: 0, stdout: Buffer.from(""), stderr: Buffer.from("") };
      }
      // Return a minimal `omp models` fixture for model-id validation / auth detection
      if (args[0] === "models") {
        const fixture = [
          "Provider models",
          "provider      model                                 aliases",
          "openai-codex  openai-codex/gpt-5.5                 -",
          "openai-codex  openai-codex/gpt-5.4                 -",
          "",
          "Canonical models",
          "  canonical  selected                              provider",
          "  1          openai-codex/gpt-5.5                 openai-codex",
          "  2          openai-codex/gpt-5.4                 openai-codex",
          "",
        ].join("\n");
        return { exitCode: 0, stdout: Buffer.from(fixture), stderr: Buffer.from("") };
      }
      return { exitCode: 0, stdout: Buffer.from("ok"), stderr: Buffer.from("") };
    }
  : undefined;

const startupTransactions = await recoverSetupTransactionsOnStartup({ spawnFn });
if (
  !values.status &&
  startupTransactions.some(({ health }) => health.state !== "healthy")
) {
  process.stderr.write(`${formatSetupTransactionHealth(startupTransactions).join("\n")}\n`);
  process.exit(1);
}

// --no-validate takes precedence over --validate flag
const rawValidateMode = process.env.PI_OVEN_VALIDATE_MODE ?? (values["no-validate"] ? "none" : (values.validate as string));
const validateMode = (["smoke", "full", "none"].includes(rawValidateMode)
  ? rawValidateMode
  : "smoke") as "smoke" | "full" | "none";
const explicitValidate = process.argv
  .slice(2)
  .some((arg) => arg === "--validate" || arg.startsWith("--validate="));

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
    hasOverride)
) {
  process.stderr.write(
    "--repair-prereqs is a standalone repair-only action. Do not combine it with --status, --reset, --import, --apply/--profile, or --override.\n"
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
let legacyRoutingReceipt = false;

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
  legacyRoutingReceipt = true;
} else if (values.profile || values.apply) {
  result = await runApply({
    profile: values.profile as string | undefined,
    validateMode,
    spawnFn,
    agentsDir,
    scope,
  });
} else if (hasOverride) {
  // Standalone --override (no other action flag)
  const overrideResult = await runOverride({ entries: overrideEntries, spawnFn, scope });
  result = { exitCode: overrideResult.exitCode, output: overrideResult.output };
  if (result.exitCode !== 0) {
    process.stderr.write(result.output);
    process.exit(result.exitCode);
  }
  legacyRoutingReceipt = true;
} else if (explicitValidate) {
  const validateResult = await runValidate(DEFAULT_PROFILE, {
    mode: validateMode,
    spawnFn,
  });
  const roleCount = Object.keys(DEFAULT_PROFILE).length;
  const checkedCount = validateMode === "none" ? roleCount : validateResult.verified.length + validateResult.unverified.length;
  const lines = [
    `Validation: ${validateMode}`,
    `verified ${validateResult.verified.length}/${checkedCount} roles`,
  ];
  if (validateResult.unverified.length > 0) {
    lines.push(`Unverified roles: ${validateResult.unverified.join(", ")}`);
  }
  result = {
    exitCode: validateResult.ok ? 0 : 1,
    output: `${lines.join("\n")}\n`,
  };
} else {
  process.stderr.write(
    "No action specified. Use --apply, --repair-prereqs, --status, --reset, --import <file>, or --override <role>=<model>. Add --scope <global|project> to target the global config or this project's .omp/settings.json. --profile is accepted for compatibility but ignored.\n"
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Output + exit
// ---------------------------------------------------------------------------

// Apply/reset own their receipt inside the journaled transaction. Import and
// standalone override retain their legacy receipt until those commands migrate.
if (legacyRoutingReceipt && result.exitCode === 0) {
  if (scope === "project") {
    await markSetupComplete();
  } else {
    await markSetupCompleteGlobal();
  }
}

process.stdout.write(result.output);
process.exit(result.exitCode);
