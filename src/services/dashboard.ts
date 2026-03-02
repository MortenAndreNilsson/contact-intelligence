import { queryOne, queryAll } from "../db/client.ts";
import type { DashboardStats, CompanyWithStats, ActivityWithNames, CompanyRow, TopArticle, ArticleReader } from "../types/index.ts";

export async function getDashboardStats(): Promise<DashboardStats> {
  const counts = (await queryOne<{ totalCompanies: number; totalContacts: number; totalActivities: number }>(
    `SELECT
       (SELECT COUNT(*) FROM companies) AS totalCompanies,
       (SELECT COUNT(*) FROM contacts) AS totalContacts,
       (SELECT COUNT(*) FROM activities) AS totalActivities`
  ))!;

  const scoreRow = await queryOne<{ avgScore: number | null }>(
    `SELECT AVG(CAST(json_extract(detail, '$.avgScore') AS DOUBLE)) AS avgScore
     FROM activities WHERE activity_type = 'survey_completed'`
  );

  const recentActivity = await queryAll<ActivityWithNames>(
    `SELECT a.*,
       ct.name AS contact_name,
       ct.email AS contact_email,
       comp.name AS company_name
     FROM activities a
     LEFT JOIN contacts ct ON a.contact_id = ct.id
     LEFT JOIN companies comp ON a.company_id = comp.id
     ORDER BY a.occurred_at DESC
     LIMIT 10`
  );

  const topCompanies = (await queryAll<CompanyRow & { contact_count: number; avg_score: number | null; last_activity: string | null }>(
    `SELECT c.*,
       (SELECT COUNT(*) FROM contacts WHERE company_id = c.id) AS contact_count,
       (SELECT AVG(CAST(json_extract(a.detail, '$.avgScore') AS DOUBLE))
        FROM activities a WHERE a.company_id = c.id AND a.activity_type = 'survey_completed') AS avg_score,
       (SELECT MAX(a2.occurred_at) FROM activities a2 WHERE a2.company_id = c.id) AS last_activity
     FROM companies c
     ORDER BY contact_count DESC
     LIMIT 5`
  )).map((r) => ({
    ...r,
    tags: JSON.parse(r.tags || "[]"),
    contact_count: r.contact_count,
    avg_score: r.avg_score,
    last_activity: r.last_activity,
  }));

  // Top articles by unique readers
  const topArticles = await queryAll<TopArticle>(
    `SELECT
       a.title,
       json_extract_string(a.detail, '$.slug') AS slug,
       json_extract_string(a.detail, '$.section') AS section,
       COUNT(DISTINCT ct.email) AS reader_count,
       MAX(a.occurred_at) AS last_read
     FROM activities a
     LEFT JOIN contacts ct ON a.contact_id = ct.id
     WHERE a.activity_type IN ('article_view', 'page_view')
       AND a.title IS NOT NULL
       AND json_extract_string(a.detail, '$.slug') IS NOT NULL
       AND json_extract_string(a.detail, '$.slug') != ''
       AND a.title NOT LIKE '/%'
     GROUP BY a.title, slug, section
     ORDER BY reader_count DESC, last_read DESC
     LIMIT 10`
  );

  // Newly published content (distinct titles, most recent first)
  const newContent = await queryAll<{ title: string; section: string | null; slug: string | null; first_seen: string }>(
    `SELECT
       a.title,
       json_extract_string(a.detail, '$.section') AS section,
       json_extract_string(a.detail, '$.slug') AS slug,
       MIN(a.occurred_at) AS first_seen
     FROM activities a
     WHERE a.activity_type IN ('article_view', 'page_view')
       AND a.title IS NOT NULL
       AND json_extract_string(a.detail, '$.slug') IS NOT NULL
       AND json_extract_string(a.detail, '$.slug') != ''
       AND a.title NOT LIKE '/%'
     GROUP BY a.title, section, slug
     ORDER BY first_seen DESC
     LIMIT 5`
  );

  return {
    totalCompanies: counts.totalCompanies,
    totalContacts: counts.totalContacts,
    totalActivities: counts.totalActivities,
    avgScore: scoreRow?.avgScore ?? null,
    recentActivity,
    topCompanies,
    topArticles,
    newContent,
  };
}

/** Get individual readers for a specific article (by slug) */
export async function getArticleReaders(slug: string): Promise<ArticleReader[]> {
  return queryAll<ArticleReader>(
    `SELECT
       ct.name AS contact_name,
       ct.email AS contact_email,
       comp.name AS company_name,
       MAX(a.occurred_at) AS occurred_at
     FROM activities a
     LEFT JOIN contacts ct ON a.contact_id = ct.id
     LEFT JOIN companies comp ON a.company_id = comp.id
     WHERE a.activity_type IN ('article_view', 'page_view')
       AND json_extract_string(a.detail, '$.slug') = $slug
     GROUP BY ct.email, ct.name, comp.name
     ORDER BY occurred_at DESC`
  , { $slug: slug });
}
