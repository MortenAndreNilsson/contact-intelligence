/**
 * Sync survey responses from Firestore into DuckDB.
 *
 * Auth: uses gcloud access token for morten.andre.nilsson@visma.com
 * Sources:
 *   - Lighthouse View (test-disco-cm): questionnaire_responses + survey_responses/{slug}/responses
 *   - ET-CMS (prod-etai-cm): published-surveys index → survey_responses/{surveyId}/responses
 */

import { queryOne, run, generateId } from "../db/client.ts";

const LIGHTHOUSE_PROJECT = "test-disco-cm";
const ETCMS_PROJECT = "prod-etai-cm";

function firestoreBase(project: string): string {
  return `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents`;
}

async function getAccessToken(): Promise<string> {
  const proc = Bun.spawn(["gcloud.cmd", "auth", "print-access-token"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const text = await new Response(proc.stdout).text();
  const err = await new Response(proc.stderr).text();
  if (!text.trim()) {
    throw new Error(`Failed to get access token: ${err}`);
  }
  return text.trim();
}

function parseFirestoreValue(val: any): any {
  if (!val) return null;
  if ("stringValue" in val) return val.stringValue;
  if ("integerValue" in val) return Number(val.integerValue);
  if ("doubleValue" in val) return val.doubleValue;
  if ("booleanValue" in val) return val.booleanValue;
  if ("timestampValue" in val) return val.timestampValue;
  if ("nullValue" in val) return null;
  if ("mapValue" in val) {
    const obj: Record<string, any> = {};
    for (const [k, v] of Object.entries(val.mapValue.fields || {})) {
      obj[k] = parseFirestoreValue(v);
    }
    return obj;
  }
  if ("arrayValue" in val) {
    return (val.arrayValue.values || []).map(parseFirestoreValue);
  }
  return null;
}

interface SurveyResponse {
  _id: string;
  slug: string | null;
  email: string | null;
  company: string | null;
  role: string | null;
  overallScore: number | null;
  maturityLevel: string | null;
  dimensionScores: string | null;
  answers: string | null;
  completedAt: string | null;
  userAgent: string | null;
  source: string;
}

function docToResponse(doc: any, slug?: string, source = "lighthouse-view"): SurveyResponse | null {
  if (!doc.fields) return null;

  const fields: Record<string, any> = {};
  for (const [k, v] of Object.entries(doc.fields)) {
    fields[k] = parseFirestoreValue(v);
  }

  const docId = doc.name?.split("/").pop() || "";

  return {
    _id: source === "et-cms" ? `etcms-${docId}` : docId,
    slug: slug || fields.slug || null,
    email: fields.email || null,
    company: fields.company || fields.companyName || null,
    role: fields.role || fields.jobTitle || null,
    overallScore: fields.overallScore ?? fields.avgScore ?? null,
    maturityLevel: fields.maturityLevel || null,
    dimensionScores: fields.dimensionScores ? JSON.stringify(fields.dimensionScores) : null,
    answers: fields.answers ? JSON.stringify(fields.answers) : null,
    completedAt: fields.completedAt || fields.submittedAt || doc.createTime || null,
    userAgent: fields.userAgent || null,
    source,
  };
}

async function fetchCollection(token: string, project: string, path: string): Promise<any[]> {
  const url = `${firestoreBase(project)}/${path}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    if (res.status === 404) return [];
    throw new Error(`Firestore API error for ${project}/${path}: ${res.status} ${res.statusText}`);
  }

  const data = await res.json();
  return data.documents || [];
}

async function fetchSurveySlugs(token: string, project: string): Promise<string[]> {
  const docs = await fetchCollection(token, project, "survey_responses");
  return docs.map((d: any) => d.name?.split("/").pop()).filter(Boolean);
}

async function insertResponse(r: SurveyResponse): Promise<void> {
  await run(
    `INSERT INTO survey_responses (_id, slug, email, company, role, overallScore, maturityLevel, dimensionScores, answers, completedAt, userAgent, source)
     VALUES ($id, $slug, $email, $company, $role, $score, $level, $dims, $answers, $completedAt, $ua, $source)`,
    {
      $id: r._id,
      $slug: r.slug,
      $email: r.email,
      $company: r.company,
      $role: r.role,
      $score: r.overallScore,
      $level: r.maturityLevel,
      $dims: r.dimensionScores,
      $answers: r.answers,
      $completedAt: r.completedAt,
      $ua: r.userAgent,
      $source: r.source,
    }
  );
}

export interface SyncResult {
  processed: number;
  created: number;
  skipped: number;
}

export interface DualSyncResult {
  lighthouse: SyncResult;
  etcms: SyncResult;
}

/** Sync from Lighthouse View (test-disco-cm) — legacy source */
export async function syncLighthouseSurveys(): Promise<SyncResult> {
  const token = await getAccessToken();
  let processed = 0;
  let created = 0;
  let skipped = 0;

  // 1. Fetch questionnaire_responses (flat collection)
  const qrDocs = await fetchCollection(token, LIGHTHOUSE_PROJECT, "questionnaire_responses");

  for (const doc of qrDocs) {
    const resp = docToResponse(doc, undefined, "lighthouse-view");
    if (!resp) { skipped++; continue; }
    processed++;

    const existing = await queryOne<{ _id: string }>(
      "SELECT _id FROM survey_responses WHERE _id = $id",
      { $id: resp._id }
    );
    if (existing) { skipped++; continue; }

    await insertResponse(resp);
    created++;
  }

  // 2. Fetch survey_responses/{slug}/responses
  const slugs = await fetchSurveySlugs(token, LIGHTHOUSE_PROJECT);

  for (const slug of slugs) {
    const docs = await fetchCollection(token, LIGHTHOUSE_PROJECT, `survey_responses/${slug}/responses`);

    for (const doc of docs) {
      const resp = docToResponse(doc, slug, "lighthouse-view");
      if (!resp) { skipped++; continue; }
      processed++;

      const existing = await queryOne<{ _id: string }>(
        "SELECT _id FROM survey_responses WHERE _id = $id",
        { $id: resp._id }
      );
      if (existing) { skipped++; continue; }

      await insertResponse(resp);
      created++;
    }
  }

  // Log sync
  await run(
    `INSERT INTO sync_log (id, source, last_sync_at, records_processed, records_created, records_skipped, status)
     VALUES ($id, 'survey_lighthouse', CAST(current_timestamp AS VARCHAR), $processed, $created, $skipped, 'success')`,
    { $id: generateId(), $processed: processed, $created: created, $skipped: skipped }
  );

  return { processed, created, skipped };
}

/** Sync from ET-CMS (prod-etai-cm) — primary source */
export async function syncEtCmsSurveys(): Promise<SyncResult> {
  const token = await getAccessToken();
  let processed = 0;
  let created = 0;
  let skipped = 0;

  // 1. Fetch published-surveys index to get slug→surveyId mapping
  const publishedDocs = await fetchCollection(token, ETCMS_PROJECT, "published-surveys");

  const slugMap = new Map<string, string>(); // surveyId → slug
  for (const doc of publishedDocs) {
    const docSlug = doc.name?.split("/").pop();
    if (!doc.fields || !docSlug) continue;

    const fields: Record<string, any> = {};
    for (const [k, v] of Object.entries(doc.fields)) {
      fields[k] = parseFirestoreValue(v);
    }
    // The published-surveys doc key IS the slug; surveyId is in the fields
    const surveyId = fields.surveyId || fields.id;
    if (surveyId) {
      slugMap.set(surveyId, docSlug);
    }

    // Upsert survey metadata (title from published-surveys)
    const title = fields.title || null;
    await run(
      `INSERT INTO survey_metadata (slug, title, source, synced_at)
       VALUES ($slug, $title, 'et-cms', CAST(current_timestamp AS VARCHAR))
       ON CONFLICT (slug) DO UPDATE SET title = $title, synced_at = CAST(current_timestamp AS VARCHAR)`,
      { $slug: docSlug, $title: title }
    );
  }

  // 2. Fetch survey_responses for each survey (use IDs from published-surveys, not parent collection)
  for (const [surveyId, slug] of slugMap) {
    const docs = await fetchCollection(token, ETCMS_PROJECT, `survey_responses/${surveyId}/responses`);

    for (const doc of docs) {
      const resp = docToResponse(doc, slug, "et-cms");
      if (!resp) { skipped++; continue; }
      processed++;

      const existing = await queryOne<{ _id: string }>(
        "SELECT _id FROM survey_responses WHERE _id = $id",
        { $id: resp._id }
      );
      if (existing) { skipped++; continue; }

      await insertResponse(resp);
      created++;
    }
  }

  // Log sync
  await run(
    `INSERT INTO sync_log (id, source, last_sync_at, records_processed, records_created, records_skipped, status)
     VALUES ($id, 'survey_etcms', CAST(current_timestamp AS VARCHAR), $processed, $created, $skipped, 'success')`,
    { $id: generateId(), $processed: processed, $created: created, $skipped: skipped }
  );

  return { processed, created, skipped };
}

/** Sync from both sources, returns combined results */
export async function syncAllSurveys(): Promise<DualSyncResult> {
  const lighthouse = await syncLighthouseSurveys();
  const etcms = await syncEtCmsSurveys();

  // Also log the combined result under the old source name for backwards compat with sync status
  const totalProcessed = lighthouse.processed + etcms.processed;
  const totalCreated = lighthouse.created + etcms.created;
  const totalSkipped = lighthouse.skipped + etcms.skipped;
  await run(
    `INSERT INTO sync_log (id, source, last_sync_at, records_processed, records_created, records_skipped, status)
     VALUES ($id, 'survey_responses', CAST(current_timestamp AS VARCHAR), $processed, $created, $skipped, 'success')`,
    { $id: generateId(), $processed: totalProcessed, $created: totalCreated, $skipped: totalSkipped }
  );

  return { lighthouse, etcms };
}

/** @deprecated Use syncAllSurveys() instead */
export const syncSurveys = syncAllSurveys;
