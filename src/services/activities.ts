import { generateId, queryAll, queryOne, run } from "../db/client.ts";
import type { Activity, ActivityWithNames } from "../types/index.ts";

export async function createActivity(
  contactId: string | null,
  companyId: string | null,
  type: string,
  source: string,
  sourceRef: string | null,
  title: string,
  detail: string | null,
  occurredAt: string
): Promise<Activity> {
  const id = generateId();
  await run(
    `INSERT INTO activities (id, contact_id, company_id, activity_type, source, source_ref, title, detail, occurred_at)
     VALUES ($id, $contactId, $companyId, $type, $source, $sourceRef, $title, $detail, $occurredAt)`,
    {
      $id: id,
      $contactId: contactId,
      $companyId: companyId,
      $type: type,
      $source: source,
      $sourceRef: sourceRef,
      $title: title,
      $detail: detail,
      $occurredAt: occurredAt,
    }
  );
  return (await queryOne<Activity>(`SELECT * FROM activities WHERE id = $id`, { $id: id }))!;
}

export async function listActivities(opts?: {
  contactId?: string;
  companyId?: string;
  type?: string;
  limit?: number;
}): Promise<ActivityWithNames[]> {
  let sql = `SELECT a.*,
    ct.name AS contact_name,
    ct.email AS contact_email,
    comp.name AS company_name
    FROM activities a
    LEFT JOIN contacts ct ON a.contact_id = ct.id
    LEFT JOIN companies comp ON a.company_id = comp.id
    WHERE 1=1
    AND NOT (a.activity_type = 'page_view' AND a.title LIKE '/%' AND length(a.title) < 30)
    AND NOT (a.title LIKE '/view/%')`;

  const params: Record<string, unknown> = {};

  if (opts?.contactId) {
    sql += ` AND a.contact_id = $contactId`;
    params.$contactId = opts.contactId;
  }
  if (opts?.companyId) {
    sql += ` AND a.company_id = $companyId`;
    params.$companyId = opts.companyId;
  }
  if (opts?.type) {
    sql += ` AND a.activity_type = $type`;
    params.$type = opts.type;
  }

  sql += ` ORDER BY a.occurred_at DESC`;

  if (opts?.limit) {
    sql += ` LIMIT $limit`;
    params.$limit = opts.limit;
  }

  return queryAll<ActivityWithNames>(sql, Object.keys(params).length > 0 ? params : undefined);
}

export async function activityExists(sourceRef: string): Promise<boolean> {
  const row = await queryOne<{ cnt: number }>(`SELECT COUNT(*) AS cnt FROM activities WHERE source_ref = $ref`, { $ref: sourceRef });
  return (row?.cnt ?? 0) > 0;
}
