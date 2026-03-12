import { Hono } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { DashboardStatsCard } from "../cards/dashboard-stats.tsx";
import { CompanyProfileCard } from "../cards/company-profile.tsx";
import { ContactProfileCard } from "../cards/contact-profile.tsx";
import { getDashboardStats } from "../../services/dashboard.ts";
import { listCompanies, getCompany, updateCompany } from "../../services/companies.ts";
import { listContacts, getContact, getContactByEmail } from "../../services/contacts.ts";
import { listActivities } from "../../services/activities.ts";
import { enrichContacts } from "../../services/enrich-contacts.ts";
import { researchCompany } from "../../services/company-research.ts";
import { getTopArticles, getTopPages, getSurveyAnalytics, getSurveyIndex, getEngagementScores } from "../../services/analytics.ts";
import { listLists, getList, getEffectiveMembers } from "../../services/lists.ts";
import { syncEvents } from "../../services/sync-events.ts";
import { syncAllSurveys } from "../../services/sync-surveys.ts";
import { materialize } from "../../services/materialize.ts";
import { ArticlesCard } from "../cards/articles-analytics.tsx";
import { ViewsCard } from "../cards/views-analytics.tsx";
import { SurveysCard } from "../cards/surveys-analytics.tsx";
import { EngagementCard } from "../cards/engagement-card.tsx";
import { ListsCard } from "../cards/lists-card.tsx";
import { ListDetailCard } from "../cards/list-detail-card.tsx";
import { understandQuery, getHistory, addTurn } from "../../services/local-llm.ts";
import type { CompanyWithStats, ContactWithDetails, QueryUnderstanding, DispatchResult } from "../../types/index.ts";

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
        <div><span class="font-mono" style="color: var(--visma-turquoise)">/articles</span> — top articles by reader count</div>
        <div><span class="font-mono" style="color: var(--visma-turquoise)">/views</span> — top pages by view count</div>
        <div><span class="font-mono" style="color: var(--visma-turquoise)">/surveys</span> — survey completions and scores</div>
        <div><span class="font-mono" style="color: var(--visma-turquoise)">/engagement</span> — company engagement rankings</div>
        <div><span class="font-mono" style="color: var(--visma-turquoise)">/lists</span> — view all lists and segments</div>
        <div><span class="font-mono" style="color: var(--visma-turquoise)">/list [name]</span> — show a specific list</div>
        <div><span class="font-mono" style="color: var(--visma-turquoise)">/sync</span> — run full sync pipeline (events + surveys + materialize + enrich)</div>
        <div><span class="font-mono" style="color: var(--visma-turquoise)">/enrich</span> — enrich contacts via Discovery Engine</div>
        <div><span class="font-mono" style="color: var(--visma-turquoise)">/research [company]</span> — deep research a company via Gemini</div>
        <div><span class="font-mono" style="color: var(--visma-turquoise)">/help</span> — show this list</div>
        <div class="text-xs text-muted mt-sm">You can also type naturally: "who works at Visma?", "show me their survey scores", "any Norwegian software companies?"</div>
      </div>
    </div>
  );
}

// --- Intent dispatch ---

async function dispatchIntent(understanding: QueryUnderstanding): Promise<DispatchResult> {
  const { intent, entities } = understanding;

  switch (intent) {
    case "dashboard": {
      const stats = await getDashboardStats();
      return { html: <DashboardStatsCard stats={stats} />, summary: "Showed dashboard overview" };
    }

    case "companies": {
      const filter: Record<string, string> = {};
      if (entities.industry) filter.industry = entities.industry;
      if (entities.country) filter.country = entities.country;
      const companies = await listCompanies(Object.keys(filter).length > 0 ? { query: [entities.industry, entities.country].filter(Boolean).join(" ") } : undefined);
      return { html: <CompanyListFragment companies={companies} />, summary: `Listed ${companies.length} companies` };
    }

    case "company": {
      const query = entities.name;
      if (!query) {
        return { html: <div class="card"><div class="text-sm text-muted">Which company? Try: "show Visma"</div></div>, summary: "Asked for company name" };
      }
      const companies = await listCompanies({ query });
      if (companies.length === 1) {
        const company = await getCompany(companies[0]!.id);
        if (company) {
          const contacts = await listContacts({ companyId: company.id });
          const activities = await listActivities({ companyId: company.id, limit: 20 });
          return {
            html: <CompanyProfileCard company={company} contacts={contacts} activities={activities} />,
            summary: `Showed company profile for ${company.name}`,
            entityId: company.id, entityName: company.name, entityType: "company",
          };
        }
      }
      if (companies.length > 1) {
        return { html: <CompanyListFragment companies={companies} />, summary: `Found ${companies.length} companies matching "${query}"` };
      }
      return { html: <div class="card"><div class="text-sm text-muted">No company found matching "{query}".</div></div>, summary: `No company found for "${query}"` };
    }

    case "contacts": {
      // If we have a company name context (e.g., "who works at Visma?"), resolve company first
      if (entities.name) {
        const companies = await listCompanies({ query: entities.name });
        if (companies.length >= 1) {
          const contacts = await listContacts({ companyId: companies[0]!.id });
          return {
            html: <ContactListFragment contacts={contacts} />,
            summary: `Listed ${contacts.length} contacts at ${companies[0]!.name}`,
            entityId: companies[0]!.id, entityName: companies[0]!.name, entityType: "company",
          };
        }
      }
      const contacts = await listContacts();
      return { html: <ContactListFragment contacts={contacts} />, summary: `Listed ${contacts.length} contacts` };
    }

    case "contact": {
      // By email
      if (entities.email) {
        const contact = await getContactByEmail(entities.email);
        if (contact) {
          const activities = await listActivities({ contactId: contact.id, limit: 20 });
          return {
            html: <ContactProfileCard contact={contact} activities={activities} />,
            summary: `Showed contact profile for ${contact.name || contact.email}`,
            entityId: contact.id, entityName: contact.name || contact.email, entityType: "contact",
          };
        }
        return { html: <div class="card"><div class="text-sm text-muted">No contact found with email "{entities.email}".</div></div>, summary: `No contact found for "${entities.email}"` };
      }
      // By name
      const query = entities.name;
      if (!query) {
        return { html: <div class="card"><div class="text-sm text-muted">Which contact? Try: "who is Hanne?"</div></div>, summary: "Asked for contact name" };
      }
      const contacts = await listContacts({ query });
      if (contacts.length === 1) {
        const contact = await getContact(contacts[0]!.id);
        if (contact) {
          const activities = await listActivities({ contactId: contact.id, limit: 20 });
          return {
            html: <ContactProfileCard contact={contact} activities={activities} />,
            summary: `Showed contact profile for ${contact.name || contact.email}`,
            entityId: contact.id, entityName: contact.name || contact.email, entityType: "contact",
          };
        }
      }
      if (contacts.length > 1) {
        return { html: <ContactListFragment contacts={contacts} />, summary: `Found ${contacts.length} contacts matching "${query}"` };
      }
      // No contact found — try as company (LLM sometimes picks "contact" for ambiguous names)
      const companiesForContact = await listCompanies({ query });
      if (companiesForContact.length === 1) {
        const company = await getCompany(companiesForContact[0]!.id);
        if (company) {
          const companyContacts = await listContacts({ companyId: company.id });
          const activities = await listActivities({ companyId: company.id, limit: 20 });
          return {
            html: <CompanyProfileCard company={company} contacts={companyContacts} activities={activities} />,
            summary: `Showed company profile for ${company.name}`,
            entityId: company.id, entityName: company.name, entityType: "company",
          };
        }
      }
      if (companiesForContact.length > 1) {
        return { html: <CompanyListFragment companies={companiesForContact} />, summary: `Found ${companiesForContact.length} companies matching "${query}"` };
      }
      return { html: <div class="card"><div class="text-sm text-muted">No results found for "{query}".</div></div>, summary: `No results for "${query}"` };
    }

    case "articles": {
      const articles = await getTopArticles(entities.limit ?? 25, entities.days ?? null);
      return { html: <ArticlesCard articles={articles} />, summary: `Showed top ${articles.length} articles` };
    }

    case "views": {
      const pages = await getTopPages(entities.limit ?? 25, entities.days ?? null);
      return { html: <ViewsCard pages={pages} />, summary: `Showed top ${pages.length} pages` };
    }

    case "surveys": {
      const days = entities.days ?? null;
      const [data, surveys] = await Promise.all([
        getSurveyAnalytics(days),
        getSurveyIndex(days),
      ]);
      return { html: <SurveysCard data={data} surveys={surveys} />, summary: "Showed survey analytics" };
    }

    case "engagement": {
      const companies = await getEngagementScores(entities.limit ?? 20, entities.days ?? null);
      return { html: <EngagementCard companies={companies} />, summary: `Showed engagement for ${companies.length} companies` };
    }

    case "dimensions": {
      // Survey dimensions for a specific company — resolve and show company profile (which includes survey data)
      const query = entities.name;
      if (!query) {
        return { html: <div class="card"><div class="text-sm text-muted">Which company? Try: "survey dimensions for Visma"</div></div>, summary: "Asked for company name" };
      }
      const companies = await listCompanies({ query });
      if (companies.length >= 1) {
        const company = await getCompany(companies[0]!.id);
        if (company) {
          const contacts = await listContacts({ companyId: company.id });
          const activities = await listActivities({ companyId: company.id, limit: 20 });
          return {
            html: <CompanyProfileCard company={company} contacts={contacts} activities={activities} />,
            summary: `Showed survey dimensions for ${company.name}`,
            entityId: company.id, entityName: company.name, entityType: "company",
          };
        }
      }
      return { html: <div class="card"><div class="text-sm text-muted">No company found matching "{query}".</div></div>, summary: `No company found for "${query}"` };
    }

    case "timeline": {
      // Timeline for a company — show company profile (which includes activity timeline)
      const query = entities.name;
      if (!query) {
        return { html: <div class="card"><div class="text-sm text-muted">Which company? Try: "timeline for Visma"</div></div>, summary: "Asked for company name" };
      }
      const companies = await listCompanies({ query });
      if (companies.length >= 1) {
        const company = await getCompany(companies[0]!.id);
        if (company) {
          const contacts = await listContacts({ companyId: company.id });
          const activities = await listActivities({ companyId: company.id, limit: 50 });
          return {
            html: <CompanyProfileCard company={company} contacts={contacts} activities={activities} />,
            summary: `Showed timeline for ${company.name}`,
            entityId: company.id, entityName: company.name, entityType: "company",
          };
        }
      }
      return { html: <div class="card"><div class="text-sm text-muted">No company found matching "{query}".</div></div>, summary: `No company found for "${query}"` };
    }

    case "lists": {
      const lists = await listLists();
      return { html: <ListsCard lists={lists} />, summary: `Showed ${lists.length} lists` };
    }

    case "list": {
      const query = entities.listName || entities.name;
      if (!query) {
        const lists = await listLists();
        return { html: <ListsCard lists={lists} />, summary: `Showed ${lists.length} lists` };
      }
      const allLists = await listLists();
      const matched = allLists.filter((l) => l.name.toLowerCase().includes(query.toLowerCase()));
      if (matched.length === 1) {
        const list = await getList(matched[0]!.id);
        if (list) {
          const members = await getEffectiveMembers(list);
          return {
            html: <ListDetailCard list={list} members={members} />,
            summary: `Showed list "${list.name}" with ${members.length} members`,
            entityId: list.id, entityName: list.name, entityType: "list",
          };
        }
      }
      if (matched.length > 1) {
        return { html: <ListsCard lists={matched} />, summary: `Found ${matched.length} lists matching "${query}"` };
      }
      return { html: <div class="card"><div class="text-sm text-muted">No list found matching "{query}".</div></div>, summary: `No list found for "${query}"` };
    }

    case "research": {
      const query = entities.name;
      if (!query) {
        return { html: <div class="card"><div class="text-sm text-muted">Which company? Try: "research Visma"</div></div>, summary: "Asked for company name" };
      }
      const companies = await listCompanies({ query });
      if (companies.length === 0) {
        return { html: <div class="card"><div class="text-sm text-muted">No company found matching "{query}".</div></div>, summary: `No company found for "${query}"` };
      }
      if (companies.length > 1) {
        return { html: <CompanyListFragment companies={companies} />, summary: `Found ${companies.length} companies matching "${query}" — pick one` };
      }
      const target = companies[0]!;
      try {
        const result = await researchCompany(target.name, target.domain);
        if (result) {
          const fields: Record<string, unknown> = {};
          if (result.description) fields.description = result.description;
          if (result.industry && !target.industry) fields.industry = result.industry;
          if (result.country && !target.country) fields.country = result.country;
          if (result.size_bucket && !target.size_bucket) fields.size_bucket = result.size_bucket;
          if (result.tags.length > 0) {
            const existing = target.tags || [];
            const merged = [...new Set([...existing, ...result.tags])];
            fields.tags = merged;
          }
          if (Object.keys(fields).length > 0) {
            await updateCompany(target.id, fields);
          }
        }
        const company = await getCompany(target.id);
        if (company) {
          const contacts = await listContacts({ companyId: company.id });
          const activities = await listActivities({ companyId: company.id, limit: 20 });
          return {
            html: <CompanyProfileCard company={company} contacts={contacts} activities={activities} />,
            summary: `Researched and updated ${company.name}`,
            entityId: company.id, entityName: company.name, entityType: "company",
          };
        }
      } catch (err: any) {
        return {
          html: (
            <div class="card">
              <div class="card-label mb-xs" style="color: var(--visma-coral)">Research Error</div>
              <div class="text-sm" style="color: var(--visma-coral)">{err.message}</div>
            </div>
          ),
          summary: `Research failed for "${query}": ${err.message}`,
        };
      }
      return { html: <div class="card"><div class="text-sm text-muted">Research completed but couldn't load company.</div></div>, summary: "Research completed" };
    }

    case "enrich": {
      try {
        const result = await enrichContacts();
        return {
          html: (
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
          ),
          summary: `Enriched ${result.enriched}/${result.processed} contacts`,
        };
      } catch (err: any) {
        return {
          html: (
            <div class="card">
              <div class="card-label mb-xs" style="color: var(--visma-coral)">Enrichment Error</div>
              <div class="text-sm" style="color: var(--visma-coral)">{err.message}</div>
            </div>
          ),
          summary: `Enrichment failed: ${err.message}`,
        };
      }
    }

    case "sync": {
      const steps: { label: string; ok: boolean; summary: string }[] = [];

      try {
        const evtResult = await syncEvents();
        steps.push({ label: "CMS Events", ok: true, summary: `${evtResult.created} new, ${evtResult.skipped} skipped` });
      } catch (err: any) {
        steps.push({ label: "CMS Events", ok: false, summary: err.message });
      }

      try {
        const survResult = await syncAllSurveys();
        const total = survResult.lighthouse.created + survResult.etcms.created;
        steps.push({ label: "Surveys", ok: true, summary: `${total} new (ET-CMS: ${survResult.etcms.created}, Lighthouse: ${survResult.lighthouse.created})` });
      } catch (err: any) {
        steps.push({ label: "Surveys", ok: false, summary: err.message });
      }

      try {
        const matResult = await materialize();
        steps.push({ label: "Materialize", ok: true, summary: `+${matResult.companies} companies, +${matResult.contacts} contacts, +${matResult.cmsActivities + matResult.surveyActivities} activities` });
      } catch (err: any) {
        steps.push({ label: "Materialize", ok: false, summary: err.message });
      }

      try {
        const enrichResult = await enrichContacts();
        steps.push({ label: "Enrich", ok: true, summary: `${enrichResult.enriched}/${enrichResult.processed} enriched` });
      } catch (err: any) {
        steps.push({ label: "Enrich", ok: false, summary: err.message });
      }

      const allOk = steps.every((s) => s.ok);
      return {
        html: (
          <div class="card">
            <div class="card-label mb-xs" style={`color: ${allOk ? "var(--visma-turquoise)" : "var(--visma-coral)"}`}>
              Full Sync {allOk ? "Complete" : "Completed with Errors"}
            </div>
            {steps.map((s) => (
              <div class="table-row">
                <div class="flex-1">
                  <span style={`font-weight: 600; color: ${s.ok ? "var(--visma-turquoise)" : "var(--visma-coral)"}`}>
                    {s.ok ? "\u2713" : "\u2717"} {s.label}
                  </span>
                </div>
                <div class="text-xs text-muted" style="max-width: 65%; text-align: right">{s.summary}</div>
              </div>
            ))}
          </div>
        ),
        summary: `Full sync: ${steps.filter((s) => s.ok).length}/${steps.length} steps succeeded`,
      };
    }

    case "sync_status": {
      return {
        html: (
          <div hx-get="/sync/status" hx-trigger="load" hx-target="#canvas" hx-swap="innerHTML">
            <div class="text-sm text-muted">Loading sync status...</div>
          </div>
        ),
        summary: "Showed sync status",
      };
    }

    case "help": {
      return { html: <HelpCard />, summary: "Showed help" };
    }

    case "lookup": {
      // Ambiguous lookup — try contacts first, then companies
      const query = entities.name || entities.email || "";
      if (!query) {
        return { html: <HelpCard />, summary: "Showed help (no query)" };
      }

      // Try email match
      if (query.includes("@")) {
        const contact = await getContactByEmail(query);
        if (contact) {
          const activities = await listActivities({ contactId: contact.id, limit: 20 });
          return {
            html: <ContactProfileCard contact={contact} activities={activities} />,
            summary: `Showed contact profile for ${contact.name || contact.email}`,
            entityId: contact.id, entityName: contact.name || contact.email, entityType: "contact",
          };
        }
      }

      // Try contacts by name
      const contacts = await listContacts({ query });
      if (contacts.length === 1) {
        const contact = await getContact(contacts[0]!.id);
        if (contact) {
          const activities = await listActivities({ contactId: contact.id, limit: 20 });
          return {
            html: <ContactProfileCard contact={contact} activities={activities} />,
            summary: `Showed contact profile for ${contact.name || contact.email}`,
            entityId: contact.id, entityName: contact.name || contact.email, entityType: "contact",
          };
        }
      }
      if (contacts.length > 1) {
        return { html: <ContactListFragment contacts={contacts} />, summary: `Found ${contacts.length} contacts matching "${query}"` };
      }

      // Try companies
      const companies = await listCompanies({ query });
      if (companies.length === 1) {
        const company = await getCompany(companies[0]!.id);
        if (company) {
          const companyContacts = await listContacts({ companyId: company.id });
          const activities = await listActivities({ companyId: company.id, limit: 20 });
          return {
            html: <CompanyProfileCard company={company} contacts={companyContacts} activities={activities} />,
            summary: `Showed company profile for ${company.name}`,
            entityId: company.id, entityName: company.name, entityType: "company",
          };
        }
      }
      if (companies.length > 1) {
        return { html: <CompanyListFragment companies={companies} />, summary: `Found ${companies.length} companies matching "${query}"` };
      }

      return { html: <div class="card"><div class="text-sm text-muted">No results found for "{query}".</div></div>, summary: `No results for "${query}"` };
    }

    default: {
      return { html: <HelpCard />, summary: "Showed help (unknown intent)" };
    }
  }
}

// --- Chat route ---

app.post("/chat", async (c) => {
  const body = await c.req.parseBody();
  const raw = (body.message as string || "").trim();
  if (!raw) {
    return c.html(<HelpCard />);
  }

  // Session management
  const sessionId = getCookie(c, "ci_session") || crypto.randomUUID();
  setCookie(c, "ci_session", sessionId, { path: "/", maxAge: 1800 });
  const history = getHistory(sessionId);

  // Understand the query (LLM with regex fallback)
  const understanding = await understandQuery(raw, history);

  // Dispatch to the right service + card
  const result = await dispatchIntent(understanding);

  // Record conversation turns
  addTurn(sessionId, { role: "user", content: raw, intent: understanding.intent });
  addTurn(sessionId, {
    role: "assistant",
    content: result.summary,
    intent: understanding.intent,
    entityId: result.entityId,
    entityName: result.entityName,
    entityType: result.entityType,
  });

  return c.html(result.html);
});

export default app;
