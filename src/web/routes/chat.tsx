import { Hono } from "hono";
import { DashboardStatsCard } from "../cards/dashboard-stats.tsx";
import { CompanyProfileCard } from "../cards/company-profile.tsx";
import { ContactProfileCard } from "../cards/contact-profile.tsx";
import { getDashboardStats } from "../../services/dashboard.ts";
import { listCompanies, getCompany } from "../../services/companies.ts";
import { listContacts, getContact, getContactByEmail } from "../../services/contacts.ts";
import { listActivities } from "../../services/activities.ts";
import type { CompanyWithStats, ContactWithDetails } from "../../types/index.ts";

const app = new Hono();

function CompanyListFragment({ companies }: { companies: CompanyWithStats[] }) {
  if (companies.length === 0) {
    return <div class="card"><div class="text-sm text-muted">No companies found.</div></div>;
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

function ContactListFragment({ contacts }: { contacts: ContactWithDetails[] }) {
  if (contacts.length === 0) {
    return <div class="card"><div class="text-sm text-muted">No contacts found.</div></div>;
  }
  return (
    <div class="card">
      <div class="card-label mb-xs">Contacts ({contacts.length})</div>
      {contacts.map((ct) => (
        <div
          class="table-row card-clickable"
          hx-get={`/contacts/${ct.id}`}
          hx-target="#canvas"
          hx-swap="innerHTML"
        >
          <div class="flex-1">
            <div style="font-weight: 600">{ct.name || ct.email}</div>
            <div class="text-xs text-muted">
              {[ct.job_title, ct.company_name, ct.email].filter(Boolean).join(" · ")}
            </div>
          </div>
          <div class="text-xs text-muted font-mono">{ct.activity_count} activities</div>
        </div>
      ))}
    </div>
  );
}

function HelpCard() {
  return (
    <div class="card">
      <div class="card-label mb-xs">Available Commands</div>
      <div class="text-sm text-secondary" style="line-height: 1.8">
        <div><span class="font-mono" style="color: var(--visma-turquoise)">/dashboard</span> — overview with stats</div>
        <div><span class="font-mono" style="color: var(--visma-turquoise)">/companies</span> — list all companies</div>
        <div><span class="font-mono" style="color: var(--visma-turquoise)">/company [name]</span> — show company profile</div>
        <div><span class="font-mono" style="color: var(--visma-turquoise)">/contacts</span> — list all contacts</div>
        <div><span class="font-mono" style="color: var(--visma-turquoise)">/contact [name/email]</span> — show contact profile</div>
        <div><span class="font-mono" style="color: var(--visma-turquoise)">/sync</span> — show sync status</div>
        <div><span class="font-mono" style="color: var(--visma-turquoise)">/help</span> — show this list</div>
      </div>
    </div>
  );
}

app.post("/chat", async (c) => {
  const body = await c.req.parseBody();
  const raw = (body.message as string || "").trim();
  const message = (raw.startsWith("/") ? raw.slice(1) : raw).toLowerCase();

  // Dashboard
  if (message === "dashboard" || message === "stats" || message === "home") {
    const stats = await getDashboardStats();
    return c.html(<DashboardStatsCard stats={stats} />);
  }

  // Companies list
  if (message === "companies" || message === "list companies") {
    const companies = await listCompanies();
    return c.html(<CompanyListFragment companies={companies} />);
  }

  // Specific company by name
  if (message.startsWith("company ")) {
    const query = message.slice(8).trim();
    const companies = await listCompanies({ query });
    if (companies.length === 1) {
      const company = await getCompany(companies[0]!.id);
      if (company) {
        const contacts = await listContacts({ companyId: company.id });
        const activities = await listActivities({ companyId: company.id, limit: 20 });
        return c.html(<CompanyProfileCard company={company} contacts={contacts} activities={activities} />);
      }
    }
    if (companies.length > 1) {
      return c.html(<CompanyListFragment companies={companies} />);
    }
    return c.html(<div class="card"><div class="text-sm text-muted">No company found matching "{query}".</div></div>);
  }

  // Contacts list
  if (message === "contacts" || message === "list contacts") {
    const contacts = await listContacts();
    return c.html(<ContactListFragment contacts={contacts} />);
  }

  // Specific contact by name or email
  if (message.startsWith("contact ")) {
    const query = message.slice(8).trim();

    // Try email match first
    if (query.includes("@")) {
      const contact = await getContactByEmail(query);
      if (contact) {
        const activities = await listActivities({ contactId: contact.id, limit: 20 });
        return c.html(<ContactProfileCard contact={contact} activities={activities} />);
      }
    }

    // Search by name
    const contacts = await listContacts({ query });
    if (contacts.length === 1) {
      const contact = await getContact(contacts[0]!.id);
      if (contact) {
        const activities = await listActivities({ contactId: contact.id, limit: 20 });
        return c.html(<ContactProfileCard contact={contact} activities={activities} />);
      }
    }
    if (contacts.length > 1) {
      return c.html(<ContactListFragment contacts={contacts} />);
    }
    return c.html(<div class="card"><div class="text-sm text-muted">No contact found matching "{query}".</div></div>);
  }

  // Sync status (redirect to sync page)
  if (message === "sync" || message === "sync status") {
    return c.html(
      <div hx-get="/sync/status" hx-trigger="load" hx-target="#canvas" hx-swap="innerHTML">
        <div class="text-sm text-muted">Loading sync status...</div>
      </div>
    );
  }

  // Help
  if (message === "help" || message === "?") {
    return c.html(<HelpCard />);
  }

  // Unknown
  return c.html(<HelpCard />);
});

export default app;
