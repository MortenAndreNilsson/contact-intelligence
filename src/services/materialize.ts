/**
 * Identity resolution: create companies and contacts from raw CMS events
 * and survey responses.
 *
 * 1. Creates companies from unique email domains
 * 2. Creates contacts from unique email addresses
 * 3. Creates activities from CMS events (article_view, page_view)
 * 4. Creates activities from survey responses (survey_completed)
 */

import { queryAll, queryOne, run, generateId } from "../db/client.ts";
import { recomputeJourneyStages, autoSnapshotIfNeeded } from "./journey-service.ts";
import { detectSignals } from "./signals-service.ts";

/** Domains to exclude from materialization (simulated/test data) */
const BLOCKED_DOMAINS = ["test.local"];

function domainBlockFilter(emailColumn: string): string {
  return BLOCKED_DOMAINS.map((d) => `AND ${emailColumn} NOT LIKE '%@${d}'`).join(" ");
}

async function materializeCompanies(): Promise<number> {
  const domains = await queryAll<{ domain: string }>(
    `SELECT DISTINCT domain FROM (
      SELECT split_part(userEmail, '@', 2) AS domain FROM cms_events WHERE userEmail IS NOT NULL ${domainBlockFilter("userEmail")}
      UNION
      SELECT split_part(email, '@', 2) AS domain FROM survey_responses WHERE email IS NOT NULL ${domainBlockFilter("email")}
    )
    WHERE domain IS NOT NULL
      AND domain != ''
      AND domain NOT IN (SELECT domain FROM companies WHERE domain IS NOT NULL)`
  );

  let created = 0;
  for (const { domain } of domains) {
    const name = domain.split(".")[0]!;
    const prettyName = name.charAt(0).toUpperCase() + name.slice(1);

    await run(
      `INSERT INTO companies (id, name, domain, created_at, updated_at)
       VALUES ($id, $name, $domain, CAST(current_timestamp AS VARCHAR), CAST(current_timestamp AS VARCHAR))`,
      { $id: generateId(), $name: prettyName, $domain: domain }
    );
    created++;
  }

  return created;
}

async function materializeContacts(): Promise<number> {
  const emails = await queryAll<{ email: string }>(
    `SELECT DISTINCT email FROM (
      SELECT userEmail AS email FROM cms_events WHERE userEmail IS NOT NULL ${domainBlockFilter("userEmail")}
      UNION
      SELECT email FROM survey_responses WHERE email IS NOT NULL ${domainBlockFilter("email")}
    )
    WHERE email IS NOT NULL
      AND email != ''
      AND email NOT IN (SELECT email FROM contacts WHERE email IS NOT NULL)`
  );

  let created = 0;
  for (const { email } of emails) {
    const domain = email.split("@")[1];

    const company = domain
      ? await queryOne<{ id: string }>(
          "SELECT id FROM companies WHERE domain = $domain",
          { $domain: domain }
        )
      : null;

    await run(
      `INSERT INTO contacts (id, email, company_id, source, created_at, updated_at)
       VALUES ($id, $email, $companyId, 'sync', CAST(current_timestamp AS VARCHAR), CAST(current_timestamp AS VARCHAR))`,
      { $id: generateId(), $email: email, $companyId: company?.id ?? null }
    );
    created++;
  }

  return created;
}

async function materializeCmsActivities(): Promise<number> {
  const events = await queryAll<{
    _id: string;
    userEmail: string | null;
    eventType: string;
    contentTitle: string | null;
    path: string | null;
    section: string | null;
    slug: string | null;
    deviceType: string | null;
    timestamp: string;
  }>(
    `SELECT e._id, e.userEmail, e.eventType, e.contentTitle, e.path, e.section, e.slug, e.deviceType, e.timestamp
     FROM cms_events e
     WHERE e._id NOT IN (
       SELECT source_ref FROM activities WHERE source = 'cms' AND source_ref IS NOT NULL
     )`
  );

  let created = 0;
  for (const evt of events) {
    const contact = evt.userEmail
      ? await queryOne<{ id: string; company_id: string | null }>(
          "SELECT id, company_id FROM contacts WHERE email = $email",
          { $email: evt.userEmail }
        )
      : null;

    const activityType = evt.eventType === "content_read" ? "article_view" : "page_view";
    const title = evt.contentTitle || evt.path || "Page view";
    const detail = JSON.stringify({
      section: evt.section,
      slug: evt.slug,
      deviceType: evt.deviceType,
    });

    await run(
      `INSERT INTO activities (id, contact_id, company_id, activity_type, source, source_ref, title, detail, occurred_at)
       VALUES ($id, $contactId, $companyId, $type, 'cms', $sourceRef, $title, $detail, $occurredAt)`,
      {
        $id: generateId(),
        $contactId: contact?.id ?? null,
        $companyId: contact?.company_id ?? null,
        $type: activityType,
        $sourceRef: evt._id,
        $title: title,
        $detail: detail,
        $occurredAt: evt.timestamp,
      }
    );
    created++;
  }

  return created;
}

async function materializeSurveyActivities(): Promise<number> {
  const responses = await queryAll<{
    _id: string;
    email: string | null;
    overallScore: number | null;
    maturityLevel: string | null;
    dimensionScores: string | null;
    completedAt: string | null;
    slug: string | null;
    source: string | null;
  }>(
    `SELECT s._id, s.email, s.overallScore, s.maturityLevel, s.dimensionScores, s.completedAt, s.slug, s.source
     FROM survey_responses s
     WHERE s._id NOT IN (
       SELECT source_ref FROM activities
       WHERE source IN ('survey_sync', 'survey_lighthouse', 'survey_etcms')
         AND source_ref IS NOT NULL
     )
     ${domainBlockFilter("s.email")}`
  );

  let created = 0;
  for (const resp of responses) {
    const contact = resp.email
      ? await queryOne<{ id: string; company_id: string | null }>(
          "SELECT id, company_id FROM contacts WHERE email = $email",
          { $email: resp.email }
        )
      : null;

    const detail = JSON.stringify({
      avgScore: resp.overallScore,
      maturityLevel: resp.maturityLevel,
      dimensions: resp.dimensionScores ? JSON.parse(resp.dimensionScores) : null,
      slug: resp.slug,
    });

    const activitySource = resp.source === "et-cms" ? "survey_etcms" : "survey_lighthouse";

    await run(
      `INSERT INTO activities (id, contact_id, company_id, activity_type, source, source_ref, title, detail, occurred_at)
       VALUES ($id, $contactId, $companyId, 'survey_completed', $source, $sourceRef, $title, $detail, $occurredAt)`,
      {
        $id: generateId(),
        $contactId: contact?.id ?? null,
        $companyId: contact?.company_id ?? null,
        $source: activitySource,
        $sourceRef: resp._id,
        $title: `Survey completed${resp.slug ? ` (${resp.slug})` : ""}`,
        $detail: detail,
        $occurredAt: resp.completedAt || new Date().toISOString(),
      }
    );
    created++;
  }

  return created;
}

/**
 * Repair activity company_id to match their contact's current company.
 * Fixes the case where materialize created activities under a domain-based company
 * but enrich later moved the contact to the real company.
 */
async function repairActivityCompanies(): Promise<number> {
  const mismatched = await queryAll<{ activity_id: string; contact_company_id: string }>(
    `SELECT a.id AS activity_id, c.company_id AS contact_company_id
     FROM activities a
     JOIN contacts c ON a.contact_id = c.id
     WHERE c.company_id IS NOT NULL
       AND (a.company_id IS NULL OR a.company_id != c.company_id)`
  );

  for (const row of mismatched) {
    await run(
      `UPDATE activities SET company_id = $companyId WHERE id = $id`,
      { $companyId: row.contact_company_id, $id: row.activity_id }
    );
  }

  if (mismatched.length > 0) {
    console.log(`Repaired ${mismatched.length} activity company assignments`);
  }

  return mismatched.length;
}

export interface MaterializeResult {
  companies: number;
  contacts: number;
  cmsActivities: number;
  surveyActivities: number;
  activitiesRepaired: number;
  journeyUpdated: number;
  snapshotsCreated: number;
  signalsDetected: number;
}

export async function materialize(): Promise<MaterializeResult> {
  const companies = await materializeCompanies();
  const contacts = await materializeContacts();
  const cmsActivities = await materializeCmsActivities();
  const surveyActivities = await materializeSurveyActivities();
  const activitiesRepaired = await repairActivityCompanies();

  // G6: Recompute journey stages for all non-override companies
  let journeyUpdated = 0;
  try {
    journeyUpdated = await recomputeJourneyStages();
  } catch (err: any) {
    console.warn("Journey stage computation error:", err.message);
  }

  // G6: Auto-snapshot companies with new survey data
  let snapshotsCreated = 0;
  if (surveyActivities > 0) {
    const companiesWithSurveys = await queryAll<{ company_id: string }>(
      `SELECT DISTINCT company_id FROM activities WHERE activity_type = 'survey_completed' AND company_id IS NOT NULL`
    );
    for (const c of companiesWithSurveys) {
      try {
        const created = await autoSnapshotIfNeeded(c.company_id);
        if (created) snapshotsCreated++;
      } catch (err: any) {
        console.warn(`Snapshot error for ${c.company_id}:`, err.message);
      }
    }
  }

  // G7: Detect new signals
  let signalsDetected = 0;
  try {
    const signals = await detectSignals();
    signalsDetected = signals.length;
  } catch (err: any) {
    console.warn("Signal detection error:", err.message);
  }

  const total = companies + contacts + cmsActivities + surveyActivities;

  // Log sync
  await run(
    `INSERT INTO sync_log (id, source, last_sync_at, records_processed, records_created, status)
     VALUES ($id, 'materialize', CAST(current_timestamp AS VARCHAR), $processed, $created, 'success')`,
    { $id: generateId(), $processed: total, $created: total }
  );

  return { companies, contacts, cmsActivities, surveyActivities, activitiesRepaired, journeyUpdated, snapshotsCreated, signalsDetected };
}
