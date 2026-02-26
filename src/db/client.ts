import { Database } from "bun:sqlite";
import { readFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";

const DB_DIR = join(import.meta.dir, "../../data");
const DB_PATH = join(DB_DIR, "contact-intel.db");
const SCHEMA_PATH = join(import.meta.dir, "schema.sql");

let db: Database | null = null;

export function getDb(): Database {
  if (db) return db;

  if (!existsSync(DB_DIR)) {
    mkdirSync(DB_DIR, { recursive: true });
  }

  db = new Database(DB_PATH);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");

  const schema = readFileSync(SCHEMA_PATH, "utf-8");
  db.exec(schema);

  return db;
}

export function generateId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).substring(2, 8);
  return `${ts}-${rand}`;
}

export function queryAll<T>(sql: string, params?: Record<string, unknown>): T[] {
  const stmt = getDb().prepare(sql);
  return (params ? stmt.all(params) : stmt.all()) as T[];
}

export function queryOne<T>(sql: string, params?: Record<string, unknown>): T | null {
  const stmt = getDb().prepare(sql);
  const row = params ? stmt.get(params) : stmt.get();
  return (row as T) ?? null;
}

export function run(sql: string, params?: Record<string, unknown>): void {
  const stmt = getDb().prepare(sql);
  if (params) {
    stmt.run(params);
  } else {
    stmt.run();
  }
}
