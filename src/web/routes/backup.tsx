import { Hono } from "hono";
import { Layout } from "../pages/layout.tsx";
import {
  createLocalBackup,
  listLocalBackups,
  uploadToGCS,
  pruneLocalBackups,
} from "../../services/backup.ts";

const app = new Hono();

function BackupCard({
  backups,
  message,
}: {
  backups: { name: string; sizeKB: number; date: string }[];
  message?: string;
}) {
  return (
    <div class="card" id="backup-content">
      <div class="flex items-center justify-between mb-sm">
        <div class="card-label">Database Backups</div>
        <div class="flex gap-xs">
          <button
            class="btn btn-sm btn-primary"
            hx-post="/backup"
            hx-target="#backup-content"
            hx-swap="outerHTML"
          >
            Create backup
          </button>
          <button
            class="btn btn-sm"
            hx-post="/backup/gcs"
            hx-target="#backup-content"
            hx-swap="outerHTML"
          >
            Backup + upload to GCS
          </button>
        </div>
      </div>

      {message && (
        <div
          class="text-sm mb-sm"
          style="color: var(--visma-turquoise); border: 1px solid var(--color-border); border-radius: var(--radius-sm); padding: var(--space-xs)"
        >
          {message}
        </div>
      )}

      {backups.length === 0 ? (
        <div class="text-sm text-muted">No backups yet. Create one to protect your data.</div>
      ) : (
        <div>
          <div class="text-xs text-muted mb-xs">
            Keeping last 10 backups in data/backups/
          </div>
          {backups.map((b) => (
            <div
              class="table-row"
              style="display: flex; justify-content: space-between; align-items: center"
            >
              <div>
                <div class="text-sm">{b.date}</div>
                <div class="text-xs text-muted">{b.name}</div>
              </div>
              <span class="badge badge-green">{b.sizeKB} KB</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// GET /backup — list backups
app.get("/backup", async (c) => {
  const isHtmx = c.req.header("HX-Request") === "true";
  const backups = listLocalBackups();
  const content = <BackupCard backups={backups} />;

  if (isHtmx) return c.html(content);
  return c.html(
    <Layout title="Backups" activePath="/backup">
      <div id="canvas">{content}</div>
    </Layout>
  );
});

// POST /backup — create local backup
app.post("/backup", async (c) => {
  try {
    const result = await createLocalBackup();
    pruneLocalBackups();
    const backups = listLocalBackups();
    return c.html(
      <BackupCard
        backups={backups}
        message={`Backup created: ${result.sizeKB} KB`}
      />
    );
  } catch (err: any) {
    const backups = listLocalBackups();
    return c.html(
      <BackupCard
        backups={backups}
        message={`Backup failed: ${err.message}`}
      />
    );
  }
});

// POST /backup/gcs — create local backup + upload to GCS
app.post("/backup/gcs", async (c) => {
  try {
    const local = await createLocalBackup();
    pruneLocalBackups();
    const gcs = await uploadToGCS(local.path);
    const backups = listLocalBackups();
    return c.html(
      <BackupCard
        backups={backups}
        message={`Backup created (${local.sizeKB} KB) and uploaded to gs://${gcs.bucket}/${gcs.object}`}
      />
    );
  } catch (err: any) {
    const backups = listLocalBackups();
    return c.html(
      <BackupCard
        backups={backups}
        message={`Error: ${err.message}`}
      />
    );
  }
});

export default app;
