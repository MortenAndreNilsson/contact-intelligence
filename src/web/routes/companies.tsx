import { Hono } from "hono";
import { Layout } from "../pages/layout.tsx";
import { CompanyProfileCard } from "../cards/company-profile.tsx";
import { listCompanies, getCompany } from "../../services/companies.ts";
import { listContacts } from "../../services/contacts.ts";
import { listActivities } from "../../services/activities.ts";
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

app.get("/companies", (c) => {
  const isHtmx = c.req.header("HX-Request") === "true";
  const query = c.req.query("q");
  const industry = c.req.query("industry");
  const companies = listCompanies({ query: query ?? undefined, industry: industry ?? undefined });
  const content = <CompanyListCard companies={companies} />;

  if (isHtmx) return c.html(content);
  return c.html(<Layout>{content}</Layout>);
});

app.get("/companies/:id", (c) => {
  const isHtmx = c.req.header("HX-Request") === "true";
  const id = c.req.param("id");
  const company = getCompany(id);

  if (!company) {
    const msg = <div class="card"><div class="text-sm text-muted">Company not found.</div></div>;
    if (isHtmx) return c.html(msg);
    return c.html(<Layout>{msg}</Layout>);
  }

  const contacts = listContacts({ companyId: id });
  const activities = listActivities({ companyId: id, limit: 20 });
  const content = <CompanyProfileCard company={company} contacts={contacts} activities={activities} />;

  if (isHtmx) return c.html(content);
  return c.html(<Layout>{content}</Layout>);
});

export default app;
