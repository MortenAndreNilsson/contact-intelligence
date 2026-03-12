/**
 * Shared entity lookup + disambiguation helpers.
 * Extracts the repeated "search → 0/1/many → render" pattern from chat handlers.
 */

import { CompanyProfileCard } from "../cards/company-profile.tsx";
import { ContactProfileCard } from "../cards/contact-profile.tsx";
import { listCompanies, getCompany } from "../../services/companies.ts";
import { listContacts, getContact, getContactByEmail } from "../../services/contacts.ts";
import { listActivities } from "../../services/activities.ts";
import type { CompanyWithStats, ContactWithDetails, DispatchResult } from "../../types/index.ts";

// --- Generic resolve types ---

export interface ResolveResult<T> {
  type: "found" | "multiple" | "not_found";
  item?: T;
  items?: T[];
}

// --- Company resolution ---

export async function resolveCompany(query: string): Promise<ResolveResult<CompanyWithStats>> {
  const companies = await listCompanies({ query });
  if (companies.length === 1) {
    const company = await getCompany(companies[0]!.id);
    if (company) return { type: "found", item: company };
  }
  if (companies.length > 1) return { type: "multiple", items: companies };
  return { type: "not_found" };
}

// --- Contact resolution ---

export async function resolveContact(
  query?: string,
  email?: string,
): Promise<ResolveResult<ContactWithDetails>> {
  if (email) {
    const contact = await getContactByEmail(email);
    if (contact) return { type: "found", item: contact };
    return { type: "not_found" };
  }
  if (!query) return { type: "not_found" };

  const contacts = await listContacts({ query });
  if (contacts.length === 1) {
    const contact = await getContact(contacts[0]!.id);
    if (contact) return { type: "found", item: contact };
  }
  if (contacts.length > 1) return { type: "multiple", items: contacts };
  return { type: "not_found" };
}

// --- Render helpers for dispatch results ---

export function CompanyListFragment({ companies }: { companies: CompanyWithStats[] }) {
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

export function ContactListFragment({ contacts }: { contacts: ContactWithDetails[] }) {
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

/** Resolve a company by name and render its full profile */
export async function resolveAndRenderCompany(
  query: string | undefined,
  promptText: string = "Which company?",
  activityLimit: number = 20,
): Promise<DispatchResult> {
  if (!query) {
    return { html: <div class="card"><div class="text-sm text-muted">{promptText}</div></div>, summary: "Asked for company name" };
  }
  const result = await resolveCompany(query);
  if (result.type === "found") {
    const company = result.item!;
    const contacts = await listContacts({ companyId: company.id });
    const activities = await listActivities({ companyId: company.id, limit: activityLimit });
    return {
      html: <CompanyProfileCard company={company} contacts={contacts} activities={activities} />,
      summary: `Showed company profile for ${company.name}`,
      entityId: company.id, entityName: company.name, entityType: "company",
    };
  }
  if (result.type === "multiple") {
    return { html: <CompanyListFragment companies={result.items!} />, summary: `Found ${result.items!.length} companies matching "${query}"` };
  }
  return { html: <div class="card"><div class="text-sm text-muted">No company found matching "{query}".</div></div>, summary: `No company found for "${query}"` };
}

/** Resolve a contact by name/email and render their full profile */
export async function resolveAndRenderContact(
  query?: string,
  email?: string,
): Promise<DispatchResult> {
  if (!query && !email) {
    return { html: <div class="card"><div class="text-sm text-muted">Which contact? Try: "who is Hanne?"</div></div>, summary: "Asked for contact name" };
  }
  const result = await resolveContact(query, email);
  if (result.type === "found") {
    const contact = result.item!;
    const activities = await listActivities({ contactId: contact.id, limit: 20 });
    return {
      html: <ContactProfileCard contact={contact} activities={activities} />,
      summary: `Showed contact profile for ${contact.name || contact.email}`,
      entityId: contact.id, entityName: contact.name || contact.email, entityType: "contact",
    };
  }
  if (result.type === "multiple") {
    return { html: <ContactListFragment contacts={result.items!} />, summary: `Found ${result.items!.length} contacts matching "${query}"` };
  }
  return { html: <div class="card"><div class="text-sm text-muted">No contact found for "{query || email}".</div></div>, summary: `No contact found for "${query || email}"` };
}
