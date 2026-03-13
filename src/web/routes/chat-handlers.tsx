/**
 * Intent handler registry for the chat dispatch.
 * Each handler takes entities and returns a DispatchResult.
 * Adding a new intent = adding one entry + one handler function.
 */

import { DashboardStatsCard } from "../cards/dashboard-stats.tsx";
import { CompanyProfileCard } from "../cards/company-profile.tsx";
import { ArticlesCard } from "../cards/articles-analytics.tsx";
import { ViewsCard } from "../cards/views-analytics.tsx";
import { SurveysCard } from "../cards/surveys-analytics.tsx";
import { EngagementCard } from "../cards/engagement-card.tsx";
import { ListsCard } from "../cards/lists-card.tsx";
import { ListDetailCard } from "../cards/list-detail-card.tsx";
import { getDashboardStats } from "../../services/dashboard.ts";
import { listCompanies, getCompany, updateCompany } from "../../services/companies.ts";
import { listContacts, getContact, updateContact } from "../../services/contacts.ts";
import { listActivities } from "../../services/activities.ts";
import { enrichContacts } from "../../services/enrich-contacts.ts";
import { researchCompany } from "../../services/company-research.ts";
import { generateBriefing, summarizeActivities } from "../../services/local-llm.ts";
import { BriefingCard } from "../cards/briefing-card.tsx";
import { ContactProfileCard } from "../cards/contact-profile.tsx";
import { getTopArticles, getTopPages, getSurveyAnalytics, getSurveyIndex, getEngagementScores } from "../../services/analytics.ts";
import { listLists, getList, getEffectiveMembers } from "../../services/lists.ts";
import { syncEvents } from "../../services/sync-events.ts";
import { syncAllSurveys } from "../../services/sync-surveys.ts";
import { materialize } from "../../services/materialize.ts";
import {
  resolveAndRenderCompany,
  resolveAndRenderContact,
  resolveCompany,
  resolveContact,
  CompanyListFragment,
  ContactListFragment,
} from "../helpers/entity-resolver.tsx";
import type { QueryUnderstanding, DispatchResult } from "../../types/index.ts";

type IntentHandler = (entities: QueryUnderstanding["entities"]) => Promise<DispatchResult>;

// --- Help card ---

export function HelpCard() {
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
        <div><span class="font-mono" style="color: var(--visma-turquoise)">/briefing [company/contact]</span> — generate CRM briefing via LM Studio</div>
        <div><span class="font-mono" style="color: var(--visma-turquoise)">/help</span> — show this list</div>
        <div class="text-xs text-muted mt-sm">You can also type naturally: "who works at Visma?", "show me their survey scores", "any Norwegian software companies?"</div>
      </div>
    </div>
  );
}

// --- Handler implementations ---

const handleDashboard: IntentHandler = async () => {
  const stats = await getDashboardStats();
  return { html: <DashboardStatsCard stats={stats} />, summary: "Showed dashboard overview" };
};

const handleCompanies: IntentHandler = async (entities) => {
  const companies = await listCompanies(
    (entities.industry || entities.country)
      ? { query: [entities.industry, entities.country].filter(Boolean).join(" ") }
      : undefined
  );
  return { html: <CompanyListFragment companies={companies} />, summary: `Listed ${companies.length} companies` };
};

const handleCompany: IntentHandler = async (entities) => {
  return resolveAndRenderCompany(entities.name, 'Which company? Try: "show Visma"');
};

const handleContacts: IntentHandler = async (entities) => {
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
};

const handleContact: IntentHandler = async (entities) => {
  const result = await resolveAndRenderContact(entities.name, entities.email);
  // If not found and we have a name, try as company (LLM sometimes picks "contact" for ambiguous names)
  if (result.summary.startsWith("No contact found") && entities.name) {
    const companyResult = await resolveAndRenderCompany(entities.name);
    if (companyResult.entityType === "company") return companyResult;
    if (companyResult.summary.startsWith("Found")) return companyResult;
  }
  return result;
};

const handleArticles: IntentHandler = async (entities) => {
  const articles = await getTopArticles(entities.limit ?? 25, entities.days ?? null);
  return { html: <ArticlesCard articles={articles} />, summary: `Showed top ${articles.length} articles` };
};

const handleViews: IntentHandler = async (entities) => {
  const pages = await getTopPages(entities.limit ?? 25, entities.days ?? null);
  return { html: <ViewsCard pages={pages} />, summary: `Showed top ${pages.length} pages` };
};

const handleSurveys: IntentHandler = async (entities) => {
  const days = entities.days ?? null;
  const [data, surveys] = await Promise.all([
    getSurveyAnalytics(days),
    getSurveyIndex(days),
  ]);
  return { html: <SurveysCard data={data} surveys={surveys} />, summary: "Showed survey analytics" };
};

const handleEngagement: IntentHandler = async (entities) => {
  const companies = await getEngagementScores(entities.limit ?? 20, entities.days ?? null);
  return { html: <EngagementCard companies={companies} />, summary: `Showed engagement for ${companies.length} companies` };
};

const handleDimensions: IntentHandler = async (entities) => {
  return resolveAndRenderCompany(entities.name, 'Which company? Try: "survey dimensions for Visma"');
};

const handleTimeline: IntentHandler = async (entities) => {
  return resolveAndRenderCompany(entities.name, 'Which company? Try: "timeline for Visma"', 50);
};

const handleLists: IntentHandler = async () => {
  const lists = await listLists();
  return { html: <ListsCard lists={lists} />, summary: `Showed ${lists.length} lists` };
};

const handleList: IntentHandler = async (entities) => {
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
};

const handleResearch: IntentHandler = async (entities) => {
  const query = entities.name;
  if (!query) {
    return { html: <div class="card"><div class="text-sm text-muted">Which company? Try: "research Visma"</div></div>, summary: "Asked for company name" };
  }
  const result = await resolveCompany(query);
  if (result.type === "not_found") {
    return { html: <div class="card"><div class="text-sm text-muted">No company found matching "{query}".</div></div>, summary: `No company found for "${query}"` };
  }
  if (result.type === "multiple") {
    return { html: <CompanyListFragment companies={result.items!} />, summary: `Found ${result.items!.length} companies matching "${query}" — pick one` };
  }
  const target = result.item!;
  try {
    const researchResult = await researchCompany(target.name, target.domain);
    if (researchResult) {
      const fields: Record<string, unknown> = {};
      if (researchResult.description) {
        fields.description = target.description
          ? `${target.description}\n\n---\n\n${researchResult.description}`
          : researchResult.description;
      }
      if (researchResult.industry && !target.industry) fields.industry = researchResult.industry;
      if (researchResult.country && !target.country) fields.country = researchResult.country;
      if (researchResult.size_bucket && !target.size_bucket) fields.size_bucket = researchResult.size_bucket;
      if (researchResult.tags.length > 0) {
        const existing = target.tags || [];
        fields.tags = [...new Set([...existing, ...researchResult.tags])];
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
};

const handleEnrich: IntentHandler = async () => {
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
};

const handleSync: IntentHandler = async () => {
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
};

const handleSyncStatus: IntentHandler = async () => {
  return {
    html: (
      <div hx-get="/sync/status" hx-trigger="load" hx-target="#canvas" hx-swap="innerHTML">
        <div class="text-sm text-muted">Loading sync status...</div>
      </div>
    ),
    summary: "Showed sync status",
  };
};

const handleHelp: IntentHandler = async () => {
  return { html: <HelpCard />, summary: "Showed help" };
};

const handleLookup: IntentHandler = async (entities) => {
  const query = entities.name || entities.email || "";
  if (!query) return { html: <HelpCard />, summary: "Showed help (no query)" };

  // Try contact first
  const contactResult = await resolveAndRenderContact(
    entities.email ? undefined : query,
    entities.email || (query.includes("@") ? query : undefined),
  );
  if (contactResult.entityType) return contactResult;
  if (contactResult.summary.startsWith("Found")) return contactResult;

  // Try company
  const companyResult = await resolveAndRenderCompany(query);
  if (companyResult.entityType) return companyResult;
  if (companyResult.summary.startsWith("Found")) return companyResult;

  return { html: <div class="card"><div class="text-sm text-muted">No results found for "{query}".</div></div>, summary: `No results for "${query}"` };
};

const handleBriefing: IntentHandler = async (entities) => {
  const query = entities.name || entities.email;
  if (!query) {
    return { html: <div class="card"><div class="text-sm text-muted">Which company or contact? Try: "briefing Visma" or "briefing hanne@example.com"</div></div>, summary: "Asked for entity name" };
  }

  // Try company first, then contact
  const companyResult = await resolveCompany(query);
  if (companyResult.type === "found" && companyResult.item) {
    const company = companyResult.item;
    const contacts = await listContacts({ companyId: company.id });
    const activities = await listActivities({ companyId: company.id, limit: 50 });
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
      return { html: <div class="card"><div class="text-sm" style="color: var(--visma-coral)">Could not generate briefing. LM Studio may be unavailable.</div></div>, summary: "Briefing generation failed" };
    }

    await updateCompany(company.id, { briefing, briefing_at: new Date().toISOString() });
    const summary = await summarizeActivities(activities, company.name);
    return {
      html: (
        <div>
          <BriefingCard entityName={company.name} entityType="company" briefing={briefing} />
          <CompanyProfileCard company={company} contacts={contacts} activities={activities.slice(0, 20)} summary={summary} />
        </div>
      ),
      summary: `Generated briefing for ${company.name}`,
      entityId: company.id, entityName: company.name, entityType: "company",
    };
  }

  // Try contact
  const contactResult = await resolveContact(query);
  if (contactResult.type === "found" && contactResult.item) {
    const contact = contactResult.item;
    const activities = await listActivities({ contactId: contact.id, limit: 50 });
    const entityName = contact.name || contact.email;
    const metadata = [contact.job_title, contact.company_name, contact.email].filter(Boolean).join(", ");

    const briefing = await generateBriefing({
      entityType: "contact",
      entityName,
      metadata: metadata || undefined,
      activities,
    });

    if (!briefing) {
      return { html: <div class="card"><div class="text-sm" style="color: var(--visma-coral)">Could not generate briefing. LM Studio may be unavailable.</div></div>, summary: "Briefing generation failed" };
    }

    await updateContact(contact.id, { briefing, briefing_at: new Date().toISOString() });
    const summary = await summarizeActivities(activities, entityName);
    return {
      html: (
        <div>
          <BriefingCard entityName={entityName} entityType="contact" briefing={briefing} />
          <ContactProfileCard contact={contact} activities={activities.slice(0, 20)} summary={summary} />
        </div>
      ),
      summary: `Generated briefing for ${entityName}`,
      entityId: contact.id, entityName, entityType: "contact",
    };
  }

  return { html: <div class="card"><div class="text-sm text-muted">No company or contact found matching "{query}".</div></div>, summary: `No entity found for "${query}"` };
};

const handleUnknown: IntentHandler = async () => {
  return { html: <HelpCard />, summary: "Showed help (unknown intent)" };
};

// --- Handler registry ---

export const handlers: Record<string, IntentHandler> = {
  dashboard: handleDashboard,
  companies: handleCompanies,
  company: handleCompany,
  contacts: handleContacts,
  contact: handleContact,
  articles: handleArticles,
  views: handleViews,
  surveys: handleSurveys,
  engagement: handleEngagement,
  dimensions: handleDimensions,
  timeline: handleTimeline,
  lists: handleLists,
  list: handleList,
  research: handleResearch,
  briefing: handleBriefing,
  enrich: handleEnrich,
  sync: handleSync,
  sync_status: handleSyncStatus,
  help: handleHelp,
  lookup: handleLookup,
  unknown: handleUnknown,
  // article_trend not yet implemented — falls through to unknown
};

/** Dispatch an intent to the appropriate handler */
export async function dispatchIntent(understanding: QueryUnderstanding): Promise<DispatchResult> {
  const handler = handlers[understanding.intent] || handlers.unknown!;
  return handler(understanding.entities);
}
