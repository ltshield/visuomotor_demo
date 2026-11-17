/**
 * schema.ts — the D1 schema as statements the API can run.
 *
 * `db/schema.sql` is the readable, commented copy; this is the same schema in
 * a form the server can execute. `classApi.test.ts` fails if the two differ.
 *
 * Every statement is IF NOT EXISTS, so `ensureSchema` in classApi.ts can run
 * them on a database that is empty or already set up.
 *
 * Key export: `SCHEMA_STATEMENTS`.
 */

export const SCHEMA_STATEMENTS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  classCode TEXT NOT NULL,
  presetId TEXT NOT NULL,
  rotationDeg INTEGER NOT NULL,
  trialTier TEXT NOT NULL,
  submittedAt TEXT NOT NULL,
  consciousAdjustment TEXT
)`,
  `CREATE TABLE IF NOT EXISTS trial_errors (
  sessionId TEXT NOT NULL,
  trialIndex INTEGER NOT NULL,
  phase TEXT NOT NULL,
  isCatch INTEGER NOT NULL,
  rotationApplied REAL NOT NULL,
  initialDirErrorDeg REAL,
  valid INTEGER NOT NULL,
  pathErrorPct REAL,
  PRIMARY KEY (sessionId, trialIndex)
)`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_class ON sessions(classCode)`,
];

/**
 * Columns added after the first version of the schema. A database created
 * before a column existed gets it added (ALTER TABLE ... ADD COLUMN) the first
 * time the API runs against it, so an existing class database keeps working.
 */
export const ADDED_COLUMNS: ReadonlyArray<{ table: string; column: string; type: string }> = [
  { table: 'trial_errors', column: 'pathErrorPct', type: 'REAL' },
];
