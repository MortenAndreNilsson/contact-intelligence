import duckdb from "@duckdb/node-api";
import { readFileSync, mkdirSync, existsSync, unlinkSync } from "fs";
import { join } from "path";

const DB_DIR = join(import.meta.dir, "../../data");
const DB_PATH = join(DB_DIR, "contact-intel.duckdb");
const WAL_PATH = DB_PATH + ".wal";
const SCHEMA_PATH = join(import.meta.dir, "schema.sql");

let instance: duckdb.DuckDBInstance | null = null;
let connection: duckdb.DuckDBConnection | null = null;
let initialized = false;

async function getConnection(): Promise<duckdb.DuckDBConnection> {
  if (connection && initialized) return connection;

  if (!existsSync(DB_DIR)) {
    mkdirSync(DB_DIR, { recursive: true });
  }

  // Try opening; if WAL is corrupted, delete it and retry.
  // The debounced CHECKPOINT after writes should minimize data in the WAL,
  // so deleting a corrupted WAL should lose very little (at most ~500ms of writes).
  try {
    instance = await duckdb.DuckDBInstance.create(DB_PATH);
    connection = await instance.connect();
  } catch (err: any) {
    if (existsSync(WAL_PATH)) {
      console.warn("Corrupted WAL detected — deleting and retrying...");
      console.warn("(Data loss should be minimal thanks to auto-checkpointing)");
      unlinkSync(WAL_PATH);
      instance = await duckdb.DuckDBInstance.create(DB_PATH);
      connection = await instance.connect();
    } else {
      throw err;
    }
  }

  // Run schema — split on semicolons and execute each statement
  const schema = readFileSync(SCHEMA_PATH, "utf-8");
  const statements = schema
    .split(";")
    .map((s) =>
      s.split("\n").filter((line) => !line.trimStart().startsWith("--")).join("\n").trim()
    )
    .filter((s) => s.length > 0);

  for (const stmt of statements) {
    await connection.run(stmt);
  }

  // Migrations — add columns that may not exist in older databases
  const migrations = [
    "ALTER TABLE companies ADD COLUMN IF NOT EXISTS description VARCHAR",
    "ALTER TABLE survey_responses ADD COLUMN IF NOT EXISTS source VARCHAR DEFAULT 'lighthouse-view'",
    "ALTER TABLE contacts ADD COLUMN IF NOT EXISTS enrich_skip BOOLEAN DEFAULT FALSE",
    "CREATE TABLE IF NOT EXISTS messages (id VARCHAR PRIMARY KEY, title VARCHAR, channel VARCHAR NOT NULL, status VARCHAR DEFAULT 'draft', contact_id VARCHAR, company_id VARCHAR, recipient_name VARCHAR, recipient_context VARCHAR, tone VARCHAR, objective VARCHAR, content_references VARCHAR, additional_context VARCHAR, provider VARCHAR, prompt VARCHAR, draft_content VARCHAR, final_content VARCHAR, subject_line VARCHAR, created_at VARCHAR DEFAULT CAST(current_timestamp AS VARCHAR), updated_at VARCHAR DEFAULT CAST(current_timestamp AS VARCHAR))",
    // G6: Journey columns on companies
    "ALTER TABLE companies ADD COLUMN IF NOT EXISTS journey_stage VARCHAR",
    "ALTER TABLE companies ADD COLUMN IF NOT EXISTS journey_override BOOLEAN DEFAULT false",
    // G6: Maturity snapshots table (drop first to fix company_id INTEGER→VARCHAR)
    "DROP TABLE IF EXISTS maturity_snapshots",
    `CREATE TABLE IF NOT EXISTS maturity_snapshots (
  id VARCHAR PRIMARY KEY,
  company_id VARCHAR NOT NULL,
  snapshot_date DATE NOT NULL,
  trigger_type VARCHAR NOT NULL,
  total_respondents INTEGER DEFAULT 0,
  beginner_count INTEGER DEFAULT 0,
  developing_count INTEGER DEFAULT 0,
  intermediate_count INTEGER DEFAULT 0,
  advanced_count INTEGER DEFAULT 0,
  leader_count INTEGER DEFAULT 0,
  avg_score REAL,
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)`,
    "CREATE INDEX IF NOT EXISTS idx_snapshots_company ON maturity_snapshots(company_id)",
    // Briefing storage — persist generated briefings so they survive restarts and appear in backups
    "ALTER TABLE companies ADD COLUMN IF NOT EXISTS briefing VARCHAR",
    "ALTER TABLE companies ADD COLUMN IF NOT EXISTS briefing_at VARCHAR",
    "ALTER TABLE contacts ADD COLUMN IF NOT EXISTS briefing VARCHAR",
    "ALTER TABLE contacts ADD COLUMN IF NOT EXISTS briefing_at VARCHAR",
    // G6: Fluency level on contacts
    "ALTER TABLE contacts ADD COLUMN IF NOT EXISTS fluency_level VARCHAR",
    "ALTER TABLE contacts ADD COLUMN IF NOT EXISTS fluency_certified_at VARCHAR",
    // G6: Migrate old journey_stage values to new names
    "UPDATE companies SET journey_stage = CASE journey_stage WHEN 'awareness' THEN 'exploring' WHEN 'assessed' THEN 'assessing' WHEN 'workshop' THEN 'training' WHEN 'courses' THEN 'scaling' WHEN 'custom_engagement' THEN 'self_sustaining' ELSE journey_stage END WHERE journey_stage IS NOT NULL",
  ];
  for (const m of migrations) {
    await connection.run(m);
  }

  initialized = true;
  return connection;
}

export function generateId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).substring(2, 8);
  return `${ts}-${rand}`;
}

/**
 * Bind params to a prepared statement.
 * Accepts $name-style params (matching the existing SQLite convention).
 * Converts to positional $1, $2 etc. for DuckDB.
 */
async function execWithParams(
  conn: duckdb.DuckDBConnection,
  sql: string,
  params?: Record<string, unknown>
): Promise<duckdb.DuckDBMaterializedResult> {
  if (!params || Object.keys(params).length === 0) {
    return conn.runAndReadAll(sql);
  }

  // Convert $name params to positional $1, $2
  const paramNames = Object.keys(params);
  let positionalSql = sql;
  const orderedValues: unknown[] = [];

  // Sort by length descending so $companyId doesn't partially match $company
  const sorted = [...paramNames].sort((a, b) => b.length - a.length);
  let paramIndex = 1;
  const nameToIndex = new Map<string, number>();

  for (const name of sorted) {
    if (positionalSql.includes(name)) {
      nameToIndex.set(name, paramIndex);
      // Use a temporary placeholder to avoid double-replacement
      positionalSql = positionalSql.replaceAll(name, `__PARAM_${paramIndex}__`);
      paramIndex++;
    }
  }

  // Replace placeholders with $1, $2 etc.
  for (let i = 1; i < paramIndex; i++) {
    positionalSql = positionalSql.replaceAll(`__PARAM_${i}__`, `$${i}`);
  }

  // Build ordered values array
  for (const name of sorted) {
    if (nameToIndex.has(name)) {
      orderedValues[nameToIndex.get(name)! - 1] = params[name];
    }
  }

  const stmt = await conn.prepare(positionalSql);

  for (let i = 0; i < orderedValues.length; i++) {
    const val = orderedValues[i];
    const pos = i + 1; // 1-based

    if (val === null || val === undefined) {
      stmt.bindNull(pos);
    } else if (typeof val === "number") {
      if (Number.isInteger(val)) {
        stmt.bindInteger(pos, val);
      } else {
        stmt.bindDouble(pos, val);
      }
    } else if (typeof val === "bigint") {
      stmt.bindBigInt(pos, val);
    } else {
      stmt.bindVarchar(pos, String(val));
    }
  }

  return stmt.runAndReadAll();
}

/** Convert BigInt values to Number in result rows (DuckDB COUNT/SUM return BigInt) */
function convertBigInts(obj: Record<string, unknown>): Record<string, unknown> {
  for (const key in obj) {
    if (typeof obj[key] === "bigint") {
      obj[key] = Number(obj[key]);
    }
  }
  return obj;
}

export async function queryAll<T>(
  sql: string,
  params?: Record<string, unknown>
): Promise<T[]> {
  const conn = await getConnection();
  const result = await execWithParams(conn, sql, params);
  const rows = result.getRowObjectsJS() as Record<string, unknown>[];
  return rows.map(convertBigInts) as T[];
}

export async function queryOne<T>(
  sql: string,
  params?: Record<string, unknown>
): Promise<T | null> {
  const rows = await queryAll<T>(sql, params);
  return rows[0] ?? null;
}

export async function run(
  sql: string,
  params?: Record<string, unknown>
): Promise<void> {
  const conn = await getConnection();
  await execWithParams(conn, sql, params);
  // Auto-checkpoint after writes to prevent WAL data loss on hard kills
  scheduleCheckpoint();
}

export async function exec(sql: string): Promise<void> {
  const conn = await getConnection();
  await conn.run(sql);
}

/**
 * Debounced WAL checkpoint — flushes WAL to main DB file after writes settle.
 * Prevents data loss when the process is killed without clean shutdown (e.g. taskkill /F on Windows).
 * Batches rapid writes with a 500ms debounce so we don't checkpoint on every single INSERT.
 */
let checkpointTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleCheckpoint(): void {
  if (checkpointTimer) clearTimeout(checkpointTimer);
  checkpointTimer = setTimeout(async () => {
    checkpointTimer = null;
    try {
      if (connection) {
        await connection.run("CHECKPOINT");
      }
    } catch {
      // Best effort — don't crash on checkpoint failures
    }
  }, 500);
}

/** Close DuckDB connection and instance cleanly (flushes WAL). */
async function closeDatabase(): Promise<void> {
  try {
    if (connection) {
      // Force WAL checkpoint before closing to prevent corruption
      try { await connection.run("CHECKPOINT"); } catch { /* best effort */ }
      // DuckDB Node API connections don't have close() — just null the reference
      connection = null;
    }
    // DuckDB Node API instance may not have close() in all versions — null the reference
    instance = null;
  } catch (err: any) {
    console.error("Error during DuckDB shutdown:", err.message);
  }
  initialized = false;
  console.log("DuckDB closed cleanly");
}

// Flush WAL on shutdown — prevents corruption from unclean exits
process.on("SIGINT", async () => {
  await closeDatabase();
  process.exit(0);
});
process.on("SIGTERM", async () => {
  await closeDatabase();
  process.exit(0);
});
