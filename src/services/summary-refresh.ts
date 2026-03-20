/**
 * Batch refresh of cached inline summaries for companies and contacts.
 * Calls LM Studio for each entity with activities, stores 1-2 sentence summary in DB.
 * Designed to run as a background task or cron job.
 */

import { queryAll, run } from "../db/client.ts";
import { summarizeActivities } from "./llm-briefings.ts";
import type { ActivityWithNames } from "../types/index.ts";

export interface RefreshResult {
  companiesUpdated: number;
  contactsUpdated: number;
  errors: number;
}

/**
 * Refresh summaries for all companies with activities.
 * Optionally filter to only stale (null or older than `maxAgeDays`).
 */
export async function refreshAllSummaries(opts?: { maxAgeDays?: number; limit?: number }): Promise<RefreshResult> {
  const maxAge = opts?.maxAgeDays ?? 7;
  const limit = opts?.limit ?? 100;

  let companiesUpdated = 0;
  let contactsUpdated = 0;
  let errors = 0;

  // Companies needing summary refresh
  const companies = await queryAll<{ id: string; name: string }>(
    `SELECT c.id, c.name FROM companies c
     WHERE EXISTS (SELECT 1 FROM activities WHERE company_id = c.id)
       AND (c.summary IS NULL OR c.updated_at < CAST(current_timestamp - INTERVAL '${maxAge} days' AS VARCHAR))
     ORDER BY c.updated_at DESC LIMIT ${limit}`
  );

  for (const co of companies) {
    try {
      const activities = await queryAll<ActivityWithNames>(
        `SELECT a.*, ct.name AS contact_name, ct.email AS contact_email, comp.name AS company_name
         FROM activities a
         LEFT JOIN contacts ct ON a.contact_id = ct.id
         LEFT JOIN companies comp ON a.company_id = comp.id
         WHERE a.company_id = $id ORDER BY a.occurred_at DESC LIMIT 15`,
        { $id: co.id }
      );

      if (activities.length === 0) continue;

      const summary = await summarizeActivities(activities, co.name);
      if (summary) {
        await run(
          `UPDATE companies SET summary = $summary, updated_at = CAST(current_timestamp AS VARCHAR) WHERE id = $id`,
          { $id: co.id, $summary: summary }
        );
        companiesUpdated++;
        console.log(`  Summary: ${co.name}`);
      }
    } catch (err: any) {
      console.warn(`  Error summarizing ${co.name}:`, err.message);
      errors++;
    }
  }

  // Contacts needing summary refresh
  const contacts = await queryAll<{ id: string; name: string | null; email: string }>(
    `SELECT ct.id, ct.name, ct.email FROM contacts ct
     WHERE EXISTS (SELECT 1 FROM activities WHERE contact_id = ct.id)
       AND (ct.summary IS NULL OR ct.updated_at < CAST(current_timestamp - INTERVAL '${maxAge} days' AS VARCHAR))
     ORDER BY ct.updated_at DESC LIMIT ${limit}`
  );

  for (const ct of contacts) {
    try {
      const activities = await queryAll<ActivityWithNames>(
        `SELECT a.*, ct2.name AS contact_name, ct2.email AS contact_email, comp.name AS company_name
         FROM activities a
         LEFT JOIN contacts ct2 ON a.contact_id = ct2.id
         LEFT JOIN companies comp ON a.company_id = comp.id
         WHERE a.contact_id = $id ORDER BY a.occurred_at DESC LIMIT 15`,
        { $id: ct.id }
      );

      if (activities.length === 0) continue;

      const summary = await summarizeActivities(activities, ct.name || ct.email);
      if (summary) {
        await run(
          `UPDATE contacts SET summary = $summary, updated_at = CAST(current_timestamp AS VARCHAR) WHERE id = $id`,
          { $id: ct.id, $summary: summary }
        );
        contactsUpdated++;
        console.log(`  Summary: ${ct.name || ct.email}`);
      }
    } catch (err: any) {
      console.warn(`  Error summarizing ${ct.name || ct.email}:`, err.message);
      errors++;
    }
  }

  return { companiesUpdated, contactsUpdated, errors };
}
