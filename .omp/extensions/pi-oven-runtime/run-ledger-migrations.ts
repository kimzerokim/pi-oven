import type { Database } from "bun:sqlite";

interface Migration {
  version: number;
  sql: string;
}

const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE IF NOT EXISTS runs (
        run_id TEXT PRIMARY KEY,
        repo_root TEXT NOT NULL,
        branch TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        contract_version INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS lease_fences (
        run_id TEXT PRIMARY KEY REFERENCES runs(run_id) ON DELETE CASCADE,
        last_fence_token INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS leases (
        run_id TEXT PRIMARY KEY REFERENCES runs(run_id) ON DELETE CASCADE,
        owner_id TEXT NOT NULL,
        fence_token INTEGER NOT NULL,
        heartbeat_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS transitions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
        from_state TEXT NOT NULL,
        to_state TEXT NOT NULL,
        payload_json TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS transitions_run_id_id ON transitions(run_id, id);
      CREATE TABLE IF NOT EXISTS effects (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
        idempotency_key TEXT NOT NULL UNIQUE,
        kind TEXT NOT NULL,
        target TEXT NOT NULL,
        status TEXT NOT NULL,
        intent_json TEXT,
        result_json TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS effects_run_id_status ON effects(run_id, status);
      CREATE TABLE IF NOT EXISTS gate_state (
        run_id TEXT PRIMARY KEY REFERENCES runs(run_id) ON DELETE CASCADE,
        state_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `,
  },
];

export function migrateRunLedger(db: Database, now: () => number = Date.now): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at INTEGER NOT NULL
    )
  `);

  const applied = new Set(
    db.query<{ version: number }, []>("SELECT version FROM schema_migrations").all()
      .map((row) => row.version)
  );
  const apply = db.transaction((migration: Migration) => {
    for (const statement of migration.sql.split(";").map((part) => part.trim()).filter(Boolean)) {
      db.run(statement);
    }
    db.run(
      "INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)",
      [migration.version, now()]
    );
  });

  for (const migration of MIGRATIONS) {
    if (!applied.has(migration.version)) apply(migration);
  }
}

export function currentRunLedgerSchemaVersion(db: Database): number {
  const row = db
    .query<{ version: number | null }, []>("SELECT MAX(version) AS version FROM schema_migrations")
    .get();
  return row?.version ?? 0;
}
