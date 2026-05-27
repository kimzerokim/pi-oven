#!/usr/bin/env bun
/**
 * pi-oven-setup.ts — Main CLI dispatcher for pi-oven setup wizard.
 * Spec B §2 surface, §10.3 structure.
 *
 * Dispatch precedence: --status > --reset > --import > --reapply > default --apply
 *
 * Environment variables for test isolation:
 *   PI_OVEN_LOCK_FILE     — override ~/.omp/plugins/omp-plugins.lock.json path
 *   PI_OVEN_AGENTS_DIR    — override agents directory path
 *   PI_OVEN_MOCK_SPAWN    — when "1", use a no-op spawn (skip real omp calls)
 *   PI_OVEN_VALIDATE_MODE — override --validate flag value
 */

import { parseArgs } from "node:util";
import { runStatus } from "./pi-oven-setup/status";
import { runReset } from "./pi-oven-setup/reset";
import { runImport } from "./pi-oven-setup/import";
import { runApply } from "./pi-oven-setup/apply";
import { runReapply } from "./pi-oven-setup/reapply";

// ---------------------------------------------------------------------------
// Parse CLI args
// ---------------------------------------------------------------------------

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    status: { type: "boolean", default: false },
    reset: { type: "boolean", default: false },
    import: { type: "string" },
    reapply: { type: "boolean", default: false },
    apply: { type: "boolean", default: false },
    profile: { type: "string" },
    override: { type: "string", multiple: true },
    validate: { type: "string", default: "smoke" },
    "no-validate": { type: "boolean", default: false },
    "confirm-auth": { type: "boolean", default: false },
  },
  strict: false,
});

// ---------------------------------------------------------------------------
// Resolve shared options from env + flags
// ---------------------------------------------------------------------------

const lockFilePath = process.env.PI_OVEN_LOCK_FILE ?? undefined;
const agentsDir = process.env.PI_OVEN_AGENTS_DIR ?? undefined;

const mockSpawn = process.env.PI_OVEN_MOCK_SPAWN === "1";
const spawnFn = mockSpawn
  ? (_cmd: string, _args: string[]) =>
      ({ exitCode: 0, stdout: Buffer.from("ok"), stderr: Buffer.from("") } as any)
  : undefined;

// --no-validate takes precedence over --validate flag
const rawValidateMode = process.env.PI_OVEN_VALIDATE_MODE ?? (values["no-validate"] ? "none" : (values.validate as string));
const validateMode = (["smoke", "full", "none"].includes(rawValidateMode)
  ? rawValidateMode
  : "smoke") as "smoke" | "full" | "none";

// ---------------------------------------------------------------------------
// Dispatch — precedence: --status > --reset > --import > --reapply > --apply (default)
// ---------------------------------------------------------------------------

let result: { exitCode: number; output: string };

if (values.status) {
  result = await runStatus({ lockFilePath, agentsDir });
} else if (values.reset) {
  result = await runReset({ spawnFn, agentsDir });
} else if (values.import) {
  result = await runImport(values.import as string, {
    spawnFn,
    agentsDir,
    lockFilePath,
    validateMode,
  });
} else if (values.reapply) {
  result = await runReapply({ spawnFn, agentsDir, lockFilePath });
} else if (values.profile || values.apply) {
  const profile = (values.profile as string | undefined) ?? "A";
  if (profile !== "A" && profile !== "B") {
    process.stderr.write(
      `Invalid profile "${profile}". Allowed: A, B.\n`
    );
    process.exit(1);
  }

  // Parse --override <role>=<model> entries into overrides map
  type Role = import("./pi-oven-setup/profiles").Role;
  type ModelEntry = import("./pi-oven-setup/profiles").ModelEntry;
  const overrides: Partial<Record<Role, Partial<ModelEntry>>> = {};
  for (const ov of (values.override as string[] | undefined) ?? []) {
    const eqIdx = ov.indexOf("=");
    if (eqIdx === -1) continue;
    const role = ov.slice(0, eqIdx) as Role;
    const model = ov.slice(eqIdx + 1);
    overrides[role] = { primary: model };
  }

  result = await runApply({
    profile: profile as "A" | "B",
    overrides: Object.keys(overrides).length > 0 ? overrides : undefined,
    validateMode,
    spawnFn,
    agentsDir,
    lockFilePath,
  });
} else {
  process.stderr.write(
    "No action specified. Use --profile <A|B>, --status, --reset, --import <file>, or --reapply.\n"
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Output + exit
// ---------------------------------------------------------------------------

process.stdout.write(result.output);
process.exit(result.exitCode);
