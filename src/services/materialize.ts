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

async function materializeCompanies(): Promise<number> {
  const domains = await queryAll<{ domain: string }>(
    `SELECT DISTINCT domain FROM (
      SELECT split_part(userEmail, '@', 2) AS domain FROM cms_events WHERE userEmail IS NOT NULL
      UNION
      SELECT split_part(email, '@', 2) AS domain FROM survey_responses WHERE email IS NOT NULL
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
      SELECT userEmail AS email FROM cms_events WHERE userEmail IS NOT NULL
      UNION
      SELECT email FROM survey_responses WHERE email IS NOT NULL
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
  }>(
    `SELECT s._id, s.email, s.overallScore, s.maturityLevel, s.dimensionScores, s.completedAt, s.slug
     FROM survey_responses s
     WHERE s._id NOT IN (
       SELECT source_ref FROM activities WHERE source = 'survey_sync' AND source_ref IS NOT NULL
     )`
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

    await run(
      `INSERT INTO activities (id, contact_id, company_id, activity_type, source, source_ref, title, detail, occurred_at)
       VALUES ($id, $contactId, $companyId, 'survey_completed', 'survey_sync', $sourceRef, $title, $detail, $occurredAt)`,
      {
        $id: generateId(),
        $contactId: contact?.id ?? null,
        $companyId: contact?.company_id ?? null,
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

export interface MaterializeResult {
  companies: number;
  contacts: number;
  cmsActivities: number;
  surveyActivities: number;
}

export async function materialize(): Promise<MaterializeResult> {
  const companies = await materializeCompanies();
  const contacts = await materializeContacts();
  const cmsActivities = await materializeCmsActivities();
  const surveyActivities = await materializeSurveyActivities();

  const total = companies + contacts + cmsActivities + surveyActivities;

  // Log sync
  await run(
    `INSERT INTO sync_log (id, source, last_sync_at, records_processed, records_created, status)
     VALUES ($id, 'materialize', CAST(current_timestamp AS VARCHAR), $processed, $created, 'success')`,
    { $id: generateId(), $processed: total, $created: total }
  );

  return { companies, contacts, cmsActivities, surveyActivities };
}
