import { Hono } from "hono";
import { Layout } from "../pages/layout.tsx";
import { SyncStatusCard } from "../cards/sync-status.tsx";
import { CompanyProfileCard } from "../cards/company-profile.tsx";
import { queryAll, queryOne, run, generateId } from "../../db/client.ts";
import { syncEvents } from "../../services/sync-events.ts";
import { syncSurveys } from "../../services/sync-surveys.ts";
import { materialize } from "../../services/materialize.ts";
import { enrichContacts } from "../../services/enrich-contacts.ts";
import { getCompany, updateCompany } from "../../services/companies.ts";
import { listContacts } from "../../services/contacts.ts";
import { listActivities } from "../../services/activities.ts";
import { researchCompany } from "../../services/company-research.ts";
import { createActivity } from "../../services/activities.ts";

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

// POST /sync/all — run full pipeline: events → surveys → materialize → enrich
app.post("/sync/all", async (c) => {
  const steps = [
    { name: "cms_events", fn: syncEvents },
    { name: "survey_responses", fn: syncSurveys },
    { name: "materialize", fn: materialize },
    { name: "people_enrichment", fn: enrichContacts },
  ];

  for (const step of steps) {
    try {
      const result = await step.fn();
      console.log(`sync-all [${step.name}]:`, result);
    } catch (err: any) {
      console.error(`sync-all [${step.name}] failed:`, err.message);
      await run(
        `INSERT INTO sync_log (id, source, last_sync_at, records_processed, status, error_message)
         VALUES ($id, $source, CAST(current_timestamp AS VARCHAR), 0, 'error', $err)`,
        { $id: generateId(), $source: step.name, $err: err.message }
      );
    }
  }

  return c.html(await renderSyncStatus());
});

// POST /sync/events — trigger CMS events sync (in-process)
app.post("/sync/events", async (c) => {
  try {
    const result = await syncEvents();
    console.log(`sync-events: ${result.processed} processed, ${result.created} created, ${result.skipped} skipped`);
  } catch (err: any) {
    console.error("sync-events failed:", err.message);
    await run(
      `INSERT INTO sync_log (id, source, last_sync_at, records_processed, status, error_message)
       VALUES ($id, 'cms_events', CAST(current_timestamp AS VARCHAR), 0, 'error', $err)`,
      { $id: generateId(), $err: err.message }
    );
  }

  return c.html(await renderSyncStatus());
});

// POST /sync/surveys — trigger survey sync (in-process)
app.post("/sync/surveys", async (c) => {
  try {
    const result = await syncSurveys();
    console.log(`sync-surveys: ${result.processed} processed, ${result.created} created, ${result.skipped} skipped`);
  } catch (err: any) {
    console.error("sync-surveys failed:", err.message);
    await run(
      `INSERT INTO sync_log (id, source, last_sync_at, records_processed, status, error_message)
       VALUES ($id, 'survey_responses', CAST(current_timestamp AS VARCHAR), 0, 'error', $err)`,
      { $id: generateId(), $err: err.message }
    );
  }

  return c.html(await renderSyncStatus());
});

// POST /sync/materialize — trigger identity resolution (in-process)
app.post("/sync/materialize", async (c) => {
  try {
    const result = await materialize();
    console.log(`materialize: +${result.companies} companies, +${result.contacts} contacts, +${result.cmsActivities} CMS, +${result.surveyActivities} survey`);
  } catch (err: any) {
    console.error("materialize failed:", err.message);
  }

  return c.html(await renderSyncStatus());
});

// POST /sync/enrich — trigger people enrichment (in-process)
app.post("/sync/enrich", async (c) => {
  try {
    const result = await enrichContacts();
    console.log(`enrich: ${result.processed} processed, ${result.enriched} enriched, ${result.failed} failed, ${result.companiesCreated} companies created`);
  } catch (err: any) {
    console.error("enrich failed:", err.message);
    await run(
      `INSERT INTO sync_log (id, source, last_sync_at, records_processed, status, error_message)
       VALUES ($id, 'people_enrichment', CAST(current_timestamp AS VARCHAR), 0, 'error', $err)`,
      { $id: generateId(), $err: err.message }
    );
  }

  return c.html(await renderSyncStatus());
});

// POST /companies/:id/note — add a note to a company
app.post("/companies/:id/note", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.parseBody();
  const note = String(body.note || "").trim();
  const company = await getCompany(id);

  if (!company || !note) {
    return c.html(<div class="card"><div class="text-sm text-muted">{!company ? "Company not found." : "Note cannot be empty."}</div></div>);
  }

  await createActivity(
    null,
    id,
    "note_added",
    "web_ui",
    null,
    note,
    null,
    new Date().toISOString()
  );

  const contacts = await listContacts({ companyId: id });
  const activities = await listActivities({ companyId: id, limit: 20 });
  return c.html(<CompanyProfileCard company={company} contacts={contacts} activities={activities} />);
});

// POST /companies/:id/research — trigger Gemini deep research for a company
app.post("/companies/:id/research", async (c) => {
  const id = c.req.param("id");
  const company = await getCompany(id);

  if (!company) {
    return c.html(<div class="card"><div class="text-sm" style="color: var(--visma-coral)">Company not found.</div></div>);
  }

  try {
    const description = await researchCompany(company.name, company.domain);

    if (description) {
      await updateCompany(id, { description });
    }

    // Re-fetch and render the full profile
    const updated = await getCompany(id);
    if (!updated) {
      return c.html(<div class="card"><div class="text-sm" style="color: var(--visma-coral)">Company not found after update.</div></div>);
    }

    const contacts = await listContacts({ companyId: id });
    const activities = await listActivities({ companyId: id, limit: 20 });
    return c.html(<CompanyProfileCard company={updated} contacts={contacts} activities={activities} />);
  } catch (err: any) {
    return c.html(
      <div class="card">
        <div class="card-label mb-xs" style="color: var(--visma-coral)">Research Error</div>
        <div class="text-sm" style="color: var(--visma-coral)">{err.message}</div>
      </div>
    );
  }
});

export default app;
