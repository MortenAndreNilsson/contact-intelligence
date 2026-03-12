import { Hono } from "hono";
import { Layout } from "../pages/layout.tsx";
import { CompanyProfileCard } from "../cards/company-profile.tsx";
import { listCompanies, getCompany, updateCompany, createCompany } from "../../services/companies.ts";
import { listContacts } from "../../services/contacts.ts";
import { listActivities } from "../../services/activities.ts";
import { summarizeActivities, generateBriefing } from "../../services/local-llm.ts";
import { BriefingCard } from "../cards/briefing-card.tsx";
import type { CompanyWithStats } from "../../types/index.ts";

const app = new Hono();

function CompanyListCard({ companies }: { companies: CompanyWithStats[] }) {
  if (companies.length === 0) {
    return (
      <div class="empty-state">
        <div class="empty-state-icon">◇</div>
        <div>No companies found.</div>
      </div>
    );
  }

  return (
    <div class="card">
      <div class="card-label mb-xs">Companies ({companies.length})</div>
      {companies.map((c) => (
        <div
          class="table-row card-clickable"
          hx-get={`/companies/${c.id}`}
          hx-target="#canvas"
          hx-swap="innerHTML"
        >
          <div class="flex-1">
            <div style="font-weight: 600">{c.name}</div>
            <div class="text-xs text-muted">
              {[c.domain, c.industry, c.country].filter(Boolean).join(" · ") || "—"}
            </div>
          </div>
          <div style="text-align: right">
            <div class="font-mono text-sm" style="color: var(--visma-green)">
              {c.avg_score ? c.avg_score.toFixed(1) : "—"}
            </div>
            <div class="text-xs text-muted">{c.contact_count} contacts</div>
          </div>
        </div>
      ))}
    </div>
  );
}

app.get("/companies", async (c) => {
  const isHtmx = c.req.header("HX-Request") === "true";
  const query = c.req.query("q");
  const industry = c.req.query("industry");
  const companies = await listCompanies({ query: query ?? undefined, industry: industry ?? undefined });
  const content = <CompanyListCard companies={companies} />;

  if (isHtmx) return c.html(content);
  return c.html(<Layout>{content}</Layout>);
});

app.get("/companies/:id", async (c) => {
  const isHtmx = c.req.header("HX-Request") === "true";
  const id = c.req.param("id");
  const company = await getCompany(id);

  if (!company) {
    const msg = <div class="card"><div class="text-sm text-muted">Company not found.</div></div>;
    if (isHtmx) return c.html(msg);
    return c.html(<Layout>{msg}</Layout>);
  }

  const contacts = await listContacts({ companyId: id });
  const activities = await listActivities({ companyId: id, limit: 20 });
  const summary = await summarizeActivities(activities, company.name);
  const content = <CompanyProfileCard company={company} contacts={contacts} activities={activities} summary={summary} />;

  if (isHtmx) return c.html(content);
  return c.html(<Layout>{content}</Layout>);
});

// POST /companies/:id/briefing — generate full briefing (G4)
app.post("/companies/:id/briefing", async (c) => {
  const id = c.req.param("id");
  const company = await getCompany(id);
  if (!company) {
    return c.html(<div class="card"><div class="text-sm text-muted">Company not found.</div></div>, 404);
  }

  const contacts = await listContacts({ companyId: id });
  const activities = await listActivities({ companyId: id, limit: 50 });

  const metadata = [company.industry, company.size_bucket, company.country].filter(Boolean).join(", ");
  const contactSummary = contacts.map((ct) => `${ct.name || ct.email} (${ct.job_title || "no title"}, ${ct.activity_count} activities)`).join("; ");

  const briefing = await generateBriefing({
    entityType: "company",
    entityName: company.name,
    metadata: metadata || undefined,
    activities,
    contacts: contactSummary || undefined,
  });

  if (!briefing) {
    return c.html(
      <div>
        <div class="card"><div class="text-sm" style="color: var(--visma-coral)">Could not generate briefing. LM Studio may be unavailable.</div></div>
        <CompanyProfileCard company={company} contacts={contacts} activities={activities.slice(0, 20)} />
      </div>
    );
  }

  const summary = await summarizeActivities(activities, company.name);
  return c.html(
    <div>
      <BriefingCard entityName={company.name} entityType="company" briefing={briefing} />
      <CompanyProfileCard company={company} contacts={contacts} activities={activities.slice(0, 20)} summary={summary} />
    </div>
  );
});

// POST /companies — create a new company
app.post("/companies", async (c) => {
  const body = await c.req.parseBody();
  const name = String(body.name || "").trim();
  if (!name) {
    return c.html(<div class="text-sm" style="color: var(--visma-coral)">Company name is required.</div>, 400);
  }
  const company = await createCompany(
    name,
    String(body.domain || "").trim() || undefined,
    String(body.industry || "").trim() || undefined,
    String(body.size_bucket || "").trim() || undefined,
    String(body.country || "").trim() || undefined,
  );
  const contacts = await listContacts({ companyId: company.id });
  const activities = await listActivities({ companyId: company.id, limit: 20 });
  const full = await getCompany(company.id);
  return c.html(<CompanyProfileCard company={full!} contacts={contacts} activities={activities} />);
});

// PATCH /companies/:id — update company fields inline
app.patch("/companies/:id", async (c) => {
  const id = c.req.param("id");
  const company = await getCompany(id);
  if (!company) {
    return c.html(<div class="text-sm" style="color: var(--visma-coral)">Company not found.</div>, 404);
  }

  const body = await c.req.parseBody();
  const fields: Record<string, unknown> = {};
  for (const key of ["industry", "size_bucket", "country", "notes", "name"]) {
    if (key in body) {
      fields[key] = String(body[key]).trim() || null;
    }
  }
  if ("tags" in body) {
    try {
      fields.tags = JSON.parse(String(body.tags));
    } catch {
      fields.tags = [];
    }
  }

  if (Object.keys(fields).length > 0) {
    await updateCompany(id, fields);
  }

  const updated = await getCompany(id);
  const contacts = await listContacts({ companyId: id });
  const activities = await listActivities({ companyId: id, limit: 20 });
  return c.html(<CompanyProfileCard company={updated!} contacts={contacts} activities={activities} />);
});

export default app;
