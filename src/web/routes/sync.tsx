import { Hono } from "hono";
import { Layout } from "../pages/layout.tsx";
import { SyncStatusCard } from "../cards/sync-status.tsx";
import { queryAll, queryOne } from "../../db/client.ts";

const app = new Hono();

interface SyncLogEntry {
  id: string;
  source: string;
  last_sync_at: string;
  records_processed: number;
  records_created: number;
  records_skipped: number;
  status: string;
  error_message: string | null;
}

async function getSyncData() {
  // Get most recent sync log per source
  const logs = await queryAll<SyncLogEntry>(
    `SELECT * FROM sync_log
     WHERE (source, last_sync_at) IN (
       SELECT source, MAX(last_sync_at) FROM sync_log GROUP BY source
     )
     ORDER BY last_sync_at DESC`
  );

  const evtCount = await queryOne<{ cnt: number }>("SELECT COUNT(*) AS cnt FROM cms_events");
  const survCount = await queryOne<{ cnt: number }>("SELECT COUNT(*) AS cnt FROM survey_responses");

  return {
    logs,
    counts: {
      cms_events: evtCount?.cnt ?? 0,
      survey_responses: survCount?.cnt ?? 0,
    },
  };
}

async function renderSyncStatus(running?: string | null) {
  const { logs, counts } = await getSyncData();
  return <SyncStatusCard logs={logs} counts={counts} running={running} />;
}

// GET /sync/status — show sync status card
app.get("/sync/status", async (c) => {
  const isHtmx = c.req.header("HX-Request") === "true";
  const content = await renderSyncStatus();

  if (isHtmx) return c.html(content);
  return c.html(<Layout>{content}</Layout>);
});

// POST /sync/events — trigger CMS events sync
app.post("/sync/events", async (c) => {
  try {
    const proc = Bun.spawn(["bun", "run", "scripts/sync-events.ts"], {
      cwd: import.meta.dir + "/../../..",
      stdout: "pipe",
      stderr: "pipe",
    });

    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;

    if (exitCode !== 0) {
      console.error("sync-events failed:", stderr || stdout);
    } else {
      console.log("sync-events output:", stdout);
    }
  } catch (err: any) {
    console.error("Failed to run sync-events:", err.message);
  }

  return c.html(await renderSyncStatus());
});

// POST /sync/surveys — trigger survey sync
app.post("/sync/surveys", async (c) => {
  try {
    const proc = Bun.spawn(["bun", "run", "scripts/sync-surveys.ts"], {
      cwd: import.meta.dir + "/../../..",
      stdout: "pipe",
      stderr: "pipe",
    });

    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;

    if (exitCode !== 0) {
      console.error("sync-surveys failed:", stderr || stdout);
    } else {
      console.log("sync-surveys output:", stdout);
    }
  } catch (err: any) {
    console.error("Failed to run sync-surveys:", err.message);
  }

  return c.html(await renderSyncStatus());
});

// POST /sync/materialize — trigger identity resolution
app.post("/sync/materialize", async (c) => {
  try {
    const proc = Bun.spawn(["bun", "run", "scripts/materialize.ts"], {
      cwd: import.meta.dir + "/../../..",
      stdout: "pipe",
      stderr: "pipe",
    });

    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;

    if (exitCode !== 0) {
      console.error("materialize failed:", stderr || stdout);
    } else {
      console.log("materialize output:", stdout);
    }
  } catch (err: any) {
    console.error("Failed to run materialize:", err.message);
  }

  return c.html(await renderSyncStatus());
});

export default app;
