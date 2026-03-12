import { generateId, queryAll, queryOne, run } from "../db/client.ts";
import type { List, ListRow, ListWithStats, ListMember, FilterCriteria } from "../types/index.ts";

function parseList(row: ListRow): List {
  return {
    ...row,
    list_type: row.list_type as "manual" | "smart",
    filter_criteria: row.filter_criteria ? JSON.parse(row.filter_criteria) : null,
  };
}

export async function createList(
  name: string,
  listType: "manual" | "smart",
  description?: string,
  filterCriteria?: FilterCriteria
): Promise<List> {
  const id = generateId();
  await run(
    `INSERT INTO lists (id, name, description, list_type, filter_criteria)
     VALUES ($id, $name, $description, $listType, $filterCriteria)`,
    {
      $id: id,
      $name: name,
      $description: description ?? null,
      $listType: listType,
      $filterCriteria: filterCriteria ? JSON.stringify(filterCriteria) : null,
    }
  );
  return (await getList(id))! as List;
}

export async function getList(id: string): Promise<ListWithStats | null> {
  const row = await queryOne<ListRow & { member_count: number }>(
    `SELECT l.*,
       (SELECT COUNT(*) FROM list_members WHERE list_id = l.id) AS member_count
     FROM lists l WHERE l.id = $id`,
    { $id: id }
  );
  if (!row) return null;
  return { ...parseList(row), member_count: row.member_count };
}

export async function listLists(): Promise<ListWithStats[]> {
  const rows = await queryAll<ListRow & { member_count: number }>(
    `SELECT l.*,
       (SELECT COUNT(*) FROM list_members WHERE list_id = l.id) AS member_count
     FROM lists l
     ORDER BY l.updated_at DESC`
  );
  return rows.map((r) => ({ ...parseList(r), member_count: r.member_count }));
}

export async function updateList(
  id: string,
  fields: Partial<Pick<List, "name" | "description" | "filter_criteria">>
): Promise<void> {
  const sets: string[] = [];
  const params: Record<string, unknown> = { $id: id };

  if (fields.name !== undefined) { sets.push("name = $name"); params.$name = fields.name; }
  if (fields.description !== undefined) { sets.push("description = $description"); params.$description = fields.description; }
  if (fields.filter_criteria !== undefined) { sets.push("filter_criteria = $filterCriteria"); params.$filterCriteria = JSON.stringify(fields.filter_criteria); }

  if (sets.length === 0) return;
  sets.push("updated_at = CAST(current_timestamp AS VARCHAR)");
  await run(`UPDATE lists SET ${sets.join(", ")} WHERE id = $id`, params);
}

export async function deleteList(id: string): Promise<void> {
  await run(`DELETE FROM list_members WHERE list_id = $id`, { $id: id });
  await run(`DELETE FROM lists WHERE id = $id`, { $id: id });
}

export async function addToList(listId: string, contactId: string): Promise<void> {
  // Ignore duplicate — DuckDB will error on PK conflict, so check first
  const existing = await queryOne<{ list_id: string }>(
    `SELECT list_id FROM list_members WHERE list_id = $listId AND contact_id = $contactId`,
    { $listId: listId, $contactId: contactId }
  );
  if (existing) return;
  await run(
    `INSERT INTO list_members (list_id, contact_id) VALUES ($listId, $contactId)`,
    { $listId: listId, $contactId: contactId }
  );
}

export async function removeFromList(listId: string, contactId: string): Promise<void> {
  await run(
    `DELETE FROM list_members WHERE list_id = $listId AND contact_id = $contactId`,
    { $listId: listId, $contactId: contactId }
  );
}

/** Get members of a manual list with engagement stats */
export async function getListMembers(listId: string): Promise<ListMember[]> {
  return queryAll<ListMember>(
    `SELECT
       ct.id AS contact_id,
       ct.name AS contact_name,
       ct.email AS contact_email,
       comp.name AS company_name,
       ct.job_title,
       (SELECT COUNT(*) FROM activities WHERE contact_id = ct.id) AS activity_count,
       (SELECT
          COUNT(DISTINCT CASE WHEN a2.activity_type = 'survey_completed' THEN a2.id END) * 5 +
          COUNT(DISTINCT CASE WHEN a2.activity_type = 'article_view' THEN a2.id END) * 3 +
          COUNT(DISTINCT CASE WHEN a2.activity_type = 'page_view' THEN a2.id END)
        FROM activities a2 WHERE a2.contact_id = ct.id) AS engagement_score,
       lm.added_at
     FROM list_members lm
     JOIN contacts ct ON lm.contact_id = ct.id
     LEFT JOIN companies comp ON ct.company_id = comp.id
     WHERE lm.list_id = $listId
     ORDER BY engagement_score DESC`,
    { $listId: listId }
  );
}

/** Evaluate smart list filter criteria and return matching contacts */
export async function getSmartListMembers(criteria: FilterCriteria): Promise<ListMember[]> {
  let sql = `SELECT
       ct.id AS contact_id,
       ct.name AS contact_name,
       ct.email AS contact_email,
       comp.name AS company_name,
       ct.job_title,
       (SELECT COUNT(*) FROM activities WHERE contact_id = ct.id) AS activity_count,
       (SELECT
          COUNT(DISTINCT CASE WHEN a2.activity_type = 'survey_completed' THEN a2.id END) * 5 +
          COUNT(DISTINCT CASE WHEN a2.activity_type = 'article_view' THEN a2.id END) * 3 +
          COUNT(DISTINCT CASE WHEN a2.activity_type = 'page_view' THEN a2.id END)
        FROM activities a2 WHERE a2.contact_id = ct.id) AS engagement_score,
       NULL AS added_at
     FROM contacts ct
     LEFT JOIN companies comp ON ct.company_id = comp.id
     WHERE 1=1`;

  const params: Record<string, unknown> = {};

  if (criteria.industry) {
    sql += ` AND comp.industry ILIKE $industry`;
    params.$industry = `%${criteria.industry}%`;
  }
  if (criteria.country) {
    sql += ` AND comp.country ILIKE $country`;
    params.$country = `%${criteria.country}%`;
  }
  if (criteria.tag) {
    sql += ` AND (ct.tags ILIKE $tag OR comp.tags ILIKE $ctag)`;
    params.$tag = `%${criteria.tag}%`;
    params.$ctag = `%${criteria.tag}%`;
  }
  if (criteria.has_survey) {
    sql += ` AND EXISTS (SELECT 1 FROM activities WHERE contact_id = ct.id AND activity_type = 'survey_completed')`;
  }
  if (criteria.read_section) {
    sql += ` AND EXISTS (SELECT 1 FROM activities WHERE contact_id = ct.id AND activity_type = 'article_view' AND detail ILIKE $readSection)`;
    params.$readSection = `%${criteria.read_section}%`;
  }
  if (criteria.completed_survey) {
    sql += ` AND EXISTS (SELECT 1 FROM activities WHERE contact_id = ct.id AND activity_type = 'survey_completed' AND source_ref ILIKE $surveySlug)`;
    params.$surveySlug = `%${criteria.completed_survey}%`;
  }
  if (criteria.min_score) {
    sql += ` AND EXISTS (SELECT 1 FROM activities WHERE contact_id = ct.id AND activity_type = 'survey_completed' AND CAST(json_extract(detail, '$.avgScore') AS DOUBLE) >= $minScore)`;
    params.$minScore = criteria.min_score;
  }
  if (criteria.max_score) {
    sql += ` AND EXISTS (SELECT 1 FROM activities WHERE contact_id = ct.id AND activity_type = 'survey_completed' AND CAST(json_extract(detail, '$.avgScore') AS DOUBLE) <= $maxScore)`;
    params.$maxScore = criteria.max_score;
  }
  if (criteria.active_days) {
    sql += ` AND EXISTS (SELECT 1 FROM activities WHERE contact_id = ct.id AND occurred_at >= CAST(current_timestamp - INTERVAL '${criteria.active_days} days' AS VARCHAR))`;
  }

  sql += ` ORDER BY engagement_score DESC`;

  const rows = await queryAll<ListMember>(sql, Object.keys(params).length > 0 ? params : undefined);

  // Filter by min_engagement in JS (can't use HAVING on a subquery alias easily in DuckDB)
  if (criteria.min_engagement) {
    return rows.filter((r) => r.engagement_score >= criteria.min_engagement!);
  }
  return rows;
}

/** Get the effective members of a list — manual or smart */
export async function getEffectiveMembers(list: List): Promise<ListMember[]> {
  if (list.list_type === "smart" && list.filter_criteria) {
    return getSmartListMembers(list.filter_criteria);
  }
  return getListMembers(list.id);
}
