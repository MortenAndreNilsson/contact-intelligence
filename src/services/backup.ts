/**
 * Database backup service — local timestamped copies + optional GCS upload.
 *
 * Local backups: data/backups/contact-intel-YYYY-MM-DD-HHmmss/  (DuckDB export)
 * GCS backups:   gs://{bucket}/backups/contact-intel-YYYY-MM-DD-HHmmss.tar.gz
 *
 * Uses DuckDB EXPORT DATABASE (safe while DB is open — no file lock issues on Windows).
 * Each backup is a directory of CSV files + schema.sql + load.sql that can be re-imported.
 */

import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from "fs";
import { join, basename } from "path";
import { exec as dbExec } from "../db/client.ts";

const DATA_DIR = join(import.meta.dir, "../../data");
const BACKUP_DIR = join(DATA_DIR, "backups");
const MAX_LOCAL_BACKUPS = 10;

function timestamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

/** Get total size of a directory in bytes. */
function dirSize(dir: string): number {
  let total = 0;
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const s = statSync(p);
    total += s.isDirectory() ? dirSize(p) : s.size;
  }
  return total;
}

/** Create a local backup using DuckDB EXPORT DATABASE. Returns the backup directory path. */
export async function createLocalBackup(): Promise<{ path: string; sizeKB: number }> {
  if (!existsSync(BACKUP_DIR)) {
    mkdirSync(BACKUP_DIR, { recursive: true });
  }

  // Flush WAL first
  try {
    await dbExec("CHECKPOINT");
  } catch {
    // Best effort
  }

  const backupName = `contact-intel-${timestamp()}`;
  const backupPath = join(BACKUP_DIR, backupName);
  mkdirSync(backupPath, { recursive: true });

  // EXPORT DATABASE creates schema.sql, load.sql, and CSV files for each table
  // This reads through the open connection — no file locking issues
  const escaped = backupPath.replace(/\\/g, "/");
  await dbExec(`EXPORT DATABASE '${escaped}' (FORMAT CSV, HEADER)`);

  const sizeKB = Math.round(dirSize(backupPath) / 1024);
  console.log(`Backup created: ${backupName} (${sizeKB} KB)`);
  return { path: backupPath, sizeKB };
}

/** List local backups, newest first. */
export function listLocalBackups(): { name: string; sizeKB: number; date: string }[] {
  if (!existsSync(BACKUP_DIR)) return [];

  return readdirSync(BACKUP_DIR)
    .filter((f) => {
      const p = join(BACKUP_DIR, f);
      return f.startsWith("contact-intel-") && statSync(p).isDirectory();
    })
    .sort()
    .reverse()
    .map((name) => {
      const dirPath = join(BACKUP_DIR, name);
      const match = name.match(/contact-intel-(\d{4}-\d{2}-\d{2})-(\d{6})/);
      const date = match
        ? `${match[1]} ${match[2].slice(0, 2)}:${match[2].slice(2, 4)}:${match[2].slice(4, 6)}`
        : name;
      return { name, sizeKB: Math.round(dirSize(dirPath) / 1024), date };
    });
}

/** Remove old backups, keeping only the N most recent. */
export function pruneLocalBackups(keep: number = MAX_LOCAL_BACKUPS): number {
  const backups = listLocalBackups();
  let removed = 0;
  for (const backup of backups.slice(keep)) {
    rmSync(join(BACKUP_DIR, backup.name), { recursive: true, force: true });
    removed++;
  }
  return removed;
}

/**
 * Upload a backup directory to GCS.
 * Uses gcloud CLI (must be authenticated: `gcloud auth login`).
 * Uploads the entire backup directory recursively.
 */
export async function uploadToGCS(
  localPath: string
): Promise<{ bucket: string; object: string }> {
  const project = process.env.GOOGLE_CLOUD_PROJECT || process.env.GOOGLE_PROJECT_ID;
  if (!project) {
    throw new Error("No GOOGLE_CLOUD_PROJECT or GOOGLE_PROJECT_ID in env");
  }

  const bucket = process.env.GCS_BACKUP_BUCKET || `ci-backups-${project}`;
  const backupName = basename(localPath);
  const objectPrefix = `backups/${backupName}`;

  // Ensure bucket exists (ignore error if it already does)
  try {
    const mkBucket = Bun.spawnSync(["gcloud.cmd", "storage", "buckets", "create", `gs://${bucket}`, "--project", project, "--location", "europe-north1"], {
      stderr: "pipe",
    });
    if (mkBucket.exitCode !== 0) {
      const err = mkBucket.stderr.toString();
      if (!err.includes("already exists") && !err.includes("409")) {
        console.warn("Bucket creation warning:", err.trim());
      }
    }
  } catch {
    // gcloud not available — will fail on upload
  }

  // Upload entire directory recursively
  const upload = Bun.spawnSync(
    ["gcloud.cmd", "storage", "cp", "-r", localPath, `gs://${bucket}/${objectPrefix}`],
    { stderr: "pipe", stdout: "pipe" }
  );

  if (upload.exitCode !== 0) {
    throw new Error(`GCS upload failed: ${upload.stderr.toString().trim()}`);
  }

  console.log(`Uploaded to gs://${bucket}/${objectPrefix}/`);
  return { bucket, object: objectPrefix };
}
