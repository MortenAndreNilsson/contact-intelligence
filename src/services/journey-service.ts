/**
 * G6: AI Maturity Journey — company stage tracking, fluency distribution, snapshots.
 */

import { generateId, queryAll, queryOne, run } from "../db/client.ts";
import type {
  JourneyStage,
  JourneyOverview,
  MaturitySnapshot,
  CompanyJourney,
  FluencyLevel,
  FluencyDistribution,
} from "../types/index.ts";

const VALID_STAGES: JourneyStage[] = ["exploring", "assessing", "training", "scaling", "self_sustaining"];
const VALID_FLUENCY: FluencyLevel[] = ["explorer", "practitioner", "integrator", "architect", "master"];

// --- Journey stage computation ---

/**
 * Auto-compute journey stage from activity data.
 * Only auto-advances exploring → assessing (on first survey).
 * Returns null if no activity data exists.
 */
export async function computeJourneyStage(companyId: string): Promise<JourneyStage | null> {
  // Check if company has manual override
  const company = await queryOne<{ journey_stage: string | null; journey_override: boolean }>(
    `SELECT journey_stage, journey_override FROM companies WHERE id = $id`,
    { $id: companyId }
  );
  if (!company) return null;
  if (company.journey_override) return company.journey_stage as JourneyStage | null;

  // Check for survey completions
  const hasSurvey = await queryOne<{ cnt: number }>(
    `SELECT COUNT(*) AS cnt FROM activities WHERE company_id = $id AND activity_type = 'survey_completed'`,
    { $id: companyId }
  );

  // Check for any content activity
  const hasActivity = await queryOne<{ cnt: number }>(
    `SELECT COUNT(*) AS cnt FROM activities WHERE company_id = $id`,
    { $id: companyId }
  );

  if (!hasActivity || hasActivity.cnt === 0) return null;

  if (hasSurvey && hasSurvey.cnt > 0) return "assessing";
  return "exploring";
}

/**
 * Update journey stage and persist. If manual=true, sets journey_override.
 */
export async function updateJourneyStage(companyId: string, stage: JourneyStage, manual = false): Promise<void> {
  if (!VALID_STAGES.includes(stage)) throw new Error(`Invalid journey stage: ${stage}`);
  await run(
    `UPDATE companies SET journey_stage = $stage, journey_override = $override, updated_at = CAST(current_timestamp AS VARCHAR) WHERE id = $id`,
    { $id: companyId, $stage: stage, $override: manual }
  );
}

/**
 * Auto-compute and persist journey stages for all companies, or a specific one.
 * Skips companies with journey_override = true.
 */
export async function recomputeJourneyStages(companyId?: string): Promise<number> {
  let companies: { id: string }[];
  if (companyId) {
    companies = [{ id: companyId }];
  } else {
    companies = await queryAll<{ id: string }>(
      `SELECT id FROM companies WHERE journey_override = false OR journey_override IS NULL`
    );
  }

  let updated = 0;
  for (const c of companies) {
    const stage = await computeJourneyStage(c.id);
    if (stage) {
      const current = await queryOne<{ journey_stage: string | null }>(
        `SELECT journey_stage FROM companies WHERE id = $id`, { $id: c.id }
      );
      if (current?.journey_stage !== stage) {
        await updateJourneyStage(c.id, stage, false);
        updated++;
      }
    }
  }
  return updated;
}

// --- Journey overview ---

export async function getJourneyOverview(): Promise<JourneyOverview> {
  const rows = await queryAll<{ journey_stage: string; cnt: number }>(
    `SELECT journey_stage, COUNT(*) AS cnt FROM companies WHERE journey_stage IS NOT NULL GROUP BY journey_stage`
  );
  const overview: JourneyOverview = { exploring: 0, assessing: 0, training: 0, scaling: 0, self_sustaining: 0, total: 0 };
  for (const r of rows) {
    const stage = r.journey_stage as keyof JourneyOverview;
    if (stage in overview && stage !== "total") {
      overview[stage] = r.cnt;
      overview.total += r.cnt;
    }
  }
  return overview;
}

// --- Fluency distribution ---

export async function getFluencyDistribution(companyId: string): Promise<FluencyDistribution> {
  const rows = await queryAll<{ fluency_level: string | null; cnt: number }>(
    `SELECT fluency_level, COUNT(*) AS cnt FROM contacts WHERE company_id = $id GROUP BY fluency_level`,
    { $id: companyId }
  );
  const dist: FluencyDistribution = { explorer: 0, practitioner: 0, integrator: 0, architect: 0, master: 0, unset: 0 };
  for (const r of rows) {
    if (r.fluency_level && r.fluency_level in dist) {
      dist[r.fluency_level as FluencyLevel] = r.cnt;
    } else {
      dist.unset += r.cnt;
    }
  }
  return dist;
}

export async function setContactFluencyLevel(contactId: string, level: FluencyLevel): Promise<void> {
  if (!VALID_FLUENCY.includes(level)) throw new Error(`Invalid fluency level: ${level}`);
  await run(
    `UPDATE contacts SET fluency_level = $level, fluency_certified_at = CAST(current_timestamp AS VARCHAR), updated_at = CAST(current_timestamp AS VARCHAR) WHERE id = $id`,
    { $id: contactId, $level: level }
  );
}

// --- Maturity snapshots ---

export async function createSnapshot(companyId: string, trigger: string): Promise<MaturitySnapshot | null> {
  // Count respondents at each maturity level from survey activities
  const levels = await queryAll<{ maturityLevel: string; cnt: number }>(
    `SELECT json_extract_string(a.detail, '$.maturityLevel') AS maturityLevel, COUNT(*) AS cnt
     FROM activities a
     WHERE a.company_id = $id AND a.activity_type = 'survey_completed'
       AND json_extract_string(a.detail, '$.maturityLevel') IS NOT NULL
     GROUP BY maturityLevel`,
    { $id: companyId }
  );

  if (levels.length === 0) return null;

  const avgRow = await queryOne<{ avg_score: number | null }>(
    `SELECT AVG(CAST(json_extract_string(a.detail, '$.avgScore') AS DOUBLE)) AS avg_score
     FROM activities a WHERE a.company_id = $id AND a.activity_type = 'survey_completed'`,
    { $id: companyId }
  );

  const levelMap: Record<string, number> = {};
  let total = 0;
  for (const r of levels) {
    levelMap[r.maturityLevel?.toLowerCase() || "unknown"] = r.cnt;
    total += r.cnt;
  }

  const id = generateId();
  await run(
    `INSERT INTO maturity_snapshots (id, company_id, snapshot_date, trigger_type, total_respondents, beginner_count, developing_count, intermediate_count, advanced_count, leader_count, avg_score)
     VALUES ($id, $companyId, current_date, $trigger, $total, $beginner, $developing, $intermediate, $advanced, $leader, $avg)`,
    {
      $id: id,
      $companyId: companyId,
      $trigger: trigger,
      $total: total,
      $beginner: levelMap["beginner"] || 0,
      $developing: levelMap["developing"] || 0,
      $intermediate: levelMap["intermediate"] || 0,
      $advanced: levelMap["advanced"] || 0,
      $leader: levelMap["leader"] || 0,
      $avg: avgRow?.avg_score ?? null,
    }
  );

  return queryOne<MaturitySnapshot>(`SELECT * FROM maturity_snapshots WHERE id = $id`, { $id: id });
}

export async function getSnapshots(companyId: string): Promise<MaturitySnapshot[]> {
  return queryAll<MaturitySnapshot>(
    `SELECT * FROM maturity_snapshots WHERE company_id = $id ORDER BY snapshot_date DESC`,
    { $id: companyId }
  );
}

/**
 * Create a snapshot only if there are new survey activities since the last snapshot.
 */
export async function autoSnapshotIfNeeded(companyId: string): Promise<boolean> {
  const lastSnapshot = await queryOne<{ snapshot_date: string }>(
    `SELECT snapshot_date FROM maturity_snapshots WHERE company_id = $id ORDER BY snapshot_date DESC LIMIT 1`,
    { $id: companyId }
  );

  const newSurveys = await queryOne<{ cnt: number }>(
    lastSnapshot
      ? `SELECT COUNT(*) AS cnt FROM activities WHERE company_id = $id AND activity_type = 'survey_completed' AND occurred_at > $since`
      : `SELECT COUNT(*) AS cnt FROM activities WHERE company_id = $id AND activity_type = 'survey_completed'`,
    lastSnapshot ? { $id: companyId, $since: lastSnapshot.snapshot_date } : { $id: companyId }
  );

  if (newSurveys && newSurveys.cnt > 0) {
    await createSnapshot(companyId, "survey");
    return true;
  }
  return false;
}

// --- Full company journey view ---

export async function getCompanyJourney(companyId: string): Promise<CompanyJourney | null> {
  const company = await queryOne<{ id: string; name: string; journey_stage: string | null; journey_override: boolean }>(
    `SELECT id, name, journey_stage, journey_override FROM companies WHERE id = $id`,
    { $id: companyId }
  );
  if (!company) return null;

  const contactCount = await queryOne<{ cnt: number }>(
    `SELECT COUNT(*) AS cnt FROM contacts WHERE company_id = $id`,
    { $id: companyId }
  );

  const fluency = await getFluencyDistribution(companyId);
  const snapshots = await getSnapshots(companyId);

  return {
    company_id: company.id,
    company_name: company.name,
    stage: company.journey_stage as JourneyStage | null,
    stage_override: company.journey_override,
    fluency_distribution: fluency,
    snapshots,
    total_contacts: contactCount?.cnt ?? 0,
  };
}
