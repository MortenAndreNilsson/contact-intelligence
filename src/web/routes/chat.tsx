import { Hono } from "hono";
import { DashboardStatsCard } from "../cards/dashboard-stats.tsx";
import { CompanyProfileCard } from "../cards/company-profile.tsx";
import { ContactProfileCard } from "../cards/contact-profile.tsx";
import { getDashboardStats } from "../../services/dashboard.ts";
import { listCompanies, getCompany } from "../../services/companies.ts";
import { listContacts, getContact, getContactByEmail } from "../../services/contacts.ts";
import { listActivities } from "../../services/activities.ts";
import { enrichContacts } from "../../services/enrich-contacts.ts";
import type { CompanyWithStats, ContactWithDetails } from "../../types/index.ts";

const app = new Hono();

/**
 * Parse natural language into a normalized slash-command string.
 * "show me the dashboard" → "dashboard"
 * "what do we have on hanne grina?" → "lookup hanne grina"
 * Returns the original message if no natural language pattern matches.
 */
function normalizeMessage(msg: string): string {
  // Dashboard intent
  if (/\b(dashboard|overview|summary|statistics|numbers|how are we doing|what.s going on)\b/.test(msg)) {
    return "dashboard";
  }

  // Enrich intent
  if (/\b(enrich|enrichment|look ?up everyone|enrich contacts)\b/.test(msg)) {
    return "enrich";
  }

  // Sync intent
  if (/\b(sync|synchronize|refresh data|pull data|update data|fetch data)\b/.test(msg)) {
    return "sync";
  }

  // Help intent
  if (/\b(help|commands|what can you do|how does this work)\b/.test(msg)) {
    return "help";
  }

  // Company list intent (no specific name)
  if (/\b(companies|all companies|list companies|which companies)\b/.test(msg) &&
      !/\b(about|on|for|at)\s+\S/.test(msg)) {
    return "companies";
  }

  // Contact list intent (no specific name)
  if (/\b(contacts|all contacts|all people|list contacts|who do we have|everyone)\b/.test(msg) &&
      !/\b(about|on|for)\s+\S/.test(msg)) {
    return "contacts";
  }

  // Lookup intent — "who is X", "what do we have on X", "tell me about X", "find X"
  const lookupPatterns = [
    /(?:who is|who's)\s+(.+)/,
    /(?:what do we (?:have|know) (?:on|about))\s+(.+)/,
    /(?:tell me about|info (?:on|about)|details (?:on|about|for))\s+(.+)/,
    /(?:look ?up|find|search for)\s+(.+)/,
    /(?:show|open|display)\s+(.+?)(?:\s+profile)?$/,
  ];

  for (const pat of lookupPatterns) {
    const m = msg.match(pat);
    if (m?.[1]) {
      const arg = m[1].replace(/[?.!]+$/, "").trim();
      if (arg.length > 0) return `lookup ${arg}`;
    }
  }

  return msg;
}

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
        <div><span class="font-mono" style="color: var(--visma-turquoise)">/enrich</span> — enrich contacts via Discovery Engine</div>
        <div><span class="font-mono" style="color: var(--visma-turquoise)">/help</span> — show this list</div>
        <div class="text-xs text-muted mt-sm">You can also type naturally: "show me the dashboard", "who is hanne grina?", "what do we have on idella?"</div>
      </div>
    </div>
  );
}

app.post("/chat", async (c) => {
  const body = await c.req.parseBody();
  const raw = (body.message as string || "").trim();
  const slashStripped = (raw.startsWith("/") ? raw.slice(1) : raw).toLowerCase();

  // Normalize natural language to a command, or pass through as-is
  const message = normalizeMessage(slashStripped);

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

  // Enrich contacts
  if (message === "enrich" || message === "enrich contacts") {
    try {
      const result = await enrichContacts();
      return c.html(
        <div class="card">
          <div class="card-label mb-xs">People Enrichment</div>
          <div class="section-title">Enrichment Complete</div>
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
        </div>
      );
    } catch (err: any) {
      return c.html(
        <div class="card">
          <div class="card-label mb-xs" style="color: var(--visma-coral)">Enrichment Error</div>
          <div class="text-sm" style="color: var(--visma-coral)">{err.message}</div>
        </div>
      );
    }
  }

  // Sync status
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

  // Ambiguous lookup — try contacts first, then companies
  if (message.startsWith("lookup ")) {
    const query = message.slice(7).trim();

    // Try email match
    if (query.includes("@")) {
      const contact = await getContactByEmail(query);
      if (contact) {
        const activities = await listActivities({ contactId: contact.id, limit: 20 });
        return c.html(<ContactProfileCard contact={contact} activities={activities} />);
      }
    }

    // Try contacts by name
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

    // Try companies
    const companies = await listCompanies({ query });
    if (companies.length === 1) {
      const company = await getCompany(companies[0]!.id);
      if (company) {
        const companyContacts = await listContacts({ companyId: company.id });
        const activities = await listActivities({ companyId: company.id, limit: 20 });
        return c.html(<CompanyProfileCard company={company} contacts={companyContacts} activities={activities} />);
      }
    }
    if (companies.length > 1) {
      return c.html(<CompanyListFragment companies={companies} />);
    }

    return c.html(<div class="card"><div class="text-sm text-muted">No results found for "{query}".</div></div>);
  }

  // Unknown
  return c.html(<HelpCard />);
});

export default app;
