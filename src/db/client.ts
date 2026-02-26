import duckdb from "@duckdb/node-api";
import { readFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";

const DB_DIR = join(import.meta.dir, "../../data");
const DB_PATH = join(DB_DIR, "contact-intel.duckdb");
const SCHEMA_PATH = join(import.meta.dir, "schema.sql");

let instance: duckdb.DuckDBInstance | null = null;
let connection: duckdb.DuckDBConnection | null = null;
let initialized = false;

async function getConnection(): Promise<duckdb.DuckDBConnection> {
  if (connection && initialized) return connection;

  if (!existsSync(DB_DIR)) {
    mkdirSync(DB_DIR, { recursive: true });
  }

  instance = await duckdb.DuckDBInstance.create(DB_PATH);
  connection = await instance.connect();

  // Run schema — split on semicolons and execute each statement
  const schema = readFileSync(SCHEMA_PATH, "utf-8");
  const statements = schema
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !s.startsWith("--"));

  for (const stmt of statements) {
    await connection.run(stmt);
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
}

export async function exec(sql: string): Promise<void> {
  const conn = await getConnection();
  await conn.run(sql);
}
