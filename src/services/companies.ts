import { generateId, queryAll, queryOne, run } from "../db/client.ts";
import type { Company, CompanyWithStats, CompanyRow } from "../types/index.ts";
import { embedContent } from "./embeddings.ts";

function parseCompany(row: CompanyRow): Company {
  return { ...row, tags: JSON.parse(row.tags || "[]") };
}

export async function createCompany(
  name: string,
  domain?: string,
  industry?: string,
  sizeBucket?: string,
  country?: string
): Promise<Company> {
  const id = generateId();
  await run(
    `INSERT INTO companies (id, name, domain, industry, size_bucket, country)
     VALUES ($id, $name, $domain, $industry, $sizeBucket, $country)`,
    { $id: id, $name: name, $domain: domain ?? null, $industry: industry ?? null, $sizeBucket: sizeBucket ?? null, $country: country ?? null }
  );
  return (await getCompany(id))!;
}

export async function getCompany(id: string): Promise<CompanyWithStats | null> {
  const row = await queryOne<CompanyRow & { contact_count: number; avg_score: number | null; last_activity: string | null }>(
    `SELECT c.*,
       (SELECT COUNT(*) FROM contacts WHERE company_id = c.id) AS contact_count,
       (SELECT AVG(CAST(json_extract(a.detail, '$.avgScore') AS DOUBLE))
        FROM activities a WHERE a.company_id = c.id AND a.activity_type = 'survey_completed') AS avg_score,
       (SELECT MAX(a2.occurred_at) FROM activities a2 WHERE a2.company_id = c.id) AS last_activity
     FROM companies c WHERE c.id = $id`,
    { $id: id }
  );
  if (!row) return null;
  return { ...parseCompany(row), contact_count: row.contact_count, avg_score: row.avg_score, last_activity: row.last_activity };
}

export async function listCompanies(opts?: { query?: string; industry?: string; sort?: string }): Promise<CompanyWithStats[]> {
  let sql = `SELECT c.*,
    (SELECT COUNT(*) FROM contacts WHERE company_id = c.id) AS contact_count,
    (SELECT AVG(CAST(json_extract(a.detail, '$.avgScore') AS DOUBLE))
     FROM activities a WHERE a.company_id = c.id AND a.activity_type = 'survey_completed') AS avg_score,
    (SELECT MAX(a2.occurred_at) FROM activities a2 WHERE a2.company_id = c.id) AS last_activity
    FROM companies c WHERE 1=1`;

  const params: Record<string, unknown> = {};

  if (opts?.query) {
    // Split query into words — each word must match name or domain (case-insensitive)
    const words = opts.query.trim().split(/\s+/).filter(Boolean);
    for (let i = 0; i < words.length; i++) {
      const key = `$qw${i}`;
      sql += ` AND (c.name ILIKE ${key} OR c.domain ILIKE ${key})`;
      params[key] = `%${words[i]}%`;
    }
  }
  if (opts?.industry) {
    sql += ` AND c.industry = $industry`;
    params.$industry = opts.industry;
  }

  const sortCol = opts?.sort === "name" ? "c.name" : opts?.sort === "score" ? "avg_score DESC" : "c.updated_at DESC";
  sql += ` ORDER BY ${sortCol}`;

  const rows = await queryAll<CompanyRow & { contact_count: number; avg_score: number | null; last_activity: string | null }>(sql, Object.keys(params).length > 0 ? params : undefined);
  return rows.map((r) => ({
    ...parseCompany(r),
    contact_count: r.contact_count,
    avg_score: r.avg_score,
    last_activity: r.last_activity,
  }));
}

export async function updateCompany(id: string, fields: Partial<Pick<Company, "name" | "domain" | "industry" | "size_bucket" | "country" | "notes" | "description" | "tags">> & { summary?: string; briefing?: string; briefing_at?: string }): Promise<void> {
  const sets: string[] = [];
  const params: Record<string, unknown> = { $id: id };

  if (fields.name !== undefined) { sets.push("name = $name"); params.$name = fields.name; }
  if (fields.domain !== undefined) { sets.push("domain = $domain"); params.$domain = fields.domain; }
  if (fields.industry !== undefined) { sets.push("industry = $industry"); params.$industry = fields.industry; }
  if (fields.size_bucket !== undefined) { sets.push("size_bucket = $sizeBucket"); params.$sizeBucket = fields.size_bucket; }
  if (fields.country !== undefined) { sets.push("country = $country"); params.$country = fields.country; }
  if (fields.notes !== undefined) { sets.push("notes = $notes"); params.$notes = fields.notes; }
  if (fields.description !== undefined) { sets.push("description = $description"); params.$description = fields.description; }
  if (fields.tags !== undefined) { sets.push("tags = $tags"); params.$tags = JSON.stringify(fields.tags); }
  if (fields.summary !== undefined) { sets.push("summary = $summary"); params.$summary = fields.summary; }
  if (fields.briefing !== undefined) { sets.push("briefing = $briefing"); params.$briefing = fields.briefing; }
  if (fields.briefing_at !== undefined) { sets.push("briefing_at = $briefingAt"); params.$briefingAt = fields.briefing_at; }

  if (sets.length === 0) return;
  sets.push("updated_at = CAST(current_timestamp AS VARCHAR)");
  await run(`UPDATE companies SET ${sets.join(", ")} WHERE id = $id`, params);

  // Embed updated notes for semantic search (fire-and-forget)
  if (fields.notes !== undefined && fields.notes) {
    const company = await queryOne<{ name: string }>(`SELECT name FROM companies WHERE id = $id`, { $id: id });
    embedContent("note", `company:${id}`, fields.notes, {
      company_id: id,
      company_name: company?.name,
    }).catch((err) => console.warn("Failed to embed company note:", err.message));
  }
}

export async function deleteCompany(id: string): Promise<void> {
  await run(`DELETE FROM companies WHERE id = $id`, { $id: id });
}

export async function getCompanyByDomain(domain: string): Promise<CompanyWithStats | null> {
  const row = await queryOne<{ id: string }>(`SELECT id FROM companies WHERE domain = $domain`, { $domain: domain });
  if (!row) return null;
  return getCompany(row.id);
}
