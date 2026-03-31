/**
 * Action handlers — sync, enrich, research.
 * Side-effect handlers that trigger pipeline operations.
 */

import { CompanyProfileCard } from "../../cards/company-profile.tsx";
import { updateCompany, getCompany } from "../../../services/companies.ts";
import { listContacts } from "../../../services/contacts.ts";
import { listActivities } from "../../../services/activities.ts";
import { enrichContacts } from "../../../services/enrich-contacts.ts";
import { researchCompany } from "../../../services/company-research.ts";
import { syncEvents } from "../../../services/sync-events.ts";
import { syncAllSurveys } from "../../../services/sync-surveys.ts";
import { syncCourseEnrollments } from "../../../services/sync-courses.ts";
import { materialize } from "../../../services/materialize.ts";
import {
  resolveCompany,
  CompanyListFragment,
} from "../../helpers/entity-resolver.tsx";
import type { IntentHandler } from "../chat-handlers.tsx";

export const handleSync: IntentHandler = async () => {
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
    const courseResult = await syncCourseEnrollments();
    steps.push({ label: "Courses", ok: true, summary: `${courseResult.created} new, ${courseResult.updated} updated, ${courseResult.skipped} skipped` });
  } catch (err: any) {
    steps.push({ label: "Courses", ok: false, summary: err.message });
  }

  try {
    const matResult = await materialize();
    steps.push({ label: "Materialize", ok: true, summary: `+${matResult.companies} companies, +${matResult.contacts} contacts, +${matResult.cmsActivities + matResult.surveyActivities + matResult.courseActivities} activities, ${matResult.journeyUpdated} stages, ${matResult.snapshotsCreated} snapshots, ${matResult.signalsDetected} signals` });
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

export const handleEnrich: IntentHandler = async () => {
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

export const handleResearch: IntentHandler = async (entities) => {
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
