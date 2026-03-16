/**
 * Entity lookup handlers — company, contact, contacts, dimensions, timeline, lookup, briefing.
 * Uses entity-resolver for search/disambiguation.
 */

import { CompanyProfileCard } from "../../cards/company-profile.tsx";
import { ContactProfileCard } from "../../cards/contact-profile.tsx";
import { BriefingCard } from "../../cards/briefing-card.tsx";
import { listCompanies } from "../../../services/companies.ts";
import { getCompany, updateCompany } from "../../../services/companies.ts";
import { listContacts, getContact, updateContact } from "../../../services/contacts.ts";
import { listActivities } from "../../../services/activities.ts";
import { generateBriefing, summarizeActivities } from "../../../services/llm-briefings.ts";
import {
  resolveAndRenderCompany,
  resolveAndRenderContact,
  resolveCompany,
  resolveContact,
  ContactListFragment,
} from "../../helpers/entity-resolver.tsx";
import type { IntentHandler } from "../chat-handlers.tsx";

export const handleCompany: IntentHandler = async (entities) => {
  return resolveAndRenderCompany(entities.name, 'Which company? Try: "show Visma"');
};

export const handleContact: IntentHandler = async (entities) => {
  const result = await resolveAndRenderContact(entities.name, entities.email);
  // If not found and we have a name, try as company (LLM sometimes picks "contact" for ambiguous names)
  if (result.summary.startsWith("No contact found") && entities.name) {
    const companyResult = await resolveAndRenderCompany(entities.name);
    if (companyResult.entityType === "company") return companyResult;
    if (companyResult.summary.startsWith("Found")) return companyResult;
  }
  return result;
};

export const handleContacts: IntentHandler = async (entities) => {
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

export const handleDimensions: IntentHandler = async (entities) => {
  return resolveAndRenderCompany(entities.name, 'Which company? Try: "survey dimensions for Visma"');
};

export const handleTimeline: IntentHandler = async (entities) => {
  return resolveAndRenderCompany(entities.name, 'Which company? Try: "timeline for Visma"', 50);
};

export const handleLookup: IntentHandler = async (entities) => {
  const query = entities.name || entities.email || "";
  if (!query) {
    const { HelpCard } = await import("./admin-handlers.tsx");
    return { html: <HelpCard />, summary: "Showed help (no query)" };
  }

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

export const handleBriefing: IntentHandler = async (entities) => {
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
