/**
 * G7: Engagement Signals — detect notable events from activity data.
 * Signals are persisted so each is shown only once.
 */

import { generateId, queryAll, queryOne, run } from "../db/client.ts";
import type { Signal, SignalType } from "../types/index.ts";

// --- Signal detection ---

/**
 * Detect all new signals. Each detector returns new signals to persist.
 * Called after materialize during sync pipeline.
 */
export async function detectSignals(): Promise<Signal[]> {
  const all: Signal[] = [];

  const detectors = [
    detectNewSurvey,
    detectScoreChange,
    detectContentBinge,
    detectCoolingOff,
    detectNewPerson,
  ];

  for (const detect of detectors) {
    try {
      const signals = await detect();
      for (const s of signals) {
        await run(
          `INSERT INTO signals (id, signal_type, company_id, title, detail, detected_at)
           VALUES ($id, $type, $companyId, $title, $detail, CAST(current_timestamp AS VARCHAR))`,
          { $id: s.id, $type: s.signal_type, $companyId: s.company_id, $title: s.title, $detail: s.detail }
        );
        all.push(s);
      }
    } catch (err: any) {
      console.warn(`Signal detection error (${detect.name}):`, err.message);
    }
  }

  return all;
}

// --- Individual detectors ---

async function detectNewSurvey(): Promise<Signal[]> {
  // Survey activities not yet signalled (dedup by activity ID stored in signal.detail)
  const rows = await queryAll<{ activity_id: string; company_id: string; company_name: string; title: string; occurred_at: string }>(
    `SELECT a.id AS activity_id, a.company_id, c.name AS company_name, a.title, a.occurred_at
     FROM activities a
     JOIN companies c ON a.company_id = c.id
     WHERE a.activity_type = 'survey_completed'
       AND a.company_id IS NOT NULL
       AND a.id NOT IN (
         SELECT detail FROM signals WHERE signal_type = 'new_survey' AND detail IS NOT NULL
       )
     ORDER BY a.occurred_at DESC`
  );

  return rows.map((r) => ({
    id: generateId(),
    signal_type: "new_survey" as SignalType,
    company_id: r.company_id,
    company_name: r.company_name,
    title: `New survey completion at ${r.company_name}`,
    detail: r.activity_id,
    detected_at: new Date().toISOString(),
    dismissed: false,
    created_at: new Date().toISOString(),
  }));
}

async function detectScoreChange(): Promise<Signal[]> {
  // Companies where avg score changed by >0.5 between last two snapshots
  const rows = await queryAll<{
    company_id: string;
    company_name: string;
    old_score: number;
    new_score: number;
  }>(
    `WITH ranked AS (
      SELECT ms.company_id, ms.avg_score, ms.snapshot_date,
        ROW_NUMBER() OVER (PARTITION BY ms.company_id ORDER BY ms.snapshot_date DESC) AS rn
      FROM maturity_snapshots ms
      WHERE ms.avg_score IS NOT NULL
    )
    SELECT r1.company_id, c.name AS company_name, r2.avg_score AS old_score, r1.avg_score AS new_score
    FROM ranked r1
    JOIN ranked r2 ON r1.company_id = r2.company_id AND r2.rn = 2
    JOIN companies c ON r1.company_id = c.id
    WHERE r1.rn = 1
      AND ABS(r1.avg_score - r2.avg_score) > 0.5
      AND r1.company_id NOT IN (
        SELECT company_id FROM signals WHERE signal_type = 'score_change'
          AND detected_at > CAST(r1.snapshot_date AS VARCHAR)
      )`
  );

  return rows.map((r) => {
    const direction = r.new_score > r.old_score ? "up" : "down";
    const delta = Math.abs(r.new_score - r.old_score).toFixed(1);
    return {
      id: generateId(),
      signal_type: "score_change" as SignalType,
      company_id: r.company_id,
      company_name: r.company_name,
      title: `${r.company_name} maturity score ${direction} by ${delta}`,
      detail: `${r.old_score.toFixed(1)} → ${r.new_score.toFixed(1)}`,
      detected_at: new Date().toISOString(),
      dismissed: false,
      created_at: new Date().toISOString(),
    };
  });
}

async function detectContentBinge(): Promise<Signal[]> {
  // Contacts who read 5+ articles in the last 7 days, not yet signalled
  const rows = await queryAll<{
    contact_id: string;
    contact_name: string;
    company_id: string;
    company_name: string;
    article_count: number;
  }>(
    `SELECT a.contact_id, ct.name AS contact_name, a.company_id, c.name AS company_name,
       COUNT(*) AS article_count
     FROM activities a
     JOIN contacts ct ON a.contact_id = ct.id
     JOIN companies c ON a.company_id = c.id
     WHERE a.activity_type = 'article_view'
       AND a.occurred_at >= CAST(current_timestamp - INTERVAL '7 days' AS VARCHAR)
       AND a.company_id IS NOT NULL
     GROUP BY a.contact_id, ct.name, a.company_id, c.name
     HAVING COUNT(*) >= 5`
  );

  // Filter out already-signalled contacts (by contact_id in detail)
  const existing = await queryAll<{ detail: string }>(
    `SELECT detail FROM signals WHERE signal_type = 'content_binge'
     AND detected_at >= CAST(current_timestamp - INTERVAL '7 days' AS VARCHAR)`
  );
  const signalled = new Set(existing.map((e) => e.detail));

  return rows
    .filter((r) => !signalled.has(r.contact_id))
    .map((r) => ({
      id: generateId(),
      signal_type: "content_binge" as SignalType,
      company_id: r.company_id,
      company_name: r.company_name,
      title: `${r.contact_name || "Someone"} at ${r.company_name} read ${r.article_count} articles this week`,
      detail: r.contact_id,
      detected_at: new Date().toISOString(),
      dismissed: false,
      created_at: new Date().toISOString(),
    }));
}

async function detectCoolingOff(): Promise<Signal[]> {
  // Companies with 3+ activities in previous 30 days but none in last 14
  const rows = await queryAll<{ company_id: string; company_name: string; prev_count: number }>(
    `SELECT c.id AS company_id, c.name AS company_name, prev.cnt AS prev_count
     FROM companies c
     JOIN (
       SELECT company_id, COUNT(*) AS cnt FROM activities
       WHERE occurred_at >= CAST(current_timestamp - INTERVAL '30 days' AS VARCHAR)
         AND occurred_at < CAST(current_timestamp - INTERVAL '14 days' AS VARCHAR)
       GROUP BY company_id HAVING COUNT(*) >= 3
     ) prev ON c.id = prev.company_id
     LEFT JOIN (
       SELECT DISTINCT company_id FROM activities
       WHERE occurred_at >= CAST(current_timestamp - INTERVAL '14 days' AS VARCHAR)
     ) recent ON c.id = recent.company_id
     WHERE recent.company_id IS NULL
       AND c.id NOT IN (
         SELECT company_id FROM signals WHERE signal_type = 'cooling_off'
           AND detected_at >= CAST(current_timestamp - INTERVAL '14 days' AS VARCHAR)
       )`
  );

  return rows.map((r) => ({
    id: generateId(),
    signal_type: "cooling_off" as SignalType,
    company_id: r.company_id,
    company_name: r.company_name,
    title: `${r.company_name} going quiet — no activity in 14 days`,
    detail: `Had ${r.prev_count} activities in the prior 16 days`,
    detected_at: new Date().toISOString(),
    dismissed: false,
    created_at: new Date().toISOString(),
  }));
}

async function detectNewPerson(): Promise<Signal[]> {
  // Contacts created in the last 7 days at companies that already existed
  const rows = await queryAll<{
    contact_id: string;
    contact_email: string;
    contact_name: string;
    company_id: string;
    company_name: string;
  }>(
    `SELECT ct.id AS contact_id, ct.email AS contact_email, ct.name AS contact_name,
       ct.company_id, c.name AS company_name
     FROM contacts ct
     JOIN companies c ON ct.company_id = c.id
     WHERE ct.created_at >= CAST(current_timestamp - INTERVAL '7 days' AS VARCHAR)
       AND c.created_at < ct.created_at
       AND ct.id NOT IN (
         SELECT detail FROM signals WHERE signal_type = 'new_person' AND detail IS NOT NULL
       )`
  );

  return rows.map((r) => ({
    id: generateId(),
    signal_type: "new_person" as SignalType,
    company_id: r.company_id,
    company_name: r.company_name,
    title: `New person at ${r.company_name}: ${r.contact_name || r.contact_email}`,
    detail: r.contact_id,
    detected_at: new Date().toISOString(),
    dismissed: false,
    created_at: new Date().toISOString(),
  }));
}

// --- Query + dismiss ---

export async function getActiveSignals(limit = 20): Promise<Signal[]> {
  const rows = await queryAll<Signal & { company_name: string }>(
    `SELECT s.*, c.name AS company_name
     FROM signals s
     JOIN companies c ON s.company_id = c.id
     WHERE s.dismissed = false
     ORDER BY s.detected_at DESC
     LIMIT $limit`,
    { $limit: limit }
  );
  return rows;
}

export async function dismissSignal(id: string): Promise<void> {
  await run(`UPDATE signals SET dismissed = true WHERE id = $id`, { $id: id });
}

export async function dismissAllForCompany(companyId: string): Promise<void> {
  await run(`UPDATE signals SET dismissed = true WHERE company_id = $id AND dismissed = false`, { $id: companyId });
}
