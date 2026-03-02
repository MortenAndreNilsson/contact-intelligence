/**
 * Sync CMS visitor events from the ET CMS analytics export API into DuckDB.
 *
 * Auth: uses gcloud identity token for morten.andre.nilsson@visma.com
 * Source: GET https://et-cms-9775734614.europe-north1.run.app/api/analytics/export
 */

import { queryOne, run, generateId } from "../db/client.ts";

const CMS_URL = "https://et-cms-9775734614.europe-north1.run.app";

async function getIdentityToken(): Promise<string> {
  const proc = Bun.spawn(["gcloud.cmd", "auth", "print-identity-token"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const text = await new Response(proc.stdout).text();
  const err = await new Response(proc.stderr).text();
  if (!text.trim()) {
    throw new Error(`Failed to get identity token: ${err}`);
  }
  return text.trim();
}

interface CmsEvent {
  _id: string;
  userEmail?: string;
  eventType?: string;
  timestamp?: string;
  date?: string;
  path?: string;
  section?: string;
  slug?: string;
  contentTitle?: string;
  referrer?: string;
  duration?: number;
  deviceType?: string;
}

async function fetchEvents(token: string): Promise<CmsEvent[]> {
  const res = await fetch(`${CMS_URL}/api/analytics/export`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    throw new Error(`CMS API error: ${res.status} ${res.statusText}`);
  }

  const text = await res.text();

  // NDJSON format: one JSON object per line
  const events: CmsEvent[] = text
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => {
      try {
        return JSON.parse(line) as CmsEvent;
      } catch {
        return null;
      }
    })
    .filter((e): e is CmsEvent => e !== null);

  return events;
}

export interface SyncResult {
  processed: number;
  created: number;
  skipped: number;
}

export async function syncEvents(): Promise<SyncResult> {
  const token = await getIdentityToken();
  const events = await fetchEvents(token);

  let created = 0;
  let skipped = 0;

  for (const evt of events) {
    if (!evt._id) {
      skipped++;
      continue;
    }

    const existing = await queryOne<{ _id: string }>(
      "SELECT _id FROM cms_events WHERE _id = $id",
      { $id: evt._id }
    );

    if (existing) {
      skipped++;
      continue;
    }

    await run(
      `INSERT INTO cms_events (_id, userEmail, eventType, timestamp, date, path, section, slug, contentTitle, referrer, duration, deviceType)
       VALUES ($id, $email, $type, $ts, $date, $path, $section, $slug, $title, $ref, $dur, $device)`,
      {
        $id: evt._id,
        $email: evt.userEmail ?? null,
        $type: evt.eventType ?? null,
        $ts: evt.timestamp ?? null,
        $date: evt.date ?? null,
        $path: evt.path ?? null,
        $section: evt.section ?? null,
        $slug: evt.slug ?? null,
        $title: evt.contentTitle ?? null,
        $ref: evt.referrer ?? null,
        $dur: evt.duration ?? null,
        $device: evt.deviceType ?? null,
      }
    );
    created++;
  }

  // Log sync
  await run(
    `INSERT INTO sync_log (id, source, last_sync_at, records_processed, records_created, records_skipped, status)
     VALUES ($id, 'cms_events', CAST(current_timestamp AS VARCHAR), $processed, $created, $skipped, 'success')`,
    { $id: generateId(), $processed: events.length, $created: created, $skipped: skipped }
  );

  return { processed: events.length, created, skipped };
}
