import { Database } from "bun:sqlite";
import { existsSync } from "fs";
import { join } from "path";
import { detectRunLedgerFilesystem } from "./sqlite-run-ledger";

export interface RunLedgerSurfaceHealth {
  status: "PASS" | "WARN" | "FAIL" | "INACTIVE";
  mode: "json" | "shadow" | "primary";
  databasePath: string;
  detail: string;
}

function resolveMode(value: string | undefined): "json" | "shadow" | "primary" {
  if (!value || value === "off" || value === "json") return "json";
  if (value === "shadow" || value === "primary") return value;
  return "json";
}

/** Read-only health probe used by doctor/status; never creates or migrates state. */
export function inspectRunLedgerSurface(
  projectRoot: string,
  modeValue: string | undefined = process.env.PI_OVEN_RUN_LEDGER_MODE,
  now: number = Date.now()
): RunLedgerSurfaceHealth {
  if (
    modeValue !== undefined &&
    modeValue !== "" &&
    modeValue !== "off" &&
    modeValue !== "json" &&
    modeValue !== "shadow" &&
    modeValue !== "primary"
  ) {
    return {
      status: "FAIL",
      mode: "json",
      databasePath: join(projectRoot, ".pi-oven", "state", "run-ledger.sqlite"),
      detail: `invalid PI_OVEN_RUN_LEDGER_MODE=${modeValue}; runtime will refuse to start`,
    };
  }
  const mode = resolveMode(modeValue);
  const databasePath = join(projectRoot, ".pi-oven", "state", "run-ledger.sqlite");
  if (mode === "json") {
    return {
      status: "INACTIVE",
      mode,
      databasePath,
      detail: "JSON rollback mode; SQLite WAL is not claimed active",
    };
  }
  const filesystem = detectRunLedgerFilesystem(databasePath);
  if (filesystem !== "local") {
    return {
      status: "FAIL",
      mode,
      databasePath,
      detail: `WAL blocked: filesystem is ${filesystem}, not verified local`,
    };
  }
  if (!existsSync(databasePath)) {
    return {
      status: "WARN",
      mode,
      databasePath,
      detail: `${mode} configured; ledger will be created on the next runtime start`,
    };
  }

  let db: Database | undefined;
  try {
    db = new Database(databasePath, { readonly: true, strict: true });
    const journal = db.query<{ journal_mode: string }, []>("PRAGMA journal_mode").get()?.journal_mode ?? "unknown";
    const integrity = db.query<{ integrity_check: string }, []>("PRAGMA integrity_check").get()?.integrity_check ?? "unknown";
    const schema = db.query<{ version: number | null }, []>(
      "SELECT MAX(version) AS version FROM schema_migrations"
    ).get()?.version ?? 0;
    const leases = db.query<{ active: number; stale: number }, [number, number]>(
      `SELECT
         COALESCE(SUM(CASE WHEN expires_at > ? THEN 1 ELSE 0 END), 0) AS active,
         COALESCE(SUM(CASE WHEN expires_at <= ? THEN 1 ELSE 0 END), 0) AS stale
       FROM leases`
    ).get(now, now) ?? { active: 0, stale: 0 };
    const healthy = journal.toLowerCase() === "wal" && integrity === "ok" && schema >= 1;
    return {
      status: healthy ? "PASS" : "FAIL",
      mode,
      databasePath,
      detail:
        `mode=${mode}, filesystem=local, journal=${journal.toLowerCase()}, integrity=${integrity}, ` +
        `schema=${schema}, leases=${leases.active} active/${leases.stale} stale`,
    };
  } catch (error) {
    return {
      status: "FAIL",
      mode,
      databasePath,
      detail: `ledger inspection failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  } finally {
    db?.close();
  }
}

export function formatRunLedgerSurface(health: RunLedgerSurfaceHealth): string {
  return `[${health.status}] run ledger: ${health.detail}`;
}
