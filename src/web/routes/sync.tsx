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
    { name: "cms_events", label: "CMS Events", fn: syncEvents },
    { name: "survey_responses", label: "Surveys", fn: syncSurveys },
    { name: "materialize", label: "Materialize", fn: materialize },
    { name: "people_enrichment", label: "Enrich", fn: enrichContacts },
  ];

  const results: { label: string; ok: boolean; summary: string }[] = [];

  for (const step of steps) {
    try {
      const result = await step.fn();
      console.log(`sync-all [${step.name}]:`, result);
      const summary = typeof result === "object"
        ? Object.entries(result).map(([k, v]) => `${k}: ${v}`).join(", ")
        : "done";
      results.push({ label: step.label, ok: true, summary });
    } catch (err: any) {
      console.error(`sync-all [${step.name}] failed:`, err.message);
      results.push({ label: step.label, ok: false, summary: err.message });
      await run(
        `INSERT INTO sync_log (id, source, last_sync_at, records_processed, status, error_message)
         VALUES ($id, $source, CAST(current_timestamp AS VARCHAR), 0, 'error', $err)`,
        { $id: generateId(), $source: step.name, $err: err.message }
      );
    }
  }

  const syncStatus = await renderSyncStatus();
  return c.html(
    <div>
      <div class="card">
        <div class="card-label mb-xs">Pipeline Complete</div>
        {results.map((r) => (
          <div class="table-row">
            <div class="flex-1">
              <span style={`font-weight: 600; color: ${r.ok ? "var(--visma-turquoise)" : "var(--visma-coral)"}`}>
                {r.ok ? "\u2713" : "\u2717"} {r.label}
              </span>
            </div>
            <div class="text-xs text-muted" style="max-width: 60%; text-align: right">{r.summary}</div>
          </div>
        ))}
      </div>
      {syncStatus}
    </div>
  );
});

// POST /sync/events — trigger CMS events sync (in-process)
app.post("/sync/events", async (c) => {
  try {
    const result = await syncEvents();
    console.log(`sync-events: ${result.processed} processed, ${result.created} created, ${result.skipped} skipped`);
    const syncStatus = await renderSyncStatus();
    return c.html(
      <div>
        <div class="card">
          <div class="card-label mb-xs" style="color: var(--visma-turquoise)">CMS Events Sync Complete</div>
          <div class="text-sm text-secondary">{result.processed} processed, {result.created} new, {result.skipped} skipped</div>
        </div>
        {syncStatus}
      </div>
    );
  } catch (err: any) {
    console.error("sync-events failed:", err.message);
    await run(
      `INSERT INTO sync_log (id, source, last_sync_at, records_processed, status, error_message)
       VALUES ($id, 'cms_events', CAST(current_timestamp AS VARCHAR), 0, 'error', $err)`,
      { $id: generateId(), $err: err.message }
    );
    const syncStatus = await renderSyncStatus();
    return c.html(
      <div>
        <div class="card"><div class="text-sm" style="color: var(--visma-coral)">CMS sync failed: {err.message}</div></div>
        {syncStatus}
      </div>
    );
  }
});

// POST /sync/surveys — trigger survey sync (in-process)
app.post("/sync/surveys", async (c) => {
  try {
    const result = await syncSurveys();
    console.log(`sync-surveys: ${result.processed} processed, ${result.created} created, ${result.skipped} skipped`);
    const syncStatus = await renderSyncStatus();
    return c.html(
      <div>
        <div class="card">
          <div class="card-label mb-xs" style="color: var(--visma-turquoise)">Survey Sync Complete</div>
          <div class="text-sm text-secondary">{result.processed} processed, {result.created} new, {result.skipped} skipped</div>
        </div>
        {syncStatus}
      </div>
    );
  } catch (err: any) {
    console.error("sync-surveys failed:", err.message);
    await run(
      `INSERT INTO sync_log (id, source, last_sync_at, records_processed, status, error_message)
       VALUES ($id, 'survey_responses', CAST(current_timestamp AS VARCHAR), 0, 'error', $err)`,
      { $id: generateId(), $err: err.message }
    );
    const syncStatus = await renderSyncStatus();
    return c.html(
      <div>
        <div class="card"><div class="text-sm" style="color: var(--visma-coral)">Survey sync failed: {err.message}</div></div>
        {syncStatus}
      </div>
    );
  }
});

// POST /sync/materialize — trigger identity resolution (in-process)
app.post("/sync/materialize", async (c) => {
  try {
    const result = await materialize();
    console.log(`materialize: +${result.companies} companies, +${result.contacts} contacts, +${result.cmsActivities} CMS, +${result.surveyActivities} survey`);
    const syncStatus = await renderSyncStatus();
    return c.html(
      <div>
        <div class="card">
          <div class="card-label mb-xs" style="color: var(--visma-turquoise)">Materialize Complete</div>
          <div class="text-sm text-secondary">
            +{result.companies} companies, +{result.contacts} contacts, +{result.cmsActivities} CMS activities, +{result.surveyActivities} survey activities
          </div>
        </div>
        {syncStatus}
      </div>
    );
  } catch (err: any) {
    console.error("materialize failed:", err.message);
    const syncStatus = await renderSyncStatus();
    return c.html(
      <div>
        <div class="card"><div class="text-sm" style="color: var(--visma-coral)">Materialize failed: {err.message}</div></div>
        {syncStatus}
      </div>
    );
  }
});

// POST /sync/enrich — trigger people enrichment (in-process)
app.post("/sync/enrich", async (c) => {
  try {
    const result = await enrichContacts();
    console.log(`enrich: ${result.processed} processed, ${result.enriched} enriched, ${result.failed} failed, ${result.companiesCreated} companies created`);
    const syncStatus = await renderSyncStatus();
    return c.html(
      <div>
        <div class="card">
          <div class="card-label mb-xs">Enrichment Complete</div>
          <div class="stat-grid" style="grid-template-columns: repeat(4, 1fr)">
            <div class="stat-box">
              <div class="stat-value" style="font-size: 1.5rem">{result.processed}</div>
              <div class="stat-label">Processed</div>
            </div>
            <div class="stat-box">
              <div class="stat-value" style="font-size: 1.5rem; color: var(--visma-turquoise)">{result.enriched}</div>
              <div class="stat-label">Enriched</div>
            </div>
            <div class="stat-box">
              <div class="stat-value" style="font-size: 1.5rem; color: var(--visma-coral)">{result.failed}</div>
              <div class="stat-label">Not Found</div>
            </div>
            <div class="stat-box">
              <div class="stat-value" style="font-size: 1.5rem; color: var(--visma-lime)">{result.companiesCreated}</div>
              <div class="stat-label">New Companies</div>
            </div>
          </div>
          {result.processed === 0 && (
            <div class="text-sm text-muted">All contacts already have name and job title. Nothing to enrich.</div>
          )}
        </div>
        {syncStatus}
      </div>
    );
  } catch (err: any) {
    console.error("enrich failed:", err.message);
    await run(
      `INSERT INTO sync_log (id, source, last_sync_at, records_processed, status, error_message)
       VALUES ($id, 'people_enrichment', CAST(current_timestamp AS VARCHAR), 0, 'error', $err)`,
      { $id: generateId(), $err: err.message }
    );
    const syncStatus = await renderSyncStatus();
    return c.html(
      <div>
        <div class="card">
          <div class="card-label mb-xs" style="color: var(--visma-coral)">Enrichment Failed</div>
          <div class="text-sm" style="color: var(--visma-coral)">{err.message}</div>
        </div>
        {syncStatus}
      </div>
    );
  }
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
